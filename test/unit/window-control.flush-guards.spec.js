/**
 * Guards around the 4.39.12 flush-before-navigate step of utils/window-control.js openSingletonWindow: unusual shapes of the stored window, keys that are not editor slots, missing editor constants, and a missing flush channel.
 *
 * Contract sources: docs/architecture/POPUP.md "Focus / navigate / recreate" and "Flush requests (v4.39.12)", docs/spec/01-prompt-system.md "Standalone Prompt Editor Window".
 * - A stored id whose window is gone (chrome.windows.get rejects) falls through to chrome.windows.create and the new id is stored; the gone window is not focused.
 * - The existing tab is navigated (chrome.tabs.update) only when there is a tab to navigate and its url differs; otherwise the window is only focused.
 * - The flush request is sent only when a swap is needed and the storage key belongs to an editor window (DSS_EDITOR_WINDOW.STORAGE_KEYS); no request when the url is unchanged.
 * - Each caller throws a message naming utils/editor-flush-channel.js when the channel is missing.
 *
 * Doubles (trust boundary only): chrome.storage.session, chrome.windows (get / create / update), chrome.tabs.update, chrome.runtime.sendMessage. Values cross the boundary as structuredClone copies.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const { openSingletonWindow } = await import('../../utils/window-control.js');

const EDITOR_CONSTANTS = globalThis.DSS_EDITOR_WINDOW;
const PRESET_KEY = EDITOR_CONSTANTS.STORAGE_KEYS.preset;
const NON_EDITOR_KEY = 'dss-some-other-window-id';
const BASE_URL = 'chrome-extension://test-extension-id/popup/editor/editor.html';
const URL_CURRENT = `${BASE_URL}?target=preset&id=poc-1`;
const URL_OTHER = `${BASE_URL}?target=preset&id=poc-2`;
const CREATE_OPTIONS = { type: 'popup', width: 1280, height: 720 };
const WINDOW_ID = 11;
const TAB_ID = 101;
const NEW_WINDOW_ID = 22;
const NEW_TAB_ID = 202;
const CHANNEL_FILE_PATTERN = /editor-flush-channel\.js/;
const requireFromTest = createRequire(import.meta.url);
const CHANNEL_PATH = requireFromTest.resolve('../../utils/editor-flush-channel.js');
const WINDOW_CONTROL_PATH = requireFromTest.resolve('../../utils/window-control.js');

/** Install copy-semantics doubles for the boundaries openSingletonWindow touches; every effect lands in one ordered log. */
function createBoundary() {
    const events = [];
    const session = {};
    const windowsById = new Map();
    let reply = () => Promise.resolve({ status: 'saved' });
    const saved = {
        session: chrome.storage.session,
        windowsGet: chrome.windows.get,
        windowsCreate: chrome.windows.create,
        windowsUpdate: chrome.windows.update,
        tabsUpdate: chrome.tabs.update,
        sendMessage: chrome.runtime.sendMessage,
    };
    chrome.storage.session = {
        get: vi.fn(async (key) => (key in session ? { [key]: structuredClone(session[key]) } : {})),
        set: vi.fn(async (items) => { Object.assign(session, structuredClone(items)); }),
        remove: vi.fn(async (key) => { delete session[key]; }),
    };
    chrome.windows.get = vi.fn(async (id) => {
        if (!windowsById.has(id)) throw new Error(`No window with id: ${id}.`);
        return structuredClone(windowsById.get(id));
    });
    chrome.windows.create = vi.fn(async (options) => {
        events.push({ kind: 'windows.create', options: structuredClone(options) });
        return { id: NEW_WINDOW_ID, tabs: [{ id: NEW_TAB_ID, active: true, windowId: NEW_WINDOW_ID, url: options?.url }] };
    });
    chrome.windows.update = vi.fn(async (id, props) => {
        events.push({ kind: 'windows.update', id, props: structuredClone(props) });
        return { id };
    });
    chrome.tabs.update = vi.fn(async (tabId, props) => {
        events.push({ kind: 'tabs.update', tabId, props: structuredClone(props) });
        return { id: tabId, ...props };
    });
    chrome.runtime.sendMessage = vi.fn((message) => {
        events.push({ kind: 'runtime.sendMessage', message: structuredClone(message) });
        return reply(structuredClone(message));
    });

    return {
        session,
        /** Store `windowObject` as what chrome.windows.get resolves for `windowId`, and remember the id under `storageKey`. */
        trackWindow(storageKey, windowId, windowObject) {
            session[storageKey] = windowId;
            windowsById.set(windowId, windowObject);
        },
        answerWith(impl) { reply = impl; },
        kinds: (kind) => events.filter((e) => e.kind === kind),
        focusedIds: () => events.filter((e) => e.kind === 'windows.update' && e.props?.focused === true).map((e) => e.id),
        restore() {
            if (saved.session === undefined) delete chrome.storage.session; else chrome.storage.session = saved.session;
            chrome.windows.get = saved.windowsGet;
            chrome.windows.create = saved.windowsCreate;
            chrome.windows.update = saved.windowsUpdate;
            chrome.tabs.update = saved.tabsUpdate;
            chrome.runtime.sendMessage = saved.sendMessage;
        },
    };
}

const editorWindow = (tabs) => (tabs === undefined ? { id: WINDOW_ID } : { id: WINDOW_ID, tabs });
const tabShowing = (url, id = TAB_ID) => ({ id, active: true, windowId: WINDOW_ID, url });
const open = (url, storageKey = PRESET_KEY) => openSingletonWindow({ url, createOptions: CREATE_OPTIONS, storageKey });
const settle = (promise) => promise.then((value) => ({ value, error: undefined }), (error) => ({ value: undefined, error }));

describe('openSingletonWindow: shape of the stored window', () => {
    let b;

    beforeEach(() => {
        b = createBoundary();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        b.restore();
        vi.restoreAllMocks();
    });

    it('a stored window reported without a tabs list is focused and returned; nothing is navigated, flushed or created', async () => {
        b.trackWindow(PRESET_KEY, WINDOW_ID, editorWindow(undefined));

        const { value, error } = await settle(open(URL_OTHER));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value, 'result').toEqual({ window: { id: WINDOW_ID }, created: false });
        expect(b.focusedIds(), 'focused window ids').toEqual([WINDOW_ID]);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
        expect(b.kinds('runtime.sendMessage'), 'flush requests').toEqual([]);
        expect(b.kinds('windows.create'), 'chrome.windows.create calls').toEqual([]);
    });

    it('a stored window with an empty tabs list is focused and returned; nothing is navigated, flushed or created', async () => {
        b.trackWindow(PRESET_KEY, WINDOW_ID, editorWindow([]));

        const { value, error } = await settle(open(URL_OTHER));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value, 'result').toEqual({ window: { id: WINDOW_ID, tabs: [] }, created: false });
        expect(b.focusedIds(), 'focused window ids').toEqual([WINDOW_ID]);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
        expect(b.kinds('runtime.sendMessage'), 'flush requests').toEqual([]);
        expect(b.kinds('windows.create'), 'chrome.windows.create calls').toEqual([]);
    });

    it('a tab without a numeric id is never navigated (a tabs.update call with no tab id targets the active tab of the current window) and no flush request is sent', async () => {
        const tabWithoutId = { active: true, windowId: WINDOW_ID, url: URL_CURRENT };
        b.trackWindow(PRESET_KEY, WINDOW_ID, editorWindow([tabWithoutId]));

        const { value, error } = await settle(open(URL_OTHER));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(false);
        expect(b.focusedIds(), 'focused window ids').toEqual([WINDOW_ID]);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
        expect(b.kinds('runtime.sendMessage'), 'flush requests').toEqual([]);
        expect(b.kinds('windows.create'), 'chrome.windows.create calls').toEqual([]);
    });

    it('chrome.windows.get resolving no window: a fresh window is created and its id stored (availability over dedupe)', async () => {
        b.trackWindow(PRESET_KEY, WINDOW_ID, undefined);

        const { value, error } = await settle(open(URL_OTHER));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(true);
        expect(b.kinds('windows.create').map((e) => e.options), 'chrome.windows.create calls').toEqual([{ url: URL_OTHER, ...CREATE_OPTIONS }]);
        expect(b.session[PRESET_KEY], 'stored editor window id').toBe(NEW_WINDOW_ID);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
    });

    it('a stored window that is gone (chrome.windows.get rejects) is not focused; a fresh window is created and its id stored', async () => {
        b.session[PRESET_KEY] = WINDOW_ID;

        const { value, error } = await settle(open(URL_OTHER));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(true);
        expect(b.focusedIds(), 'focused window ids').toEqual([]);
        expect(b.kinds('windows.create').map((e) => e.options), 'chrome.windows.create calls').toEqual([{ url: URL_OTHER, ...CREATE_OPTIONS }]);
        expect(b.session[PRESET_KEY], 'stored editor window id').toBe(NEW_WINDOW_ID);
        expect(b.kinds('runtime.sendMessage'), 'flush requests').toEqual([]);
    });
});

describe('openSingletonWindow: a key that is not an editor slot', () => {
    let b;

    beforeEach(() => { b = createBoundary(); });
    afterEach(() => { b.restore(); });

    it('navigates without sending a flush request, so even a receiver that would answer duplicate cannot cancel the swap', async () => {
        b.answerWith(() => Promise.resolve({ status: EDITOR_CONSTANTS.FLUSH_STATUS.DUPLICATE }));
        b.trackWindow(NON_EDITOR_KEY, WINDOW_ID, editorWindow([tabShowing(URL_CURRENT)]));

        const { value, error } = await settle(open(URL_OTHER, NON_EDITOR_KEY));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(false);
        expect(b.kinds('runtime.sendMessage'), 'runtime messages sent').toEqual([]);
        expect(b.kinds('tabs.update').map((e) => ({ tabId: e.tabId, props: e.props })), 'chrome.tabs.update calls').toEqual([{ tabId: TAB_ID, props: { url: URL_OTHER } }]);
        expect(b.focusedIds(), 'focused window ids').toEqual([WINDOW_ID]);
    });
});

describe('openSingletonWindow: editor constants (utils/message-constants.js) not loaded or partial', () => {
    let b;

    beforeEach(() => { b = createBoundary(); });
    afterEach(() => {
        globalThis.DSS_EDITOR_WINDOW = EDITOR_CONSTANTS;
        b.restore();
    });

    it('constants absent, same url: the window is focused and returned; the unchanged-url path never needs the flush constants', async () => {
        b.trackWindow(PRESET_KEY, WINDOW_ID, editorWindow([tabShowing(URL_CURRENT)]));
        delete globalThis.DSS_EDITOR_WINDOW;

        const { value, error } = await settle(open(URL_CURRENT));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(false);
        expect(b.focusedIds(), 'focused window ids').toEqual([WINDOW_ID]);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
        expect(b.kinds('runtime.sendMessage'), 'flush requests').toEqual([]);
    });

    it('constants without FLUSH_STATUS, same url: the window is focused and returned without a flush request', async () => {
        b.trackWindow(PRESET_KEY, WINDOW_ID, editorWindow([tabShowing(URL_CURRENT)]));
        globalThis.DSS_EDITOR_WINDOW = { STORAGE_KEYS: EDITOR_CONSTANTS.STORAGE_KEYS };

        const { value, error } = await settle(open(URL_CURRENT));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(false);
        expect(b.focusedIds(), 'focused window ids').toEqual([WINDOW_ID]);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
        expect(b.kinds('runtime.sendMessage'), 'flush requests').toEqual([]);
    });

    it('constants absent, different url: no key can belong to an editor window, so no flush request is sent; the existing tab is navigated to the new url and the window focused, without a second window', async () => {
        b.trackWindow(PRESET_KEY, WINDOW_ID, editorWindow([tabShowing(URL_CURRENT)]));
        delete globalThis.DSS_EDITOR_WINDOW;

        const { value, error } = await settle(open(URL_OTHER));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(false);
        expect(b.kinds('tabs.update').map((e) => ({ tabId: e.tabId, props: e.props })), 'chrome.tabs.update calls').toEqual([{ tabId: TAB_ID, props: { url: URL_OTHER } }]);
        expect(b.focusedIds(), 'focused window ids').toEqual([WINDOW_ID]);
        expect(b.kinds('runtime.sendMessage'), 'flush requests').toEqual([]);
        expect(b.kinds('windows.create'), 'chrome.windows.create calls').toEqual([]);
    });

    it('constants without FLUSH_STATUS, different url, key not an editor slot: no flush request is sent and the missing duplicate status cannot cancel the swap; the existing tab is navigated to the new url and the window focused', async () => {
        b.trackWindow(NON_EDITOR_KEY, WINDOW_ID, editorWindow([tabShowing(URL_CURRENT)]));
        globalThis.DSS_EDITOR_WINDOW = { STORAGE_KEYS: EDITOR_CONSTANTS.STORAGE_KEYS };

        const { value, error } = await settle(open(URL_OTHER, NON_EDITOR_KEY));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(false);
        expect(b.kinds('tabs.update').map((e) => ({ tabId: e.tabId, props: e.props })), 'chrome.tabs.update calls').toEqual([{ tabId: TAB_ID, props: { url: URL_OTHER } }]);
        expect(b.focusedIds(), 'focused window ids').toEqual([WINDOW_ID]);
        expect(b.kinds('runtime.sendMessage'), 'flush requests').toEqual([]);
        expect(b.kinds('windows.create'), 'chrome.windows.create calls').toEqual([]);
    });
});

describe('openSingletonWindow: flush channel (utils/editor-flush-channel.js) resolution', () => {
    let b;
    let savedChannel;
    let savedCacheEntry;

    beforeEach(() => {
        b = createBoundary();
        b.trackWindow(PRESET_KEY, WINDOW_ID, editorWindow([tabShowing(URL_CURRENT)]));
        savedChannel = globalThis.DSSEditorFlushChannel;
        delete globalThis.DSSEditorFlushChannel;
        savedCacheEntry = requireFromTest.cache[CHANNEL_PATH];
    });

    afterEach(() => {
        if (savedCacheEntry === undefined) delete requireFromTest.cache[CHANNEL_PATH]; else requireFromTest.cache[CHANNEL_PATH] = savedCacheEntry;
        if (savedChannel === undefined) delete globalThis.DSSEditorFlushChannel; else globalThis.DSSEditorFlushChannel = savedChannel;
        b.restore();
    });

    /** Make the CommonJS require of utils/editor-flush-channel.js yield `exportsValue`, as a broken or stale channel file would. */
    function stubChannelModule(exportsValue) {
        requireFromTest.cache[CHANNEL_PATH] = { id: CHANNEL_PATH, filename: CHANNEL_PATH, loaded: true, exports: exportsValue, children: [], paths: [] };
    }

    it('Node runtime, channel global not loaded: the channel file is loaded on demand, the flush request is sent and the window navigates', async () => {
        const { value, error } = await settle(open(URL_OTHER));

        expect(error, 'openSingletonWindow rejection').toBeUndefined();
        expect(value?.created, 'created').toBe(false);
        expect(b.kinds('runtime.sendMessage').map((e) => e.message), 'flush requests').toEqual([{ type: EDITOR_CONSTANTS.FLUSH_MESSAGE_TYPE, slot: 'preset' }]);
        expect(b.kinds('tabs.update').map((e) => ({ tabId: e.tabId, props: e.props })), 'chrome.tabs.update calls').toEqual([{ tabId: TAB_ID, props: { url: URL_OTHER } }]);
    });

    it('the channel file exports no requestEditorFlush function: the call rejects with an error naming utils/editor-flush-channel.js', async () => {
        stubChannelModule({});

        const { error } = await settle(open(URL_OTHER));

        expect(error?.message, 'rejection message').toMatch(CHANNEL_FILE_PATTERN);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
    });

    it('the channel file exports nothing (null): the call rejects with an error naming utils/editor-flush-channel.js', async () => {
        stubChannelModule(null);

        const { error } = await settle(open(URL_OTHER));

        expect(error?.message, 'rejection message').toMatch(CHANNEL_FILE_PATTERN);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
    });

    it('browser classic-script runtime (no require, as popup.html loads it), channel not loaded: the call rejects with an error naming utils/editor-flush-channel.js', async () => {
        // Run the real file as a classic script in a context without require or module, the way popup.html loads it.
        const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, DSS_EDITOR_WINDOW: EDITOR_CONSTANTS });
        // Share the mutation-testing namespace (absent in a normal run) so an instrumented copy of the file sees the active mutant.
        Object.defineProperty(context, '__stryker__', { get: () => globalThis.__stryker__, set: () => {}, configurable: true });
        vm.runInContext(readFileSync(WINDOW_CONTROL_PATH, 'utf8'), context, { filename: WINDOW_CONTROL_PATH });
        expect(typeof context.DSSWindowControl?.openSingletonWindow, 'the classic script published DSSWindowControl').toBe('function');

        const { error } = await settle(context.DSSWindowControl.openSingletonWindow({ url: URL_OTHER, createOptions: CREATE_OPTIONS, storageKey: PRESET_KEY }));

        expect(error?.message, 'rejection message').toMatch(CHANNEL_FILE_PATTERN);
        expect(b.kinds('tabs.update'), 'chrome.tabs.update calls').toEqual([]);
    });
});
