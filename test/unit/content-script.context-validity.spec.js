/**
 * content/content-script.js — isExtensionContextValid() and its wiring into
 * the invalidation watcher.
 *
 * Requirement (from the directive, NOT from reading the implementation):
 *   isExtensionContextValid() returns true only when chrome.runtime.id is a
 *   non-empty string. An invalidated extension context surfaces as
 *   chrome.runtime.id === undefined (see temporary-chat-delete.handlers.js and
 *   temporary-chat-delete.chain-safety.spec.js), so undefined id, missing
 *   chrome.runtime, and a throwing id getter all return false.
 *
 * Required test surface: content-script.js module.exports.isExtensionContextValid.
 *
 * End-to-end: with the real invalidation-watcher.js and invalidation-toast.js
 * loaded, content-script.js starts the watcher at load; once chrome.runtime.id
 * becomes undefined, one 30 000 ms tick must put exactly one
 * .ds-invalidation-toast into document.body.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const INTERVAL = 30_000;
const originalRuntime = globalThis.chrome.runtime;

let contentScript;

async function loadContentScript() {
    vi.resetModules();
    await import('../../utils/storage-manager.js');
    await import('../../content/invalidation-watcher.js');
    await import('../../content/invalidation-toast.js');
    contentScript = (await import('../../content/content-script.js')).default;
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    globalThis.chrome.runtime = originalRuntime;
    originalRuntime.id = 'test-extension-id';
    document.body.innerHTML = '';
});

afterEach(() => {
    globalThis.chrome.runtime = originalRuntime;
    originalRuntime.id = 'test-extension-id';
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('isExtensionContextValid()', () => {
    beforeEach(loadContentScript);

    function check() {
        expect(typeof contentScript.isExtensionContextValid,
            'content-script.js must expose isExtensionContextValid via module.exports').toBe('function');
        return contentScript.isExtensionContextValid();
    }

    it('returns true when chrome.runtime.id is a non-empty string', () => {
        chrome.runtime.id = 'abc';
        expect(check()).toBe(true);
    });

    it('returns false when chrome.runtime.id is undefined (invalidated context)', () => {
        chrome.runtime.id = undefined;
        expect(check()).toBe(false);
    });

    it('returns false when chrome.runtime.id is an empty string', () => {
        chrome.runtime.id = '';
        expect(check()).toBe(false);
    });

    it('returns false when chrome.runtime itself is undefined', () => {
        globalThis.chrome.runtime = undefined;
        expect(check()).toBe(false);
    });

    it('returns false when reading chrome.runtime.id throws', () => {
        globalThis.chrome.runtime = {
            ...originalRuntime,
            get id() { throw new Error('Extension context invalidated.'); },
        };
        expect(check()).toBe(false);
    });
});

describe('invalidation watcher wired by content-script.js', () => {
    it('shows exactly one toast after one interval once chrome.runtime.id becomes undefined', async () => {
        await loadContentScript();
        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(0);

        chrome.runtime.id = undefined;
        vi.advanceTimersByTime(INTERVAL);

        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(1);

        vi.advanceTimersByTime(INTERVAL * 3);
        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(1);
    });

    it('shows exactly one toast after one interval once reading chrome.runtime.id throws', async () => {
        await loadContentScript();
        globalThis.chrome.runtime = {
            ...originalRuntime,
            get id() { throw new Error('Extension context invalidated.'); },
        };
        vi.advanceTimersByTime(INTERVAL);
        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(1);
    });

    it('shows no toast while chrome.runtime.id stays valid', async () => {
        await loadContentScript();
        vi.advanceTimersByTime(INTERVAL * 3);
        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(0);
    });
});
