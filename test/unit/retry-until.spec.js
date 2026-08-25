/**
 * content/retry-until.js — shared poll-until-ready contract.
 *
 * Requirement (from the design contract, not from any implementation — no
 * production file exists yet):
 *   globalThis.DSSRetryUntil = retryUntil(predicate, { intervalMs, maxRetries,
 *                                                      onReady, onGiveUp })
 *   - predicate is called immediately, synchronously, on the initial call.
 *   - A truthy predicate result calls onReady(result) exactly once and schedules
 *     no timers at all.
 *   - A falsy result schedules a retry every intervalMs, up to maxRetries extra
 *     attempts (so at most 1 + maxRetries predicate calls).
 *   - onReady fires on the first truthy attempt, receiving that truthy value,
 *     and no further attempts are made afterwards.
 *   - onGiveUp, when supplied, fires once after the retries are exhausted with
 *     no truthy result. onReady must never fire in that case.
 *   - retryUntil returns a cancel function; calling it stops all further
 *     attempts and suppresses both callbacks.
 *
 * Classic script; the global assignment is its only load-time effect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../content/retry-until.js";

const INTERVAL_MS = 500;

let retryUntil;

beforeEach(() => {
    vi.useFakeTimers();
    retryUntil = globalThis.DSSRetryUntil;
});

afterEach(() => {
    vi.useRealTimers();
});

describe("content/retry-until.js — module surface", () => {
    it("publishes retryUntil as globalThis.DSSRetryUntil", () => {
        expect(globalThis.DSSRetryUntil).toBeTypeOf("function");
    });
});

describe("retryUntil — ready on the first attempt", () => {
    it("calls onReady once with the predicate value and schedules no timer", () => {
        const target = { id: "sidebar-button" };
        const predicate = vi.fn(() => target);
        const onReady = vi.fn();
        const onGiveUp = vi.fn();

        retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 10, onReady, onGiveUp });

        expect(predicate).toHaveBeenCalledTimes(1);
        expect(onReady).toHaveBeenCalledTimes(1);
        expect(onReady).toHaveBeenCalledWith(target);
        expect(onGiveUp).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        // Draining the clock must not produce a second attempt or callback.
        vi.advanceTimersByTime(INTERVAL_MS * 20);
        expect(predicate).toHaveBeenCalledTimes(1);
        expect(onReady).toHaveBeenCalledTimes(1);
    });
});

describe("retryUntil — ready on a later attempt", () => {
    it("retries at intervalMs and fires onReady on the first truthy attempt only", () => {
        const target = { id: "late-element" };
        const predicate = vi.fn()
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(null)
            .mockReturnValue(target);
        const onReady = vi.fn();
        const onGiveUp = vi.fn();

        retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 10, onReady, onGiveUp });

        expect(predicate).toHaveBeenCalledTimes(1);
        expect(onReady).not.toHaveBeenCalled();

        vi.advanceTimersByTime(INTERVAL_MS);
        expect(predicate).toHaveBeenCalledTimes(2);
        expect(onReady).not.toHaveBeenCalled();

        vi.advanceTimersByTime(INTERVAL_MS);
        expect(predicate).toHaveBeenCalledTimes(3);
        expect(onReady).toHaveBeenCalledTimes(1);
        expect(onReady).toHaveBeenCalledWith(target);

        // No trailing attempts once ready.
        vi.advanceTimersByTime(INTERVAL_MS * 10);
        expect(predicate).toHaveBeenCalledTimes(3);
        expect(onReady).toHaveBeenCalledTimes(1);
        expect(onGiveUp).not.toHaveBeenCalled();
    });

    it("does not attempt again before a full interval has elapsed", () => {
        const predicate = vi.fn(() => false);
        retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 5, onReady: vi.fn() });

        vi.advanceTimersByTime(INTERVAL_MS - 1);
        expect(predicate).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1);
        expect(predicate).toHaveBeenCalledTimes(2);
    });

    it("treats every falsy predicate result as not-ready", () => {
        for (const falsy of [null, undefined, false, 0, "", NaN]) {
            const predicate = vi.fn(() => falsy);
            const onReady = vi.fn();
            retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 1, onReady });
            vi.advanceTimersByTime(INTERVAL_MS * 3);
            expect(onReady, `falsy value ${String(falsy)} must not be treated as ready`).not.toHaveBeenCalled();
            expect(predicate).toHaveBeenCalledTimes(2);
        }
    });
});

describe("retryUntil — exhaustion", () => {
    it("makes 1 + maxRetries attempts, then calls onGiveUp once", () => {
        const predicate = vi.fn(() => null);
        const onReady = vi.fn();
        const onGiveUp = vi.fn();

        retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 3, onReady, onGiveUp });

        vi.advanceTimersByTime(INTERVAL_MS * 3);
        expect(predicate).toHaveBeenCalledTimes(4);
        expect(onGiveUp).toHaveBeenCalledTimes(1);
        expect(onReady).not.toHaveBeenCalled();

        // The clock is drained: no lingering timer keeps polling forever.
        vi.advanceTimersByTime(INTERVAL_MS * 50);
        expect(predicate).toHaveBeenCalledTimes(4);
        expect(onGiveUp).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("makes exactly one attempt when maxRetries is 0", () => {
        const predicate = vi.fn(() => null);
        const onGiveUp = vi.fn();

        retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 0, onReady: vi.fn(), onGiveUp });

        expect(predicate).toHaveBeenCalledTimes(1);
        expect(onGiveUp).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(INTERVAL_MS * 10);
        expect(predicate).toHaveBeenCalledTimes(1);
    });

    it("exhausts without throwing when onGiveUp is omitted", () => {
        const predicate = vi.fn(() => null);

        expect(() => {
            retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 2, onReady: vi.fn() });
            vi.advanceTimersByTime(INTERVAL_MS * 10);
        }).not.toThrow();

        expect(predicate).toHaveBeenCalledTimes(3);
    });
});

describe("retryUntil — cancellation", () => {
    it("returns a cancel function that stops further attempts and both callbacks", () => {
        const predicate = vi.fn(() => null);
        const onReady = vi.fn();
        const onGiveUp = vi.fn();

        const cancel = retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 10, onReady, onGiveUp });
        expect(cancel).toBeTypeOf("function");

        vi.advanceTimersByTime(INTERVAL_MS);
        expect(predicate).toHaveBeenCalledTimes(2);

        cancel();
        vi.advanceTimersByTime(INTERVAL_MS * 20);

        expect(predicate).toHaveBeenCalledTimes(2);
        expect(onReady).not.toHaveBeenCalled();
        expect(onGiveUp).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("is idempotent when cancel is called twice", () => {
        const predicate = vi.fn(() => null);
        const cancel = retryUntil(predicate, { intervalMs: INTERVAL_MS, maxRetries: 5, onReady: vi.fn() });

        expect(() => { cancel(); cancel(); }).not.toThrow();
        vi.advanceTimersByTime(INTERVAL_MS * 10);
        expect(predicate).toHaveBeenCalledTimes(1);
    });

    it("tolerates a cancel call made after the predicate already succeeded", () => {
        const onReady = vi.fn();
        const cancel = retryUntil(() => "ready", { intervalMs: INTERVAL_MS, maxRetries: 5, onReady });

        expect(onReady).toHaveBeenCalledTimes(1);
        expect(() => cancel()).not.toThrow();
        expect(onReady).toHaveBeenCalledTimes(1);
    });
});
