/**
 * Unit tests for preset-settle.scheduler.js — runSettle()
 *
 * runSettle() is a pure settle-loop scheduler that repeatedly calls
 * apply -> measure -> compare until convergence, maxFrames, or cancellation.
 * By injecting a controlled frame queue (schedule + drainFrames) instead of
 * real rAF, we can step through each frame synchronously and verify the
 * exact sequence of calls and stop conditions.
 *
 * All tests use `require()` for the CJS export (loaded as a side-effect
 * import in vitest.setup.js for the global __DS_PresetSettle).
 */

import { describe, it, expect, vi } from 'vitest';

const { runSettle } = require('../../content/preset-settle.scheduler.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a controlled frame scheduler. Frames are queued and executed
 * manually via drainFrames(), giving us synchronous, deterministic control
 * over the settle loop's timing.
 */
function createFrameQueue() {
    const frames = [];
    function schedule(fn) { frames.push(fn); }
    function drainFrames(count) {
        if (count === undefined) count = frames.length;
        while (count > 0 && frames.length > 0) {
            frames.shift()();
            count--;
        }
    }
    function pendingCount() { return frames.length; }
    return { schedule, drainFrames, pendingCount };
}

/**
 * Return a measure() that yields values from the given array in order.
 * When exhausted, continues returning the last value (if any) or undefined.
 */
function sequenceMeasure(values) {
    let idx = 0;
    return function measure() {
        if (idx < values.length) {
            return values[idx++];
        }
        return values.length > 0 ? values[values.length - 1] : undefined;
    };
}

/**
 * Create a minimal runSettle options object, accepting overrides.
 * Useful for guard-clause tests where only one field is invalid.
 */
function defaultOpts(overrides) {
    return {
        measure:   function () { return 100; },
        apply:     function () {},
        schedule:  function () {},
        maxFrames: 30,
        stableK:   3,
        epsilon:   0.5,
        onLog:     function () {},
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Group A: Guard clauses — each missing or invalid param must throw
// ---------------------------------------------------------------------------

describe('runSettle — guard clauses', function () {

    it('throws when opts is undefined', function () {
        expect(function () { runSettle(); }).toThrow('runSettle: opts is required');
    });

    it('throws when opts.measure is not a function', function () {
        expect(function () { runSettle(defaultOpts({ measure: null })); })
            .toThrow('runSettle: opts.measure must be a function');
    });

    it('throws when opts.apply is not a function', function () {
        expect(function () { runSettle(defaultOpts({ apply: 'string' })); })
            .toThrow('runSettle: opts.apply must be a function');
    });

    it('throws when opts.schedule is not a function', function () {
        expect(function () { runSettle(defaultOpts({ schedule: 42 })); })
            .toThrow('runSettle: opts.schedule must be a function');
    });

    it('throws when opts.maxFrames is not a number', function () {
        expect(function () { runSettle(defaultOpts({ maxFrames: '10' })); })
            .toThrow('runSettle: opts.maxFrames must be a number');
    });

    it('throws when opts.stableK is not a number', function () {
        expect(function () { runSettle(defaultOpts({ stableK: null })); })
            .toThrow('runSettle: opts.stableK must be a number');
    });

    it('throws when opts.epsilon is not a number', function () {
        expect(function () { runSettle(defaultOpts({ epsilon: undefined })); })
            .toThrow('runSettle: opts.epsilon must be a number');
    });

    it('throws when opts.onLog is not a function', function () {
        expect(function () { runSettle(defaultOpts({ onLog: true })); })
            .toThrow('runSettle: opts.onLog must be a function');
    });
});

// ---------------------------------------------------------------------------
// Group B: Settle behavior — convergence, detachment, maxFrames, cancel
// ---------------------------------------------------------------------------

describe('runSettle — settle behavior', function () {

    // -----------------------------------------------------------------------
    // B1: Converges after a delayed right-shift (the real-world bug)
    // -----------------------------------------------------------------------
    // Scenario: button rect starts at 160px for 2 frames, then jumps to 189px
    // and stays there. With stableK=3, the counter resets on the jump, then
    // builds up 3 consecutive stable frames at 189px.
    //
    // Frame 0: apply, measure=160, prevMetric=null  → stableCount=0
    // Frame 1: apply, measure=160, delta=0           → stableCount=1
    // Frame 2: apply, measure=189, delta=29 > 0.5   → stableCount=0 (reset)
    // Frame 3: apply, measure=189, delta=0           → stableCount=1
    // Frame 4: apply, measure=189, delta=0           → stableCount=2
    // Frame 5: apply, measure=189, delta=0           → stableCount=3 >= K → CONVERGED

    it('converges after a delayed right-shift (the actual bug)', function () {
        var q = createFrameQueue();
        var apply   = vi.fn();
        var onLog   = vi.fn();
        var measure = sequenceMeasure([160, 160, 189, 189, 189, 189]);

        runSettle({
            measure: measure,
            apply: apply,
            schedule: q.schedule,
            maxFrames: 30,
            stableK: 3,
            epsilon: 0.5,
            onLog: onLog,
        });

        q.drainFrames(6);

        // — apply was called for all 6 frames with correct reasons
        expect(apply).toHaveBeenCalledTimes(6);
        expect(apply).toHaveBeenNthCalledWith(1, 'settle:frame-0');
        expect(apply).toHaveBeenNthCalledWith(2, 'settle:frame-1');
        expect(apply).toHaveBeenNthCalledWith(3, 'settle:frame-2');
        expect(apply).toHaveBeenNthCalledWith(4, 'settle:frame-3');
        expect(apply).toHaveBeenNthCalledWith(5, 'settle:frame-4');
        expect(apply).toHaveBeenNthCalledWith(6, 'settle:frame-5');

        // — converged with correct stop metadata
        expect(onLog).toHaveBeenCalledWith(
            'settle:stop',
            expect.objectContaining({
                reason:      'converged',
                frames:      6,
                finalMetric: 189,
            })
        );
    });

    // -----------------------------------------------------------------------
    // B2: Detached — element disappears mid-settle
    // -----------------------------------------------------------------------
    // When a non-null metric was established but the next measure returns null,
    // the loop should stop immediately with reason 'detached'.

    it('stops with "detached" when element disappears mid-settle', function () {
        var q = createFrameQueue();
        var apply   = vi.fn();
        var onLog   = vi.fn();
        var measure = sequenceMeasure([160, 189, null]);

        runSettle({
            measure: measure,
            apply: apply,
            schedule: q.schedule,
            maxFrames: 30,
            stableK: 3,
            epsilon: 0.5,
            onLog: onLog,
        });

        q.drainFrames(3);

        expect(apply).toHaveBeenCalledTimes(3);
        expect(onLog).toHaveBeenCalledWith(
            'settle:stop',
            expect.objectContaining({
                reason:      'detached',
                frames:      3,
                finalMetric: null,
            })
        );
    });

    // -----------------------------------------------------------------------
    // B3: Max frames — never converges, hits hard limit
    // -----------------------------------------------------------------------
    // Oscillating values (100, 200, 100, 200, …) prevent stableCount from
    // ever reaching stableK. The loop stops at maxFrames=4.

    it('stops with "maxFrames" when elements never converge', function () {
        var q = createFrameQueue();
        var apply   = vi.fn();
        var onLog   = vi.fn();
        var measure = sequenceMeasure([100, 200, 100, 200]);

        runSettle({
            measure: measure,
            apply: apply,
            schedule: q.schedule,
            maxFrames: 4,
            stableK: 3,
            epsilon: 0.5,
            onLog: onLog,
        });

        q.drainFrames(4);

        expect(apply).toHaveBeenCalledTimes(4);
        expect(onLog).toHaveBeenCalledWith(
            'settle:stop',
            expect.objectContaining({
                reason: 'maxFrames',
                frames: 4,
            })
        );
    });

    // -----------------------------------------------------------------------
    // B4: Cancel before any frame executes
    // -----------------------------------------------------------------------
    // Calling cancel() before drainFrames() sets _cancelled=true, so the
    // first runFrame() returns immediately without calling apply/measure.

    it('can be cancelled before any frame executes', function () {
        var q = createFrameQueue();
        var apply = vi.fn();
        var onLog = vi.fn();

        var handle = runSettle({
            measure:   function () { return 160; },
            apply:     apply,
            schedule:  q.schedule,
            maxFrames: 30,
            stableK:   3,
            epsilon:   0.5,
            onLog:     onLog,
        });

        // Cancel before draining — the scheduled runFrame is still in the queue
        handle.cancel();
        q.drainFrames(10);

        // The frame was queued but _cancelled prevents execution
        expect(apply).not.toHaveBeenCalled();

        // settle:start is logged synchronously inside runSettle() BEFORE
        // the first schedule, so it should have been called.
        expect(onLog).toHaveBeenCalledWith('settle:start', expect.any(Object));
        // settle:stop should NOT be logged because no frame actually ran.
        expect(onLog).not.toHaveBeenCalledWith('settle:stop', expect.any(Object));
    });

    // -----------------------------------------------------------------------
    // B5: Cancel mid-execution
    // -----------------------------------------------------------------------
    // Let 2 frames run, then cancel. Frames already queued but still pending
    // should be skipped. The apply call count stays at 2.

    it('can be cancelled mid-execution', function () {
        var q = createFrameQueue();
        var apply = vi.fn();
        var onLog = vi.fn();

        var handle = runSettle({
            measure:   function () { return 160; },
            apply:     apply,
            schedule:  q.schedule,
            maxFrames: 30,
            stableK:   5,
            epsilon:   0.5,
            onLog:     onLog,
        });

        // Execute first 2 frames
        q.drainFrames(2);
        expect(apply).toHaveBeenCalledTimes(2);

        // Cancel and then drain any remaining queued frames
        handle.cancel();
        q.drainFrames(20);

        // Count should still be exactly 2
        expect(apply).toHaveBeenCalledTimes(2);
    });

    // -----------------------------------------------------------------------
    // B6: Initial null metric (element not yet rendered)
    // -----------------------------------------------------------------------
    // When measure returns null for the first frames (element not in DOM),
    // the loop keeps waiting as long as prevMetric is also null. Once the
    // element appears and metric stabilises, it converges normally.

    it('waits when measure returns null initially (element not yet rendered)', function () {
        var q = createFrameQueue();
        var apply   = vi.fn();
        var onLog   = vi.fn();
        // Two nulls (not yet rendered), then 200 that stabilises.
        // With stableK=2 we need 2 consecutive identical values.
        var measure = sequenceMeasure([null, null, 200, 200, 200]);

        runSettle({
            measure: measure,
            apply: apply,
            schedule: q.schedule,
            maxFrames: 30,
            stableK: 2,
            epsilon: 0.5,
            onLog: onLog,
        });

        q.drainFrames(10);

        // Frame 0: measure=null, prevMetric=null → wait
        // Frame 1: measure=null, prevMetric=null → wait
        // Frame 2: measure=200,  prevMetric=null → stableCount=0
        // Frame 3: measure=200,  delta=0         → stableCount=1
        // Frame 4: measure=200,  delta=0         → stableCount=2 >= 2 → CONVERGED
        expect(apply).toHaveBeenCalledTimes(5);
        expect(onLog).toHaveBeenCalledWith(
            'settle:stop',
            expect.objectContaining({
                reason:      'converged',
                finalMetric: 200,
            })
        );
    });
});
