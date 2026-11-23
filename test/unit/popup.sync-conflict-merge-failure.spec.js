/**
 * popup.js：同步衝突提示選「Merge Sync」時，合併成功與合併失敗兩種情況。
 *
 * 需求：使用者確認「Merge Sync」而 StorageManager.resolveSyncConflict() reject 時，popup 記錄 console.warn('[DSS] popup: resolveSyncConflict failed:', err)、顯示「Sync failed」提示（i18n key syncFailedToast）、不重新載入、繼續正常載入流程，並保留儲存中的衝突旗標 syncConflictPending。合併成功時，popup 顯示「Data has been merged and synced successfully」提示（syncMergedSuccessToast），並在 1 秒後重新載入一次。
 *
 * Harness: the real popup.js source from `await StorageManager.initialize()` up to the first `await refreshSyncStatus()` (the open sequence through the conflict prompt) runs as an async function body with `return 'continued'` appended, so the function returns 'continued' only when the load goes on past the prompt. It runs with the real StorageManager over the in-memory chrome.storage double, the real Modal and Toast (popup/popup.modal.js, popup/popup.toast.js) on the real popup.html body, and the real dsI18n; the test answers the prompt by clicking its confirm button. Only browser boundaries are faked: `window.location.reload` (a counting stub passed in as `window`) and, for the failure case, chrome.storage.sync.get. The block range comes from regex anchors, not indentation, and the file's top-level function declarations (the stryMutAct_* helpers on the Stryker-instrumented popup.js) share its scope, as in popup-live-sync.spec.js Group H.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { readProjectFile, evalPopupScript } from '../helpers/popup-script-loader.js';
import { topLevelFunctionDeclarations } from '../helpers/popup-closure-source.js';
import { mountPopupHtml } from '../helpers/popup-master-switch-harness.js';

const K = StorageManager.KEYS;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const WARN_PREFIX = '[DSS] popup: resolveSyncConflict failed:';

/** User-visible strings per locale, written out literally so a wrong i18n key fails the test. */
const TEXT = {
    en: { confirm: 'Merge Sync', failed: 'Sync failed', merged: 'Data has been merged and synced successfully' },
    zh_TW: { confirm: '合併同步', failed: '同步失敗', merged: '資料已成功合併同步' },
};

const preset = (id, updatedAt) => ({ id, name: `Name-${id}`, content: `content-${id}`, createdAt: 1, updatedAt });

let openSequence;
let Modal;
let Toast;

/** Compiles the popup.js open sequence (initialize, conflict check, conflict prompt) into a callable async function. */
function compileOpenSequence() {
    const source = readProjectFile('popup/popup.js');
    const start = /await\s+StorageManager\.initialize\s*\(\s*\)/.exec(source);
    if (!start) throw new Error('Could not locate `await StorageManager.initialize()` in popup/popup.js');
    const endRe = /await\s+refreshSyncStatus\s*\(\s*\)/g;
    endRe.lastIndex = start.index;
    const end = endRe.exec(source);
    if (!end) throw new Error('Could not locate `await refreshSyncStatus()` after initialize() in popup/popup.js');
    const block = source.slice(start.index, end.index);
    if (!/checkSyncConflictPending/.test(block)) throw new Error('The extracted open sequence holds no conflict check; the anchors in popup/popup.js moved');
    const helpers = topLevelFunctionDeclarations(source).join('\n');
    return new AsyncFunction('StorageManager', 'Modal', 'Toast', 'dsI18n', 'window', `${helpers}\n${block}\nreturn 'continued';`);
}

/** Seeds a pending conflict: sync already initialized, the conflict flag set, and the cloud holding a prompt group (p2) this device never cached. */
async function seedPendingConflict() {
    await chrome.storage.local.set({
        [K.SYNC_INITIALIZED]: true,
        [K.SYNC_CONFLICT_PENDING]: true,
        [K.PRESET_INDEX]: ['p1'],
        dsPreset_p1: preset('p1', 10),
        [K.PRESET_ORDER_META]: { order: ['p1'], orderUpdatedAt: 100 },
    });
    await chrome.storage.sync.set({
        [K.PRESET_INDEX]: ['p1', 'p2'],
        dsPreset_p1: preset('p1', 10),
        dsPreset_p2: preset('p2', 20),
        [K.PRESET_ORDER_META]: { order: ['p1', 'p2'], orderUpdatedAt: 200 },
    });
}

/** From this call on, every chrome.storage.sync.get fails the way Chrome reports a read failure: lastError only inside the callback, rejection in promise form. Counts the hits per form. */
function failSyncReadsFromNowOn() {
    const message = 'Simulated sync read failure during the merge';
    const hits = { callback: 0, promise: 0 };
    const spy = vi.spyOn(chrome.storage.sync, 'get').mockImplementation((keys, callback) => {
        if (typeof keys === 'function') callback = keys;
        if (!callback) {
            hits.promise += 1;
            return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));
        }
        hits.callback += 1;
        setTimeout(() => {
            chrome.runtime.lastError = { message };
            try { callback({}); } finally { delete chrome.runtime.lastError; }
        }, 0);
        return undefined;
    });
    return { spy, hits };
}

/** Advances fake time 1 ms at a time until predicate() holds; throws after maxMs of fake time. */
async function advanceUntil(predicate, label, maxMs = 900) {
    for (let elapsed = 0; elapsed <= maxMs; elapsed += 1) {
        if (predicate()) return;
        await vi.advanceTimersByTimeAsync(1);
    }
    throw new Error(`Timed out after ${maxMs} ms of fake time waiting for ${label}`);
}

/**
 * Starts the open sequence under fake timers, waits for the conflict prompt, runs beforeConfirm(), clicks the prompt's confirm button and waits for the sequence to settle.
 * @returns {Promise<{ outcome: string, reload: import('vitest').Mock, text: object }>} outcome is 'continued' (the load went on), 'returned' (the sequence returned early) or 'rejected: <message>'.
 */
async function openPopupAndConfirmMerge(beforeConfirm = () => {}) {
    const text = TEXT[dsI18n.getLocale()];
    expect(text, `guard: expected strings exist for the locale ${dsI18n.getLocale()}`).toBeDefined();
    const reload = vi.fn();
    vi.useFakeTimers();
    let outcome = null;
    openSequence(StorageManager, Modal, Toast, dsI18n, { location: { reload } }).then(
        (value) => { outcome = value === 'continued' ? 'continued' : 'returned'; },
        (err) => { outcome = `rejected: ${err?.message ?? err}`; },
    );

    const overlay = document.getElementById('modalOverlay');
    await advanceUntil(() => !overlay.hidden || outcome !== null, 'the sync conflict prompt');
    expect(outcome, 'guard: the open sequence must stop at the conflict prompt, not settle before it').toBeNull();
    const confirmBtn = document.querySelector('#modalActions .modal-btn--primary');
    expect(confirmBtn?.textContent, 'guard: the prompt shown is the sync conflict prompt').toBe(text.confirm);

    beforeConfirm();
    confirmBtn.click();
    await advanceUntil(() => outcome !== null, 'the open sequence to settle after "Merge Sync"');
    return { outcome, reload, text };
}

/** Reads one local key with real timers (call after vi.useRealTimers()). */
async function readLocal(key) {
    return (await chrome.storage.local.get(key))[key];
}

beforeAll(() => {
    openSequence = compileOpenSequence();
    evalPopupScript('popup/popup.modal.js');
    evalPopupScript('popup/popup.toast.js');
    ({ Modal, Toast } = window.__DS_PopupModal);
});

let warnSpy;

beforeEach(() => {
    delete chrome.runtime.lastError;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountPopupHtml();
    Toast._timer = undefined;
    Modal.init();
    Toast.init();
});

afterEach(() => {
    vi.useRealTimers();
    delete chrome.runtime.lastError;
    vi.restoreAllMocks();
});

describe('popup "Merge Sync" when the merge sync read fails (callback lastError / promise rejection)', () => {
    it('shows the "Sync failed" toast, logs one [DSS] warn, goes on loading, never reloads, and keeps syncConflictPending set', async () => {
        await seedPendingConflict();
        let failure;

        const { outcome, reload, text } = await openPopupAndConfirmMerge(() => { failure = failSyncReadsFromNowOn(); });
        const { hits } = failure;

        expect(hits.callback, 'guard: the merge read hit the failing chrome.storage.sync.get in callback form (lastError)').toBeGreaterThan(0);
        expect.soft(outcome, 'the open sequence goes on with the normal load after a failed merge').toBe('continued');
        const toast = document.getElementById('toast');
        expect.soft(toast.textContent, 'toast text after a failed merge').toBe(text.failed);
        expect.soft(toast.hidden, 'the toast is visible after a failed merge').toBe(false);
        const dssWarns = warnSpy.mock.calls.filter(([first]) => first === WARN_PREFIX);
        expect.soft(dssWarns, `console.warn calls with the prefix "${WARN_PREFIX}"`).toHaveLength(1);
        expect.soft(dssWarns[0]?.[1], 'the [DSS] warn carries the rejection reason').toBeDefined();

        await vi.advanceTimersByTimeAsync(1500);
        expect.soft(reload, 'location.reload calls 1.5 s after a failed merge').not.toHaveBeenCalled();

        failure.spy.mockRestore();
        vi.useRealTimers();
        expect(await readLocal(K.SYNC_CONFLICT_PENDING), 'stored syncConflictPending after a failed merge').toBe(true);
    });
});

describe('popup "Merge Sync" when the merge succeeds (control)', () => {
    it('shows the merged toast, stops the open sequence, and reloads exactly once 1 s later', async () => {
        await seedPendingConflict();

        const { outcome, reload, text } = await openPopupAndConfirmMerge();

        expect.soft(outcome, 'the open sequence returns early to wait for the reload').toBe('returned');
        const toast = document.getElementById('toast');
        expect.soft(toast.textContent, 'toast text after a successful merge').toBe(text.merged);
        expect.soft(toast.hidden, 'the toast is visible after a successful merge').toBe(false);
        expect.soft(warnSpy.mock.calls.filter(([first]) => first === WARN_PREFIX), 'no merge-failure warn on success').toHaveLength(0);

        expect(reload, 'location.reload calls right after the merge').not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(990);
        expect(reload, 'location.reload calls 990 ms after the merge').not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(20);
        expect(reload, 'location.reload calls 1010 ms after the merge').toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5000);
        expect(reload, 'location.reload calls 6 s after the merge').toHaveBeenCalledTimes(1);
    });
});
