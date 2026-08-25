/**
 * content/temporary-chat-heartbeat.js — periodic lease-refresh heartbeat.
 *
 * Requirement (from the design contract, NOT from reading the implementation):
 *   globalThis.TemporaryChatHeartbeat = { start(chatUuid), stop() }
 *   - start(uuid) sends { type: DSS_MSG_HEARTBEAT, uuid } via
 *     chrome.runtime.sendMessage immediately, then every HEARTBEAT_INTERVAL_MS.
 *   - start with the same uuid while running does not add a second interval.
 *   - start with a different uuid replaces the interval; only the new uuid is sent.
 *   - start with a falsy uuid does nothing (no message, no interval).
 *   - stop() clears the interval; safe to call when nothing runs.
 *   - a rejecting/throwing sendMessage must not throw out of the timer, and the
 *     interval keeps running so a later tick still sends.
 *   - the content layer never calls chrome.storage.*.
 *
 * Classic script; global assignment is its only load-time effect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// Constants first so HEARTBEAT_INTERVAL_MS and DSS_MSG_HEARTBEAT reach globalThis
// before the module under test resolves them.
import "../../utils/temporary-chat-constants.js";
import "../../content/temporary-chat-heartbeat.js";

const INTERVAL = globalThis.HEARTBEAT_INTERVAL_MS;
const HEARTBEAT_TYPE = globalThis.DSS_MSG_HEARTBEAT;

let heartbeat;
let sendMessage;
let storageSpies;

function spyStorageArea(area) {
    return ["get", "set", "remove", "clear", "getBytesInUse"]
        .filter((m) => typeof area[m] === "function")
        .map((m) => vi.spyOn(area, m));
}

// Every uuid carried by a sendMessage call, in order.
function sentUuids() {
    return sendMessage.mock.calls.map((c) => c[0]?.uuid);
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    heartbeat = globalThis.TemporaryChatHeartbeat;
    sendMessage = globalThis.chrome.runtime.sendMessage;
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
    storageSpies = [
        ...spyStorageArea(globalThis.chrome.storage.local),
        ...spyStorageArea(globalThis.chrome.storage.sync),
    ];
});

afterEach(() => {
    heartbeat.stop();
    storageSpies.forEach((s) => s.mockRestore());
    vi.useRealTimers();
});

describe("content/temporary-chat-heartbeat.js — module surface", () => {
    it("publishes start/stop on globalThis.TemporaryChatHeartbeat", () => {
        expect(heartbeat).toBeTypeOf("object");
        expect(heartbeat.start).toBeTypeOf("function");
        expect(heartbeat.stop).toBeTypeOf("function");
    });
});

describe("start — immediate send", () => {
    it("sends exactly one heartbeat with the expected object immediately", () => {
        heartbeat.start("uuid-1");

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith({ type: HEARTBEAT_TYPE, uuid: "uuid-1" });
    });
});

describe("start — interval boundary", () => {
    it("sends nothing at INTERVAL-1 ms and exactly one more at the final ms", () => {
        heartbeat.start("uuid-1");
        expect(sendMessage).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(INTERVAL - 1);
        expect(sendMessage).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1);
        expect(sendMessage).toHaveBeenCalledTimes(2);
    });
});

describe("start — idempotent for the same uuid", () => {
    it("double start with the same uuid keeps a single per-interval rate", () => {
        heartbeat.start("uuid-1");
        heartbeat.start("uuid-1");

        // Immediate sends: one per start call is acceptable, but no runaway
        // interval — after three intervals a single interval would have produced
        // 1 (immediate) + 3 (ticks) = 4 sends. A doubled interval would exceed that.
        const immediate = sendMessage.mock.calls.length;
        vi.advanceTimersByTime(INTERVAL * 3);

        expect(sendMessage.mock.calls.length).toBe(immediate + 3);
        expect(sentUuids().every((u) => u === "uuid-1")).toBe(true);
    });
});

describe("start — switching uuid", () => {
    it("replaces the interval so only the new uuid is sent after the switch", () => {
        heartbeat.start("uuid-a");
        vi.advanceTimersByTime(INTERVAL * 2);
        const switchIndex = sendMessage.mock.calls.length;

        heartbeat.start("uuid-b");
        vi.advanceTimersByTime(INTERVAL * 3);

        const afterSwitch = sentUuids().slice(switchIndex);
        expect(afterSwitch).not.toContain("uuid-a");
        // b arrives once per interval: immediate + 3 ticks over 3 intervals.
        expect(afterSwitch.filter((u) => u === "uuid-b").length).toBe(4);
    });
});

describe("start — falsy uuid", () => {
    it.each([["empty string", ""], ["null", null], ["undefined", undefined]])(
        "does nothing for %s: no message and no pending timer",
        (_label, value) => {
            heartbeat.start(value);

            expect(sendMessage).not.toHaveBeenCalled();
            vi.advanceTimersByTime(INTERVAL * 5);
            expect(sendMessage).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        },
    );
});

describe("stop", () => {
    it("clears the interval so no further messages arrive", () => {
        heartbeat.start("uuid-1");
        expect(sendMessage).toHaveBeenCalledTimes(1);

        heartbeat.stop();
        vi.advanceTimersByTime(INTERVAL * 10);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("is safe to call when nothing is running", () => {
        expect(() => heartbeat.stop()).not.toThrow();
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe("start — resilient to a failing sendMessage", () => {
    it("does not throw out of the timer and keeps ticking after a rejection", async () => {
        sendMessage.mockReset();
        sendMessage
            .mockRejectedValueOnce(new Error("Extension context invalidated"))
            .mockResolvedValue(undefined);

        expect(() => heartbeat.start("uuid-1")).not.toThrow();
        expect(sendMessage).toHaveBeenCalledTimes(1);

        // Flush the rejected promise's microtasks, then a later tick must still fire.
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage.mock.calls[1][0]).toEqual({ type: HEARTBEAT_TYPE, uuid: "uuid-1" });
    });
});

describe("content layer never touches chrome.storage", () => {
    it("invokes no chrome.storage.local or chrome.storage.sync method across the lifecycle", () => {
        heartbeat.start("uuid-1");
        vi.advanceTimersByTime(INTERVAL * 3);
        heartbeat.start("uuid-2");
        vi.advanceTimersByTime(INTERVAL * 3);
        heartbeat.stop();

        storageSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
});
