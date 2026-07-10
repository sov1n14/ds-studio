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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import StorageManager from '../../utils/storage-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const K = StorageManager.KEYS;

beforeAll(() => {
    const code = readFileSync(resolve(__dirname, '../../popup/popup.live-sync.js'), 'utf-8');
    eval(code);
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

async function flushMicrotasks() {
    // StorageManager's storage mock resolves via chained setTimeout(0) calls plus
    // an internal write-lock queue (_get -> _safeGet -> per-preset _get, etc. for
    // getSettings/getChatPresetMap). Empirically this needs several hundred ms of
    // real wall time to fully drain, not just a couple of event-loop turns.
    await new Promise((r) => setTimeout(r, 500));
}

afterEach(() => {
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
        const listener = startAndCapture(ctx);

        listener({ [K.PRESET_INDEX]: { oldValue: [], newValue: ['p1'] } }, 'sync');
        await flushMicrotasks();

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
        const listener = startAndCapture(ctx);

        listener({ dsPreset_p2: { oldValue: null, newValue: { id: 'p2' } } }, 'sync');
        await flushMicrotasks();

        expect(state.presets.some((p) => p.id === 'p2')).toBe(true);
        expect(customSelect.render).toHaveBeenCalled();
    });

    it('reloads presets when PRESET_ORDER_META changes', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p3', name: 'Gamma', content: 'C', createdAt: 1, updatedAt: 1 },
        ]);

        const customSelect = { render: vi.fn() };
        const { ctx, state } = buildCtx({ customSelect });
        const listener = startAndCapture(ctx);

        listener({ [K.PRESET_ORDER_META]: { oldValue: {}, newValue: { order: ['p3'], orderUpdatedAt: Date.now() } } }, 'sync');
        await flushMicrotasks();

        expect(state.presets.some((p) => p.id === 'p3')).toBe(true);
    });

    it('does NOT reload presets for unrelated key changes', async () => {
        const customSelect = { render: vi.fn() };
        const { ctx } = buildCtx({ customSelect });
        const listener = startAndCapture(ctx);

        listener({ [K.IS_ENABLED]: { oldValue: false, newValue: true } }, 'local');
        await flushMicrotasks();

        expect(customSelect.render).not.toHaveBeenCalled();
    });

    it('does not throw when customSelect has not been created yet (getCustomSelect returns falsy)', async () => {
        const { ctx } = buildCtx({ customSelect: null });
        const listener = startAndCapture(ctx);

        expect(() => {
            listener({ [K.PRESET_INDEX]: { oldValue: [], newValue: [] } }, 'sync');
        }).not.toThrow();
        await flushMicrotasks();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group E — chat preset map reload (CHAT_PRESET_MAP_META / chatPresetMap_*)
// ─────────────────────────────────────────────────────────────────────────────

describe('createLiveSyncListener — chat preset map reload', () => {
    it('reloads chatPresetMap when CHAT_PRESET_MAP_META changes', async () => {
        await StorageManager.saveChatPresetMap({ uuidA: 'p1' });

        const { ctx, state } = buildCtx();
        const listener = startAndCapture(ctx);

        listener({ [K.CHAT_PRESET_MAP_META]: { oldValue: {}, newValue: { version: 1 } } }, 'sync');
        await flushMicrotasks();

        expect(state.chatPresetMap).toEqual({ uuidA: 'p1' });
    });

    it('reloads chatPresetMap when a chatPresetMap_* chunk key changes', async () => {
        await StorageManager.saveChatPresetMap({ uuidB: 'p2' });

        const { ctx, state } = buildCtx();
        const listener = startAndCapture(ctx);

        listener({ [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}0`]: { oldValue: null, newValue: '{}' } }, 'sync');
        await flushMicrotasks();

        expect(state.chatPresetMap).toEqual({ uuidB: 'p2' });
    });

    it('does NOT reload chatPresetMap for unrelated key changes', async () => {
        const { ctx, state } = buildCtx();
        const listener = startAndCapture(ctx);
        const originalMap = state.chatPresetMap;

        listener({ [K.HIDE_THINKING]: { oldValue: false, newValue: true } }, 'local');
        await flushMicrotasks();

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
// Group H — popup.js wiring block (static source assertions)
// ─────────────────────────────────────────────────────────────────────────────

describe('popup.js — Live Sync wiring block', () => {
    let popupCode;

    beforeAll(() => {
        popupCode = readFileSync(resolve(__dirname, '../../popup/popup.js'), 'utf-8');
    });

    function extractWiringBlock() {
        const match = popupCode.match(
            /const liveSync = window\.__DS_PopupLiveSync\.createLiveSyncListener\(\{[\s\S]*?\r?\n {4}\}\);\r?\n {4}liveSync\.start\(\);/
        );
        if (!match) throw new Error('Could not locate Live Sync wiring block in popup.js');
        return match[0];
    }

    it('constructs createLiveSyncListener with StorageManager and calls start()', () => {
        const block = extractWiringBlock();
        expect(block).toMatch(/StorageManager,/);
        expect(block).toMatch(/liveSync\.start\(\);$/);
    });

    it('passes all expected dom fields into ctx.dom', () => {
        const block = extractWiringBlock();
        const expectedDomFields = [
            'enableToggle', 'includeThinkingToggle', 'includeReferencesToggle',
            'showSystemTimeToggle', 'globalPromptToggle',
            'sidebarAutoHideToggle', 'hideThinkingToggle',
            'chatWidthToggle', 'chatWidthSlider', 'chatWidthValue', 'chatWidthSliderContainer',
            'inputWidthToggle', 'inputWidthSlider', 'inputWidthValue', 'inputWidthSliderContainer',
        ];
        for (const field of expectedDomFields) {
            expect(block, `missing dom field: ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
        }
    });

    it('wires applyMasterSwitchUI and updateEditPresetBtnState callbacks', () => {
        const block = extractWiringBlock();
        expect(block).toMatch(/applyMasterSwitchUI,/);
        expect(block).toMatch(/updateEditPresetBtnState,/);
    });

    it('wires preset/activePresetId/chatPresetMap/customSelect accessors', () => {
        const block = extractWiringBlock();
        expect(block).toMatch(/getPresets:\s*\(\)\s*=>\s*presets/);
        expect(block).toMatch(/setPresets:\s*\(v\)\s*=>\s*\{\s*presets\s*=\s*v;\s*\}/);
        expect(block).toMatch(/getActivePresetId:\s*\(\)\s*=>\s*activePresetId/);
        expect(block).toMatch(/setActivePresetId:\s*\(v\)\s*=>\s*\{\s*activePresetId\s*=\s*v;\s*\}/);
        expect(block).toMatch(/getChatPresetMap:\s*\(\)\s*=>\s*chatPresetMap/);
        expect(block).toMatch(/setChatPresetMap:\s*\(v\)\s*=>\s*\{\s*chatPresetMap\s*=\s*v;\s*\}/);
        expect(block).toMatch(/getCustomSelect:\s*\(\)\s*=>\s*customSelect/);
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
