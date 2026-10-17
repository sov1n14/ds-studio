/**
 * content/invalidation-watcher.js — periodic extension-context validity check.
 *
 * Requirement (from the feature spec, NOT from reading the implementation):
 *   createInvalidationWatcher({ isValid, showToast, interval? })
 *     → { start(), stop() }
 *
 *   - start() sets a setInterval at `interval` ms (default 30 000).
 *   - Each tick calls isValid().  When isValid() returns false, showToast()
 *     is called exactly once and the interval is cleared (one-shot).
 *   - When isValid() returns true, showToast() is NOT called; polling continues.
 *   - stop() clears the interval; safe to call when nothing runs.
 *   - start() is idempotent — calling it twice does NOT create duplicate intervals.
 *   - After invalidation is detected (showToast fired), further ticks do not
 *     call showToast again even if the watcher is somehow still ticking.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../content/invalidation-watcher.js";

const DEFAULT_INTERVAL = 30_000;

let watcher;
let isValid;
let showToast;

beforeEach(() => {
    vi.useFakeTimers({
        toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    });
    isValid = vi.fn().mockReturnValue(true);
    showToast = vi.fn();
});

afterEach(() => {
    watcher?.stop();
    vi.useRealTimers();
});

function createWatcher(overrides = {}) {
    const factory = globalThis.DSSInvalidationWatcher?.create
        ?? globalThis.DSSInvalidationWatcher;
    if (typeof factory !== "function") {
        throw new Error(
            "Expected globalThis.DSSInvalidationWatcher or " +
            "globalThis.DSSInvalidationWatcher.create to be a factory function"
        );
    }
    watcher = factory({ isValid, showToast, ...overrides });
    return watcher;
}

// ── 1. start() sets up periodic checking ────────────────────────────────────

describe("content/invalidation-watcher — periodic checking", () => {
    it("calls isValid on each interval tick", () => {
        createWatcher();
        watcher.start();

        expect(isValid).not.toHaveBeenCalled();

        vi.advanceTimersByTime(DEFAULT_INTERVAL);
        expect(isValid).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(DEFAULT_INTERVAL);
        expect(isValid).toHaveBeenCalledTimes(2);
    });

    it("respects a custom interval", () => {
        const custom = 5_000;
        createWatcher({ interval: custom });
        watcher.start();

        vi.advanceTimersByTime(custom - 1);
        expect(isValid).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(isValid).toHaveBeenCalledTimes(1);
    });
});

// ── 2. isValid returns false → showToast called, interval stops ─────────────

describe("content/invalidation-watcher — invalidation detected", () => {
    it("calls showToast when isValid returns false", () => {
        isValid.mockReturnValue(false);
        createWatcher();
        watcher.start();

        vi.advanceTimersByTime(DEFAULT_INTERVAL);

        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it("stops polling after invalidation (no further isValid calls)", () => {
        isValid.mockReturnValue(false);
        createWatcher();
        watcher.start();

        vi.advanceTimersByTime(DEFAULT_INTERVAL);
        expect(isValid).toHaveBeenCalledTimes(1);

        // Advance several more intervals — isValid should NOT be called again
        vi.advanceTimersByTime(DEFAULT_INTERVAL * 3);
        expect(isValid).toHaveBeenCalledTimes(1);
    });
});

// ── 3. isValid returns true → showToast NOT called, interval continues ──────

describe("content/invalidation-watcher — context still valid", () => {
    it("does not call showToast while isValid returns true", () => {
        isValid.mockReturnValue(true);
        createWatcher();
        watcher.start();

        vi.advanceTimersByTime(DEFAULT_INTERVAL * 5);

        expect(showToast).not.toHaveBeenCalled();
    });

    it("keeps polling (isValid called on every tick)", () => {
        isValid.mockReturnValue(true);
        createWatcher();
        watcher.start();

        vi.advanceTimersByTime(DEFAULT_INTERVAL * 3);

        expect(isValid).toHaveBeenCalledTimes(3);
    });
});

// ── 4. stop() clears the interval ──────────────────────────────────────────

describe("content/invalidation-watcher — stop()", () => {
    it("prevents further isValid calls after stop", () => {
        createWatcher();
        watcher.start();

        vi.advanceTimersByTime(DEFAULT_INTERVAL);
        expect(isValid).toHaveBeenCalledTimes(1);

        watcher.stop();

        vi.advanceTimersByTime(DEFAULT_INTERVAL * 3);
        expect(isValid).toHaveBeenCalledTimes(1);
    });

    it("is safe to call when nothing is running", () => {
        createWatcher();
        // stop without start — must not throw
        expect(() => watcher.stop()).not.toThrow();
    });
});

// ── 5. start() is idempotent ────────────────────────────────────────────────

describe("content/invalidation-watcher — idempotency", () => {
    it("calling start() twice does not create duplicate intervals", () => {
        createWatcher();
        watcher.start();
        watcher.start(); // second call — should be no-op

        vi.advanceTimersByTime(DEFAULT_INTERVAL);

        // If duplicate intervals existed, isValid would be called twice per tick
        expect(isValid).toHaveBeenCalledTimes(1);
    });
});

// ── 6. After toast shown, further ticks don't re-trigger showToast ──────────

describe("content/invalidation-watcher — one-shot toast", () => {
    it("showToast is called at most once even if ticks somehow continue", () => {
        // isValid returns false on first call, then true on subsequent
        // (simulates the unlikely case of re-validation after toast)
        isValid
            .mockReturnValueOnce(false)
            .mockReturnValue(true);

        createWatcher();
        watcher.start();

        // First tick — invalidation detected
        vi.advanceTimersByTime(DEFAULT_INTERVAL);
        expect(showToast).toHaveBeenCalledTimes(1);

        // Several more intervals — showToast must NOT be called again
        vi.advanceTimersByTime(DEFAULT_INTERVAL * 5);
        expect(showToast).toHaveBeenCalledTimes(1);
    });
});
