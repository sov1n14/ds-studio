/**
 * Tests for the slider debounce wiring in popup/popup.width-sliders.js.
 *
 * The width sliders take their `debounce` from the shared utils/debounce.js
 * (`const debounce = DSSDebounce;`); the helper's own timing contract is owned by
 * test/unit/debounce.spec.js. What this file guards is the wiring around it:
 *   - the `input` event updates the live percentage label synchronously (undebounced)
 *   - the `change` event calls a `debounce(asyncFn, 500)`-wrapped save
 *     (debouncedSaveChatWidth / debouncedSaveInputWidth)
 *
 * popup.width-sliders.js has no ESM export surface (classic script executed inside
 * DOMContentLoaded), so the wiring is covered two ways: source-level regex assertions
 * on the shipped file, plus an injectable harness that mirrors the production closures
 * line-for-line using the real shared debounce.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/debounce.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPopupCode() {
    return readFileSync(resolve(__dirname, '../../popup/popup.width-sliders.js'), 'utf-8');
}

// ─────────────────────────────────────────────
// Source-level guard: slider saves must be wired at 500ms
// ─────────────────────────────────────────────

describe('popup.js slider debounce wiring — source assertions', () => {
    const code = getPopupCode();

    it('wires debouncedSaveChatWidth with a 500ms delay', () => {
        expect(code).toMatch(/const debouncedSaveChatWidth = debounce\(async \(widthValue\) => \{[\s\S]*?\}, 500\);/);
    });

    it('wires debouncedSaveInputWidth with a 500ms delay', () => {
        expect(code).toMatch(/const debouncedSaveInputWidth = debounce\(async \(widthValue\) => \{[\s\S]*?\}, 500\);/);
    });

    it('chatWidthSlider "input" handler is not wrapped by the debounce call', () => {
        const inputBlockMatch = code.match(/chatWidthSlider\.addEventListener\('input', \(\) => \{[\s\S]*?\}\);/);
        expect(inputBlockMatch).not.toBeNull();
        expect(inputBlockMatch[0]).not.toContain('debouncedSaveChatWidth');
    });

    it('chatWidthSlider "change" handler calls the debounced save', () => {
        const changeBlockMatch = code.match(/chatWidthSlider\.addEventListener\('change', \(\) => \{[\s\S]*?\}\);/);
        expect(changeBlockMatch).not.toBeNull();
        expect(changeBlockMatch[0]).toContain('debouncedSaveChatWidth');
    });

    it('inputWidthSlider "input" handler is not wrapped by the debounce call', () => {
        const inputBlockMatch = code.match(/inputWidthSlider\.addEventListener\('input', \(\) => \{[\s\S]*?\}\);/);
        expect(inputBlockMatch).not.toBeNull();
        expect(inputBlockMatch[0]).not.toContain('debouncedSaveInputWidth');
    });

    it('inputWidthSlider "change" handler calls the debounced save', () => {
        const changeBlockMatch = code.match(/inputWidthSlider\.addEventListener\('change', \(\) => \{[\s\S]*?\}\);/);
        expect(changeBlockMatch).not.toBeNull();
        expect(changeBlockMatch[0]).toContain('debouncedSaveInputWidth');
    });
});

// ─────────────────────────────────────────────
// Behavioral harness: chatWidthSlider input/change wiring
// Mirrors popup.js lines ~494-501 exactly, with StorageManager/refreshSyncStatus/
// showSaveStatus injected so we can assert on debounced-save timing and payload.
// ─────────────────────────────────────────────

function buildChatWidthSliderHarness({ saveChatWidth, refreshSyncStatus, showSaveStatus, debounce }) {
    const chatWidthSlider = document.createElement('input');
    chatWidthSlider.type = 'range';
    const chatWidthValue = document.createElement('span');

    const debouncedSaveChatWidth = debounce(async (widthValue) => {
        await saveChatWidth(widthValue);
        await refreshSyncStatus();
        showSaveStatus();
    }, 500);

    chatWidthSlider.addEventListener('input', () => {
        chatWidthValue.textContent = chatWidthSlider.value + '%';
    });
    chatWidthSlider.addEventListener('change', () => {
        debouncedSaveChatWidth(parseInt(chatWidthSlider.value, 10));
    });

    return { chatWidthSlider, chatWidthValue };
}

describe('chatWidthSlider behavior — input vs change wiring (harness mirroring popup.js)', () => {
    let debounce;

    beforeAll(() => {
        // The shipped file does `const debounce = DSSDebounce;` — the harness uses that same shared helper.
        debounce = globalThis.DSSDebounce;
    });

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('input event updates the live label immediately without waiting for the debounce window', () => {
        const saveChatWidth = vi.fn().mockResolvedValue(undefined);
        const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
        const showSaveStatus = vi.fn();

        const { chatWidthSlider, chatWidthValue } = buildChatWidthSliderHarness({
            saveChatWidth, refreshSyncStatus, showSaveStatus, debounce,
        });

        chatWidthSlider.value = '75';
        chatWidthSlider.dispatchEvent(new Event('input'));

        // Label updates synchronously — no timer advance needed.
        expect(chatWidthValue.textContent).toBe('75%');
        expect(saveChatWidth).not.toHaveBeenCalled();
    });

    it('change event does not persist to storage before 500ms elapses', () => {
        const saveChatWidth = vi.fn().mockResolvedValue(undefined);
        const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
        const showSaveStatus = vi.fn();

        const { chatWidthSlider } = buildChatWidthSliderHarness({
            saveChatWidth, refreshSyncStatus, showSaveStatus, debounce,
        });

        chatWidthSlider.value = '60';
        chatWidthSlider.dispatchEvent(new Event('change'));

        vi.advanceTimersByTime(499);
        expect(saveChatWidth).not.toHaveBeenCalled();
    });

    it('change event persists the parsed integer value at/after 500ms', async () => {
        const saveChatWidth = vi.fn().mockResolvedValue(undefined);
        const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
        const showSaveStatus = vi.fn();

        const { chatWidthSlider } = buildChatWidthSliderHarness({
            saveChatWidth, refreshSyncStatus, showSaveStatus, debounce,
        });

        chatWidthSlider.value = '60';
        chatWidthSlider.dispatchEvent(new Event('change'));

        await vi.advanceTimersByTimeAsync(500);

        expect(saveChatWidth).toHaveBeenCalledWith(60);
        expect(refreshSyncStatus).toHaveBeenCalledOnce();
        expect(showSaveStatus).toHaveBeenCalledOnce();
    });

    it('rapid successive change events collapse into a single storage write with the last value', async () => {
        const saveChatWidth = vi.fn().mockResolvedValue(undefined);
        const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
        const showSaveStatus = vi.fn();

        const { chatWidthSlider } = buildChatWidthSliderHarness({
            saveChatWidth, refreshSyncStatus, showSaveStatus, debounce,
        });

        chatWidthSlider.value = '50';
        chatWidthSlider.dispatchEvent(new Event('change'));
        chatWidthSlider.value = '65';
        chatWidthSlider.dispatchEvent(new Event('change'));
        chatWidthSlider.value = '80';
        chatWidthSlider.dispatchEvent(new Event('change'));

        await vi.advanceTimersByTimeAsync(500);

        expect(saveChatWidth).toHaveBeenCalledTimes(1);
        expect(saveChatWidth).toHaveBeenCalledWith(80);
    });
});

// ─────────────────────────────────────────────
// Regression: chatWidthToggle / inputWidthToggle remain synchronous/undebounced
// Mirrors popup.js lines ~478-486 and ~504-512.
// ─────────────────────────────────────────────

describe('chatWidthToggle / inputWidthToggle — regression: remain undebounced', () => {
    it('chatWidthToggle "change" handler calls StorageManager.saveChatWidthEnabled immediately (no debounce wrapper in source)', () => {
        const code = getPopupCode();
        const toggleBlockMatch = code.match(/chatWidthToggle\.addEventListener\('change', async \(\) => \{[\s\S]*?\}\);/);
        expect(toggleBlockMatch).not.toBeNull();
        expect(toggleBlockMatch[0]).not.toMatch(/debounce/);
        expect(toggleBlockMatch[0]).toContain('StorageManager.saveChatWidthEnabled');
    });

    it('inputWidthToggle "change" handler calls StorageManager.saveInputWidthEnabled immediately (no debounce wrapper in source)', () => {
        const code = getPopupCode();
        const toggleBlockMatch = code.match(/inputWidthToggle\.addEventListener\('change', async \(\) => \{[\s\S]*?\}\);/);
        expect(toggleBlockMatch).not.toBeNull();
        expect(toggleBlockMatch[0]).not.toMatch(/debounce/);
        expect(toggleBlockMatch[0]).toContain('StorageManager.saveInputWidthEnabled');
    });

    it('behavioral: toggle change handler fires storage save synchronously without needing a timer advance', async () => {
        const saveChatWidthEnabled = vi.fn().mockResolvedValue(undefined);
        const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
        const showSaveStatus = vi.fn();

        const chatWidthToggle = document.createElement('input');
        chatWidthToggle.type = 'checkbox';
        const chatWidthSliderContainer = document.createElement('div');

        chatWidthToggle.addEventListener('change', async () => {
            const isEnabled = chatWidthToggle.checked;
            chatWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
            await saveChatWidthEnabled(isEnabled);
            await refreshSyncStatus();
            showSaveStatus();
        });

        chatWidthToggle.checked = true;
        await chatWidthToggle.dispatchEvent(new Event('change'));
        // Flush the microtask queue for the async handler without advancing any timers.
        await Promise.resolve();
        await Promise.resolve();

        expect(saveChatWidthEnabled).toHaveBeenCalledWith(true);
        expect(showSaveStatus).toHaveBeenCalledOnce();
    });
});
