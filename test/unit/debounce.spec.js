/**
 * utils/debounce.js — the single shared trailing-edge debounce (backlog B5 / D3).
 *
 * Requirement (from the D3 decision + the shared semantics of the three popup
 * copies being merged — popup/popup.width-sliders.js, popup/editor/editor.js,
 * popup/custom-select.js — not from any implementation; no production file
 * exists yet):
 *   globalThis.DSSDebounce = debounce(fn, delayMs) -> debounced
 *   - Trailing edge only: fn is NOT called on the leading call. It runs delayMs
 *     after the LAST call.
 *   - Timer resets on every call: calls spaced closer than delayMs collapse into
 *     a single fn invocation.
 *   - Last args win: fn receives the arguments of the final call only.
 *   - `this` is forwarded from the debounced call site to fn.
 *   - A call made after a window has already fired starts a fresh window.
 *   - debounced() returns undefined (fn's return value is unreachable — it runs
 *     asynchronously).
 *   - No cancel(): none of the three merged copies exposes one, so it is not
 *     part of the pinned contract.
 *
 * Classic script; the global assignment is its only load-time effect. Module
 * surface follows the single-function convention of content/retry-until.js
 * (the function itself is the global, and the CommonJS test export).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../utils/debounce.js";

let debounce;

beforeEach(() => {
    vi.useFakeTimers();
    debounce = globalThis.DSSDebounce;
});

afterEach(() => {
    vi.useRealTimers();
});

describe("utils/debounce.js — module surface", () => {
    it("publishes debounce as globalThis.DSSDebounce", () => {
        expect(globalThis.DSSDebounce).toBeTypeOf("function");
    });

    it("returns a callable wrapper", () => {
        expect(debounce(() => {}, 100)).toBeTypeOf("function");
    });
});

describe("utils/debounce.js — trailing-edge timing", () => {
    it("does not call fn on the leading call", () => {
        const fn = vi.fn();
        debounce(fn, 500)();

        expect(fn).not.toHaveBeenCalled();
    });

    it("calls fn only once the full delay has elapsed, not one tick early", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);

        debounced();
        vi.advanceTimersByTime(499);
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("restarts the countdown on every call, so a call stream keeps deferring fn", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);

        // Five calls, each 400ms apart: 2000ms of wall time, zero invocations.
        for (let i = 0; i < 5; i += 1) {
            debounced();
            vi.advanceTimersByTime(400);
        }
        expect(fn).not.toHaveBeenCalled();

        // Only the quiet period after the last call releases it.
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("starts a fresh window for a call made after the previous window fired", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);

        debounced("a");
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(1);

        debounced("b");
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith("b");
    });
});

describe("utils/debounce.js — argument and receiver forwarding", () => {
    it("collapses a burst into one invocation carrying the final call's arguments", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);

        debounced("first", 1);
        debounced("second", 2);
        debounced("third", 3);
        vi.advanceTimersByTime(500);

        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith("third", 3);
    });

    it("forwards every argument, not just the first", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced(1, 2, 3, 4);
        vi.advanceTimersByTime(100);

        expect(fn).toHaveBeenCalledWith(1, 2, 3, 4);
    });

    it("forwards `this` from the call site to fn", () => {
        let seen = null;
        const host = { tag: "host", ping: debounce(function () { seen = this; }, 100) };

        host.ping();
        vi.advanceTimersByTime(100);

        expect(seen).toBe(host);
    });

    it("uses the receiver of the final call when the burst spans different receivers", () => {
        const seen = [];
        const debounced = debounce(function () { seen.push(this.tag); }, 100);
        const a = { tag: "a", ping: debounced };
        const b = { tag: "b", ping: debounced };

        a.ping();
        b.ping();
        vi.advanceTimersByTime(100);

        expect(seen).toEqual(["b"]);
    });
});

describe("utils/debounce.js — independence and return value", () => {
    it("gives each wrapper its own timer, so one does not cancel another", () => {
        const first = vi.fn();
        const second = vi.fn();
        const debouncedFirst = debounce(first, 500);
        const debouncedSecond = debounce(second, 500);

        debouncedFirst("x");
        vi.advanceTimersByTime(400);
        debouncedSecond("y");
        vi.advanceTimersByTime(100);

        // first's window completed on schedule despite second's call mid-flight.
        expect(first).toHaveBeenCalledWith("x");
        expect(second).not.toHaveBeenCalled();

        vi.advanceTimersByTime(400);
        expect(second).toHaveBeenCalledWith("y");
    });

    it("returns undefined from the debounced call (fn's result is unreachable)", () => {
        const debounced = debounce(() => "payload", 100);

        expect(debounced()).toBeUndefined();
    });

    it("honours a per-wrapper delay rather than a shared constant", () => {
        const fast = vi.fn();
        const slow = vi.fn();
        debounce(fast, 100)();
        debounce(slow, 400)();

        vi.advanceTimersByTime(100);
        expect(fast).toHaveBeenCalledTimes(1);
        expect(slow).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(slow).toHaveBeenCalledTimes(1);
    });
});
