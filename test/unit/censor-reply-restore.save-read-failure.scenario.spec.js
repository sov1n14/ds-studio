/**
 * Scenario: a tab save whose first storage read fails, after a "clear all" raised the clear generation, writes only the tab's in-memory records, reports the failure, and never depends on the logger to finish.
 *
 * Requirements (docs/spec/05-data-storage.md "Clear guard on tab saves"; chrome-extension-coding-guidelines §2 "Error reporting"):
 * - When the first read of the records or of the generation fails, the save drops nothing, merges nothing and writes the in-memory records only: the tab's own post-clear records persist, and a record another context stored after the tab loaded is not merged into that write.
 * - A recoverable failure where the feature continues is logged with `__DS_Logger.warn` (a `[DSS]` console.warn) that names its context and carries the error.
 * - Logging is diagnostics only: when `__DS_Logger` is absent, the save still persists its own record and no rejection escapes.
 *
 * Trust boundary: only `chrome.storage` is faked (the copying in-memory double from test/setup/vitest.setup.js, failing reads through `failRestoredReads` from test/helpers/censor-reply-restore-harness.js); the real `StorageManager` and the real `CensorReplyRestore` share it.
 * Saves go through `_onFragmentComplete()`, the handler the page's DSS_FRAGMENT_COMPLETE window message reaches, which fires the save without awaiting it, as in production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';
import { settle, persistedKeys, fragmentPayload, exportedRecord, requestsRestoredKey, failRestoredReads } from '../helpers/censor-reply-restore-harness.js';

const READ_FAILURE_MESSAGE = 'IO error: restored_messages read failed';

// 存檔的兩種第一次讀取：同時讀記錄與清除世代的快照讀取，以及單獨讀取清除世代
const FIRST_READS = [
    ['the snapshot read of the records', requestsRestoredKey],
    ['the read of the clear generation', (keys) => keys === StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY]
];

// Rejections still unhandled when checked; one handled a tick late fires rejectionHandled and leaves the list
let unhandled;
const onUnhandled = (reason, promise) => { unhandled.set(promise, reason); };
const onHandledLate = (promise) => { unhandled.delete(promise); };
const originalLogger = globalThis.__DS_Logger;

// 清除之後（世代至少 1）分頁已存一筆 sA::1，另一情境（彈出視窗匯入）再存入一筆只在 storage 的 sessIMP::5
async function startTabAfterClearWithImportedRecord() {
    await CensorReplyRestore.start();
    await StorageManager.clearRestoredMessages();
    chrome.runtime.onMessage.callListeners({ type: DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES }, {}, () => {});
    await settle();
    CensorReplyRestore._onFragmentComplete(fragmentPayload('sA', 1));
    await settle();
    await StorageManager.mergeRestoredMessages({ 'sessIMP::5': exportedRecord('sessIMP', 5) });
    const generationKey = StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY;
    expect((await chrome.storage.local.get(generationKey))[generationKey], 'precondition: the clear must have raised the clear generation to 1 or more').toBeGreaterThanOrEqual(1);
    expect(await persistedKeys(), 'precondition: the post-clear record and the imported record must be persisted').toEqual(['sA::1', 'sessIMP::5']);
}

// 讓符合 matches 的讀取失敗一次，存一筆 sB::2，回傳失敗紀錄
async function saveWithOneFailingRead(mode, matches) {
    const failure = failRestoredReads(mode, { limit: 1, matches });
    CensorReplyRestore._onFragmentComplete(fragmentPayload('sB', 2));
    await settle();
    failure.disarm();
    expect(failure.failedForms(), 'precondition: the save must have hit the one failing read').toHaveLength(1);
    return failure;
}

beforeEach(() => {
    resetCensorReplyRestore();
    unhandled = new Map();
    process.on('unhandledRejection', onUnhandled);
    process.on('rejectionHandled', onHandledLate);
});

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    process.off('rejectionHandled', onHandledLate);
    globalThis.__DS_Logger = originalLogger;
    resetCensorReplyRestore();
    vi.restoreAllMocks();
});

describe.each(FIRST_READS)('CensorReplyRestore — a save after a clear whose first read fails: %s', (_label, matches) => {
    it.each([['lastError'], ['throw']])('writes only the tab in-memory records, merging nothing, when that read fails once with %s', async (mode) => {
        await startTabAfterClearWithImportedRecord();

        await saveWithOneFailingRead(mode, matches);

        expect(await persistedKeys(), 'the save must keep the tab post-clear record, add its own, and merge no stored record').toEqual(['sA::1', 'sB::2']);
    });

    it('logs a [DSS] warning that names its context and carries the read error', async () => {
        await startTabAfterClearWithImportedRecord();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await saveWithOneFailingRead('lastError', matches);

        const failureLogs = warnSpy.mock.calls.filter((args) => args[0] === '[DSS]' && args.some((arg) => arg instanceof Error && arg.message.includes(READ_FAILURE_MESSAGE)));
        expect(failureLogs.length, 'a [DSS] console.warn call must carry the read error').toBeGreaterThan(0);
        const contexts = failureLogs.map((args) => args[1]);
        expect(contexts.every((context) => typeof context === 'string' && context.trim().length > 0), 'every such warning must name its context, got ' + JSON.stringify(contexts)).toBe(true);
    });

    it('still persists its own record with no escaping rejection when __DS_Logger is absent', async () => {
        await startTabAfterClearWithImportedRecord();
        delete globalThis.__DS_Logger;
        expect(globalThis.__DS_Logger, 'precondition: the logger must be absent').toBeUndefined();

        await saveWithOneFailingRead('lastError', matches);

        expect(await persistedKeys(), 'the save must persist its own record without the logger').toContain('sB::2');
        expect([...unhandled.values()], 'the failed read must not escape as an unhandled rejection').toEqual([]);
    });
});
