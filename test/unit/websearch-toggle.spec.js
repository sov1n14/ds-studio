import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import WebSearchToggle from '../../content/websearch-toggle.js';
import StorageManager from '../../utils/storage-manager.js';

// Build a connected button matching the primary selector, with a click spy.
// The spy replaces the real click so the aria-pressed attribute stays put —
// the module's "click on mismatch" behavior can then be asserted precisely.
function makeButton(pressed) {
    const btn = document.createElement('button');
    btn.className = 'ds-toggle-button';
    btn.setAttribute('aria-pressed', pressed);
    btn.click = vi.fn();
    return btn;
}

// Wait one macrotask so pending MutationObserver callbacks and the
// mock storage's setTimeout-based promises have a chance to settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WebSearchToggle', () => {
    beforeEach(async () => {
        // Reset the shared instance to a clean, disabled baseline.
        WebSearchToggle.disable();
        WebSearchToggle.enabled = false;
        WebSearchToggle._masterEnabled = false;
        WebSearchToggle.mode = 'default';
        WebSearchToggle._lastClickAt = 0;
        WebSearchToggle._targetOn = false;
        WebSearchToggle.CLICK_COOLDOWN_MS = 0; // zero out so fast test runs never trip the cooldown
        document.body.innerHTML = '';
        // Settle the module's import-time start() read before each test.
        await flush();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('apply()', () => {
        it('clicks when aria-pressed mismatches the target', () => {
            const btn = makeButton('true');
            document.body.appendChild(btn);

            // 'off' mode: target is off, button is on, so it must be clicked
            WebSearchToggle.mode = 'off';
            WebSearchToggle._targetOn = false;
            WebSearchToggle.apply(btn);
            expect(btn.click).toHaveBeenCalledOnce();

            // 'on' mode: target is on, button is off, so it must be clicked
            btn.click.mockClear();
            btn.setAttribute('aria-pressed', 'false');
            WebSearchToggle.mode = 'on';
            WebSearchToggle._targetOn = true;
            WebSearchToggle.apply(btn);
            expect(btn.click).toHaveBeenCalledOnce();
        });

        it('does not click when aria-pressed matches the target', () => {
            const btn = makeButton('true');
            document.body.appendChild(btn);

            WebSearchToggle.mode = 'on';
            WebSearchToggle._targetOn = true;
            WebSearchToggle.apply(btn);
            expect(btn.click).not.toHaveBeenCalled();

            btn.setAttribute('aria-pressed', 'false');
            WebSearchToggle.mode = 'off';
            WebSearchToggle._targetOn = false;
            WebSearchToggle.apply(btn);
            expect(btn.click).not.toHaveBeenCalled();
        });

        it('does not click a disconnected button', () => {
            const btn = makeButton('true'); // never appended to the DOM
            WebSearchToggle.mode = 'off';
            WebSearchToggle._targetOn = false;
            WebSearchToggle.apply(btn);
            expect(btn.click).not.toHaveBeenCalled();
        });
    });

    describe('click cooldown', () => {
        it('suppresses re-clicks within CLICK_COOLDOWN_MS and clicks after it elapses', () => {
            vi.useFakeTimers();
            vi.advanceTimersByTime(60000); // move the fake clock past any stale _lastClickAt
            WebSearchToggle.CLICK_COOLDOWN_MS = 60000;
            const btn = makeButton('true');
            document.body.appendChild(btn);
            WebSearchToggle.mode = 'off';
            WebSearchToggle._targetOn = false;

            WebSearchToggle.apply(btn);
            expect(btn.click).toHaveBeenCalledOnce();

            // Same mismatch immediately after: still inside the cooldown window
            btn.click.mockClear();
            WebSearchToggle.apply(btn);
            expect(btn.click).not.toHaveBeenCalled();

            // Advance past the cooldown: the mismatch may be clicked again
            vi.advanceTimersByTime(60000);
            WebSearchToggle.apply(btn);
            expect(btn.click).toHaveBeenCalledOnce();
        });
    });

    describe('observer behavior', () => {
        it('clicks a button appended after enable() and re-clicks when the user flips it away from the target', async () => {
            WebSearchToggle._targetOn = true;
            WebSearchToggle.enable();

            const btn = makeButton('false'); // mismatch vs target 'on'
            document.body.appendChild(btn);
            await flush();
            expect(btn.click).toHaveBeenCalledOnce();

            // Flip to the target state: no click
            btn.setAttribute('aria-pressed', 'true');
            await flush();
            expect(btn.click).toHaveBeenCalledOnce();

            // User manually turns it off: mismatch observed, clicked back
            btn.setAttribute('aria-pressed', 'false');
            await flush();
            expect(btn.click).toHaveBeenCalledTimes(2);
        });
    });

    describe('enable() / disable()', () => {
        it('disable() stops enforcement and re-enable() re-applies to the existing button', async () => {
            const btn = makeButton('true');
            document.body.appendChild(btn);
            WebSearchToggle._targetOn = true;
            WebSearchToggle.enable();

            // User turns the button off; the observer clicks it back
            btn.setAttribute('aria-pressed', 'false');
            await flush();
            expect(btn.click).toHaveBeenCalledOnce();

            btn.click.mockClear();

            // After disable: the same manual flip goes unenforced
            WebSearchToggle.disable();
            expect(WebSearchToggle.enabled).toBe(false);
            btn.setAttribute('aria-pressed', 'false');
            await flush();
            expect(btn.click).not.toHaveBeenCalled();

            // Re-enable: the existing mismatch is re-applied immediately
            WebSearchToggle.enable();
            expect(WebSearchToggle.enabled).toBe(true);
            expect(btn.click).toHaveBeenCalledOnce();
        });

        it('enable() is idempotent', () => {
            WebSearchToggle._targetOn = true;
            WebSearchToggle.enable();
            const observer = WebSearchToggle._observer;
            WebSearchToggle.enable();
            expect(WebSearchToggle._observer).toBe(observer);
        });
    });

    describe('storage listener', () => {
        it('re-applies when the mode changes while running (on to off) without disabling', async () => {
            await chrome.storage.local.set({
                [StorageManager.KEYS.IS_ENABLED]: true,
                [WebSearchToggle.STORAGE_KEY]: 'on',
            });

            const btn = makeButton('true');
            document.body.appendChild(btn);
            await flush(); // let the observer initial click land
            btn.click.mockClear();

            await chrome.storage.local.set({ [WebSearchToggle.STORAGE_KEY]: 'off' });
            expect(WebSearchToggle.enabled).toBe(true); // still running, not disabled
            expect(btn.click).toHaveBeenCalledOnce(); // 'true' vs target off, clicked
        });

        it('disables when the master switch turns off', async () => {
            WebSearchToggle._masterEnabled = true;
            WebSearchToggle.mode = 'on';
            WebSearchToggle._recompute();
            expect(WebSearchToggle.enabled).toBe(true);

            await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
            expect(WebSearchToggle.enabled).toBe(false);
        });

        it('disables when the mode returns to default', async () => {
            WebSearchToggle._masterEnabled = true;
            WebSearchToggle.mode = 'on';
            WebSearchToggle._recompute();
            expect(WebSearchToggle.enabled).toBe(true);

            await chrome.storage.local.set({ [WebSearchToggle.STORAGE_KEY]: 'default' });
            expect(WebSearchToggle.enabled).toBe(false);
        });

        it('ignores changes from the sync namespace', async () => {
            WebSearchToggle._targetOn = true;
            WebSearchToggle.enable();
            expect(WebSearchToggle.enabled).toBe(true);

            await chrome.storage.sync.set({
                [StorageManager.KEYS.IS_ENABLED]: false,
                [WebSearchToggle.STORAGE_KEY]: 'default',
            });
            expect(WebSearchToggle.enabled).toBe(true);
        });
    });

    describe('findButton()', () => {
        it('falls back to any aria-pressed element when no .ds-toggle-button exists', () => {
            const div = document.createElement('div');
            div.setAttribute('aria-pressed', 'false');
            div.click = vi.fn();
            document.body.appendChild(div);

            WebSearchToggle.mode = 'on';
            WebSearchToggle._masterEnabled = true;
            WebSearchToggle._recompute();

            expect(WebSearchToggle.enabled).toBe(true);
            expect(div.click).toHaveBeenCalledOnce();
        });
    });

    describe('two-toggle selection', () => {
        // A .ds-toggle-button[aria-pressed] button with a visible label, built on
        // the shared makeButton helper so the click spy is already in place.
        function labelledButton(pressed, label) {
            const btn = makeButton(pressed);
            const span = document.createElement('span');
            span.textContent = label;
            btn.appendChild(span);
            return btn;
        }

        // Enable enforcement targeting 'on' against whatever toggles are in the DOM.
        function enforceOn() {
            WebSearchToggle.mode = 'on';
            WebSearchToggle._masterEnabled = true;
            WebSearchToggle._recompute();
        }

        it('clicks the 智能搜索 toggle, not an earlier 深度思考 toggle', () => {
            const deepThink = labelledButton('false', '深度思考');
            const webSearch = labelledButton('false', '智能搜索');
            document.body.appendChild(deepThink);
            document.body.appendChild(webSearch);

            enforceOn();

            expect(webSearch.click).toHaveBeenCalledOnce();
            expect(deepThink.click).not.toHaveBeenCalled();
            expect(WebSearchToggle.findButton()).toBe(webSearch);
        });

        it('still picks the 智能搜索 toggle when it comes first', () => {
            const webSearch = labelledButton('false', '智能搜索');
            const deepThink = labelledButton('false', '深度思考');
            document.body.appendChild(webSearch);
            document.body.appendChild(deepThink);

            enforceOn();

            expect(webSearch.click).toHaveBeenCalledOnce();
            expect(deepThink.click).not.toHaveBeenCalled();
            expect(WebSearchToggle.findButton()).toBe(webSearch);
        });

        it('falls back to the first toggle when no label contains 搜索', () => {
            const first = labelledButton('false', '深度思考');
            const second = labelledButton('false', '深度推理');
            document.body.appendChild(first);
            document.body.appendChild(second);

            enforceOn();

            expect(first.click).toHaveBeenCalledOnce();
            expect(second.click).not.toHaveBeenCalled();
            expect(WebSearchToggle.findButton()).toBe(first);
        });

        it('generic fallback: picks the 搜索-bearing aria-pressed element', () => {
            const plain = document.createElement('div');
            plain.setAttribute('aria-pressed', 'false');
            plain.click = vi.fn();
            const search = document.createElement('div');
            search.setAttribute('aria-pressed', 'false');
            search.click = vi.fn();
            const label = document.createElement('span');
            label.textContent = '智能搜索';
            search.appendChild(label);
            document.body.appendChild(plain);
            document.body.appendChild(search);

            enforceOn();

            expect(search.click).toHaveBeenCalledOnce();
            expect(plain.click).not.toHaveBeenCalled();
            expect(WebSearchToggle.findButton()).toBe(search);
        });
    });

    describe('start()', () => {
        it('reads the stored mode and master switch from storage and enforces without a storage event', async () => {
            // Seed storage directly (bypassing the listener) so only start() can
            // react to the stored values - no storage change event is involved.
            chrome.storage.local._data[StorageManager.KEYS.IS_ENABLED] = true;
            chrome.storage.local._data[WebSearchToggle.STORAGE_KEY] = 'on';

            const btn = makeButton('false');
            document.body.appendChild(btn);

            await WebSearchToggle.start();

            expect(WebSearchToggle.enabled).toBe(true);
            expect(btn.click).toHaveBeenCalledOnce(); // 'false' vs target on, clicked
        });
    });
});
