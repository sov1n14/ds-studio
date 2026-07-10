/**
 * Tests for the slider debounce wiring in popup.js (Step 5: debounce timing alignment).
 *
 * popup.js defines a module-level `debounce(fn, delayMs)` helper (line ~20) and wires
 * chatWidthSlider / inputWidthSlider so that:
 *   - the `input` event updates the live percentage label synchronously (undebounced)
 *   - the `change` event calls a `debounce(asyncFn, 500)`-wrapped save
 *     (debouncedSaveChatWidth / debouncedSaveInputWidth, defined around lines 488 / 514)
 *
 * popup.js has no ESM export surface (classic script executed inside
 * DOMContentLoaded), so — following the extraction convention already used in
 * popup-editor-window.spec.js and popup.spec.js — we extract the exact `debounce`
 * source from the file and adapt the slider wiring into an injectable harness that
 * mirrors the production closures line-for-line.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPopupCode() {
    return readFileSync(resolve(__dirname, '../../popup/popup.js'), 'utf-8');
}

// ─────────────────────────────────────────────
// Extract the module-level debounce() from popup.js source
// ─────────────────────────────────────────────

describe('popup.js debounce() helper (extracted from source)', () => {
    let debounce;

    beforeAll(() => {
        const code = getPopupCode();
        const match = code.match(/function debounce\(fn, delayMs\)\s*\{[\s\S]*?\n\}/);
        if (!match) {
            throw new Error('Could not extract debounce() from popup.js — has the helper been renamed or moved?');
        }
        // eslint-disable-next-line no-eval
        debounce = eval(`(${match[0]})`);
    });

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('delays invocation until delayMs has elapsed', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);

        debounced();
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(499);
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('collapses rapid successive calls into a single invocation', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);

        debounced(1);
        debounced(2);
        debounced(3);

        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('invokes with the arguments from the final call ("last write wins")', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);

        debounced('first');
        debounced('second');
        debounced('third');

        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledWith('third');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('fires again for a call made after the previous debounce window completed', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);

        debounced('a');
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(1);

        debounced('b');
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith('b');
    });
});

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
        const code = getPopupCode();
        const match = code.match(/function debounce\(fn, delayMs\)\s*\{[\s\S]*?\n\}/);
        // eslint-disable-next-line no-eval
        debounce = eval(`(${match[0]})`);
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
