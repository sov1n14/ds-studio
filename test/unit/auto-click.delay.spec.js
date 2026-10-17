/**
 * content/auto-click.delay.js — random per-round delay for the shared auto-click loop.
 *
 * Requirement (product decision, final; no production file exists yet):
 *   globalThis.DSSAutoClickDelay.nextDelayMs(random = Math.random) -> number
 *   - The delay is uniformly random over {0.0, 0.1, ..., 3.0} seconds: 31 equally
 *     likely values, returned in milliseconds (0, 100, ..., 3000).
 *   - Semantics: Math.floor(random() * 31) * 100, where random() returns [0, 1).
 *   - random is injectable; when omitted, Math.random is used.
 *
 * Classic script; the global assignment is its only load-time effect.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import "../../content/auto-click.delay.js";

afterEach(() => {
    vi.restoreAllMocks();
});

/** Resolve nextDelayMs, failing with a message that names the missing surface. */
function nextDelayMs(...args) {
    const api = globalThis.DSSAutoClickDelay;
    expect(api, `globalThis.DSSAutoClickDelay must be published by content/auto-click.delay.js`).toBeTypeOf("object");
    expect(api.nextDelayMs, "DSSAutoClickDelay.nextDelayMs must be a function").toBeTypeOf("function");
    return api.nextDelayMs(...args);
}

describe("content/auto-click.delay.js — module surface", () => {
    it("publishes nextDelayMs on globalThis.DSSAutoClickDelay", () => {
        expect(globalThis.DSSAutoClickDelay?.nextDelayMs).toBeTypeOf("function");
    });
});

describe("nextDelayMs — fixed points of the 0..3000 ms / 100 ms grid", () => {
    it.each([
        [0, 0],
        [0.5, 1500],
        [0.999999, 3000],
        [0.0322, 0],      // 0.0322 * 31 = 0.998 -> bucket 0
        [0.0323, 100],    // 0.0323 * 31 = 1.001 -> bucket 1
        [0.9677, 2900],   // 0.9677 * 31 = 29.999 -> bucket 29
        [0.9678, 3000],   // 0.9678 * 31 = 30.002 -> bucket 30
    ])("random() = %s -> %s ms", (r, expected) => {
        expect(nextDelayMs(() => r)).toBe(expected);
    });
});

describe("nextDelayMs — distribution over a sweep of random values", () => {
    const SAMPLES = 10000;
    const sweep = () => Array.from({ length: SAMPLES }, (_, i) => nextDelayMs(() => i / SAMPLES));

    it("returns only multiples of 100 within [0, 3000]", () => {
        const outOfGrid = sweep().filter((ms) => !(Number.isInteger(ms) && ms % 100 === 0 && ms >= 0 && ms <= 3000));
        expect(outOfGrid).toEqual([]);
    });

    it("reaches all 31 values 0, 100, ..., 3000", () => {
        const seen = [...new Set(sweep())].sort((a, b) => a - b);
        expect(seen).toEqual(Array.from({ length: 31 }, (_, i) => i * 100));
    });

    it("gives each of the 31 values an equal share of a uniform sweep (within one sample)", () => {
        const counts = new Map();
        for (const ms of sweep()) counts.set(ms, (counts.get(ms) ?? 0) + 1);
        const expectedShare = SAMPLES / 31;
        for (const [ms, count] of counts) {
            expect(Math.abs(count - expectedShare), `bucket ${ms} ms got ${count}`).toBeLessThanOrEqual(1);
        }
    });
});

describe("nextDelayMs — default random source", () => {
    it.each([
        [0, 0],
        [0.5, 1500],
        [0.999999, 3000],
    ])("uses Math.random when no source is injected (Math.random() = %s -> %s ms)", (r, expected) => {
        vi.spyOn(Math, "random").mockReturnValue(r);
        expect(nextDelayMs()).toBe(expected);
    });
});
