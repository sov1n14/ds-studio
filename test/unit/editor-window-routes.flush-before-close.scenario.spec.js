/**
 * Scenario: the background closing an editor window never drops the last typed edits.
 *
 * Requirement: before the background closes an editor window, it asks the editor window to save and waits for its answer, at most about 1 s; when the save fails because the group name duplicates another group, the window stays open, as with Esc.
 * Requirement: a window kept open for a duplicate name stays behind DeepSeek; the background does not focus it.
 * Contract:
 * - request: chrome.runtime.sendMessage({ type: DSS_EDITOR_WINDOW.FLUSH_MESSAGE_TYPE, slot }), where slot is the DSS_EDITOR_WINDOW.STORAGE_KEYS property name ('global' or 'preset'), one request per tracked window, sent before chrome.windows.remove for that window;
 * - the editor page answers only for its own slot, with { status }: 'clean', 'saved', 'duplicate', 'failed' or 'timeout';
 * - 'duplicate': no chrome.windows.remove for that window, its session key stays, no chrome.windows.update({ focused: true });
 * - any other answer, no answer within about 1000 ms, a rejection (no receiver), a resolved undefined or a synchronous throw: the window is removed and its session key deleted;
 * - the tracked windows are handled in parallel, so two windows that never answer are both removed after one wait of about 1000 ms, not two;
 * - the editor bounds its own save wait below the caller's 1000 ms (docs/architecture/POPUP.md, requestEditorFlush), so a save that never settles still reaches the caller as 'timeout' instead of a missing reply.
 *
 * Real modules: background/editor-window-routes.js, the editor page (popup/editor/editor.js and its parts, through test/helpers/editor-window-harness.js), StorageManager, the in-memory chrome.storage. Doubles: chrome.storage.session, chrome.windows and chrome.runtime.sendMessage (test/helpers/editor-window-flush-doubles.js). The DSS_CLOSE_EDITOR_WINDOWS message of the content script reaches the route by calling the listener the route registered on chrome.runtime.onMessage.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createEditorWindowHarness } from '../helpers/editor-window-harness.js';
import { createEditorWindowFlushDoubles, NON_BLOCKING_FLUSH_OUTCOMES } from '../helpers/editor-window-flush-doubles.js';

const KEYS = globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS;
const CLOSE_TYPE = globalThis.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE;
const PRESET_ID = 'poc-1';
const ORIGINAL = { id: PRESET_ID, name: 'poc original', content: 'ORIGINAL', createdAt: 1000, updatedAt: 1000 };
const TAKEN = { id: 'poc-2', name: 'taken', content: 'OTHER', createdAt: 1000, updatedAt: 1000 };
const GLOBAL_WINDOW_ID = 111;
const PRESET_WINDOW_ID = 222;
const SERVICE_WORKER_SENDER = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/background/service-worker.js' };
// The editor autosave fires 500 ms after the last input (test/unit/editor.escape-save.scenario.spec.js). A close that waits for the flush answer lands well inside this bound, so a pass cannot come from the debounce saving on its own, nor from a fixed wait of about 1000 ms.
const PROMPT_CLOSE_BOUND_MS = 400;
// The background waits for the flush answer at most about 1000 ms; these tests allow 1500 ms.
const WAIT_CAP_BOUND_MS = 1500;
// requestEditorFlush gives up on the editor's reply after 1000 ms (docs/architecture/POPUP.md); the editor must answer before it.
const CALLER_FLUSH_DEADLINE_MS = 1000;
const FLUSH_STATUS = globalThis.DSS_EDITOR_WINDOW.FLUSH_STATUS;

let routeListener;

beforeAll(async () => {
    const captured = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { captured.push(fn); });
    await import('../../background/editor-window-routes.js');
    globalThis.DSSEditorWindowRoutes.install();
    addSpy.mockRestore();
    routeListener = captured[0];
});

/** Deliver DSS_CLOSE_EDITOR_WINDOWS from the DeepSeek tab to the route, as chrome.runtime.onMessage does. */
function deliverCloseMessage() {
    const sendResponse = vi.fn();
    const result = routeListener({ type: CLOSE_TYPE }, { id: 'test-extension-id', tab: { id: 7, url: 'https://chat.deepseek.com/' } }, sendResponse);
    return { result, sendResponse };
}

it('the flush request type is a named constant distinct from the close request', () => {
    const flushType = globalThis.DSS_EDITOR_WINDOW.FLUSH_MESSAGE_TYPE;
    expect(typeof flushType, 'DSS_EDITOR_WINDOW.FLUSH_MESSAGE_TYPE in utils/message-constants.js').toBe('string');
    expect(flushType.length, 'FLUSH_MESSAGE_TYPE length').toBeGreaterThan(0);
    expect(flushType, 'FLUSH_MESSAGE_TYPE differs from CLOSE_MESSAGE_TYPE').not.toBe(CLOSE_TYPE);
});

describe('background close with the real editor window open', () => {
    let h;
    let d;

    beforeEach(() => {
        d = createEditorWindowFlushDoubles();
        h = createEditorWindowHarness();
    });

    afterEach(() => {
        h.cleanup();
        d.restore();
    });

    /** Open the real preset editor on PRESET_ID, track the given windows in session storage, and connect the runtime bus from the service worker to the editor page. */
    async function openEditor({ presets, session }) {
        await h.openPresetEditor({ presets, id: PRESET_ID });
        Object.assign(d.sessionData, session);
        d.connectRuntimeBus(() => h.pageMessageListeners, SERVICE_WORKER_SENDER);
    }

    it('A: a pending edit (typed, no blur, autosave not yet fired) is in storage at the instant chrome.windows.remove runs', async () => {
        await openEditor({ presets: [ORIGINAL], session: { [KEYS.preset]: PRESET_WINDOW_ID } });
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'poc renamed');

        const { result, sendResponse } = deliverCloseMessage();
        const isRemoved = await d.advanceUntil(() => d.removals().length > 0, PROMPT_CLOSE_BOUND_MS);

        expect(result, 'route listener return value (async response)').toBe(true);
        expect(isRemoved, `chrome.windows.remove called within ${PROMPT_CLOSE_BOUND_MS} ms of the close message`).toBe(true);
        const removal = d.removals()[0];
        expect(removal.id, 'removed window id').toBe(PRESET_WINDOW_ID);
        const flushIndex = d.indexOfFlushRequest('preset');
        const storedAtRemove = await h.readPreset(PRESET_ID, removal.storage);
        expect(storedAtRemove.name, 'preset name in storage when chrome.windows.remove ran').toBe('poc renamed');
        expect(storedAtRemove.content, 'preset content in storage when chrome.windows.remove ran').toBe('NEW-CONTENT');
        expect(flushIndex, 'a flush request for slot preset was sent').toBeGreaterThan(-1);
        expect(flushIndex, 'the flush request precedes chrome.windows.remove').toBeLessThan(d.events.indexOf(removal));
        await d.advanceUntil(() => sendResponse.mock.calls.length > 0, WAIT_CAP_BOUND_MS);
        expect(d.sessionData, 'session key of the closed window').not.toHaveProperty(KEYS.preset);
        expect(sendResponse, 'route response').toHaveBeenCalledWith({ ok: true });
    });

    it('A: no pending edit: the editor answers at once and the window closes promptly, after the flush request', async () => {
        await openEditor({ presets: [ORIGINAL], session: { [KEYS.preset]: PRESET_WINDOW_ID } });

        deliverCloseMessage();
        const isRemoved = await d.advanceUntil(() => d.removals().length > 0, PROMPT_CLOSE_BOUND_MS);

        expect(isRemoved, `chrome.windows.remove called within ${PROMPT_CLOSE_BOUND_MS} ms of the close message`).toBe(true);
        expect(d.removals().map((r) => r.id), 'removed window ids').toEqual([PRESET_WINDOW_ID]);
        expect(d.indexOfFlushRequest('preset'), 'a flush request for slot preset was sent').toBeGreaterThan(-1);
        expect(d.indexOfFlushRequest('preset'), 'the flush request precedes chrome.windows.remove').toBeLessThan(d.events.indexOf(d.removals()[0]));
    });

    it('B: duplicate name: the preset window stays open, keeps its session key and is not focused; the global window, which no editor answers for, still closes', async () => {
        await openEditor({ presets: [ORIGINAL, TAKEN], session: { [KEYS.global]: GLOBAL_WINDOW_ID, [KEYS.preset]: PRESET_WINDOW_ID } });
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'taken');

        deliverCloseMessage();
        await d.advanceUntil(() => false, WAIT_CAP_BOUND_MS + 1000);

        expect(d.removals().map((r) => r.id), 'removed window ids').toEqual([GLOBAL_WINDOW_ID]);
        expect(d.sessionData[KEYS.preset], 'session key of the window kept open').toBe(PRESET_WINDOW_ID);
        expect(d.sessionData, 'session key of the closed global window').not.toHaveProperty(KEYS.global);
        expect(d.focusCalls(), 'chrome.windows.update({ focused: true }) calls').toEqual([]);
        expect(h.el.saveStatus.textContent, 'editor save status text').toBe('「taken」已存在，請使用不同的名稱。');
        expect(h.el.saveStatus.classList.contains('save-status--error'), 'save status carries the error class').toBe(true);
    });

    it('C: the editor save never settles at the storage boundary: the editor answers timeout before the caller gives up at 1000 ms', async () => {
        await openEditor({ presets: [ORIGINAL], session: {} });
        h.hangStorageWrites();
        h.type(h.el.textarea, 'NEW-CONTENT');

        const startedAt = Date.now();
        let reply = { settled: false };
        globalThis.DSSEditorFlushChannel.requestEditorFlush('preset').then((status) => { reply = { settled: true, status, elapsedMs: Date.now() - startedAt }; });
        await d.advanceUntil(() => reply.settled, WAIT_CAP_BOUND_MS);

        expect(reply.settled, 'requestEditorFlush settled').toBe(true);
        expect(reply.status, 'status requestEditorFlush returns for a hung editor save (undefined means the editor reply came too late)').toBe(FLUSH_STATUS.TIMEOUT);
        expect(reply.elapsedMs, `ms from the flush request to the editor reply (caller deadline ${CALLER_FLUSH_DEADLINE_MS} ms)`).toBeLessThan(CALLER_FLUSH_DEADLINE_MS);
    });
});

describe('background close, flush answer shapes at the runtime boundary', () => {
    let d;

    beforeEach(() => {
        vi.useFakeTimers();
        d = createEditorWindowFlushDoubles();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        d.restore();
    });

    it('sends exactly { type: FLUSH_MESSAGE_TYPE, slot } once per tracked window, and removes both windows after clean answers', async () => {
        Object.assign(d.sessionData, { [KEYS.global]: GLOBAL_WINDOW_ID, [KEYS.preset]: PRESET_WINDOW_ID });
        d.installSendMessage(() => Promise.resolve({ status: 'clean' }));

        deliverCloseMessage();
        await d.advanceUntil(() => d.removals().length === 2, PROMPT_CLOSE_BOUND_MS);

        const flushType = globalThis.DSS_EDITOR_WINDOW.FLUSH_MESSAGE_TYPE;
        const requests = d.flushRequests().slice().sort((a, b) => a.slot.localeCompare(b.slot));
        expect(requests, 'flush requests sent').toEqual([{ type: flushType, slot: 'global' }, { type: flushType, slot: 'preset' }]);
        expect(d.removals().map((r) => r.id).sort(), 'removed window ids').toEqual([GLOBAL_WINDOW_ID, PRESET_WINDOW_ID]);
        expect(d.indexOfFlushRequest('global'), 'global flush request precedes removal of the global window').toBeLessThan(d.indexOfEvent((e) => e.kind === 'windows.remove' && e.id === GLOBAL_WINDOW_ID));
        expect(d.indexOfFlushRequest('preset'), 'preset flush request precedes removal of the preset window').toBeLessThan(d.indexOfEvent((e) => e.kind === 'windows.remove' && e.id === PRESET_WINDOW_ID));
    });

    it.each(NON_BLOCKING_FLUSH_OUTCOMES)('C: %s: the window is removed after the flush request and its session key deleted', async (_label, sendMessageImpl, isPrompt) => {
        d.sessionData[KEYS.preset] = PRESET_WINDOW_ID;
        d.installSendMessage(sendMessageImpl);
        const boundMs = isPrompt ? PROMPT_CLOSE_BOUND_MS : WAIT_CAP_BOUND_MS;

        const { sendResponse } = deliverCloseMessage();
        const isRemoved = await d.advanceUntil(() => d.removals().length > 0, boundMs);

        expect(isRemoved, `chrome.windows.remove called within ${boundMs} ms of the close message`).toBe(true);
        expect(d.removals().map((r) => r.id), 'removed window ids').toEqual([PRESET_WINDOW_ID]);
        expect(d.indexOfFlushRequest('preset'), 'a flush request for slot preset was sent').toBeGreaterThan(-1);
        expect(d.indexOfFlushRequest('preset'), 'the flush request precedes chrome.windows.remove').toBeLessThan(d.events.indexOf(d.removals()[0]));
        await d.advanceUntil(() => sendResponse.mock.calls.length > 0, WAIT_CAP_BOUND_MS);
        expect(d.sessionData, 'session key of the closed window').not.toHaveProperty(KEYS.preset);
        expect(sendResponse, 'route response').toHaveBeenCalledWith({ ok: true });
    });

    it('two tracked windows, neither answers: both are removed within one wait of about 1000 ms (handled in parallel, not one after the other)', async () => {
        Object.assign(d.sessionData, { [KEYS.global]: GLOBAL_WINDOW_ID, [KEYS.preset]: PRESET_WINDOW_ID });
        d.installSendMessage(() => new Promise(() => {}));

        const { sendResponse } = deliverCloseMessage();
        const areBothRemoved = await d.advanceUntil(() => d.removals().length === 2, WAIT_CAP_BOUND_MS);

        expect(areBothRemoved, `both windows removed within ${WAIT_CAP_BOUND_MS} ms (one after the other would take about 2000 ms); removed so far: ${JSON.stringify(d.removals().map((r) => r.id))}`).toBe(true);
        expect(d.removals().map((r) => r.id).sort(), 'removed window ids').toEqual([GLOBAL_WINDOW_ID, PRESET_WINDOW_ID]);
        await d.advanceUntil(() => sendResponse.mock.calls.length > 0, WAIT_CAP_BOUND_MS);
        expect(sendResponse, 'route response').toHaveBeenCalledWith({ ok: true });
        expect(d.sessionData, 'session keys of the closed windows').toEqual({});
    });

    it('B: the editor answers duplicate: no chrome.windows.remove, the session key stays, no focus call', async () => {
        d.sessionData[KEYS.preset] = PRESET_WINDOW_ID;
        d.installSendMessage(() => Promise.resolve({ status: 'duplicate' }));

        deliverCloseMessage();
        await d.advanceUntil(() => false, WAIT_CAP_BOUND_MS + 1000);

        expect(d.removals().map((r) => r.id), 'window ids passed to chrome.windows.remove').toEqual([]);
        expect(d.sessionData[KEYS.preset], 'session key of the window kept open').toBe(PRESET_WINDOW_ID);
        expect(d.focusCalls(), 'chrome.windows.update({ focused: true }) calls').toEqual([]);
        expect(d.flushRequests().map((m) => m.slot), 'flush requests sent (slots)').toEqual(['preset']);
    });
});
