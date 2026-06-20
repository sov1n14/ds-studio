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
 * RAF_FLUSH_CAP (200) is large enough to let the settle loop reach
 * stableK=120 (converge) on a real DOM, yet small enough to terminate
 * immediately when measure() always returns null (null-metric path).
 * The test assertions only require that reposition was called at least
 * once with 'settle:frame-0', which is satisfied on the very first flush.
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
        // returns null, so measure() returns null every frame.  Since
        // prevMetric stays null (it's only set when measure returns non-null),
        // the loop keeps waiting and increments frame each time until
        // maxFrames=30 is reached: 30 calls to apply -> reposition.
        expect(overlay.reposition).toHaveBeenCalled();
        expect(overlay.reposition).toHaveBeenNthCalledWith(1, 'settle:frame-0');
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
