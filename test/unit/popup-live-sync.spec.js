/**
 * popup/popup.live-sync.js — createLiveSyncListener() unit tests
 *
 * Strategy: this module is a standalone classic-script factory (not bundled
 * inside popup.js's DOMContentLoaded closure), so it can be loaded directly
 * via eval() (pattern established in popup-custom-select.spec.js) and its
 * public API (window.__DS_PopupLiveSync.createLiveSyncListener) exercised
 * end-to-end with a real StorageManager instance.
 *
 * chrome.storage.onChanged.addListener is spied so the exact listener
 * function registered by start() can be captured and invoked directly with
 * hand-built (changes, namespace) tuples — this sidesteps the fact that the
 * shared InMemoryStorageMock's `local` and `sync` areas keep independent
 * listener arrays (see test/fixtures/chrome-storage-mock.js), which would
 * otherwise make sync-area writes invisible to a listener registered via
 * chrome.storage.onChanged (aliased to the local area only in vitest.setup.js).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript, readProjectFile } from '../helpers/popup-script-loader.js';
import { readClosureDomRefs, sliceCompilable, topLevelFunctionDeclarations } from '../helpers/popup-closure-source.js';
import { writeChatMapLayout } from '../helpers/chat-map-writer-harness.js';

const K = StorageManager.KEYS;

beforeAll(() => {
    evalPopupScript('popup/popup.live-sync.js');
    if (typeof window.__DS_PopupLiveSync?.createLiveSyncListener !== 'function') {
        throw new Error('createLiveSyncListener was not exposed on window.__DS_PopupLiveSync');
    }
});

// ── DOM stub builders — real elements so .checked/.value/.classList behave like production ──

function makeCheckbox(checked = false) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = checked;
    return el;
}
function makeRadio(value, checked = false) {
    const el = document.createElement('input');
    el.type = 'radio';
    el.value = value;
    el.checked = checked;
    return el;
}

function makeWebsearchRadios(checkedValue = 'on') {
    return ['on', 'off'].map((value) => makeRadio(value, value === checkedValue));
}

function makeReplyNotificationRadios(checkedValue = 'off') {
    return ['on', 'off'].map((value) => makeRadio(value, value === checkedValue));
}

function makeSlider(value = '70') {
    const el = document.createElement('input');
    el.type = 'range';
    el.value = value;
    return el;
}

function makeSpan(text = '') {
    const el = document.createElement('span');
    el.textContent = text;
    return el;
}

function makeDiv() {
    return document.createElement('div');
}

function makeDom(overrides = {}) {
    return {
        enableToggle: makeCheckbox(false),
        globalPromptToggle: makeCheckbox(true),
        includeThinkingToggle: makeCheckbox(true),
        includeReferencesToggle: makeCheckbox(true),
        sidebarAutoHideToggle: makeCheckbox(false),
        hideThinkingToggle: makeCheckbox(false),
        autoExpandMessagesToggle: makeCheckbox(false),
        showSystemTimeToggle: makeCheckbox(false),
        chatWidthToggle: makeCheckbox(false),
        chatWidthSlider: makeSlider('70'),
        chatWidthValue: makeSpan('70%'),
        chatWidthSliderContainer: makeDiv(),
        inputWidthToggle: makeCheckbox(false),
        inputWidthSlider: makeSlider('70'),
        inputWidthValue: makeSpan('70%'),
        inputWidthSliderContainer: makeDiv(),
        preventAutoScrollToggle: makeCheckbox(false),
        autoRetryToggle: makeCheckbox(false),
        autoContinueToggle: makeCheckbox(false),
        autoOpenSidebarToggle: makeCheckbox(false),
        autoCopyReplyToggle: makeCheckbox(false),
        autoCopyCodeToggle: makeCheckbox(false),
        websearchRadios: makeWebsearchRadios(),
        replyNotificationRadios: makeReplyNotificationRadios(),
        ...overrides,
    };
}

// ── ctx builder — mirrors the wiring block in popup/popup.js ──

function buildCtx({ dom, customSelect = { render: vi.fn() }, activePresetId = '' } = {}) {
    const state = {
        presets: [],
        activePresetId,
        chatPresetMap: {},
    };
    const applyMasterSwitchUI = vi.fn();
    const updateEditPresetBtnState = vi.fn();
    const ctx = {
        StorageManager,
        dom: dom ?? makeDom(),
        applyMasterSwitchUI,
        updateEditPresetBtnState,
        getPresets: () => state.presets,
        setPresets: (v) => { state.presets = v; },
        getActivePresetId: () => state.activePresetId,
        setActivePresetId: (v) => { state.activePresetId = v; },
        getChatPresetMap: () => state.chatPresetMap,
        setChatPresetMap: (v) => { state.chatPresetMap = v; },
        getCustomSelect: () => customSelect,
    };
    return { ctx, state, applyMasterSwitchUI, updateEditPresetBtnState, customSelect };
}

/** Starts a listener and returns the captured raw callback passed to addListener. */
function startAndCapture(ctx) {
    let captured;
    vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation((fn) => {
        captured = fn;
    });
    const liveSync = window.__DS_PopupLiveSync.createLiveSyncListener(ctx);
    liveSync.start();
    expect(captured).toBeTypeOf('function');
    return captured;
}

// StorageManager's storage mock settles every read and write on its own setTimeout(0), and getSettings/getChatPresetMap issue those sequentially through an internal write-lock queue, so the pending chain needs one timer turn per link. Under happy-dom a real timer turn costs ~15ms, so draining the chain in real time costs hundreds of milliseconds per call site. Tests that need it drained call useVirtualTime() right before triggering the chain, and this helper then runs the whole chain in virtual time - same drain, no wall clock.
async function drainStorageChain() {
    await vi.advanceTimersByTimeAsync(1000);
}

/** Switches to virtual time for the storage chain a listener is about to kick off. Called AFTER any real-timer setup (e.g. seeding storage), so that setup still resolves against real timers. */
function useVirtualTime() {
    vi.useFakeTimers();
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Group A — IS_ENABLED / GLOBAL_PROMPT_ENABLED
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — IS_ENABLED / GLOBAL_PROMPT_ENABLED', () => {
    it('updates enableToggle and calls applyMasterSwitchUI on IS_ENABLED change', () => {
        const dom = makeDom({ enableToggle: makeCheckbox(false) });
        const { ctx, applyMasterSwitchUI } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'local');

        expect(dom.enableToggle.checked).toBe(true);
        expect(applyMasterSwitchUI).toHaveBeenCalledWith(true);
    });

    it('disables enableToggle and calls applyMasterSwitchUI(false) when disabled remotely', () => {
        const dom = makeDom({ enableToggle: makeCheckbox(true) });
        const { ctx, applyMasterSwitchUI } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.IS_ENABLED]: { oldValue: true, newValue: false } }, 'local');

        expect(dom.enableToggle.checked).toBe(false);
        expect(applyMasterSwitchUI).toHaveBeenCalledWith(false);
    });

    it('updates globalPromptToggle on GLOBAL_PROMPT_ENABLED explicit change', () => {
        const dom = makeDom({ globalPromptToggle: makeCheckbox(true) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.GLOBAL_PROMPT_ENABLED]: { oldValue: true, newValue: false } }, 'local');

        expect(dom.globalPromptToggle.checked).toBe(false);
    });

    it('defaults GLOBAL_PROMPT_ENABLED to true when newValue is undefined (?? true)', () => {
        const dom = makeDom({ globalPromptToggle: makeCheckbox(false) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.GLOBAL_PROMPT_ENABLED]: { oldValue: true, newValue: undefined } }, 'local');

        expect(dom.globalPromptToggle.checked).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — simple toggle keys
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — simple toggle keys', () => {
    const cases = [
        ['INCLUDE_THINKING', 'includeThinkingToggle'],
        ['INCLUDE_REFERENCES', 'includeReferencesToggle'],
        ['SIDEBAR_AUTO_HIDE', 'sidebarAutoHideToggle'],
        ['HIDE_THINKING', 'hideThinkingToggle'],
        ['PREVENT_AUTO_SCROLL', 'preventAutoScrollToggle'],
        ['AUTO_EXPAND_MESSAGES', 'autoExpandMessagesToggle'],
        ['AUTO_RETRY', 'autoRetryToggle'],
        ['AUTO_CONTINUE', 'autoContinueToggle'],
    ];

    it.each(cases)('updates %s -> dom.%s checkbox', (keyName, domField) => {
        const dom = makeDom({ [domField]: makeCheckbox(false) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K[keyName]]: { oldValue: false, newValue: true } }, 'local');

        expect(dom[domField].checked).toBe(true);
    });

    it('updates SHOW_SYSTEM_TIME -> showSystemTimeToggle on explicit change', () => {
        const dom = makeDom({ showSystemTimeToggle: makeCheckbox(false) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.SHOW_SYSTEM_TIME]: { oldValue: false, newValue: true } }, 'local');

        expect(dom.showSystemTimeToggle.checked).toBe(true);
    });

    it('defaults SHOW_SYSTEM_TIME to false when newValue is undefined (?? false)', () => {
        const dom = makeDom({ showSystemTimeToggle: makeCheckbox(true) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.SHOW_SYSTEM_TIME]: { oldValue: true, newValue: undefined } }, 'local');

        expect(dom.showSystemTimeToggle.checked).toBe(false);
    });

    it('ignores unrelated keys without touching any toggle', () => {
        const dom = makeDom();
        const before = {
            includeThinking: dom.includeThinkingToggle.checked,
            includeReferences: dom.includeReferencesToggle.checked,
        };
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ someUnrelatedKey: { oldValue: 1, newValue: 2 } }, 'local');

        expect(dom.includeThinkingToggle.checked).toBe(before.includeThinking);
        expect(dom.includeReferencesToggle.checked).toBe(before.includeReferences);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B2 — WEBSEARCH_TOGGLE radio group
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — WEBSEARCH_TOGGLE radio group', () => {
    it("checks the 'on' radio and unchecks 'off' when WEBSEARCH_TOGGLE becomes 'on'", () => {
        const dom = makeDom();
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.WEBSEARCH_TOGGLE]: { oldValue: 'off', newValue: 'on' } }, 'local');

        expect(dom.websearchRadios.find((r) => r.value === 'on').checked).toBe(true);
        expect(dom.websearchRadios.find((r) => r.value === 'off').checked).toBe(false);
    });

    it("checks the 'off' radio and unchecks 'on' when WEBSEARCH_TOGGLE becomes 'off'", () => {
        const dom = makeDom();
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.WEBSEARCH_TOGGLE]: { oldValue: 'on', newValue: 'off' } }, 'local');

        expect(dom.websearchRadios.find((r) => r.value === 'off').checked).toBe(true);
        expect(dom.websearchRadios.find((r) => r.value === 'on').checked).toBe(false);
    });

    it("falls back to 'on' when newValue is nullish (?? 'on')", () => {
        const dom = makeDom({ websearchRadios: makeWebsearchRadios('off') });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.WEBSEARCH_TOGGLE]: { oldValue: 'off', newValue: undefined } }, 'local');

        expect(dom.websearchRadios.find((r) => r.value === 'on').checked).toBe(true);
        expect(dom.websearchRadios.find((r) => r.value === 'off').checked).toBe(false);
    });

    it("maps the legacy stored value 'default' to the 'on' radio", () => {
        const dom = makeDom({ websearchRadios: makeWebsearchRadios('off') });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.WEBSEARCH_TOGGLE]: { oldValue: 'default', newValue: 'default' } }, 'local');

        expect(dom.websearchRadios.find((r) => r.value === 'on').checked).toBe(true);
        expect(dom.websearchRadios.find((r) => r.value === 'off').checked).toBe(false);
    });

    it('re-applying an equal value is a no-op (no feedback loop, DOM unchanged)', () => {
        const dom = makeDom();
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        // first application: the popup's own save echoing back via onChanged
        listener({ [K.WEBSEARCH_TOGGLE]: { oldValue: 'off', newValue: 'on' } }, 'local');
        expect(dom.websearchRadios.find((r) => r.value === 'on').checked).toBe(true);

        // re-application of the same value must not throw and must leave the DOM as-is
        expect(() => {
            listener({ [K.WEBSEARCH_TOGGLE]: { oldValue: 'on', newValue: 'on' } }, 'local');
        }).not.toThrow();

        expect(dom.websearchRadios.find((r) => r.value === 'on').checked).toBe(true);
        expect(dom.websearchRadios.find((r) => r.value === 'off').checked).toBe(false);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// Group B3 — AUTO_OPEN_SIDEBAR ("isAutoOpenSidebarEnabled")
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — AUTO_OPEN_SIDEBAR', () => {
    it.each([true, false])('a change of isAutoOpenSidebarEnabled to %s updates autoOpenSidebarToggle', (value) => {
        const dom = makeDom({ autoOpenSidebarToggle: makeCheckbox(!value) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ isAutoOpenSidebarEnabled: { oldValue: !value, newValue: value } }, 'local');

        expect(dom.autoOpenSidebarToggle.checked).toBe(value);
    });

    it('unchecks autoOpenSidebarToggle when the key is removed (newValue undefined falls back to false)', () => {
        const dom = makeDom({ autoOpenSidebarToggle: makeCheckbox(true) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ isAutoOpenSidebarEnabled: { oldValue: true, newValue: undefined } }, 'local');

        expect(dom.autoOpenSidebarToggle.checked).toBe(false);
    });

    it('leaves autoContinueToggle untouched (no cross-wiring)', () => {
        const dom = makeDom({ autoOpenSidebarToggle: makeCheckbox(false), autoContinueToggle: makeCheckbox(false) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ isAutoOpenSidebarEnabled: { oldValue: false, newValue: true } }, 'sync');

        expect(dom.autoOpenSidebarToggle.checked).toBe(true);
        expect(dom.autoContinueToggle.checked).toBe(false);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// Group C — CHAT_WIDTH / INPUT_WIDTH sliders
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — CHAT_WIDTH slider', () => {
    it('applies both toggle and percent when CHAT_WIDTH and CHAT_WIDTH_ENABLED change together', () => {
        const dom = makeDom({
            chatWidthToggle: makeCheckbox(false),
            chatWidthSlider: makeSlider('70'),
            chatWidthValue: makeSpan('70%'),
        });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({
            [K.CHAT_WIDTH]: { oldValue: 70, newValue: 85 },
            [K.CHAT_WIDTH_ENABLED]: { oldValue: false, newValue: true },
        }, 'local');

        expect(dom.chatWidthToggle.checked).toBe(true);
        expect(dom.chatWidthSlider.value).toBe('85');
        expect(dom.chatWidthValue.textContent).toBe('85%');
        expect(dom.chatWidthSliderContainer.classList.contains('collapsed')).toBe(false);
    });

    it('falls back to current DOM checked state when only CHAT_WIDTH changes', () => {
        const dom = makeDom({
            chatWidthToggle: makeCheckbox(true), // already enabled in DOM
            chatWidthSlider: makeSlider('50'),
            chatWidthValue: makeSpan('50%'),
        });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.CHAT_WIDTH]: { oldValue: 50, newValue: 90 } }, 'local');

        // isSliderEnabled falls back to dom.chatWidthToggle.checked (true)
        expect(dom.chatWidthToggle.checked).toBe(true);
        expect(dom.chatWidthSlider.value).toBe('90');
        expect(dom.chatWidthValue.textContent).toBe('90%');
        expect(dom.chatWidthSliderContainer.classList.contains('collapsed')).toBe(false);
    });

    it('falls back to current DOM slider value when only CHAT_WIDTH_ENABLED changes', () => {
        const dom = makeDom({
            chatWidthToggle: makeCheckbox(false),
            chatWidthSlider: makeSlider('60'),
            chatWidthValue: makeSpan('60%'),
        });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.CHAT_WIDTH_ENABLED]: { oldValue: false, newValue: true } }, 'local');

        expect(dom.chatWidthToggle.checked).toBe(true);
        // percent falls back to dom.chatWidthSlider.value (unchanged, '60')
        expect(dom.chatWidthSlider.value).toBe('60');
        expect(dom.chatWidthValue.textContent).toBe('60%');
    });

    it('adds collapsed class when CHAT_WIDTH_ENABLED becomes false', () => {
        const dom = makeDom({ chatWidthToggle: makeCheckbox(true) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.CHAT_WIDTH_ENABLED]: { oldValue: true, newValue: false } }, 'local');

        expect(dom.chatWidthSliderContainer.classList.contains('collapsed')).toBe(true);
    });
});

describe('createLiveSyncListener — INPUT_WIDTH slider', () => {
    it('applies both toggle and percent when INPUT_WIDTH and INPUT_WIDTH_ENABLED change together', () => {
        const dom = makeDom({
            inputWidthToggle: makeCheckbox(false),
            inputWidthSlider: makeSlider('70'),
            inputWidthValue: makeSpan('70%'),
        });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({
            [K.INPUT_WIDTH]: { oldValue: 70, newValue: 40 },
            [K.INPUT_WIDTH_ENABLED]: { oldValue: false, newValue: true },
        }, 'local');

        expect(dom.inputWidthToggle.checked).toBe(true);
        expect(dom.inputWidthSlider.value).toBe('40');
        expect(dom.inputWidthValue.textContent).toBe('40%');
    });

    it('falls back to current DOM checked state when only INPUT_WIDTH changes', () => {
        const dom = makeDom({
            inputWidthToggle: makeCheckbox(true),
            inputWidthSlider: makeSlider('55'),
            inputWidthValue: makeSpan('55%'),
        });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.INPUT_WIDTH]: { oldValue: 55, newValue: 33 } }, 'local');

        expect(dom.inputWidthToggle.checked).toBe(true);
        expect(dom.inputWidthSlider.value).toBe('33');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group D — preset list reload (PRESET_INDEX / PRESET_ORDER_META / dsPreset_*)
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — preset list reload', () => {
    it('reloads presets and re-renders when PRESET_INDEX changes', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Alpha', content: 'A', createdAt: 1, updatedAt: 1 },
        ]);

        const customSelect = { render: vi.fn() };
        const { ctx, state, updateEditPresetBtnState } = buildCtx({ customSelect });
        useVirtualTime();
        const listener = startAndCapture(ctx);

        listener({ [K.PRESET_INDEX]: { oldValue: [], newValue: ['p1'] } }, 'sync');
        await drainStorageChain();

        expect(state.presets).toEqual([
            expect.objectContaining({ id: 'p1', name: 'Alpha' }),
        ]);
        expect(customSelect.render).toHaveBeenCalled();
        expect(updateEditPresetBtnState).toHaveBeenCalled();
    });

    it('reloads presets when a dsPreset_* chunk key changes', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p2', name: 'Beta', content: 'B', createdAt: 1, updatedAt: 1 },
        ]);

        const customSelect = { render: vi.fn() };
        const { ctx, state } = buildCtx({ customSelect });
        useVirtualTime();
        const listener = startAndCapture(ctx);

        listener({ dsPreset_p2: { oldValue: null, newValue: { id: 'p2' } } }, 'sync');
        await drainStorageChain();

        expect(state.presets.some((p) => p.id === 'p2')).toBe(true);
        expect(customSelect.render).toHaveBeenCalled();
    });

    it('reloads presets when PRESET_ORDER_META changes', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p3', name: 'Gamma', content: 'C', createdAt: 1, updatedAt: 1 },
        ]);

        const customSelect = { render: vi.fn() };
        const { ctx, state } = buildCtx({ customSelect });
        useVirtualTime();
        const listener = startAndCapture(ctx);

        listener({ [K.PRESET_ORDER_META]: { oldValue: {}, newValue: { order: ['p3'], orderUpdatedAt: Date.now() } } }, 'sync');
        await drainStorageChain();

        expect(state.presets.some((p) => p.id === 'p3')).toBe(true);
    });

    it('does NOT reload presets for unrelated key changes', async () => {
        const customSelect = { render: vi.fn() };
        const { ctx } = buildCtx({ customSelect });
        useVirtualTime();
        const listener = startAndCapture(ctx);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'local');
        await drainStorageChain();

        expect(customSelect.render).not.toHaveBeenCalled();
    });

    // The reload runs in an un-awaited async chain, so a throw on a missing customSelect never reaches the listener caller; it surfaces only as the reload stopping short. Assert the reload end state after the drain, not a synchronous not.toThrow.
    it('still reloads presets and refreshes the edit button when customSelect has not been created yet (getCustomSelect returns null)', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p4', name: 'Delta', content: 'D', createdAt: 1, updatedAt: 1 },
        ]);

        const getCustomSelect = vi.fn(() => null);
        const { ctx, state, updateEditPresetBtnState } = buildCtx();
        ctx.getCustomSelect = getCustomSelect;
        useVirtualTime();
        const listener = startAndCapture(ctx);

        listener({ [K.PRESET_INDEX]: { oldValue: [], newValue: ['p4'] } }, 'sync');
        await drainStorageChain();

        expect(getCustomSelect, 'reload path must consult getCustomSelect').toHaveBeenCalled();
        expect(state.presets).toEqual([expect.objectContaining({ id: 'p4', name: 'Delta' })]);
        expect(updateEditPresetBtnState, 'edit-button state must refresh even without a custom select').toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group E — chat preset map reload (CHAT_PRESET_MAP_META / chatPresetMap_*)
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — chat preset map reload', () => {
    // Durable chat-map layout as the SW writer leaves it; the popup is a client and cannot mutate the map directly.
    const seedStoredMap = (map) => writeChatMapLayout([chrome.storage.sync, chrome.storage.local], K, [map]);

    it('reloads chatPresetMap when CHAT_PRESET_MAP_META changes', async () => {
        await seedStoredMap({ uuidA: 'p1' });

        const { ctx, state } = buildCtx();
        useVirtualTime();
        const listener = startAndCapture(ctx);

        listener({ [K.CHAT_PRESET_MAP_META]: { oldValue: {}, newValue: { version: 1 } } }, 'sync');
        await drainStorageChain();

        expect(state.chatPresetMap).toEqual({ uuidA: 'p1' });
    });

    it('reloads chatPresetMap when a chatPresetMap_* chunk key changes', async () => {
        await seedStoredMap({ uuidB: 'p2' });

        const { ctx, state } = buildCtx();
        useVirtualTime();
        const listener = startAndCapture(ctx);

        listener({ [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}0`]: { oldValue: null, newValue: '{}' } }, 'sync');
        await drainStorageChain();

        expect(state.chatPresetMap).toEqual({ uuidB: 'p2' });
    });

    it('does NOT reload chatPresetMap for unrelated key changes', async () => {
        const { ctx, state } = buildCtx();
        useVirtualTime();
        const listener = startAndCapture(ctx);
        const originalMap = state.chatPresetMap;

        listener({ [K.HIDE_THINKING]: { oldValue: false, newValue: true } }, 'local');
        await drainStorageChain();

        expect(state.chatPresetMap).toBe(originalMap);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group F — ACTIVE_PRESET_ID no-op guard
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — ACTIVE_PRESET_ID guard', () => {
    it('updates activePresetId and re-renders when newValue differs from current', () => {
        const customSelect = { render: vi.fn() };
        const { ctx, state, updateEditPresetBtnState } = buildCtx({ customSelect, activePresetId: 'old-id' });
        const listener = startAndCapture(ctx);

        listener({ [K.ACTIVE_PRESET_ID]: { oldValue: 'old-id', newValue: 'new-id' } }, 'sync');

        expect(state.activePresetId).toBe('new-id');
        expect(updateEditPresetBtnState).toHaveBeenCalled();
        expect(customSelect.render).toHaveBeenCalled();
    });

    it('is a no-op when newValue equals the current in-memory activePresetId', () => {
        const customSelect = { render: vi.fn() };
        const { ctx, state, updateEditPresetBtnState } = buildCtx({ customSelect, activePresetId: 'same-id' });
        const listener = startAndCapture(ctx);

        listener({ [K.ACTIVE_PRESET_ID]: { oldValue: 'same-id', newValue: 'same-id' } }, 'sync');

        expect(state.activePresetId).toBe('same-id');
        expect(updateEditPresetBtnState).not.toHaveBeenCalled();
        expect(customSelect.render).not.toHaveBeenCalled();
    });

    it('defaults newValue to empty string via ?? and treats it as a change when current is non-empty', () => {
        const customSelect = { render: vi.fn() };
        const { ctx, state } = buildCtx({ customSelect, activePresetId: 'old-id' });
        const listener = startAndCapture(ctx);

        listener({ [K.ACTIVE_PRESET_ID]: { oldValue: 'old-id', newValue: undefined } }, 'sync');

        expect(state.activePresetId).toBe('');
    });

    it('does not throw when customSelect has not been created yet', () => {
        const { ctx, state } = buildCtx({ customSelect: null, activePresetId: 'old-id' });
        const listener = startAndCapture(ctx);

        expect(() => {
            listener({ [K.ACTIVE_PRESET_ID]: { oldValue: 'old-id', newValue: 'new-id' } }, 'sync');
        }).not.toThrow();
        expect(state.activePresetId).toBe('new-id');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group G — idempotency / no feedback loop / namespace filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — idempotency and namespace filtering', () => {
    it('re-applying the same value twice does not throw and leaves DOM state unchanged', () => {
        const dom = makeDom({ enableToggle: makeCheckbox(false) });
        const { ctx, applyMasterSwitchUI } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'local');
        expect(() => {
            listener({ [K.IS_ENABLED]: { oldValue: true, newValue: true } }, 'local');
        }).not.toThrow();

        expect(dom.enableToggle.checked).toBe(true);
        expect(applyMasterSwitchUI).toHaveBeenCalledTimes(2);
    });

    it('does nothing when namespace is neither local nor sync (guard in the registered wrapper)', () => {
        const dom = makeDom({ enableToggle: makeCheckbox(false) });
        const { ctx, applyMasterSwitchUI } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'managed');

        expect(dom.enableToggle.checked).toBe(false);
        expect(applyMasterSwitchUI).not.toHaveBeenCalled();
    });

    it('processes changes for both local and sync namespaces', () => {
        const dom = makeDom({ hideThinkingToggle: makeCheckbox(false) });
        const { ctx } = buildCtx({ dom });
        const listener = startAndCapture(ctx);

        listener({ [K.HIDE_THINKING]: { oldValue: false, newValue: true } }, 'sync');

        expect(dom.hideThinkingToggle.checked).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group H — popup.js 的 Live Sync 接線區塊（執行真實區塊，斷言交給 createLiveSyncListener 的 ctx）
// ─────────────────────────────────────────────────────────────────────────────

describe('popup.js — Live Sync wiring block', () => {
    let popupCode;

    beforeAll(() => {
        popupCode = readProjectFile('popup/popup.js');
    });

    /**
     * 執行 popup.js 從 `const liveSync = window.__DS_PopupLiveSync.createLiveSyncListener(...)` 到 `liveSync.start()` 的真實原始碼。
     * 區塊範圍以可編譯判斷取出，不依賴縮排，因此在 Stryker 以 Babel 重新排版並插樁的 popup.js 上同樣執行；檔案最外層的 stryMutAct_* 等輔助函式放在同一範圍。
     * 閉包變數由 with 範圍提供：每個閉包層級 DOM 參照是一個獨立的標記物件，presets、activePresetId、chatPresetMap、customSelect 讀寫 state，window 只帶一個記錄 ctx 的 createLiveSyncListener。區塊若引用其他閉包變數，執行時丟出 ReferenceError。
     */
    function runWiringBlock() {
        const start = popupCode.search(/const\s+liveSync\s*=\s*window\.__DS_PopupLiveSync\.createLiveSyncListener\s*\(/);
        if (start === -1) throw new Error('Could not locate Live Sync wiring block in popup.js');
        const call = sliceCompilable(popupCode, start, ')', 'the createLiveSyncListener(...) call');
        const startCallIdx = popupCode.indexOf('liveSync.start()', start + call.length);
        if (startCallIdx === -1) throw new Error('Could not locate liveSync.start() after the Live Sync wiring block in popup.js');
        const block = popupCode.slice(start, startCallIdx + 'liveSync.start()'.length);

        const domRefs = Object.fromEntries([...readClosureDomRefs(popupCode).keys()].map((name) => [name, { domRef: name }]));
        const state = {
            presets: [{ id: 'p-initial' }],
            activePresetId: 'a-initial',
            chatPresetMap: { 'chat-initial': 'p-initial' },
            customSelect: { name: 'customSelect-initial' },
        };
        const created = [];
        const listener = { startCalls: 0, start() { this.startCalls += 1; } };
        const scope = {
            ...domRefs,
            StorageManager: { name: 'StorageManager sentinel' },
            applyMasterSwitchUI: function applyMasterSwitchUI() {},
            updateEditPresetBtnState: function updateEditPresetBtnState() {},
            window: { __DS_PopupLiveSync: { createLiveSyncListener: (ctx) => { created.push(ctx); return listener; } } },
            get presets() { return state.presets; },
            set presets(v) { state.presets = v; },
            get activePresetId() { return state.activePresetId; },
            set activePresetId(v) { state.activePresetId = v; },
            get chatPresetMap() { return state.chatPresetMap; },
            set chatPresetMap(v) { state.chatPresetMap = v; },
            get customSelect() { return state.customSelect; },
            set customSelect(v) { state.customSelect = v; },
        };
        // new Function 的函式本體為非嚴格模式，可使用 with 把閉包變數接到 scope；最外層宣告放在 with 之外，作用同檔案最外層。
        new Function('scope', `${topLevelFunctionDeclarations(popupCode).join('\n')}\nwith (scope) {\n${block}\n}`)(scope);
        expect(created, 'the wiring block must call createLiveSyncListener exactly once').toHaveLength(1);
        return { ctx: created[0], listener, scope, domRefs, state };
    }

    it('constructs createLiveSyncListener with StorageManager and calls start()', () => {
        const { ctx, listener, scope } = runWiringBlock();
        expect(ctx.StorageManager).toBe(scope.StorageManager);
        expect(listener.startCalls).toBe(1);
    });

    it('passes all expected dom fields into ctx.dom', () => {
        const { ctx, domRefs } = runWiringBlock();
        const expectedDomFields = [
            'enableToggle', 'includeThinkingToggle', 'includeReferencesToggle',
            'showSystemTimeToggle', 'globalPromptToggle',
            'sidebarAutoHideToggle', 'hideThinkingToggle',
            'chatWidthToggle', 'chatWidthSlider', 'chatWidthValue', 'chatWidthSliderContainer',
            'inputWidthToggle', 'inputWidthSlider', 'inputWidthValue', 'inputWidthSliderContainer',
            'preventAutoScrollToggle', 'autoExpandMessagesToggle', 'websearchRadios',
            'autoOpenSidebarToggle', 'autoCopyReplyToggle', 'autoCopyCodeToggle',
            'replyNotificationRadios',
        ];
        for (const field of expectedDomFields) {
            expect(domRefs[field], `popup.js declares no closure DOM ref named ${field}`).toBeDefined();
            expect(ctx.dom[field], `missing dom field: ${field}`).toBe(domRefs[field]);
        }
    });

    it('wires applyMasterSwitchUI and updateEditPresetBtnState callbacks', () => {
        const { ctx, scope } = runWiringBlock();
        expect(ctx.applyMasterSwitchUI).toBe(scope.applyMasterSwitchUI);
        expect(ctx.updateEditPresetBtnState).toBe(scope.updateEditPresetBtnState);
    });

    it('wires preset/activePresetId/chatPresetMap/customSelect accessors', () => {
        const { ctx, state } = runWiringBlock();

        // getter 讀的是閉包變數的當下值，不是建立 ctx 時的快照
        const laterPresets = [{ id: 'p-later' }];
        state.presets = laterPresets;
        expect(ctx.getPresets()).toBe(laterPresets);
        const nextPresets = [{ id: 'p-next' }];
        ctx.setPresets(nextPresets);
        expect(state.presets).toBe(nextPresets);

        state.activePresetId = 'a-later';
        expect(ctx.getActivePresetId()).toBe('a-later');
        ctx.setActivePresetId('a-next');
        expect(state.activePresetId).toBe('a-next');

        const laterMap = { 'chat-later': 'p-later' };
        state.chatPresetMap = laterMap;
        expect(ctx.getChatPresetMap()).toBe(laterMap);
        const nextMap = { 'chat-next': 'p-next' };
        ctx.setChatPresetMap(nextMap);
        expect(state.chatPresetMap).toBe(nextMap);

        const laterSelect = { name: 'customSelect-later' };
        state.customSelect = laterSelect;
        expect(ctx.getCustomSelect()).toBe(laterSelect);
    });

    it('is wired after customSelect creation and after sendActivePresetToContentScript()', () => {
        const customSelectCreationIdx = popupCode.indexOf('customSelect = window.__DSSCustomSelect.createPresetCustomSelect(');
        const sendActiveIdx = popupCode.indexOf('sendActivePresetToContentScript();');
        const wiringIdx = popupCode.indexOf('const liveSync = window.__DS_PopupLiveSync.createLiveSyncListener(');

        expect(customSelectCreationIdx).toBeGreaterThan(-1);
        expect(sendActiveIdx).toBeGreaterThan(-1);
        expect(wiringIdx).toBeGreaterThan(-1);
        expect(wiringIdx).toBeGreaterThan(customSelectCreationIdx);
        expect(wiringIdx).toBeGreaterThan(sendActiveIdx);
    });
});
