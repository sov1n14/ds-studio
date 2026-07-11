/**
 * popup/popup.settings-controls.js — bindSettingsControls() and debounce() unit tests.
 * bindSettingsControls() takes no params and references the same bare DOM-const
 * globals as popup.js (enableToggle, chatWidthSlider, ...) plus StorageManager /
 * refreshSyncStatus / showSaveStatus / applyMasterSwitchUI. Freshly extracted
 * during the modular split; no prior spec covered this logic directly.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

beforeAll(() => {
    const code = readFileSync(resolve(__dirname, '../../popup/popup.settings-controls.js'), 'utf-8');
    const globalEval = eval;
    globalEval(code);
    if (typeof globalThis.bindSettingsControls !== 'function') {
        throw new Error('bindSettingsControls was not exposed as a global after eval');
    }
});

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

beforeEach(() => {
    Object.assign(globalThis, {
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
    });
    globalThis.StorageManager = {
        saveGlobalPromptEnabled: vi.fn().mockResolvedValue(undefined),
        saveEnabledState: vi.fn().mockResolvedValue(undefined),
        saveIncludeThinking: vi.fn().mockResolvedValue(undefined),
        saveIncludeReferences: vi.fn().mockResolvedValue(undefined),
        saveSidebarAutoHide: vi.fn().mockResolvedValue(undefined),
        saveHideThinking: vi.fn().mockResolvedValue(undefined),
        saveShowSystemTime: vi.fn().mockResolvedValue(undefined),
        saveChatWidthEnabled: vi.fn().mockResolvedValue(undefined),
        saveChatWidth: vi.fn().mockResolvedValue(undefined),
        saveInputWidthEnabled: vi.fn().mockResolvedValue(undefined),
        saveInputWidth: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    globalThis.showSaveStatus = vi.fn();
    globalThis.applyMasterSwitchUI = vi.fn();
});

describe('debounce(fn, delayMs)', () => {
    it('calls fn only once after the delay, with the last invocation args', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced('a');
        debounced('b');
        vi.advanceTimersByTime(100);

        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith('b');
        vi.useRealTimers();
    });

    it('does not fire before the delay elapses', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced();
        vi.advanceTimersByTime(299);

        expect(fn).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});

describe('bindSettingsControls()', () => {
    it('saves globalPromptEnabled and refreshes status on toggle change', async () => {
        bindSettingsControls();

        globalThis.globalPromptToggle.checked = false;
        globalThis.globalPromptToggle.dispatchEvent(new Event('change'));
        await Promise.resolve();
        await Promise.resolve();

        expect(globalThis.StorageManager.saveGlobalPromptEnabled).toHaveBeenCalledWith(false);
        expect(globalThis.refreshSyncStatus).toHaveBeenCalled();
        expect(globalThis.showSaveStatus).toHaveBeenCalled();
    });

    it('saves enabled state and applies master switch UI on the main toggle', async () => {
        bindSettingsControls();

        globalThis.enableToggle.checked = true;
        globalThis.enableToggle.dispatchEvent(new Event('change'));
        await Promise.resolve();
        await Promise.resolve();

        expect(globalThis.StorageManager.saveEnabledState).toHaveBeenCalledWith(true);
        expect(globalThis.applyMasterSwitchUI).toHaveBeenCalledWith(true);
    });

    it('toggles the collapsed class and saves chatWidthEnabled on chatWidthToggle change', async () => {
        bindSettingsControls();

        globalThis.chatWidthToggle.checked = false;
        globalThis.chatWidthToggle.dispatchEvent(new Event('change'));
        await Promise.resolve();
        await Promise.resolve();

        expect(globalThis.chatWidthSliderContainer.classList.contains('collapsed')).toBe(true);
        expect(globalThis.StorageManager.saveChatWidthEnabled).toHaveBeenCalledWith(false);
    });

    it('debounces chatWidthSlider "change" events into a single saveChatWidth call', async () => {
        vi.useFakeTimers();
        bindSettingsControls();

        globalThis.chatWidthSlider.value = '80';
        globalThis.chatWidthSlider.dispatchEvent(new Event('change'));
        globalThis.chatWidthSlider.value = '90';
        globalThis.chatWidthSlider.dispatchEvent(new Event('change'));

        await vi.advanceTimersByTimeAsync(500);

        expect(globalThis.StorageManager.saveChatWidth).toHaveBeenCalledTimes(1);
        expect(globalThis.StorageManager.saveChatWidth).toHaveBeenCalledWith(90);
        vi.useRealTimers();
    });

    it('updates chatWidthValue text on slider "input" without saving', () => {
        bindSettingsControls();

        globalThis.chatWidthSlider.value = '55';
        globalThis.chatWidthSlider.dispatchEvent(new Event('input'));

        expect(globalThis.chatWidthValue.textContent).toBe('55%');
        expect(globalThis.StorageManager.saveChatWidth).not.toHaveBeenCalled();
    });

    it('debounces inputWidthSlider "change" events into a single saveInputWidth call', async () => {
        vi.useFakeTimers();
        bindSettingsControls();

        globalThis.inputWidthSlider.value = '40';
        globalThis.inputWidthSlider.dispatchEvent(new Event('change'));

        await vi.advanceTimersByTimeAsync(500);

        expect(globalThis.StorageManager.saveInputWidth).toHaveBeenCalledWith(40);
        vi.useRealTimers();
    });
});
