/**
 * Scenario: how a tab save checks the clear generation and re-reads storage decides which records persist.
 *
 * Requirements (docs/spec/05-data-storage.md "Clear guard on tab saves"; docs/spec/04-features.md §20 "Storage Records"):
 * - A save re-reads the records only when the clear generation changed after its read, so with an unchanged generation a snapshot re-read that would fail cannot cost the save the records it merged.
 * - When the generation changed, the save re-reads the records up to 3 times; when the generation holds after a re-read, the save merges the records of that re-read; when it still differs after the third re-read, the save merges no stored record and writes its own record.
 * - When the generation changed and a re-read fails, the save stops re-reading and merges no stored record, also a record another context wrote after the clear that a later re-read would see; it drops only the in-memory records tagged with an older generation, and keeps a record the same tab saved after the clear.
 * - Overlapping saves in one tab never lose a record, also when the first save's read fails: a failed read is never a reason to drop a record.
 * - A tab whose startup load could not read the clear generation still persists its first censored reply.
 *
 * Trust boundary: only `chrome.storage` is faked (the copying in-memory double from test/setup/vitest.setup.js, driven by test/helpers/censor-reply-restore-harness.js); the real `StorageManager` and the real `CensorReplyRestore` share it; a fresh tab is a second real module instance over the same double.
 * Saves go through `_onFragmentComplete()`, which fires the save without awaiting it, as in production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';
import { settle, persistedKeys, fragmentPayload, exportedRecord, requestsGenerationKey, requestsRestoredSnapshot, failRestoredReads, holdRestoredReads, loadSecondTab, writeThenClearAroundEverySnapshotRead } from '../helpers/censor-reply-restore-harness.js';

const extraTabs = [];

// 彈出視窗的「清除全部」：先移除 storage 鍵，再通知分頁
async function popupClearAll() {
    await StorageManager.clearRestoredMessages();
    chrome.runtime.onMessage.callListeners({ type: DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES }, {}, () => {});
    await settle();
}

// 分頁已存一筆清除前的記錄 sOLD::1
async function startTabWithPreClearRecord() {
    await CensorReplyRestore.start();
    CensorReplyRestore._onFragmentComplete(fragmentPayload('sOLD', 1));
    await settle();
    expect(await persistedKeys(), 'precondition: the pre-clear record must be persisted').toEqual(['sOLD::1']);
}

beforeEach(() => {
    resetCensorReplyRestore();
});

afterEach(() => {
    // 關閉本測試開出的其他分頁實例，避免監聽器殘留到下一個測試
    while (extraTabs.length) extraTabs.pop().disable();
    resetCensorReplyRestore();
    vi.restoreAllMocks();
});

describe('CensorReplyRestore — a save whose clear generation did not change', () => {
    it('keeps the imported record even when every snapshot read after its first one fails', async () => {
        await CensorReplyRestore.start();
        await popupClearAll();
        await StorageManager.mergeRestoredMessages({ 'sessIMP::5': exportedRecord('sessIMP', 5) });
        expect(await persistedKeys(), 'precondition: the imported record must be persisted').toEqual(['sessIMP::5']);
        let snapshotReads = 0;
        // 第一次快照讀取照常，之後每次快照讀取（重讀）都失敗；單獨讀取世代照常
        const failure = failRestoredReads('lastError', { matches: (keys) => requestsRestoredSnapshot(keys) && ++snapshotReads > 1 });

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sLIVE', 9));
        await settle();
        failure.disarm();

        expect(snapshotReads, 'precondition: the save must have read the records and the generation').toBeGreaterThan(0);
        expect(await persistedKeys(), 'the save must keep the imported record and add its own').toEqual(['sLIVE::9', 'sessIMP::5']);
    });
});

describe('CensorReplyRestore — a save that keeps seeing a new clear generation', () => {
    it('gives up after the third re-read and merges no stored record when every read so far was followed by a clear', async () => {
        await startTabWithPreClearRecord();
        // 第一次讀取與三次重讀之後各發生一次清除；第五次快照讀取（若發生）只寫入 sMID::5、不再清除
        const clears = writeThenClearAroundEverySnapshotRead({ clearReads: 4 });

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();

        expect(clears.clearCount(), 'precondition: the first read and three re-reads must each have been followed by a clear').toBe(4);
        expect(await persistedKeys(), 'after three re-reads the save must stop re-reading and write only its own record').toEqual(['sNEW::1']);
    });

    it('merges the records of the third re-read when the generation holds after it', async () => {
        await startTabWithPreClearRecord();
        // 第一次讀取與前兩次重讀之後各發生一次清除；第三次重讀只寫入 sMID::4，世代不再變動
        const clears = writeThenClearAroundEverySnapshotRead({ clearReads: 3 });

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();

        expect(clears.clearCount(), 'precondition: the first read and two re-reads must each have been followed by a clear').toBe(3);
        expect(await persistedKeys(), 'the save must merge the post-clear record of the third re-read and add its own').toEqual(['sMID::4', 'sNEW::1']);
    });
});

describe('CensorReplyRestore — two saves in one tab around a storage-only clear, the earlier one failing its re-read', () => {
    it('keeps the record the later save persisted after the clear', async () => {
        await startTabWithPreClearRecord();
        const gate = holdRestoredReads();
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();
        expect(gate.heldCount(), 'precondition: the first save must be waiting on its read of restored_messages').toBeGreaterThan(0);
        gate.restore();

        // 只有 storage 清除；分頁沒收到清除訊息
        await StorageManager.clearRestoredMessages();
        await settle();
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 2));
        await settle();
        expect(await persistedKeys(), 'precondition: the later save must have persisted after the clear').toEqual(['sNEW::1', 'sNEW::2']);

        // 第一個存檔的第一次快照讀取仍被攔住，此後唯一的快照讀取就是它偵測到清除後的重讀，讓這次 chrome.storage.local.get 以 lastError 失敗
        const failure = failRestoredReads('lastError', { limit: 1, matches: requestsRestoredSnapshot });
        gate.release();
        await settle();
        failure.disarm();

        expect(failure.failedForms(), 'precondition: the first save must have re-read after detecting the clear, and that re-read must have failed').toEqual(['callback lastError']);
        expect(await persistedKeys(), 'both records saved around the clear must persist and the pre-clear record must not').toEqual(['sNEW::1', 'sNEW::2']);
    });
});

// 攔截 chrome.storage.local.get 的快照讀取（同一次讀取要求 restored_messages 與清除世代）：第一次讀到快照之後、交付結果之前，以真實 StorageManager 完成一次只動 storage 的清除，再由另一情境寫入清除後的記錄 sB::1；第二次快照讀取（存檔偵測到清除後的第一次重讀）以 lastError 失敗；之後的快照讀取照常，讀得到 sB::1。restoreAllMocks 解除
function clearAfterFirstReadThenFailFirstReread() {
    const area = chrome.storage.local;
    const originalGet = area.get.bind(area);
    let snapshotReads = 0;
    let failedRereads = 0;
    let wrotePostClearRecord = false;
    const readThenClearAndWrite = async (keys) => {
        const result = await new Promise((resolve) => originalGet(keys, resolve));
        await StorageManager.clearRestoredMessages();
        await StorageManager.mergeRestoredMessages({ 'sB::1': exportedRecord('sB', 1) });
        wrotePostClearRecord = true;
        return result;
    };
    vi.spyOn(area, 'get').mockImplementation((keys, callback) => {
        if (typeof keys === 'function') { callback = keys; keys = null; }
        if (!requestsRestoredSnapshot(keys)) return callback ? originalGet(keys, callback) : originalGet(keys);
        snapshotReads++;
        if (snapshotReads === 1) {
            if (!callback) return readThenClearAndWrite(keys);
            readThenClearAndWrite(keys).then(callback);
            return undefined;
        }
        if (snapshotReads === 2) {
            failedRereads++;
            const message = 'IO error: restored_messages read failed';
            if (!callback) return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));
            setTimeout(() => {
                chrome.runtime.lastError = { message };
                try { callback(undefined); } finally { delete chrome.runtime.lastError; }
            }, 0);
            return undefined;
        }
        return callback ? originalGet(keys, callback) : originalGet(keys);
    });
    return { failedRereads: () => failedRereads, wrotePostClearRecord: () => wrotePostClearRecord };
}

describe('CensorReplyRestore — a save whose first re-read after a storage-only clear fails while a later re-read would succeed', () => {
    it('stops re-reading, merges no stored record and writes only its own post-clear record', async () => {
        await startTabWithPreClearRecord();
        const reads = clearAfterFirstReadThenFailFirstReread();

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();

        expect(reads.wrotePostClearRecord(), 'precondition: a clear and a post-clear record from another context must have landed between the first read and the generation check').toBe(true);
        expect(reads.failedRereads(), 'precondition: the save must have re-read after detecting the clear, and that re-read must have failed').toBe(1);
        expect(await persistedKeys(), 'after a failed re-read the save must merge no stored record (not even the post-clear sB::1 a further re-read would see) and must drop the pre-clear sOLD::1').toEqual(['sNEW::1']);
    });
});

describe('CensorReplyRestore — two unawaited saves in one tab after a clear, the first failing its read', () => {
    it.each([['lastError'], ['throw']])('persists both records when the first save read fails once with %s', async (mode) => {
        await CensorReplyRestore.start();
        await popupClearAll();
        const failure = failRestoredReads(mode, { limit: 1 });

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sB', 1));
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sC', 2));
        await settle();
        failure.disarm();

        expect(failure.failedForms(), 'precondition: the first save must have hit the one failing read').toHaveLength(1);
        expect(await persistedKeys(), 'overlapping saves must not lose a record because one read failed').toEqual(['sB::1', 'sC::2']);
    });
});

describe('CensorReplyRestore — a freshly loaded tab whose startup load cannot read the clear generation', () => {
    it.each([['lastError'], ['throw']])('persists its first censored reply when the startup generation read fails with %s', async (mode) => {
        // 模組載入時自行 start()（與內容腳本注入相同），因此在載入之前就讓那一次啟動讀取的清除世代失敗
        const failure = failRestoredReads(mode, { limit: 1, matches: requestsGenerationKey });
        const tab = await loadSecondTab();
        extraTabs.push(tab);
        expect(tab, 'precondition: the tab must be a freshly loaded module instance').not.toBe(CensorReplyRestore);
        await settle();
        expect(failure.failedForms(), 'precondition: the startup load must have hit the one failing generation read').toHaveLength(1);

        tab._onFragmentComplete(fragmentPayload('sN', 1));
        await settle();

        expect(await persistedKeys(), 'the first save of the tab must persist its record').toEqual(['sN::1']);
    });
});
