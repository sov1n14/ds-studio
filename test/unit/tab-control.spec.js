/**
 * RED-phase spec for utils/tab-control.js (backlog B1 / B17).
 *
 * Contract under test — a popup-facing adapter over chrome.tabs that never throws at its callers:
 *
 *   queryActiveDeepseekTab()
 *     - queries chrome.tabs.query({active:true, currentWindow:true, url:'*://chat.deepseek.com/*'}) — the url condition is pushed into the query rather than filtered in JS (B17)
 *     - resolves the FIRST matching tab, or null when nothing matches
 *     - a rejected query resolves null and logs a '[DSS]'-prefixed console.error
 *
 *   queryDeepseekTabs()
 *     - resolves every DeepSeek chat tab across all windows, active or not, and no other-URL tab
 *     - resolves [] when nothing matches, and [] plus a '[DSS]'-prefixed console.error when the query rejects or throws
 *
 *   sendToTab(tabId, message)
 *     - forwards to chrome.tabs.sendMessage(tabId, message) and resolves the response
 *     - a rejected send resolves undefined and logs a '[DSS]'-prefixed console.debug (popup callers today treat a failed send as non-fatal)
 *
 * The chrome.tabs mock comes from test/setup/vitest.setup.js; each test installs its own vi.fn() implementations or the honest tab double test/helpers/fake-chrome-tabs.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeTabs } from '../helpers/fake-chrome-tabs.js';

const tabControlModule = await import('../../utils/tab-control.js');
const { queryActiveDeepseekTab, sendToTab } = tabControlModule;

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

// ── queryDeepseekTabs：跨視窗查詢所有 DeepSeek 分頁，供廣播型呼叫端使用 ──
// 需求（JSDoc 與 popup/popup.backup-manager.js 清除已還原紀錄的用法）：回傳所有視窗中的 DeepSeek 聊天分頁陣列，不論是否作用中；
// 其他網址的分頁不得列入（呼叫端會對每個回傳分頁送出 CLEAR_RESTORED_MESSAGES）；查詢失敗時回傳空陣列（呼叫端直接對結果呼叫 filter），並記錄 [DSS] 錯誤。
// 分頁表替身（test/helpers/fake-chrome-tabs.js）依網址樣式與視窗條件誠實過濾，未知查詢鍵記入 fakeErrors。
describe('queryDeepseekTabs', () => {
    let fake;
    let errorSpy;

    /** 依 id 排序後取出 id 清單，避免斷言依賴 chrome.tabs.query 的回傳順序。 */
    const sortedIds = (tabs) => tabs.map((t) => t.id).sort((a, b) => a - b);

    beforeEach(() => {
        fake = undefined;
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        const fakeErrors = fake?.fakeErrors ?? [];
        fake?.restore();
        vi.restoreAllMocks();
        expect(fakeErrors, 'precondition: code under test only uses query keys the fake understands').toEqual([]);
    });

    it('returns every DeepSeek chat tab across windows, active or not, and no other-URL tab', async () => {
        fake = installFakeTabs([
            { id: 31, windowId: 1, active: true, url: 'https://chat.deepseek.com/a/chat/s/aaa' },
            { id: 32, windowId: 1, active: false, url: 'https://example.com/chat.deepseek.com/' },
            { id: 33, windowId: 2, active: false, url: 'https://chat.deepseek.com/' },
            { id: 34, windowId: 2, active: true, url: 'https://www.deepseek.com/' },
            { id: 35, windowId: 3, active: true, url: 'https://chat.deepseek.com/a/chat/s/ccc' },
            { id: 36, windowId: 3, active: false, url: 'chrome://extensions/' },
        ]);

        const tabs = await tabControlModule.queryDeepseekTabs();

        expect(Array.isArray(tabs), 'resolves an array the caller can filter').toBe(true);
        expect(sortedIds(tabs), 'all chat.deepseek.com tabs in windows 1, 2 and 3; never example.com, www.deepseek.com or chrome:// tabs').toEqual([31, 33, 35]);
        expect(loggedDss(errorSpy), 'a successful query logs no [DSS] error').toBe(false);
    });

    it('resolves an empty array when no DeepSeek chat tab is open', async () => {
        fake = installFakeTabs([
            { id: 41, windowId: 1, active: true, url: 'https://example.com/' },
            { id: 42, windowId: 2, active: true, url: 'https://www.deepseek.com/' },
        ]);

        await expect(tabControlModule.queryDeepseekTabs(), 'no matching tab resolves [] rather than null or other-URL tabs').resolves.toEqual([]);
        expect(loggedDss(errorSpy), 'an empty result is not an error').toBe(false);
    });

    it('resolves an empty array and logs a [DSS] error when chrome.tabs.query rejects', async () => {
        fake = installFakeTabs([
            { id: 51, windowId: 1, active: true, url: 'https://chat.deepseek.com/' },
        ]);
        chrome.tabs.query = () => Promise.reject(new Error('tabs API error'));

        await expect(tabControlModule.queryDeepseekTabs(), 'a rejected query must not reach the caller').resolves.toEqual([]);
        expect(loggedDss(errorSpy), 'the failure is logged with the [DSS] prefix').toBe(true);
    });

    it('resolves an empty array and logs a [DSS] error when chrome.tabs.query throws synchronously', async () => {
        fake = installFakeTabs([
            { id: 61, windowId: 1, active: true, url: 'https://chat.deepseek.com/' },
        ]);
        chrome.tabs.query = () => { throw new Error('Extension context invalidated.'); };

        await expect(tabControlModule.queryDeepseekTabs(), 'a synchronous throw must not reach the caller').resolves.toEqual([]);
        expect(loggedDss(errorSpy), 'the failure is logged with the [DSS] prefix').toBe(true);
    });
});
