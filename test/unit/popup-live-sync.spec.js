/**
 * popup/popup.live-sync.js — startLiveSync() unit tests
 *
 * Post-refactor, this module is a plain classic-script file: top-level
 * `function startLiveSync(popupState) {...}` with no window.__DS_PopupLiveSync
 * bridge. Its internals (_handleChanges et al.) reference bare globals that are
 * top-level `const`/consts declared in popup.js — enableToggle, chatWidthSlider,
 * applyMasterSwitchUI, updateEditPresetBtnState, StorageManager, etc — rather
 * than an injected ctx object. Tests therefore stub these as globalThis
 * properties before loading the module (via indirect eval, which always runs
 * as a non-strict global script so the function declaration becomes reachable),
 * then call startLiveSync(popupState) with only the shared state object.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import StorageManager from '../../utils/storage-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const K = StorageManager.KEYS;

beforeAll(() => {
    const code = readFileSync(resolve(__dirname, '../../popup/popup.live-sync.js'), 'utf-8');
    const globalEval = eval;
    globalEval(code);
    if (typeof globalThis.startLiveSync !== 'function') {
        throw new Error('startLiveSync was not exposed as a global after eval');
    }
});

// ── DOM stub builders — real elements so .checked/.value/.classList behave like production ──

function makeCheckbox(checked = false) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = checked;
    return el;
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

/** Stubs every bare global that popup.live-sync.js's _handleChanges reads/writes. */
function stubGlobals(overrides = {}) {
    const dom = {
        enableToggle: makeCheckbox(false),
        globalPromptToggle: makeCheckbox(true),
        includeThinkingToggle: makeCheckbox(true),
        includeReferencesToggle: makeCheckbox(true),
        sidebarAutoHideToggle: makeCheckbox(false),
        hideThinkingToggle: makeCheckbox(false),
        showSystemTimeToggle: makeCheckbox(false),
        chatWidthToggle: makeCheckbox(false),
        chatWidthSlider: makeSlider('70'),
        chatWidthValue: makeSpan('70%'),
        chatWidthSliderContainer: makeDiv(),
        inputWidthToggle: makeCheckbox(false),
        inputWidthSlider: makeSlider('70'),
        inputWidthValue: makeSpan('70%'),
        inputWidthSliderContainer: makeDiv(),
        ...overrides,
    };
    Object.assign(globalThis, dom);
    globalThis.applyMasterSwitchUI = vi.fn();
    globalThis.updateEditPresetBtnState = vi.fn();
    globalThis.StorageManager = StorageManager;
    return dom;
}

function makePopupState({ customSelect = { render: vi.fn() }, activePresetId = '' } = {}) {
    return {
        presets: [],
        activePresetId,
        chatPresetMap: {},
        customSelect,
    };
}

/** Starts a listener and returns the captured raw callback passed to addListener. */
function startAndCapture(popupState) {
    let captured;
    vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation((fn) => {
        captured = fn;
    });
    startLiveSync(popupState);
    expect(captured).toBeTypeOf('function');
    return captured;
}

async function flushMicrotasks() {
    // StorageManager's storage mock resolves via chained setTimeout(0) calls plus
    // an internal write-lock queue. Empirically this needs several hundred ms of
    // real wall time to fully drain, not just a couple of event-loop turns.
    await new Promise((r) => setTimeout(r, 500));
}

afterEach(() => {
    vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Group A — IS_ENABLED / GLOBAL_PROMPT_ENABLED
// ─────────────────────────────────────────────────────────────────────────────

describe('startLiveSync — IS_ENABLED / GLOBAL_PROMPT_ENABLED', () => {
    it('updates enableToggle and calls applyMasterSwitchUI on IS_ENABLED change', () => {
        const dom = stubGlobals({ enableToggle: makeCheckbox(false) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'local');

        expect(dom.enableToggle.checked).toBe(true);
        expect(globalThis.applyMasterSwitchUI).toHaveBeenCalledWith(true);
    });

    it('disables enableToggle and calls applyMasterSwitchUI(false) when disabled remotely', () => {
        const dom = stubGlobals({ enableToggle: makeCheckbox(true) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.IS_ENABLED]: { oldValue: true, newValue: false } }, 'local');

        expect(dom.enableToggle.checked).toBe(false);
        expect(globalThis.applyMasterSwitchUI).toHaveBeenCalledWith(false);
    });

    it('updates globalPromptToggle on GLOBAL_PROMPT_ENABLED explicit change', () => {
        const dom = stubGlobals({ globalPromptToggle: makeCheckbox(true) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.GLOBAL_PROMPT_ENABLED]: { oldValue: true, newValue: false } }, 'local');

        expect(dom.globalPromptToggle.checked).toBe(false);
    });

    it('defaults GLOBAL_PROMPT_ENABLED to true when newValue is undefined (?? true)', () => {
        const dom = stubGlobals({ globalPromptToggle: makeCheckbox(false) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.GLOBAL_PROMPT_ENABLED]: { oldValue: true, newValue: undefined } }, 'local');

        expect(dom.globalPromptToggle.checked).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — simple toggle keys
// ─────────────────────────────────────────────────────────────────────────────

describe('startLiveSync — simple toggle keys', () => {
    const cases = [
        ['INCLUDE_THINKING', 'includeThinkingToggle'],
        ['INCLUDE_REFERENCES', 'includeReferencesToggle'],
        ['SIDEBAR_AUTO_HIDE', 'sidebarAutoHideToggle'],
        ['HIDE_THINKING', 'hideThinkingToggle'],
    ];

    it.each(cases)('updates %s -> %s checkbox', (keyName, domField) => {
        const dom = stubGlobals({ [domField]: makeCheckbox(false) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K[keyName]]: { oldValue: false, newValue: true } }, 'local');

        expect(dom[domField].checked).toBe(true);
    });

    it('updates SHOW_SYSTEM_TIME -> showSystemTimeToggle on explicit change', () => {
        const dom = stubGlobals({ showSystemTimeToggle: makeCheckbox(false) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.SHOW_SYSTEM_TIME]: { oldValue: false, newValue: true } }, 'local');

        expect(dom.showSystemTimeToggle.checked).toBe(true);
    });

    it('defaults SHOW_SYSTEM_TIME to false when newValue is undefined (?? false)', () => {
        const dom = stubGlobals({ showSystemTimeToggle: makeCheckbox(true) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.SHOW_SYSTEM_TIME]: { oldValue: true, newValue: undefined } }, 'local');

        expect(dom.showSystemTimeToggle.checked).toBe(false);
    });

    it('ignores unrelated keys without touching any toggle', () => {
        const dom = stubGlobals();
        const before = {
            includeThinking: dom.includeThinkingToggle.checked,
            includeReferences: dom.includeReferencesToggle.checked,
        };
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ someUnrelatedKey: { oldValue: 1, newValue: 2 } }, 'local');

        expect(dom.includeThinkingToggle.checked).toBe(before.includeThinking);
        expect(dom.includeReferencesToggle.checked).toBe(before.includeReferences);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C — CHAT_WIDTH / INPUT_WIDTH sliders
// ─────────────────────────────────────────────────────────────────────────────

describe('startLiveSync — CHAT_WIDTH slider', () => {
    it('applies both toggle and percent when CHAT_WIDTH and CHAT_WIDTH_ENABLED change together', () => {
        const dom = stubGlobals({
            chatWidthToggle: makeCheckbox(false),
            chatWidthSlider: makeSlider('70'),
            chatWidthValue: makeSpan('70%'),
        });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

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
        const dom = stubGlobals({
            chatWidthToggle: makeCheckbox(true), // already enabled in DOM
            chatWidthSlider: makeSlider('50'),
            chatWidthValue: makeSpan('50%'),
        });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.CHAT_WIDTH]: { oldValue: 50, newValue: 90 } }, 'local');

        expect(dom.chatWidthToggle.checked).toBe(true);
        expect(dom.chatWidthSlider.value).toBe('90');
        expect(dom.chatWidthValue.textContent).toBe('90%');
        expect(dom.chatWidthSliderContainer.classList.contains('collapsed')).toBe(false);
    });

    it('falls back to current DOM slider value when only CHAT_WIDTH_ENABLED changes', () => {
        const dom = stubGlobals({
            chatWidthToggle: makeCheckbox(false),
            chatWidthSlider: makeSlider('60'),
            chatWidthValue: makeSpan('60%'),
        });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.CHAT_WIDTH_ENABLED]: { oldValue: false, newValue: true } }, 'local');

        expect(dom.chatWidthToggle.checked).toBe(true);
        expect(dom.chatWidthSlider.value).toBe('60');
        expect(dom.chatWidthValue.textContent).toBe('60%');
    });

    it('adds collapsed class when CHAT_WIDTH_ENABLED becomes false', () => {
        const dom = stubGlobals({ chatWidthToggle: makeCheckbox(true) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.CHAT_WIDTH_ENABLED]: { oldValue: true, newValue: false } }, 'local');

        expect(dom.chatWidthSliderContainer.classList.contains('collapsed')).toBe(true);
    });
});

describe('startLiveSync — INPUT_WIDTH slider', () => {
    it('applies both toggle and percent when INPUT_WIDTH and INPUT_WIDTH_ENABLED change together', () => {
        const dom = stubGlobals({
            inputWidthToggle: makeCheckbox(false),
            inputWidthSlider: makeSlider('70'),
            inputWidthValue: makeSpan('70%'),
        });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({
            [K.INPUT_WIDTH]: { oldValue: 70, newValue: 40 },
            [K.INPUT_WIDTH_ENABLED]: { oldValue: false, newValue: true },
        }, 'local');

        expect(dom.inputWidthToggle.checked).toBe(true);
        expect(dom.inputWidthSlider.value).toBe('40');
        expect(dom.inputWidthValue.textContent).toBe('40%');
    });

    it('falls back to current DOM checked state when only INPUT_WIDTH changes', () => {
        const dom = stubGlobals({
            inputWidthToggle: makeCheckbox(true),
            inputWidthSlider: makeSlider('55'),
            inputWidthValue: makeSpan('55%'),
        });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.INPUT_WIDTH]: { oldValue: 55, newValue: 33 } }, 'local');

        expect(dom.inputWidthToggle.checked).toBe(true);
        expect(dom.inputWidthSlider.value).toBe('33');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group D — preset list reload (PRESET_INDEX / PRESET_ORDER_META / dsPreset_*)
// ─────────────────────────────────────────────────────────────────────────────

describe('startLiveSync — preset list reload', () => {
    it('reloads presets and re-renders when PRESET_INDEX changes', async () => {
        stubGlobals();
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Alpha', content: 'A', createdAt: 1, updatedAt: 1 },
        ]);

        const customSelect = { render: vi.fn() };
        const popupState = makePopupState({ customSelect });
        const listener = startAndCapture(popupState);

        listener({ [K.PRESET_INDEX]: { oldValue: [], newValue: ['p1'] } }, 'sync');
        await flushMicrotasks();

        expect(popupState.presets).toEqual([
            expect.objectContaining({ id: 'p1', name: 'Alpha' }),
        ]);
        expect(customSelect.render).toHaveBeenCalled();
        expect(globalThis.updateEditPresetBtnState).toHaveBeenCalled();
    });

    it('reloads presets when a dsPreset_* chunk key changes', async () => {
        stubGlobals();
        await StorageManager.savePromptPresets([
            { id: 'p2', name: 'Beta', content: 'B', createdAt: 1, updatedAt: 1 },
        ]);

        const customSelect = { render: vi.fn() };
        const popupState = makePopupState({ customSelect });
        const listener = startAndCapture(popupState);

        listener({ dsPreset_p2: { oldValue: null, newValue: { id: 'p2' } } }, 'sync');
        await flushMicrotasks();

        expect(popupState.presets.some((p) => p.id === 'p2')).toBe(true);
        expect(customSelect.render).toHaveBeenCalled();
    });

    it('reloads presets when PRESET_ORDER_META changes', async () => {
        stubGlobals();
        await StorageManager.savePromptPresets([
            { id: 'p3', name: 'Gamma', content: 'C', createdAt: 1, updatedAt: 1 },
        ]);

        const customSelect = { render: vi.fn() };
        const popupState = makePopupState({ customSelect });
        const listener = startAndCapture(popupState);

        listener({ [K.PRESET_ORDER_META]: { oldValue: {}, newValue: { order: ['p3'], orderUpdatedAt: Date.now() } } }, 'sync');
        await flushMicrotasks();

        expect(popupState.presets.some((p) => p.id === 'p3')).toBe(true);
    });

    it('does NOT reload presets for unrelated key changes', async () => {
        stubGlobals();
        const customSelect = { render: vi.fn() };
        const popupState = makePopupState({ customSelect });
        const listener = startAndCapture(popupState);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'local');
        await flushMicrotasks();

        expect(customSelect.render).not.toHaveBeenCalled();
    });

    it('does not throw when customSelect has not been created yet (null)', async () => {
        stubGlobals();
        const popupState = makePopupState({ customSelect: null });
        const listener = startAndCapture(popupState);

        expect(() => {
            listener({ [K.PRESET_INDEX]: { oldValue: [], newValue: [] } }, 'sync');
        }).not.toThrow();
        await flushMicrotasks();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group E — chat preset map reload (CHAT_PRESET_MAP_META / chatPresetMap_*)
// ─────────────────────────────────────────────────────────────────────────────

describe('startLiveSync — chat preset map reload', () => {
    it('reloads chatPresetMap when CHAT_PRESET_MAP_META changes', async () => {
        stubGlobals();
        await StorageManager.saveChatPresetMap({ uuidA: 'p1' });

        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.CHAT_PRESET_MAP_META]: { oldValue: {}, newValue: { version: 1 } } }, 'sync');
        await flushMicrotasks();

        expect(popupState.chatPresetMap).toEqual({ uuidA: 'p1' });
    });

    it('reloads chatPresetMap when a chatPresetMap_* chunk key changes', async () => {
        stubGlobals();
        await StorageManager.saveChatPresetMap({ uuidB: 'p2' });

        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}0`]: { oldValue: null, newValue: '{}' } }, 'sync');
        await flushMicrotasks();

        expect(popupState.chatPresetMap).toEqual({ uuidB: 'p2' });
    });

    it('does NOT reload chatPresetMap for unrelated key changes', async () => {
        stubGlobals();
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);
        const originalMap = popupState.chatPresetMap;

        listener({ [K.HIDE_THINKING]: { oldValue: false, newValue: true } }, 'local');
        await flushMicrotasks();

        expect(popupState.chatPresetMap).toBe(originalMap);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group F — ACTIVE_PRESET_ID no-op guard
// ─────────────────────────────────────────────────────────────────────────────

describe('startLiveSync — ACTIVE_PRESET_ID guard', () => {
    it('updates activePresetId and re-renders when newValue differs from current', () => {
        stubGlobals();
        const customSelect = { render: vi.fn() };
        const popupState = makePopupState({ customSelect, activePresetId: 'old-id' });
        const listener = startAndCapture(popupState);

        listener({ [K.ACTIVE_PRESET_ID]: { oldValue: 'old-id', newValue: 'new-id' } }, 'sync');

        expect(popupState.activePresetId).toBe('new-id');
        expect(globalThis.updateEditPresetBtnState).toHaveBeenCalled();
        expect(customSelect.render).toHaveBeenCalled();
    });

    it('is a no-op when newValue equals the current in-memory activePresetId', () => {
        stubGlobals();
        const customSelect = { render: vi.fn() };
        const popupState = makePopupState({ customSelect, activePresetId: 'same-id' });
        const listener = startAndCapture(popupState);

        listener({ [K.ACTIVE_PRESET_ID]: { oldValue: 'same-id', newValue: 'same-id' } }, 'sync');

        expect(popupState.activePresetId).toBe('same-id');
        expect(globalThis.updateEditPresetBtnState).not.toHaveBeenCalled();
        expect(customSelect.render).not.toHaveBeenCalled();
    });

    it('defaults newValue to empty string via ?? and treats it as a change when current is non-empty', () => {
        stubGlobals();
        const customSelect = { render: vi.fn() };
        const popupState = makePopupState({ customSelect, activePresetId: 'old-id' });
        const listener = startAndCapture(popupState);

        listener({ [K.ACTIVE_PRESET_ID]: { oldValue: 'old-id', newValue: undefined } }, 'sync');

        expect(popupState.activePresetId).toBe('');
    });

    it('does not throw when customSelect has not been created yet', () => {
        stubGlobals();
        const popupState = makePopupState({ customSelect: null, activePresetId: 'old-id' });
        const listener = startAndCapture(popupState);

        expect(() => {
            listener({ [K.ACTIVE_PRESET_ID]: { oldValue: 'old-id', newValue: 'new-id' } }, 'sync');
        }).not.toThrow();
        expect(popupState.activePresetId).toBe('new-id');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group G — idempotency / no feedback loop / namespace filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('startLiveSync — idempotency and namespace filtering', () => {
    it('re-applying the same value twice does not throw and leaves DOM state unchanged', () => {
        const dom = stubGlobals({ enableToggle: makeCheckbox(false) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'local');
        expect(() => {
            listener({ [K.IS_ENABLED]: { oldValue: true, newValue: true } }, 'local');
        }).not.toThrow();

        expect(dom.enableToggle.checked).toBe(true);
        expect(globalThis.applyMasterSwitchUI).toHaveBeenCalledTimes(2);
    });

    it('does nothing when namespace is neither local nor sync (guard in the registered wrapper)', () => {
        const dom = stubGlobals({ enableToggle: makeCheckbox(false) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'managed');

        expect(dom.enableToggle.checked).toBe(false);
        expect(globalThis.applyMasterSwitchUI).not.toHaveBeenCalled();
    });

    it('processes changes for both local and sync namespaces', () => {
        const dom = stubGlobals({ hideThinkingToggle: makeCheckbox(false) });
        const popupState = makePopupState();
        const listener = startAndCapture(popupState);

        listener({ [K.HIDE_THINKING]: { oldValue: false, newValue: true } }, 'sync');

        expect(dom.hideThinkingToggle.checked).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group H — popup.js wiring (static source assertions)
// ─────────────────────────────────────────────────────────────────────────────

describe('popup.js — Live Sync wiring', () => {
    let popupCode;

    beforeAll(() => {
        popupCode = readFileSync(resolve(__dirname, '../../popup/popup.js'), 'utf-8');
    });

    it('calls startLiveSync(popupState) after customSelect creation and after sendActivePresetToContentScript()', () => {
        const customSelectCreationIdx = popupCode.indexOf('popupState.customSelect = createPresetCustomSelect(');
        const sendActiveIdx = popupCode.indexOf('sendActivePresetToContentScript();');
        const wiringIdx = popupCode.indexOf('startLiveSync(popupState);');

        expect(customSelectCreationIdx).toBeGreaterThan(-1);
        expect(sendActiveIdx).toBeGreaterThan(-1);
        expect(wiringIdx).toBeGreaterThan(-1);
        expect(wiringIdx).toBeGreaterThan(customSelectCreationIdx);
        expect(wiringIdx).toBeGreaterThan(sendActiveIdx);
    });
});
