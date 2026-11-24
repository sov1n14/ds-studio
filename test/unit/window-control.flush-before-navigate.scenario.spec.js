/**
 * Scenario: the popup pointing the open editor window at another prompt group never drops the last typed edits.
 *
 * Requirement: before the editor window is navigated, the editor saves first; the wait lasts at most about 1 s.
 * Requirement: when the save fails because the group name duplicates another group, the navigation is cancelled; the window stays on the old group and shows the duplicate-name error.
 * Contract, utils/window-control.js openSingletonWindow when the stored window shows a different url:
 * - before chrome.windows.update(focused) and chrome.tabs.update, it sends chrome.runtime.sendMessage({ type: DSS_EDITOR_WINDOW.FLUSH_MESSAGE_TYPE, slot: 'preset' }) and waits for the answer;
 * - answer 'duplicate': no chrome.tabs.update (the navigation is aborted);
 * - any other answer, no answer within about 1000 ms, a rejection, a resolved undefined or a synchronous throw: it navigates as before;
 * - the stored window already shows the requested url: no flush request, focus only (unchanged behaviour).
 *
 * Real modules: utils/window-control.js, the editor page (popup/editor/editor.js and its parts, through test/helpers/editor-window-harness.js), StorageManager, the in-memory chrome.storage. Doubles: chrome.storage.session, chrome.windows, chrome.tabs and chrome.runtime.sendMessage (test/helpers/editor-window-flush-doubles.js).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/window-control.js';
import { createEditorWindowHarness } from '../helpers/editor-window-harness.js';
import { createEditorWindowFlushDoubles, NON_BLOCKING_FLUSH_OUTCOMES } from '../helpers/editor-window-flush-doubles.js';

const KEYS = globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS;
const BASE_URL = 'chrome-extension://test-extension-id/popup/editor/editor.html';
const URL_CURRENT = `${BASE_URL}?target=preset&id=poc-1`;
const URL_OTHER = `${BASE_URL}?target=preset&id=poc-2`;
const CREATE_OPTIONS = { type: 'popup', width: 1280, height: 720 };
const WINDOW_ID = 11;
const TAB_ID = 101;
const PRESET_ID = 'poc-1';
const ORIGINAL = { id: PRESET_ID, name: 'poc original', content: 'ORIGINAL', createdAt: 1000, updatedAt: 1000 };
const OTHER = { id: 'poc-2', name: 'taken', content: 'OTHER', createdAt: 1000, updatedAt: 1000 };
const POPUP_SENDER = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup/popup.html' };
// The editor autosave fires 500 ms after the last input (test/unit/editor.escape-save.scenario.spec.js). A navigation that waits for the flush answer lands well inside this bound, so a pass cannot come from the debounce saving on its own, nor from a fixed wait of about 1000 ms.
const PROMPT_NAVIGATE_BOUND_MS = 400;
// The wait for the flush answer lasts at most about 1000 ms; these tests allow 1500 ms.
const WAIT_CAP_BOUND_MS = 1500;

/** Start the popup request to show `url` in the preset editor window; returns a record that the settled outcome fills in. */
function requestEditorUrl(url) {
    const outcome = { isSettled: false, value: undefined, error: undefined };
    globalThis.DSSWindowControl.openSingletonWindow({ url, createOptions: CREATE_OPTIONS, storageKey: KEYS.preset })
        .then((value) => { outcome.isSettled = true; outcome.value = value; }, (error) => { outcome.isSettled = true; outcome.error = error; });
    return outcome;
}

describe('popup navigation with the real editor window open', () => {
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

    /** Open the real preset editor on PRESET_ID inside tracked window WINDOW_ID, and connect the runtime bus from the popup to the editor page. */
    async function openEditor(presets) {
        await h.openPresetEditor({ presets, id: PRESET_ID });
        d.addWindow(WINDOW_ID, TAB_ID, URL_CURRENT);
        d.sessionData[KEYS.preset] = WINDOW_ID;
        d.connectRuntimeBus(() => h.pageMessageListeners, POPUP_SENDER);
    }

    it('D: a pending edit (typed, no blur, autosave not yet fired) is in storage at the instant chrome.tabs.update navigates the window', async () => {
        await openEditor([ORIGINAL, { ...OTHER, name: 'other' }]);
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'poc renamed');

        requestEditorUrl(URL_OTHER);
        const isNavigated = await d.advanceUntil(() => d.navigations().length > 0, PROMPT_NAVIGATE_BOUND_MS);

        expect(isNavigated, `chrome.tabs.update called within ${PROMPT_NAVIGATE_BOUND_MS} ms of the request`).toBe(true);
        const navigation = d.navigations()[0];
        expect(navigation, 'navigation target').toMatchObject({ tabId: TAB_ID, props: { url: URL_OTHER } });
        const flushIndex = d.indexOfFlushRequest('preset');
        const storedAtNavigate = await h.readPreset(PRESET_ID, navigation.storage);
        expect(storedAtNavigate.name, 'preset name in storage when chrome.tabs.update ran').toBe('poc renamed');
        expect(storedAtNavigate.content, 'preset content in storage when chrome.tabs.update ran').toBe('NEW-CONTENT');
        expect(flushIndex, 'a flush request for slot preset was sent').toBeGreaterThan(-1);
        expect(flushIndex, 'the flush request precedes chrome.tabs.update').toBeLessThan(d.events.indexOf(navigation));
        expect(d.events.filter((e) => e.kind === 'windows.create'), 'chrome.windows.create calls').toEqual([]);
    });

    it('D: duplicate name: the navigation is cancelled, no second window opens, and the editor keeps showing the duplicate-name error', async () => {
        await openEditor([ORIGINAL, OTHER]);
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'taken');

        requestEditorUrl(URL_OTHER);
        await d.advanceUntil(() => false, WAIT_CAP_BOUND_MS + 1000);

        expect(d.navigations().map((n) => n.props), 'chrome.tabs.update calls').toEqual([]);
        expect(d.events.filter((e) => e.kind === 'windows.create'), 'chrome.windows.create calls').toEqual([]);
        expect(d.sessionData[KEYS.preset], 'stored editor window id').toBe(WINDOW_ID);
        expect(h.el.saveStatus.textContent, 'editor save status text').toBe('「taken」已存在，請使用不同的名稱。');
        expect(h.el.saveStatus.classList.contains('save-status--error'), 'save status carries the error class').toBe(true);
        expect(d.flushRequests().map((m) => m.slot), 'flush requests sent (slots)').toEqual(['preset']);
    });

    it('D: the window already shows the requested url: it is focused, not navigated, and no flush request is sent (unchanged)', async () => {
        await openEditor([ORIGINAL]);
        h.type(h.el.textarea, 'NEW-CONTENT');

        requestEditorUrl(URL_CURRENT);
        await d.advanceUntil(() => d.focusCalls().length > 0, PROMPT_NAVIGATE_BOUND_MS);

        expect(d.focusCalls().map((e) => e.id), 'focused window ids').toEqual([WINDOW_ID]);
        expect(d.navigations(), 'chrome.tabs.update calls').toEqual([]);
        expect(d.flushRequests(), 'flush requests sent').toEqual([]);
    });
});

describe('popup navigation, flush answer shapes at the runtime boundary', () => {
    let d;

    beforeEach(() => {
        vi.useFakeTimers();
        d = createEditorWindowFlushDoubles();
        d.addWindow(WINDOW_ID, TAB_ID, URL_CURRENT);
        d.sessionData[KEYS.preset] = WINDOW_ID;
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        d.restore();
    });

    it.each(NON_BLOCKING_FLUSH_OUTCOMES)('D: %s: the window navigates to the new url after the flush request', async (_label, sendMessageImpl, isPrompt) => {
        d.installSendMessage(sendMessageImpl);
        const boundMs = isPrompt ? PROMPT_NAVIGATE_BOUND_MS : WAIT_CAP_BOUND_MS;

        const outcome = requestEditorUrl(URL_OTHER);
        const isNavigated = await d.advanceUntil(() => d.navigations().length > 0, boundMs);

        expect(isNavigated, `chrome.tabs.update called within ${boundMs} ms of the request`).toBe(true);
        expect(d.navigations().map((n) => ({ tabId: n.tabId, props: n.props })), 'navigations').toEqual([{ tabId: TAB_ID, props: { url: URL_OTHER } }]);
        expect(d.indexOfFlushRequest('preset'), 'a flush request for slot preset was sent').toBeGreaterThan(-1);
        expect(d.indexOfFlushRequest('preset'), 'the flush request precedes chrome.tabs.update').toBeLessThan(d.events.indexOf(d.navigations()[0]));
        await d.advanceUntil(() => outcome.isSettled, WAIT_CAP_BOUND_MS);
        expect(outcome.error, 'openSingletonWindow rejection').toBeUndefined();
        expect(d.events.filter((e) => e.kind === 'windows.create'), 'chrome.windows.create calls').toEqual([]);
    });

    it('D: the editor answers duplicate: no chrome.tabs.update and no chrome.windows.create', async () => {
        d.installSendMessage(() => Promise.resolve({ status: 'duplicate' }));

        requestEditorUrl(URL_OTHER);
        await d.advanceUntil(() => false, WAIT_CAP_BOUND_MS + 1000);

        expect(d.navigations().map((n) => n.props), 'chrome.tabs.update calls').toEqual([]);
        expect(d.events.filter((e) => e.kind === 'windows.create'), 'chrome.windows.create calls').toEqual([]);
        expect(d.flushRequests(), 'flush requests sent').toEqual([{ type: globalThis.DSS_EDITOR_WINDOW.FLUSH_MESSAGE_TYPE, slot: 'preset' }]);
    });
});
