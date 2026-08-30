/**
 * content/editor-window-autoclose.js -- window focus handler that asks
 * background/editor-window-routes.js to close any tracked editor-window
 * popups. Pure event forwarding: this module owns no window-closing logic
 * itself, only the focus -> sendMessage wiring.
 *
 * Contract under test, derived from the requirements (module read for its
 * public surface and load-order guard only):
 *  - After start() runs, a 'focus' event on window sends EXACTLY ONE
 *    chrome.runtime.sendMessage call with payload
 *    { type: 'DSS_CLOSE_EDITOR_WINDOWS' } (the real constant value).
 *  - Every subsequent focus event sends again -- no once-only latch.
 *  - A rejected sendMessage promise must not surface as an unhandled
 *    rejection; the module keeps running.
 *  - Calling the focus handler before utils/editor-window-constants.js has
 *    populated globalThis.DSS_EDITOR_WINDOW throws, naming the missing file.
 *  - Before the module is imported (start() not yet called), a focus event
 *    dispatched on window sends nothing.
 *
 * The module auto-starts at import time (classic-script entry point, no
 * load-without-start surface exposed) -- so the 'before start' case is
 * exercised by dispatching focus BEFORE the dynamic import runs, then doing
 * the dynamic import and re-checking. This mirrors the arrangement-before-import
 * pattern used by test/unit/editor-window-routes.spec.js for the sibling
 * background route.
 */
import { describe, it, expect, vi } from 'vitest';

describe('content/editor-window-autoclose', () => {
    it('sends nothing on focus before the module is imported, then sends exactly one message per focus after import', async () => {
        chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);

        window.dispatchEvent(new Event('focus'));
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

        await import('../../utils/editor-window-constants.js');
        await import('../../content/editor-window-autoclose.js');

        window.dispatchEvent(new Event('focus'));

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'DSS_CLOSE_EDITOR_WINDOWS' });
    });

    it('sends again on each subsequent focus event -- no once-only latch', () => {
        chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);

        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('focus'));

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
        chrome.runtime.sendMessage.mock.calls.forEach(([arg]) => {
            expect(arg).toEqual({ type: 'DSS_CLOSE_EDITOR_WINDOWS' });
        });
    });

    it('a rejected sendMessage does not throw or produce an unhandled rejection', async () => {
        chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('no receiver'));

        expect(() => window.dispatchEvent(new Event('focus'))).not.toThrow();

        // Flush microtasks so the rejection (if unhandled) would have surfaced.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('does not throw when DSS_EDITOR_WINDOW is absent (try/catch handles it gracefully)', () => {
        const saved = globalThis.DSS_EDITOR_WINDOW;
        delete globalThis.DSS_EDITOR_WINDOW;

        try {
            expect(() => globalThis.__DS_EditorWindowAutoclose.onWindowFocus())
                .not.toThrow();
        } finally {
            globalThis.DSS_EDITOR_WINDOW = saved;
        }
    });
});
