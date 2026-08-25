/**
 * content/main-world-injector.js — MAIN-world script injection contract.
 *
 * Post-implementation DOM-adapter coverage. Everything below is asserted
 * through observable output — the <script> elements that reach the document,
 * the arguments handed to chrome.runtime.getURL, the return value of inject()
 * and what reaches console.error — never through internal call sequences.
 *
 * Why a MutationObserver instead of querySelectorAll: an injected MAIN-world
 * <script> is self-removing (it has already executed by the time the tag is
 * detached), so the document is empty again by assertion time. The observer
 * records what was appended and in which order, which is exactly the behavior
 * that matters, and the recorded nodes keep their src after detachment.
 *
 * The module auto-starts on load, so every arrangement (getURL stub, console
 * spy, observer) must be in place BEFORE the fresh dynamic import in load().
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const EXPECTED_SCRIPTS = [
    'content/sse-parser.js',
    'content/censor-xhr-hook.js',
    'content/temporary-chat-history-hook.js',
    'content/temporary-chat-fiber-delete.js',
];

// happy-dom synchronously fetches any connected <script src>, and throws a noisy
// DOMException for the chrome-extension: scheme it cannot fetch. A data: URL is
// fetchable, keeps the run output clean, and still carries the path so both the
// order and the identity of each injected script stay assertable.
const url = (path) => `data:text/javascript,//${path}`;

let observer;
let appendedSrcs;

/** Start recording every <script src> added anywhere under <html>. */
function watchScripts() {
    appendedSrcs = [];
    observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeName === 'SCRIPT') appendedSrcs.push(node.getAttribute('src'));
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

/** MutationObserver records are delivered asynchronously; give them a tick. */
function settleObserver() {
    return new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Load a pristine copy of the module against the currently stubbed globals.
 * vi.resetModules() is required because the injected-once flag lives in the
 * module closure: without it, one spec would inherit the previous spec's
 * "already injected" state.
 */
async function load() {
    vi.resetModules();
    delete globalThis.DSSMainWorldInjector;
    await import('../../content/main-world-injector.js');
    await settleObserver();
    return globalThis.DSSMainWorldInjector;
}

beforeEach(() => {
    document.querySelectorAll('script').forEach((s) => s.remove());
    chrome.runtime.getURL.mockReset();
    chrome.runtime.getURL.mockImplementation(url);
    watchScripts();
});

afterEach(() => {
    observer.disconnect();
    document.querySelectorAll('script').forEach((s) => s.remove());
    delete globalThis.DSSMainWorldInjector;
    vi.restoreAllMocks();
});

describe('MAIN_WORLD_SCRIPTS', () => {
    it('lists exactly the four MAIN-world scripts, sse-parser first', async () => {
        const { MAIN_WORLD_SCRIPTS } = await load();
        expect(MAIN_WORLD_SCRIPTS).toEqual(EXPECTED_SCRIPTS);
    });
});

describe('inject()', () => {
    it('appends exactly four <script> elements in declared order', async () => {
        await load();
        expect(appendedSrcs).toEqual(EXPECTED_SCRIPTS.map(url));
    });

    it('resolves every src through chrome.runtime.getURL, in declared order', async () => {
        await load();
        expect(chrome.runtime.getURL.mock.calls.map(([p]) => p)).toEqual(EXPECTED_SCRIPTS);
    });

    it('is idempotent: a second call appends nothing', async () => {
        const injector = await load();
        const afterAutoStart = [...appendedSrcs];

        injector.inject();
        await settleObserver();

        expect(appendedSrcs).toEqual(afterAutoStart);
        expect(appendedSrcs).toHaveLength(4);
    });

    it('returns false and logs a [DSS] error instead of throwing when getURL fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        chrome.runtime.getURL.mockImplementation(() => {
            throw new Error('extension context invalidated');
        });

        const injector = await load();

        expect(() => injector.inject()).not.toThrow();
        expect(injector.inject()).toBe(false);
        expect(consoleError).toHaveBeenCalled();
        expect(consoleError.mock.calls.flat().join(' ')).toContain('[DSS]');
    });
});
