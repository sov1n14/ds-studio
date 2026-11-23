/**
 * 情境（content script 接線）：未綁定、也沒有待綁群組的對話上，另一個分頁新增群組 D，設定廣播送達本分頁；這時沒有任何群組的前綴需要讀取，所以即使重算前綴用的設定讀取會失敗，廣播的處理也要照常完成：浮動選單列出 D，前綴保持空白，沒有錯誤被記錄，也沒有未處理的 rejection。
 *
 * 需求：docs/FEATURES.md「In-Page Quick Switch Overlay」（Bidirectional Sync：popup 或其他地方的變更立即反映在浮動選單）與「Conversation-Bound Prompt Groups」（未綁定的對話不帶任何群組）。推得的規則：未綁定且無待綁群組時，前綴重算不依賴設定讀取，讀取失敗不得擋下同一則廣播的選單更新，也不得記成錯誤。
 *
 * 失敗注入：StorageManager 讀取 chrome.storage 失敗時回傳空結果、不會 reject，所以 chrome.storage 替身無法讓讀取 reject（testing-pitfalls「Boundary Test Doubles Must Copy」）；本檔在模組接縫 stub StorageManager.getSettings，只讓呼叫堆疊含 updatePromptPrefixFromBinding 的讀取 reject，其餘讀取照常，所以觀察到的失敗只屬於前綴重算。第二個案例在已綁定的對話上確認這個 stub 確實攔得到前綴重算的讀取，讓第一個案例「沒有讀取失敗」的結果有意義。
 *
 * 只模擬信任邊界：test/helpers/overlay-consistency-harness.js 的記憶體版 chrome.storage（真實 Chrome onChanged 語意）、SW 設定轉送與 SW chat-map writer；content 模組皆為真實模組。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { preset, settle, shownValue, injected, setUpOverlayScenario, openChat, contentScript } from '../helpers/overlay-consistency-harness.js';

const CHAT = '/a/chat/s/dddddddd-4444-4444-4444-444444444444';
const UUID = 'dddddddd-4444-4444-4444-444444444444';
const A = preset('preset-A', 'Alpha', 'PREFIX-A', false);
const D = preset('preset-D', 'Delta', 'PREFIX-D', false);

async function seedDeviceSettings() {
    const items = { globalPromptEnabled: false, globalDefaultPrompt: '', isEnabled: true };
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    await settle();
}

/** 另一個分頁新增群組 D：兩個 storage 區都寫入新的群組索引與 D，本分頁收到設定廣播。 */
async function otherTabAddsD() {
    const item = { dsPresetIndex: [A.id, D.id], [`dsPreset_${D.id}`]: D };
    await chrome.storage.sync.set(item);
    await chrome.storage.local.set(item);
}

const listedOptions = () => [...contentScript.PresetOverlay.dropdown.menu.querySelectorAll('.dss-preset-option')].map((el) => el.getAttribute('data-value')).filter(Boolean);
const dssErrors = () => console.error.mock.calls.filter((args) => String(args[0]).includes('[DSS]')).map((args) => args.map((a) => String(a?.message ?? a)).join(' '));

describe('a settings broadcast on a chat with no bound or pending group does not depend on the prefix settings read', () => {
    let tearDown;
    let unhandled;
    const onUnhandled = (reason, promise) => { unhandled.set(promise, reason); };
    const onHandledLate = (promise) => { unhandled.delete(promise); };
    // 交給 updatePromptPrefixFromBinding 讀取的錯誤。
    let prefixReadErrors;

    /** 執行 action 期間，呼叫堆疊含 updatePromptPrefixFromBinding 的設定讀取一律 reject，其餘讀取照常；等頁面安靜後還原。 */
    async function whilePrefixReadsReject(action) {
        const readSettings = StorageManager.getSettings.bind(StorageManager);
        const getSettings = vi.spyOn(StorageManager, 'getSettings').mockImplementation((...args) => {
            if (!String(new Error().stack).includes('updatePromptPrefixFromBinding')) return readSettings(...args);
            const err = new Error(`prefix recompute read #${prefixReadErrors.length + 1} failed`);
            prefixReadErrors.push(err);
            return Promise.reject(err);
        });
        try {
            await action();
            await settle();
        } finally {
            getSettings.mockRestore();
        }
    }

    beforeEach(async () => {
        tearDown = await setUpOverlayScenario({ isUnchangedWriteSilent: true });
        unhandled = new Map();
        prefixReadErrors = [];
        process.on('unhandledRejection', onUnhandled);
        process.on('rejectionHandled', onHandledLate);
        await seedDeviceSettings();
    });
    afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
        process.off('rejectionHandled', onHandledLate);
        tearDown();
    });

    it('unbound chat, no pending group: the broadcast still lists the new group D, the prefix stays empty, and nothing is logged or left unhandled', async () => {
        await openChat(CHAT, [A], {});
        expect(contentScript.state.currentChatUuid, 'precondition: the unbound chat is open').toBe(UUID);
        expect(contentScript.state.pendingPresetId ?? null, 'precondition: no pending group').toBeNull();
        expect(shownValue(), 'precondition: the unbound chat shows the blank option').toBe('');
        expect(listedOptions(), 'precondition: the overlay lists only A before the other tab adds D').toEqual([A.id]);
        console.error.mockClear();

        await whilePrefixReadsReject(otherTabAddsD);

        expect.soft(listedOptions(), 'the other tab added D, so the overlay lists D even though a prefix settings read would fail: the unbound chat has no group to read').toEqual([A.id, D.id]);
        expect.soft(shownValue(), 'the unbound chat still shows the blank option').toBe('');
        expect.soft(contentScript.state.promptPrefix, 'the unbound chat has no group, so the prefix stays empty').toBe('');
        expect.soft(injected(), 'a send on the unbound chat carries no group').not.toContain('PREFIX-');
        expect.soft(dssErrors(), 'the broadcast on an unbound chat needs no prefix read, so no failure is logged').toEqual([]);
        expect.soft([...unhandled.values()].map((r) => String(r?.message ?? r)), 'no rejection escapes the broadcast').toEqual([]);
    });

    // 夾具檢查：同一個 stub 在已綁定 A 的對話上確實讓前綴重算的讀取 reject，證明上一個案例沒有讀取失敗不是因為 stub 攔不到。
    it('fixture check: on a chat bound to A the same broadcast makes the stubbed prefix read reject', async () => {
        await openChat(CHAT, [A], { [UUID]: A.id });
        expect(shownValue(), 'precondition: the chat bound to A shows A').toBe(A.id);

        await whilePrefixReadsReject(otherTabAddsD);

        expect(prefixReadErrors.length, 'the stub must reject the prefix settings read that a bound chat issues on the broadcast').toBeGreaterThan(0);
        expect([...unhandled.values()].map((r) => String(r?.message ?? r)), 'the listener boundary catches the rejection').toEqual([]);
    });
});
