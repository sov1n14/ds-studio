/**
 * Scenario: an open DeepSeek tab saving a restore record must not erase records that another context (the popup import, another tab) wrote to `restored_messages` after the tab loaded it.
 *
 * Requirements (docs/spec/05-data-storage.md "Import merge rule", docs/spec/04-features.md §20 "Storage Records"):
 * - The import merges into the local `restored_messages` and every other local record is kept; the content script only trims to the newest 200 at its next save, so a tab save must not drop an imported record.
 * - Every open tab saves into the same `restored_messages` key, so one tab's save must not drop another tab's record.
 * - Records without `censored: true` are never taken into a tab's records (the same rule `_loadRestoredMessages()` applies on load).
 * - When the tab's startup load cannot read the clear generation, the tab's next save whose read succeeds keeps every stored record: an unknown generation is never a reason to drop records.
 *
 * Trust boundary: only `chrome.storage` is faked (the copying in-memory double from test/setup/vitest.setup.js). The real `StorageManager` and the real `CensorReplyRestore` modules share it; each tab is a real module instance.
 * Saves go through `_onFragmentComplete()`, the handler the page's DSS_FRAGMENT_COMPLETE window message reaches, which fires the save without awaiting it, as in production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';
import { settle, persistedKeys, fragmentPayload, exportedRecord, holdRestoredReads, loadSecondTab, failRestoredReads, requestsGenerationKey } from '../helpers/censor-reply-restore-harness.js';

const extraTabs = [];

beforeEach(() => {
    resetCensorReplyRestore();
});

afterEach(() => {
    // 關閉本測試開出的其他分頁實例，避免監聽器殘留到下一個測試
    while (extraTabs.length) extraTabs.pop().disable();
    resetCensorReplyRestore();
    vi.restoreAllMocks();
});

describe('CensorReplyRestore — a tab save keeps records other contexts wrote after the tab loaded', () => {
    it('keeps a record imported from the popup after the tab started when the tab saves its own record', async () => {
        // 分頁啟動時 storage 為空，載入一次
        await CensorReplyRestore.start();

        // 彈出視窗匯入一筆記錄（真實 StorageManager 合併路徑）
        await StorageManager.mergeRestoredMessages({ 'sessIMP::5': exportedRecord('sessIMP', 5) });
        expect(await persistedKeys(), 'precondition: the import must have persisted its record').toEqual(['sessIMP::5']);

        // 分頁隨後收到一段被審查回覆並存檔
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sessLIVE', 9, 'live reply'));
        await settle();

        expect(await persistedKeys(), 'the tab save must keep the imported record and add its own').toEqual(['sessIMP::5', 'sessLIVE::9']);
        const stored = await StorageManager.getRestoredMessages();
        expect(stored['sessIMP::5'].fragments[0].content, 'the imported record content must be unchanged').toBe('imported reply 5');
    });

    it('keeps both records when two open tabs each save one', async () => {
        // 兩個分頁都在 storage 為空時啟動
        const tabA = CensorReplyRestore;
        await tabA.start();
        const tabB = await loadSecondTab();
        extraTabs.push(tabB);
        expect(tabB, 'precondition: the second tab must be a separate module instance').not.toBe(tabA);
        await tabB.start();

        tabA._onFragmentComplete(fragmentPayload('sA', 1, 'reply in tab A'));
        await settle();
        expect(await persistedKeys(), 'precondition: tab A must have persisted its record').toEqual(['sA::1']);

        tabB._onFragmentComplete(fragmentPayload('sB', 2, 'reply in tab B'));
        await settle();

        expect(await persistedKeys(), 'tab B saving must not erase the record tab A saved').toEqual(['sA::1', 'sB::2']);
    });

    it('keeps all three records when one tab fires three saves without awaiting them', async () => {
        await CensorReplyRestore.start();

        // 正式呼叫端不 await 存檔，三次存檔同時進行
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sC', 1, 'first'));
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sC', 2, 'second'));
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sC', 3, 'third'));
        await settle();

        expect(await persistedKeys(), 'overlapping saves in one tab must not lose any record').toEqual(['sC::1', 'sC::2', 'sC::3']);
    });

    it('does not take an imported record lacking censored: true into the tab records when the tab saves', async () => {
        await CensorReplyRestore.start();

        // 匯入兩筆未標記 censored: true 的記錄：一筆為 false，一筆缺少該欄位
        const missingFlag = exportedRecord('sessIMP', 7);
        delete missingFlag.censored;
        await StorageManager.mergeRestoredMessages({
            'sessIMP::6': exportedRecord('sessIMP', 6, { censored: false }),
            'sessIMP::7': missingFlag
        });
        expect(await persistedKeys(), 'precondition: the import must have persisted both records').toEqual(['sessIMP::6', 'sessIMP::7']);

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sessLIVE', 9, 'live reply'));
        await settle();

        expect(await persistedKeys(), 'records without censored: true must not be written back by the tab save').toEqual(['sessLIVE::9']);
        expect(Object.keys(CensorReplyRestore._restoredMessages).sort(), 'records without censored: true must not enter the tab records').toEqual(['sessLIVE::9']);
    });
});

/**
 * Clear guard: a "clear all" that another context commits while a tab save sits between its storage read and its write must not be undone by that write.
 *
 * The clear is the production popup flow (docs/spec/05-data-storage.md "Clear All Restored Records"): the popup removes `restored_messages` through the real `StorageManager.clearRestoredMessages()`, then every open tab receives `DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES` through its real `chrome.runtime.onMessage` listener.
 * The interleaving is driven only at the `chrome.storage` boundary: while armed, a read of `restored_messages` takes its snapshot at call time (as the double does) but its result is held back until the test releases it, so the save has already read the pre-clear records when the clear commits.
 */
describe('CensorReplyRestore — a clear committed while a tab save is between its read and its write', () => {
    // 彈出視窗的「清除全部」：先移除 storage 鍵，再通知每個分頁（經由分頁真實的 onMessage 監聽器）
    async function popupClearAll() {
        await StorageManager.clearRestoredMessages();
        chrome.runtime.onMessage.callListeners({ type: DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES }, {}, () => {});
        await settle();
    }

    // 分頁啟動後，另一個情境（彈出視窗匯入）寫入一筆記錄，該筆只存在 storage、不在分頁記憶體中
    async function startTabThenImportOtherRecord() {
        await CensorReplyRestore.start();
        await StorageManager.mergeRestoredMessages({ 'sessIMP::5': exportedRecord('sessIMP', 5) });
        expect(await persistedKeys(), 'precondition: the other context must have persisted its record').toEqual(['sessIMP::5']);
    }

    // 分頁收到被審查回覆並開始存檔，直到存檔的讀取被攔下
    async function startSaveAndHoldItsRead() {
        const gate = holdRestoredReads();
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sessLIVE', 9, 'live reply'));
        await settle();
        expect(gate.heldCount(), 'precondition: the tab save must have read restored_messages and be waiting on that read').toBeGreaterThan(0);
        gate.disarm();
        return gate;
    }

    it('does not bring back the cleared records when the clear commits after the save read them', async () => {
        await startTabThenImportOtherRecord();
        const gate = await startSaveAndHoldItsRead();

        expect(chrome.runtime.onMessage.listenerCount(), 'precondition: the tab must listen for the clear message').toBeGreaterThan(0);
        await popupClearAll();
        expect(await persistedKeys(), 'precondition: the clear must have committed before the save writes').toEqual([]);

        gate.release();
        await settle();

        const keys = await persistedKeys();
        expect(keys, 'a record that existed before the clear must not be written back by the save').not.toContain('sessIMP::5');
        expect(keys.filter((k) => k !== 'sessLIVE::9'), 'after the clear, storage may hold at most the saving tab\'s own new record').toEqual([]);
    });

    it('does not bring back the cleared records when only the storage clear reached storage and the tab never got the clear message', async () => {
        await startTabThenImportOtherRecord();
        const gate = await startSaveAndHoldItsRead();
        // 彈出視窗移除 storage 鍵，但送往分頁的 CLEAR_RESTORED_MESSAGES 投遞失敗：分頁只能從 storage 得知這次清除
        await StorageManager.clearRestoredMessages();
        await settle();
        expect(await persistedKeys(), 'precondition: the clear must have committed before the save writes').toEqual([]);

        gate.release();
        await settle();

        const keys = await persistedKeys();
        expect(keys, 'a record that existed before the clear must not be written back by the save').not.toContain('sessIMP::5');
        expect(keys.filter((k) => k !== 'sessLIVE::9'), "after the clear, storage may hold at most the saving tab's own new record").toEqual([]);
    });

    it('control: without a clear, the held save still keeps the record the other context wrote', async () => {
        await startTabThenImportOtherRecord();
        const gate = await startSaveAndHoldItsRead();

        gate.release();
        await settle();

        expect(await persistedKeys(), 'the tab save must keep the other context\'s record and add its own').toEqual(['sessIMP::5', 'sessLIVE::9']);
    });
});

describe('CensorReplyRestore — the tab startup load cannot read the clear generation', () => {
    it.each([['lastError'], ['throw']])('keeps every stored record on the next save when the startup generation read fails once with %s', async (mode) => {
        // 先清除一次讓世代至少為 1，之後其他情境存入兩筆記錄
        await StorageManager.clearRestoredMessages();
        await StorageManager.mergeRestoredMessages({ 'sOLD::3': exportedRecord('sOLD', 3), 'sessIMP::5': exportedRecord('sessIMP', 5) });
        const generationKey = StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY;
        expect((await chrome.storage.local.get(generationKey))[generationKey], 'precondition: the clear must have raised the clear generation to 1 or more').toBeGreaterThanOrEqual(1);
        expect(await persistedKeys(), 'precondition: both stored records must be persisted').toEqual(['sOLD::3', 'sessIMP::5']);

        const failure = failRestoredReads(mode, { limit: 1, matches: requestsGenerationKey });
        await CensorReplyRestore.start();
        await settle();
        expect(failure.failedForms(), 'precondition: the startup load must have hit the one failing generation read').toHaveLength(1);

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();

        expect(await persistedKeys(), 'the save must keep both stored records and add its own').toEqual(['sNEW::1', 'sOLD::3', 'sessIMP::5']);
    });
});
