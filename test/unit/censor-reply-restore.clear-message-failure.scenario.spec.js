/**
 * Scenario: an open tab that receives the "clear all" message while the storage write fails must handle that failure itself: no unhandled promise rejection, and the failure is logged.
 *
 * Requirements (docs/spec/05-data-storage.md "Clear All Restored Records"; chrome-extension-coding-guidelines §2 "Error reporting": a failure at a `chrome.runtime.onMessage` boundary is caught and logged with the `[DSS]` prefix):
 * - Delivering `DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES` while `chrome.storage.local.set` fails leaves no unhandled rejection.
 * - The storage failure is logged on the `[DSS]` boundary (console.error or console.warn, the latter being where `__DS_Logger.warn` writes).
 *
 * Trust boundary: only `chrome.storage` is faked (the copying in-memory double from test/setup/vitest.setup.js, whose quota-error mode makes every `set` fail as real Chrome does: promise form rejects, callback form exposes `lastError` only inside its callback). The real `StorageManager` and the real `CensorReplyRestore` share it; the message reaches the tab through its real `chrome.runtime.onMessage` listener.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';
import { settle, persistedKeys, fragmentPayload } from '../helpers/censor-reply-restore-harness.js';

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

// 分頁已存一筆記錄後，在 storage 寫入全部失敗時收到清除訊息；回傳清除期間呼叫 set 的次數與記錄的 console 呼叫
async function deliverClearWhileWritesFail() {
    await CensorReplyRestore.start();
    CensorReplyRestore._onFragmentComplete(fragmentPayload('sA', 1));
    await settle();
    expect(await persistedKeys(), 'precondition: the tab must have persisted a record before the clear').toEqual(['sA::1']);
    expect(chrome.runtime.onMessage.listenerCount(), 'precondition: the tab must listen for the clear message').toBeGreaterThan(0);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    chrome.storage.local.setQuotaError(true);
    chrome.runtime.onMessage.callListeners({ type: DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES }, {}, () => {});
    await settle();
    return { setCalls: setSpy.mock.calls.length, logCalls: [...errorSpy.mock.calls, ...warnSpy.mock.calls] };
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

describe('CensorReplyRestore — the clear message arrives while chrome.storage.local.set fails', () => {
    it('leaves no unhandled promise rejection', async () => {
        const { setCalls } = await deliverClearWhileWritesFail();

        expect(setCalls, 'precondition: the tab clear must have attempted a storage write').toBeGreaterThan(0);
        expect([...unhandled.values()], 'the failed clear write must not escape as an unhandled rejection').toEqual([]);
    });

    it('logs the storage failure with the [DSS] prefix', async () => {
        const { setCalls, logCalls } = await deliverClearWhileWritesFail();

        expect(setCalls, 'precondition: the tab clear must have attempted a storage write').toBeGreaterThan(0);
        const failureLogs = logCalls.filter((args) => String(args[0]).startsWith('[DSS]') && args.some(carriesQuotaFailure));
        expect(failureLogs.length, 'a [DSS] console.error or console.warn call must carry the quota failure').toBeGreaterThan(0);
    });
});
