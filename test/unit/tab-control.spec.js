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
 *     - a rejected send resolves undefined and logs a '[DSS]'-prefixed console.debug
 *       (popup callers today treat a failed send as non-fatal)
 *
 * The chrome.tabs mock comes from test/setup/vitest.setup.js; each test installs
 * its own vi.fn() implementations.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeTabs } from '../helpers/fake-chrome-tabs.js';

const tabControlModule = await import('../../utils/tab-control.js');
const { queryActiveDeepseekTab, sendToTab, broadcastActivePreset } = tabControlModule;

const ACTIVE_DEEPSEEK_QUERY = {
    active: true,
    currentWindow: true,
    url: '*://chat.deepseek.com/*',
};

/** True when any call on the given spy carried a '[DSS]'-prefixed string argument. */
const loggedDss = (spy) =>
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
            expect(loggedDss(errorSpy)).toBe(false);
        });

        it('resolves null and logs a [DSS] error when the query rejects', async () => {
            chrome.tabs.query = vi.fn().mockRejectedValue(new Error('tabs API error'));

            await expect(queryActiveDeepseekTab()).resolves.toBeNull();
            expect(loggedDss(errorSpy)).toBe(true);
        });
    });

    describe('sendToTab', () => {
        it('forwards the tab id and message and resolves the response', async () => {
            chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: true, count: 3 });

            const response = await sendToTab(42, { action: 'HARVEST' });

            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'HARVEST' });
            expect(response).toEqual({ ok: true, count: 3 });
        });

        it('resolves undefined and logs a [DSS] debug when the send rejects', async () => {
            const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            chrome.tabs.sendMessage = vi
                .fn()
                .mockRejectedValue(new Error('Could not establish connection'));

            await expect(sendToTab(42, { action: 'HARVEST' })).resolves.toBeUndefined();
            expect(loggedDss(debugSpy)).toBe(true);
            expect(loggedDss(errorSpy)).toBe(false);
        });

        it('resolves a falsy response as-is without treating it as a failure', async () => {
            const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            chrome.tabs.sendMessage = vi.fn().mockResolvedValue(undefined);

            await expect(sendToTab(42, { action: 'PING' })).resolves.toBeUndefined();
            expect(loggedDss(errorSpy)).toBe(false);
            expect(loggedDss(debugSpy)).toBe(false);
        });
    });

    // ── broadcastActivePreset: BROADCAST COMPOSITION (ported from messaging.spec.js) ──
    // Fans ACTIVE_PRESET_CHANGED out to every DeepSeek tab, built on
    // queryDeepseekTabs() + sendToTab(). Individual tab failures are swallowed
    // by sendToTab and must not block the others or reject the overall call.
    describe('broadcastActivePreset', () => {
        const message = (presetId, presetContent) => ({
            action: 'ACTIVE_PRESET_CHANGED',
            presetId,
            presetContent,
        });
        const deliveries = (sendMessage) =>
            sendMessage.mock.calls.map(([tabId, payload]) => ({ tabId, payload }));
        const deliveredTabIds = (sendMessage) =>
            sendMessage.mock.calls.map(([tabId]) => tabId).sort((a, b) => a - b);

        it('delivers ACTIVE_PRESET_CHANGED to every matching chat.deepseek.com tab', async () => {
            chrome.tabs.query = vi.fn().mockResolvedValue([
                { id: 42, url: 'https://chat.deepseek.com/a/chat/s/abc' },
                { id: 77, url: 'https://chat.deepseek.com/' },
                { id: 99, url: 'https://chat.deepseek.com/a/chat/s/xyz' },
            ]);
            chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

            await broadcastActivePreset('preset-1', 'Hello world');

            expect(chrome.tabs.query).toHaveBeenCalledWith({ url: '*://chat.deepseek.com/*' });
            expect(deliveredTabIds(chrome.tabs.sendMessage)).toEqual([42, 77, 99]);
            for (const tabId of [42, 77, 99]) {
                expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
                    tabId,
                    message('preset-1', 'Hello world'),
                );
            }
        });

        it('delivers an empty presetId (selection cleared) to every matching tab', async () => {
            chrome.tabs.query = vi.fn().mockResolvedValue([
                { id: 42, url: 'https://chat.deepseek.com/' },
                { id: 77, url: 'https://chat.deepseek.com/' },
            ]);
            chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

            await broadcastActivePreset('', '');

            expect(deliveries(chrome.tabs.sendMessage)).toEqual([
                { tabId: 42, payload: message('', '') },
                { tabId: 77, payload: message('', '') },
            ]);
        });

        it('still delivers to the remaining tabs when one tab rejects, and resolves', async () => {
            chrome.tabs.query = vi.fn().mockResolvedValue([
                { id: 42, url: 'https://chat.deepseek.com/' },
                { id: 77, url: 'https://chat.deepseek.com/' },
                { id: 99, url: 'https://chat.deepseek.com/' },
            ]);
            chrome.tabs.sendMessage = vi.fn().mockImplementation((tabId) =>
                tabId === 77
                    ? Promise.reject(new Error('Could not establish connection'))
                    : Promise.resolve({}),
            );

            await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();

            expect(deliveredTabIds(chrome.tabs.sendMessage)).toEqual([42, 77, 99]);
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, message('preset-1', 'Hello'));
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, message('preset-1', 'Hello'));
        });

        it('still delivers to the remaining tabs when the FIRST tab rejects', async () => {
            chrome.tabs.query = vi.fn().mockResolvedValue([
                { id: 42, url: 'https://chat.deepseek.com/' },
                { id: 77, url: 'https://chat.deepseek.com/' },
            ]);
            chrome.tabs.sendMessage = vi.fn().mockImplementation((tabId) =>
                tabId === 42
                    ? Promise.reject(new Error('Receiving end does not exist'))
                    : Promise.resolve({}),
            );

            await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();

            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(77, message('preset-1', 'Hello'));
        });

        it('skips a tab with no id but still delivers to the tabs that have one', async () => {
            chrome.tabs.query = vi.fn().mockResolvedValue([
                { url: 'https://chat.deepseek.com/' },
                { id: 77, url: 'https://chat.deepseek.com/' },
            ]);
            chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

            await broadcastActivePreset('preset-1', 'Hello');

            expect(deliveries(chrome.tabs.sendMessage)).toEqual([
                { tabId: 77, payload: message('preset-1', 'Hello') },
            ]);
        });

        it('resolves without sending when no tab matches', async () => {
            chrome.tabs.query = vi.fn().mockResolvedValue([]);
            chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

            await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();

            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });

        it('swallows a tabs.query rejection without throwing and sends nothing', async () => {
            chrome.tabs.query = vi.fn().mockRejectedValue(new Error('tabs API error'));
            chrome.tabs.sendMessage = vi.fn();

            await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });
    });
});

// ── sendActivePresetToActiveTab：彈出視窗選取的群組只送往彈出視窗底下的分頁 ──
// 需求：彈出視窗選取群組只影響目前視窗中作用中的 DeepSeek 分頁；同視窗的其他 DeepSeek 分頁與其他視窗的作用中分頁都不得收到。
// 分頁表替身（test/helpers/fake-chrome-tabs.js）依 active、currentWindow 與網址樣式誠實過濾，投遞以實際收件分頁記錄。
describe('sendActivePresetToActiveTab', () => {
    const DEEPSEEK_TABS = [
        { id: 11, windowId: 1, active: true, url: 'https://chat.deepseek.com/a/chat/s/aaa' },
        { id: 12, windowId: 1, active: false, url: 'https://chat.deepseek.com/' },
        { id: 13, windowId: 2, active: true, url: 'https://chat.deepseek.com/a/chat/s/ccc' },
    ];
    let fake;

    /** 取得受測函式；尚未實作時以指名的訊息失敗，而非籠統的 TypeError。 */
    function target() {
        const fn = tabControlModule.sendActivePresetToActiveTab;
        expect(typeof fn, 'utils/tab-control.js 必須匯出 sendActivePresetToActiveTab(presetId, presetContent)').toBe('function');
        return fn;
    }

    /** 呼叫受測函式並把結局轉成可比對的文字：同步拋出與 rejection 都帶出錯誤訊息。 */
    async function outcomeOf(presetId, presetContent) {
        const fn = target();
        try {
            await fn(presetId, presetContent);
            return 'resolved';
        } catch (err) {
            return `threw or rejected: ${err?.message ?? err}`;
        }
    }

    beforeEach(() => {
        fake = undefined;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        const fakeErrors = fake?.fakeErrors ?? [];
        fake?.restore();
        vi.restoreAllMocks();
        expect(fakeErrors, '前提：受測程式只用替身認得的查詢條件').toEqual([]);
    });

    it('is published on globalThis.DSSTabControl', () => {
        fake = installFakeTabs([]);
        expect(typeof globalThis.DSSTabControl?.sendActivePresetToActiveTab, 'DSSTabControl 必須公開 sendActivePresetToActiveTab 供彈出視窗呼叫').toBe('function');
    });

    it('delivers ACTIVE_PRESET_CHANGED only to the active DeepSeek tab of the current window', async () => {
        fake = installFakeTabs(DEEPSEEK_TABS);

        expect(await outcomeOf('preset-X', 'C')).toBe('resolved');

        expect(fake.deliveries, '只有目前視窗的作用中 DeepSeek 分頁（11）收到；同視窗非作用中分頁（12）與其他視窗作用中分頁（13）都不得收到').toEqual([
            { tabId: 11, message: { action: 'ACTIVE_PRESET_CHANGED', presetId: 'preset-X', presetContent: 'C' } },
        ]);
    });

    it('delivers nothing and resolves when the active tab of the current window is not DeepSeek', async () => {
        fake = installFakeTabs([
            { id: 21, windowId: 1, active: true, url: 'https://example.com/' },
            { id: 22, windowId: 1, active: false, url: 'https://chat.deepseek.com/' },
            { id: 23, windowId: 2, active: true, url: 'https://chat.deepseek.com/' },
        ]);

        expect(await outcomeOf('preset-X', 'C'), '沒有可送的分頁時照常完成').toBe('resolved');

        expect(fake.deliveries, '作用中分頁不是 DeepSeek 時，任何 DeepSeek 分頁都不得收到').toEqual([]);
    });

    it('resolves without throwing when chrome.tabs.sendMessage rejects', async () => {
        fake = installFakeTabs(DEEPSEEK_TABS, { route: () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')) });

        expect(await outcomeOf('preset-X', 'C'), '送出失敗不得讓呼叫端收到 rejection').toBe('resolved');

        expect(fake.deliveries.map((d) => d.tabId), '失敗前只嘗試送往作用中分頁 11').toEqual([11]);
    });

    it('resolves without throwing when chrome.tabs.query rejects', async () => {
        fake = installFakeTabs(DEEPSEEK_TABS);
        chrome.tabs.query = () => Promise.reject(new Error('tabs API error'));

        expect(await outcomeOf('preset-X', 'C'), '查詢分頁失敗不得讓呼叫端收到 rejection').toBe('resolved');

        expect(fake.deliveries, '查不到分頁時不送出任何訊息').toEqual([]);
    });

    it('resolves without throwing when chrome.tabs.sendMessage throws synchronously', async () => {
        fake = installFakeTabs(DEEPSEEK_TABS, { route: () => { throw new Error('Extension context invalidated.'); } });

        expect(await outcomeOf('preset-X', 'C'), 'sendMessage 同步例外不得同步拋出，也不得讓呼叫端收到 rejection').toBe('resolved');

        expect(fake.deliveries.map((d) => d.tabId), '拋出前只嘗試送往作用中分頁 11').toEqual([11]);
    });
});
