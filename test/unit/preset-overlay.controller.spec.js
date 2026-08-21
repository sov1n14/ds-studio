/**
 * Unit tests for createPresetOverlay (preset-overlay.controller.js).
 *
 * StorageManager is a global populated by the real storage-manager.js chain
 * loaded in vitest.setup.js — we spy on its methods to avoid storage I/O
 * without replacing the module.
 *
 * Regression focus: onSelectChange must call reposition() as its final
 * statement so the overlay re-positions after the label text width changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Ensure the StorageManager global is populated before any test runs.
import '../../utils/storage-manager.js';

const { createPresetOverlay } = require('../../content/preset-overlay.controller.js');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
    return {
        getIsEnabled:               vi.fn(() => true),
        getCurrentChatUuid:         vi.fn(() => 'uuid-1234'),
        setCurrentChatUuid:         vi.fn(),
        getChatPresetMap:           vi.fn(() => ({})),
        setChatPresetMap:           vi.fn(),
        setPendingPresetId:         vi.fn(),
        updatePromptPrefixFromBinding: vi.fn(),
        isExtensionContextValid:    vi.fn(() => true),
        ...overrides,
    };
}

/**
 * Mount a minimal DOM target so reposition() guard clauses
 * (wrapperEl && targetEl) pass without crashing.
 */
function mountOverlay(overlay) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    overlay.mountTo(target);
    return target;
}

function teardownOverlay(overlay, target) {
    if (overlay) overlay.unmount();
    if (target && target.parentNode) target.parentNode.removeChild(target);
}

// ── StorageManager spy helpers ────────────────────────────────────────────────

let smSpies = [];

function spyStorageManager() {
    const resolved = Promise.resolve({});
    smSpies = [
        vi.spyOn(StorageManager, 'bindChatToPreset').mockReturnValue(resolved),
        vi.spyOn(StorageManager, 'unbindChat').mockReturnValue(resolved),
        vi.spyOn(StorageManager, 'getChatPresetMap').mockResolvedValue({}),
        vi.spyOn(StorageManager, 'saveActivePresetId').mockReturnValue(resolved),
    ];
}

function restoreStorageManager() {
    smSpies.forEach(s => s.mockRestore());
    smSpies = [];
}

// ── Group A: regression — onSelectChange calls reposition ────────────────────

describe('onSelectChange — reposition regression', () => {
    let overlay, ctx, target;

    beforeEach(() => {
        spyStorageManager();
        ctx     = makeCtx();
        overlay = createPresetOverlay(ctx);
        target  = mountOverlay(overlay);
        // Replace reposition with a spy AFTER mount (mount itself calls reposition
        // via render path; we only care about calls from onSelectChange).
        overlay.reposition = vi.fn();
    });

    afterEach(() => {
        teardownOverlay(overlay, target);
        restoreStorageManager();
    });

    it('calls reposition after selecting a non-empty preset id (bind path)', () => {
        overlay.onSelectChange('preset-A');
        expect(overlay.reposition).toHaveBeenCalledTimes(1);
    });

    it('calls reposition after selecting empty string (unbind path)', () => {
        overlay.onSelectChange('');
        expect(overlay.reposition).toHaveBeenCalledTimes(1);
    });

    it('calls reposition when there is no currentChatUuid (pending path)', () => {
        ctx.getCurrentChatUuid.mockReturnValue(null);
        overlay.onSelectChange('preset-B');
        expect(overlay.reposition).toHaveBeenCalledTimes(1);
    });

    it('reposition is the LAST call — not skipped on any branch', () => {
        // Verify that reposition is invoked after updatePromptPrefixFromBinding
        // by checking call order via mock.invocationCallOrder
        ctx.getCurrentChatUuid.mockReturnValue('uuid-xyz');
        const updateOrder = [];
        ctx.updatePromptPrefixFromBinding.mockImplementation(() => {
            updateOrder.push('update');
        });
        overlay.reposition = vi.fn(() => {
            updateOrder.push('reposition');
        });

        overlay.onSelectChange('preset-C');

        expect(updateOrder).toEqual(['update', 'reposition']);
    });
});

// ── rAF synchroniser ─────────────────────────────────────────────────────────

/**
 * Stub requestAnimationFrame with a bounded trampoline.
 *
 * Problem: the production settle loop reschedules itself every frame via
 * opts.schedule(runFrame) → scheduleFrame() → rAF(runFrame). In a real
 * browser rAF is ASYNC, so each new frame unwinds the stack. A naive
 * synchronous stub (`(fn) => { fn(); }`) turns this into unbounded
 * synchronous recursion → RangeError: Maximum call stack size exceeded.
 *
 * Solution: queue callbacks instead of calling inline, then drain the
 * queue ITERATIVELY (no stack growth) up to RAF_FLUSH_CAP iterations.
 * Each iteration may enqueue new callbacks (the next settle frame), which
 * are processed in the same drain loop — exactly like the browser's async
 * frame queue but without the async overhead or the recursion.
 *
 * RAF_FLUSH_CAP (200) is deliberately larger than the production
 * settle-loop ceiling (maxFrames=60, stableK=4), so the loop always hits
 * its OWN bound before this stub's bound. That is what makes the
 * frame-ceiling assertion below meaningful: if maxFrames regressed to a
 * huge value (the old 7200), the drain loop would be cut off by
 * RAF_FLUSH_CAP instead and the settle:frame-N indices would run well
 * past 59, failing the test.
 *
 * Returns a restore function.
 */
const RAF_FLUSH_CAP = 200;

function makeRafSync() {
    const original = globalThis.requestAnimationFrame;
    const queue = [];
    let flushing = false;

    globalThis.requestAnimationFrame = function (fn) {
        queue.push(fn);
        // Drain the queue iteratively on the OUTERMOST call only.
        // Re-entrant calls (callbacks that enqueue more frames) just push
        // to the queue and return; the outermost loop picks them up.
        if (!flushing) {
            flushing = true;
            let ticks = 0;
            while (queue.length > 0 && ticks < RAF_FLUSH_CAP) {
                const cb = queue.shift();
                ticks++;
                cb();
            }
            flushing = false;
        }
        return 0;
    };

    return () => {
        globalThis.requestAnimationFrame = original;
    };
}

// ── Group B: settlement loop integration ─────────────────────────────────

describe('settle loop integration', () => {
    let overlay, ctx, target, restoreRaf;

    beforeEach(() => {
        spyStorageManager();
        ctx     = makeCtx();
        overlay = createPresetOverlay(ctx);
        // Spy on reposition BEFORE mountTo so settle frame calls are captured.
        overlay.reposition = vi.fn();
        // Make rAF synchronous so the settle loop runs to completion during mountTo.
        restoreRaf = makeRafSync();
    });

    afterEach(() => {
        teardownOverlay(overlay, target);
        restoreStorageManager();
        if (restoreRaf) restoreRaf();
    });

    it('mountTo triggers settle loop that calls reposition with settle:frame-N reasons', () => {
        target = document.createElement('div');
        document.body.appendChild(target);

        overlay.mountTo(target);

        // The settle loop runs synchronously (rAF stubbed).
        // With no button element inside the target, resolveNewChatButtonEl
        // returns null, so measure() returns null every frame, the metric
        // never stabilises, and the loop runs until it hits its frame
        // ceiling (maxFrames=60) -> reposition('settle:frame-N').
        expect(overlay.reposition).toHaveBeenCalled();
        expect(overlay.reposition).toHaveBeenNthCalledWith(1, 'settle:frame-0');
    });

    it('bounds settle frames to the 60-frame ceiling (no unbounded loop)', () => {
        target = document.createElement('div');
        document.body.appendChild(target);

        overlay.mountTo(target);

        const frameIndices = overlay.reposition.mock.calls
            .map(([reason]) => /^settle:frame-(\d+)$/.exec(String(reason)))
            .filter(Boolean)
            .map(([, n]) => Number(n));

        // Sanity: the loop actually ran, otherwise the bound below is vacuous.
        expect(frameIndices.length).toBeGreaterThan(0);
        // The ceiling: with maxFrames=60 no frame index may reach 60, and the
        // loop may not emit more than 60 settle frames. RAF_FLUSH_CAP (200)
        // exceeds 60, so a regression to an unbounded/huge maxFrames would
        // produce indices up to the flush cap and fail here.
        expect(Math.max(...frameIndices)).toBeLessThan(60);
        expect(frameIndices.length).toBeLessThanOrEqual(60);
    });

    it('unmount does not crash after settle loop', () => {
        target = document.createElement('div');
        document.body.appendChild(target);

        overlay.mountTo(target);
        // After the synchronous settle loop completes, unmount should
        // cleanly tear down without throwing.
        expect(() => overlay.unmount()).not.toThrow();
        expect(overlay.wrapperEl).toBeNull();
    });
});

// ── Group C: pinned-default vs explicit-empty regression (new-conversation page) ──

describe('findAndMount — pinned default vs explicit empty choice (no chatUuid)', () => {
    let overlay, ctx, target, getSettingsSpy;
    let pendingStore; // real-storage-like backing for getPendingPresetId/setPendingPresetId

    const PINNED_PRESET = { id: 'preset-pinned', name: 'Pinned Preset' };

    beforeEach(() => {
        spyStorageManager();
        pendingStore = undefined; // "nothing chosen yet" per resolver contract (null/undefined)
        getSettingsSpy = vi.spyOn(StorageManager, 'getSettings').mockResolvedValue({
            pinnedPresetId: PINNED_PRESET.id,
            promptPresets: [PINNED_PRESET],
        });

        ctx = makeCtx({
            getCurrentChatUuid: vi.fn(() => null), // new-conversation page: no chat id
            getPendingPresetId: vi.fn(() => pendingStore),
            setPendingPresetId: vi.fn((id) => { pendingStore = id; }),
        });

        overlay = createPresetOverlay(ctx);

        target = document.createElement('div');
        target.className = '_2be88ba';
        document.body.appendChild(target);
    });

    afterEach(() => {
        teardownOverlay(overlay, null);
        if (target && target.parentNode) target.parentNode.removeChild(target);
        restoreStorageManager();
        getSettingsSpy.mockRestore();
    });

    /** Reads which option the rebuilt dropdown actually shows as selected. */
    function getRenderedSelectedValue() {
        const selectedLi = overlay.dropdown.menu.querySelector('[aria-selected="true"]');
        return selectedLi ? (selectedLi.getAttribute('data-value') || '') : null;
    }

    it('keeps showing the empty preset after a title-bar rebuild when the user explicitly chose empty', async () => {
        // Initial mount: nothing chosen yet -> pinned default is shown.
        overlay.findAndMount();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(getRenderedSelectedValue()).toBe(PINNED_PRESET.id);

        // User explicitly picks the empty / no-op option via the controller's
        // own public selection path (the same path the dropdown component invokes).
        overlay.onSelectChange('');

        // The explicit empty choice must be stored as the empty string, not coerced to null.
        expect(ctx.getPendingPresetId()).toBe('');

        // Simulate React replacing the chat title bar: swap in a fresh target element.
        target.parentNode.removeChild(target);
        target = document.createElement('div');
        target.className = '_2be88ba';
        document.body.appendChild(target);

        overlay.findAndMount();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(getRenderedSelectedValue()).toBe('');
    });

    it('companion: still falls back to the pinned preset when the user has chosen nothing', async () => {
        overlay.findAndMount();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(getRenderedSelectedValue()).toBe(PINNED_PRESET.id);
    });
});

// ── Group D: scheduleFindAndMount debounce ───────────────────────────────────
// The controller owns no body observer: content-script.js's single body observer
// fans DOM mutations out to scheduleFindAndMount(), which must collapse a burst
// of mutations into ONE findAndMount() 150ms after the last one, and must not
// fire at all once the overlay has been unmounted.

describe('scheduleFindAndMount — 150ms debounce', () => {
    let overlay, ctx;

    beforeEach(() => {
        vi.useFakeTimers();
        spyStorageManager();
        ctx     = makeCtx();
        overlay = createPresetOverlay(ctx);
        // Observe the remount decision itself; the real findAndMount would need a
        // live DeepSeek header in the DOM, which is not what this debounce owns.
        overlay.findAndMount = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        restoreStorageManager();
    });

    it('does not remount before 150ms have elapsed, and remounts exactly once at 150ms', () => {
        overlay.scheduleFindAndMount();

        vi.advanceTimersByTime(149);
        expect(overlay.findAndMount).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(overlay.findAndMount).toHaveBeenCalledTimes(1);
    });

    it('collapses a burst of body mutations into a single remount', () => {
        overlay.scheduleFindAndMount();
        vi.advanceTimersByTime(50);
        overlay.scheduleFindAndMount();
        vi.advanceTimersByTime(50);
        overlay.scheduleFindAndMount();

        // 100ms of the burst has already passed: a non-debounced timer would have
        // fired more than once by the end of this window.
        vi.advanceTimersByTime(150);
        expect(overlay.findAndMount).toHaveBeenCalledTimes(1);
    });

    it('unmount cancels a pending remount', () => {
        overlay.scheduleFindAndMount();
        overlay.unmount();

        vi.advanceTimersByTime(150);
        expect(overlay.findAndMount).not.toHaveBeenCalled();
    });
});
