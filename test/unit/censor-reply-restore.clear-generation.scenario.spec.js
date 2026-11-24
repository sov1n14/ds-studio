/**
 * Scenario (clear-generation guard): after a "clear all" restored records, every censored reply the same tab saves from then on must survive in storage, and no record from before the clear may come back.
 *
 * Requirements (docs/spec/05-data-storage.md "Clear All Restored Records", docs/spec/04-features.md §20 "Storage Records"):
 * - Two replies completed in one tab around a clear (their saves may have read storage before the clear committed) both persist; no pre-clear record persists.
 * - A save that starts after the clear and after an earlier post-clear save finished keeps that earlier record.
 * - A save in tab A that read storage before the clear keeps a record another tab (B) persisted after the clear and before A wrote (records other contexts write after the clear survive).
 * - When the storage read inside a save fails, the save still persists its own record.
 * - After a clear, when every read of the restored records and of the clear generation fails during a save, the save keeps the records the tab already persisted after the clear: a failed read is unknown, never a reason to drop records.
 * - When a save detects a clear after its read and then its re-read fails, or the clear generation changes again after every re-read, the save still completes and persists only its own record: no pre-clear record and nothing from the failed or stale read.
 *
 * Trust boundary: only `chrome.storage` is faked (the copying in-memory double from test/setup/vitest.setup.js); the real `StorageManager` and the real `CensorReplyRestore` share it; a second tab is a second real module instance over the same double.
 * Saves go through `_onFragmentComplete()`, the handler the page's DSS_FRAGMENT_COMPLETE window message reaches, which fires the save without awaiting it, as in production.
 * Each case runs with both clear paths: the popup flow (storage removal, then `DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES` through the tab's real `chrome.runtime.onMessage` listener) and a storage-only clear whose tab message was lost.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';
import { settle, persistedKeys, fragmentPayload, exportedRecord, requestsRestoredOrGenerationKey, requestsRestoredSnapshot, failRestoredReads, holdRestoredReads, loadSecondTab, writeThenClearAroundEverySnapshotRead } from '../helpers/censor-reply-restore-harness.js';

const CLEAR_MODES = [
    ['the popup clear that also messages the tab', async () => {
        await StorageManager.clearRestoredMessages();
        chrome.runtime.onMessage.callListeners({ type: DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES }, {}, () => {});
        await settle();
    }],
    ['a storage-only clear whose tab message was lost', async () => {
        await StorageManager.clearRestoredMessages();
        await settle();
    }]
];

// 清除前的狀態：分頁自己存過一筆 sOLD::1（在記憶體與 storage），另一情境匯入一筆 sessIMP::5（只在 storage）
async function startTabWithPreClearRecords() {
    await CensorReplyRestore.start();
    CensorReplyRestore._onFragmentComplete(fragmentPayload('sOLD', 1));
    await settle();
    await StorageManager.mergeRestoredMessages({ 'sessIMP::5': exportedRecord('sessIMP', 5) });
    expect(await persistedKeys(), 'precondition: both pre-clear records must be persisted').toEqual(['sOLD::1', 'sessIMP::5']);
}

async function clearAndConfirm(clearAll) {
    await clearAll();
    expect(await persistedKeys(), 'precondition: the clear must have committed').toEqual([]);
}

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

describe.each(CLEAR_MODES)('CensorReplyRestore — two saves in one tab around %s', (_label, clearAll) => {
    it('persists both new records when both saves read storage before the clear committed', async () => {
        await startTabWithPreClearRecords();
        const gate = holdRestoredReads();
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 2));
        await settle();
        expect(gate.heldCount(), 'precondition: a save must be waiting on its read of restored_messages').toBeGreaterThan(0);
        gate.disarm();

        await clearAndConfirm(clearAll);
        gate.release();
        await settle();

        expect(await persistedKeys(), 'both replies saved around the clear must persist, and no pre-clear record').toEqual(['sNEW::1', 'sNEW::2']);
    });

    it('persists both new records when the first save read before the clear and the second reply arrived after it', async () => {
        await startTabWithPreClearRecords();
        const gate = holdRestoredReads();
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();
        expect(gate.heldCount(), 'precondition: the first save must be waiting on its read of restored_messages').toBeGreaterThan(0);
        gate.disarm();

        await clearAndConfirm(clearAll);
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 2));
        gate.release();
        await settle();

        expect(await persistedKeys(), 'both replies saved around the clear must persist, and no pre-clear record').toEqual(['sNEW::1', 'sNEW::2']);
    });

    it('keeps the first post-clear record when a second save starts after the first finished', async () => {
        await startTabWithPreClearRecords();
        await clearAndConfirm(clearAll);

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();
        expect(await persistedKeys(), 'precondition: the first post-clear save must have persisted its record').toContain('sNEW::1');

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 2));
        await settle();

        expect(await persistedKeys(), 'the second post-clear save must keep the first post-clear record').toEqual(expect.arrayContaining(['sNEW::1', 'sNEW::2']));
    });

    it('keeps the record another tab saved after the clear when this tab save read storage before the clear', async () => {
        await startTabWithPreClearRecords();
        const tabB = await loadSecondTab();
        extraTabs.push(tabB);
        expect(tabB, 'precondition: tab B must be a separate module instance').not.toBe(CensorReplyRestore);
        await tabB.start();
        const gate = holdRestoredReads();
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();
        expect(gate.heldCount(), 'precondition: the tab A save must be waiting on its read of restored_messages').toBeGreaterThan(0);
        gate.disarm();

        await clearAndConfirm(clearAll);
        tabB._onFragmentComplete(fragmentPayload('sB', 1));
        await settle();
        expect(await persistedKeys(), 'precondition: tab B post-clear record B1 must be in storage before tab A writes').toEqual(['sB::1']);

        gate.release();
        await settle();

        expect(await persistedKeys(), 'tab A save must keep tab B post-clear record and add its own, with no pre-clear record').toEqual(['sB::1', 'sNEW::1']);
    });

    // A save that starts after the clear must not write back a record the tab held in memory before the clear
    it('does not write back the tab pre-clear record on the first save after the clear', async () => {
        await startTabWithPreClearRecords();
        await clearAndConfirm(clearAll);

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();

        expect(await persistedKeys(), 'only the post-clear record may be persisted').toEqual(['sNEW::1']);
    });
});

describe('CensorReplyRestore — a save whose storage read fails', () => {
    it.each([['lastError'], ['throw']])('still persists its own record when chrome.storage.local.get fails with %s', async (mode) => {
        await CensorReplyRestore.start();
        const failure = failRestoredReads(mode, { limit: 1 });

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sFAIL', 1));
        await settle();

        expect(failure.failedForms(), 'precondition: the save must have hit the failing read of restored_messages').toHaveLength(1);
        expect(await persistedKeys(), 'the save must persist its own record despite the failed read').toContain('sFAIL::1');
    });

    // 只讓存檔的快照讀取（同時讀記錄與清除世代的那一次 chrome.storage.local.get）以 lastError 失敗一次
    it('still persists its own record when the restored-records snapshot read rejects', async () => {
        await CensorReplyRestore.start();
        const failure = failRestoredReads('lastError', { limit: 1, matches: requestsRestoredSnapshot });

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sFAIL', 1));
        await settle();
        failure.disarm();

        expect(failure.failedForms(), 'precondition: the save must have hit the one failing snapshot read').toEqual(['callback lastError']);
        expect(await persistedKeys(), 'the save must persist its own record despite the rejected read').toContain('sFAIL::1');
    });
});

describe.each(CLEAR_MODES)('CensorReplyRestore — a save after %s whose storage reads all fail', (_label, clearAll) => {
    it.each([['lastError'], ['throw']])('keeps the record the tab persisted after the clear when every read fails with %s', async (mode) => {
        await CensorReplyRestore.start();
        await clearAndConfirm(clearAll);
        const generationKey = StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY;
        const stored = await chrome.storage.local.get(generationKey);
        expect(stored[generationKey], 'precondition: the clear must have raised the clear generation to 1 or more').toBeGreaterThanOrEqual(1);

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sA', 1));
        await settle();
        expect(await persistedKeys(), 'precondition: the first post-clear save must have persisted its record').toEqual(['sA::1']);

        // 之後每次讀取 restored_messages 或清除世代都失敗，寫入照常成功
        const failure = failRestoredReads(mode, { matches: requestsRestoredOrGenerationKey });
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sB', 2));
        await settle();
        failure.disarm();

        expect(failure.failedForms().length, 'precondition: the second save must have hit a failing read').toBeGreaterThan(0);
        expect(await persistedKeys(), 'a save whose reads failed must keep the earlier post-clear record and add its own').toEqual(['sA::1', 'sB::2']);
    });
});

describe('CensorReplyRestore — a save that detects a clear and cannot get a current snapshot', () => {
    const [, storageOnlyClear] = CLEAR_MODES[1];

    // 存檔讀到清除前的快照後偵測到清除；清除之後的下一次快照讀取（即重讀）在 chrome.storage.local.get 以 lastError 失敗
    it('persists only its own record when the re-read after the detected clear rejects', async () => {
        await startTabWithPreClearRecords();
        const gate = holdRestoredReads();
        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();
        expect(gate.heldCount(), 'precondition: the save must be waiting on its first read of restored_messages').toBeGreaterThan(0);
        gate.restore();

        await clearAndConfirm(storageOnlyClear);
        // 第一次快照讀取已被攔住，此後唯一的快照讀取就是偵測到清除後的重讀
        const failure = failRestoredReads('lastError', { limit: 1, matches: requestsRestoredSnapshot });
        gate.release();
        await settle();
        failure.disarm();

        expect(failure.failedForms(), 'precondition: the save must have re-read after detecting the clear, and that re-read must have failed').toEqual(['callback lastError']);
        expect(await persistedKeys(), 'only the save own record may persist: no pre-clear record, nothing from the failed re-read').toEqual(['sNEW::1']);
    });

    it('still completes with only its own record when the clear generation changes after every read', async () => {
        await startTabWithPreClearRecords();
        const clears = writeThenClearAroundEverySnapshotRead();

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sNEW', 1));
        await settle();

        expect(clears.clearCount(), 'precondition: a clear must have followed the first read and at least one re-read').toBeGreaterThanOrEqual(2);
        expect(await persistedKeys(), 'the save must complete with its own record and write back no pre-clear record (sOLD, sessIMP, or any sMID read before a later clear)').toEqual(['sNEW::1']);
    });
});
