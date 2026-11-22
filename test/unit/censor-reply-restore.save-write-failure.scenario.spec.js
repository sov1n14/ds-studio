/**
 * Scenario: a censored-reply save whose storage write fails must handle that failure itself: no unhandled promise rejection, and the failure is logged.
 *
 * Requirements (chrome-extension-coding-guidelines §2 "Error reporting": a failure is caught and logged with the `[DSS]` prefix; docs/spec/05-data-storage.md "Clear guard on tab saves"):
 * - When the `chrome.storage.local.set` of a save started by `_onFragmentComplete()` fails, no rejection escapes as an unhandled rejection.
 * - The failure is logged on the `[DSS]` boundary (console.error or console.warn, the latter being where `__DS_Logger.warn` writes), carrying the storage error.
 * - Each real failure shape of `set` is covered: the asynchronous failure (the double's quota-error mode: promise form rejects, callback form exposes `lastError` only inside its callback) and a synchronous throw.
 *
 * Trust boundary: only `chrome.storage` is faked (the copying in-memory double from test/setup/vitest.setup.js); the real `StorageManager` and the real `CensorReplyRestore` share it.
 * Saves go through `_onFragmentComplete()`, the handler the page's DSS_FRAGMENT_COMPLETE window message reaches, which fires the save without awaiting it, as in production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';
import { settle, persistedKeys, fragmentPayload, RESTORED_KEY } from '../helpers/censor-reply-restore-harness.js';

const QUOTA_MESSAGE = 'QUOTA_BYTES_PER_ITEM quota exceeded';

// Rejections still unhandled when checked; one handled a tick late fires rejectionHandled and leaves the list
let unhandled;
const onUnhandled = (reason, promise) => { unhandled.set(promise, reason); };
const onHandledLate = (promise) => { unhandled.delete(promise); };

function carriesQuotaFailure(arg) {
    if (arg instanceof Error) return arg.message.includes(QUOTA_MESSAGE);
    if (typeof arg === 'string') return arg.includes(QUOTA_MESSAGE);
    return Boolean(arg && typeof arg.message === 'string' && arg.message.includes(QUOTA_MESSAGE));
}

function writesRestored(items) {
    return Boolean(items) && typeof items === 'object' && RESTORED_KEY in items;
}

// 分頁啟動後，在 restored_messages 寫入失敗時存一筆 sW::1。async：替身的配額錯誤模式（資料不寫入）；throw：寫入 restored_messages 的 set 同步拋出。回傳 console 呼叫
async function saveWhileWritesFail(shape) {
    await CensorReplyRestore.start();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const area = chrome.storage.local;
    const originalSet = area.set.bind(area);
    let restoredWrites = 0;
    vi.spyOn(area, 'set').mockImplementation((items, callback) => {
        if (writesRestored(items)) {
            restoredWrites++;
            if (shape === 'throw') throw new Error(QUOTA_MESSAGE);
        }
        return originalSet(items, callback);
    });
    if (shape === 'async') area.setQuotaError(true);

    CensorReplyRestore._onFragmentComplete(fragmentPayload('sW', 1));
    await settle();

    const logCalls = [...errorSpy.mock.calls, ...warnSpy.mock.calls];
    area.setQuotaError(false);
    vi.restoreAllMocks();
    expect(restoredWrites, 'precondition: the save must have attempted to write restored_messages').toBeGreaterThan(0);
    expect(await persistedKeys(), 'precondition: the failed write must have stored nothing').toEqual([]);
    return logCalls;
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
    chrome.storage.local.setQuotaError(false);
    resetCensorReplyRestore();
    vi.restoreAllMocks();
});

describe.each([['async'], ['throw']])('CensorReplyRestore — a save whose storage write fails (%s)', (shape) => {
    it('leaves no unhandled promise rejection', async () => {
        await saveWhileWritesFail(shape);

        const reasons = [...unhandled.values()].map((reason) => (reason && typeof reason.message === 'string' ? reason.message : reason));
        expect(reasons, 'the failed save write must not escape as an unhandled rejection').toEqual([]);
    });

    it('logs the storage failure with the [DSS] prefix', async () => {
        const logCalls = await saveWhileWritesFail(shape);

        const failureLogs = logCalls.filter((args) => String(args[0]).startsWith('[DSS]') && args.some(carriesQuotaFailure));
        expect(failureLogs.length, 'a [DSS] console.error or console.warn call must carry the write failure').toBeGreaterThan(0);
    });
});
