/**
 * Scenario: a record that a tab saved while every storage read failed is still a record of the clear generation the tab held, so a later "clear all" removes it for good and the tab never writes it back.
 *
 * Requirements (docs/spec/05-data-storage.md "Clear guard on tab saves": a tab save compares the clear generation it holds with the stored one and never writes a record from before a clear back):
 * - After a clear, the next save of the tab persists only post-clear records, also when a pre-clear record of the tab was saved by a save whose reads all failed.
 * - This holds for a storage-only clear (the tab message lost) at the initial generation and after an earlier clear raised the generation.
 * - Control: without a clear in between, the record saved by the failing-read save survives the next save (a failed read is never a reason to drop a record).
 * - Control: with the clear message delivered, the next save also persists only post-clear records.
 *
 * Trust boundary: only `chrome.storage` is faked (the copying in-memory double from test/setup/vitest.setup.js, failing reads through `failRestoredReads` from test/helpers/censor-reply-restore-harness.js); the real `StorageManager` and the real `CensorReplyRestore` share it.
 * Saves go through `_onFragmentComplete()`, which fires the save without awaiting it, as in production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';
import { settle, persistedKeys, fragmentPayload, requestsRestoredOrGenerationKey, failRestoredReads } from '../helpers/censor-reply-restore-harness.js';

// 起始狀態：初始世代（從未清除），或先經一次送達訊息的清除（世代至少 1）
const START_STATES = [
    ['at the initial clear generation', false],
    ['after an earlier delivered clear', true]
];

async function deliverClearMessage() {
    chrome.runtime.onMessage.callListeners({ type: DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES }, {}, () => {});
    await settle();
}

async function startTab(isAfterEarlierClear) {
    await CensorReplyRestore.start();
    if (!isAfterEarlierClear) return;
    await StorageManager.clearRestoredMessages();
    await deliverClearMessage();
    const generationKey = StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY;
    expect((await chrome.storage.local.get(generationKey))[generationKey], 'precondition: the earlier clear must have raised the clear generation to 1 or more').toBeGreaterThanOrEqual(1);
}

// 每一次讀取 restored_messages 或清除世代都失敗時存一筆 sX::1；該次存檔只寫入記憶體中的記錄
async function saveWhileEveryReadFails(mode) {
    const failure = failRestoredReads(mode, { matches: requestsRestoredOrGenerationKey });
    CensorReplyRestore._onFragmentComplete(fragmentPayload('sX', 1));
    await settle();
    failure.disarm();
    expect(failure.failedForms().length, 'precondition: the save must have hit the failing reads').toBeGreaterThan(0);
    expect(await persistedKeys(), 'precondition: the failing-read save must have written its own record').toEqual(['sX::1']);
}

beforeEach(() => {
    resetCensorReplyRestore();
});

afterEach(() => {
    resetCensorReplyRestore();
    vi.restoreAllMocks();
});

describe.each(START_STATES)('CensorReplyRestore — a record saved while every read failed, %s', (_label, isAfterEarlierClear) => {
    it.each([['lastError'], ['throw']])('is not written back by the next save after a storage-only clear (reads failed with %s)', async (mode) => {
        await startTab(isAfterEarlierClear);
        await saveWhileEveryReadFails(mode);

        // 只有 storage 清除；分頁沒收到清除訊息
        await StorageManager.clearRestoredMessages();
        await settle();
        expect(await persistedKeys(), 'precondition: the storage-only clear must have removed every record').toEqual([]);

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sY', 2));
        await settle();

        expect(await persistedKeys(), 'after the clear the next save must persist only the post-clear record').toEqual(['sY::2']);
    });

    it('control: survives the next save when no clear happened in between', async () => {
        await startTab(isAfterEarlierClear);
        await saveWhileEveryReadFails('lastError');

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sY', 2));
        await settle();

        expect(await persistedKeys(), 'without a clear the next save must keep the failing-read record and add its own').toEqual(['sX::1', 'sY::2']);
    });

    it('control: is not written back by the next save after a clear whose message reached the tab', async () => {
        await startTab(isAfterEarlierClear);
        await saveWhileEveryReadFails('lastError');

        await StorageManager.clearRestoredMessages();
        await deliverClearMessage();
        expect(await persistedKeys(), 'precondition: the clear must have removed every record').toEqual([]);

        CensorReplyRestore._onFragmentComplete(fragmentPayload('sY', 2));
        await settle();

        expect(await persistedKeys(), 'after the clear the next save must persist only the post-clear record').toEqual(['sY::2']);
    });
});
