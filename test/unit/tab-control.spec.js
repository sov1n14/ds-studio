/**
 * RED-phase spec for utils/tab-control.js (backlog B1 / B17).
 *
 * Contract under test — a popup-facing adapter over chrome.tabs that never
 * throws at its callers:
 *
 *   queryActiveDeepseekTab()
 *     - queries chrome.tabs.query({active:true, currentWindow:true,
 *       url:'*://chat.deepseek.com/*'}) — the url condition is pushed into the
 *       query rather than filtered in JS (B17)
 *     - resolves the FIRST matching tab, or null when nothing matches
 *     - a rejected query resolves null and logs a '[DSS]'-prefixed console.error
 *
 *   sendToTab(tabId, message)
 *     - forwards to chrome.tabs.sendMessage(tabId, message) and resolves the response
 *     - a rejected send resolves undefined and logs a '[DSS]'-prefixed console.error
 *       (popup callers today treat a failed send as non-fatal)
 *
 * The chrome.tabs mock comes from test/setup/vitest.setup.js; each test installs
 * its own vi.fn() implementations.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { queryActiveDeepseekTab, sendToTab } = await import('../../utils/tab-control.js');

const ACTIVE_DEEPSEEK_QUERY = {
    active: true,
    currentWindow: true,
    url: '*://chat.deepseek.com/*',
};

/** True when any console.error call carried a '[DSS]'-prefixed string argument. */
const loggedDssError = (spy) =>
    spy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('[DSS]')),
    );

describe('DSSTabControl', () => {
    let errorSpy;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('publishes queryActiveDeepseekTab and sendToTab on globalThis.DSSTabControl', () => {
        expect(typeof globalThis.DSSTabControl?.queryActiveDeepseekTab).toBe('function');
        expect(typeof globalThis.DSSTabControl?.sendToTab).toBe('function');
    });

    describe('queryActiveDeepseekTab', () => {
        it('scopes the query to the active DeepSeek tab of the current window', async () => {
            chrome.tabs.query = vi.fn().mockResolvedValue([]);

            await queryActiveDeepseekTab();

            expect(chrome.tabs.query).toHaveBeenCalledWith(ACTIVE_DEEPSEEK_QUERY);
        });

        it('resolves the first matching tab', async () => {
            const first = { id: 42, url: 'https://chat.deepseek.com/a/chat/s/abc' };
            const second = { id: 77, url: 'https://chat.deepseek.com/' };
            chrome.tabs.query = vi.fn().mockResolvedValue([first, second]);

            await expect(queryActiveDeepseekTab()).resolves.toEqual(first);
        });

        it('resolves null when no DeepSeek tab matches', async () => {
            chrome.tabs.query = vi.fn().mockResolvedValue([]);

            await expect(queryActiveDeepseekTab()).resolves.toBeNull();
            expect(loggedDssError(errorSpy)).toBe(false);
        });

        it('resolves null and logs a [DSS] error when the query rejects', async () => {
            chrome.tabs.query = vi.fn().mockRejectedValue(new Error('tabs API error'));

            await expect(queryActiveDeepseekTab()).resolves.toBeNull();
            expect(loggedDssError(errorSpy)).toBe(true);
        });
    });

    describe('sendToTab', () => {
        it('forwards the tab id and message and resolves the response', async () => {
            chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: true, count: 3 });

            const response = await sendToTab(42, { action: 'HARVEST' });

            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'HARVEST' });
            expect(response).toEqual({ ok: true, count: 3 });
        });

        it('resolves undefined and logs a [DSS] error when the send rejects', async () => {
            chrome.tabs.sendMessage = vi
                .fn()
                .mockRejectedValue(new Error('Could not establish connection'));

            await expect(sendToTab(42, { action: 'HARVEST' })).resolves.toBeUndefined();
            expect(loggedDssError(errorSpy)).toBe(true);
        });

        it('resolves a falsy response as-is without treating it as a failure', async () => {
            chrome.tabs.sendMessage = vi.fn().mockResolvedValue(undefined);

            await expect(sendToTab(42, { action: 'PING' })).resolves.toBeUndefined();
            expect(loggedDssError(errorSpy)).toBe(false);
        });
    });
});
