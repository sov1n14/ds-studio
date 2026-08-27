/**
 * content/temporary-chat-heartbeat.js — thaw-immediate & sendNow tests.
 *
 * Tests the sendNow() public method and the visibilitychange / pageshow
 * event listeners that call it, ensuring heartbeats fire on tab thaw.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../utils/temporary-chat-constants.js";
import "../../content/temporary-chat-heartbeat.js";

const HEARTBEAT_TYPE = globalThis.DSS_MSG_HEARTBEAT;

let heartbeat;
let sendMessage;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    heartbeat = globalThis.TemporaryChatHeartbeat;
    sendMessage = globalThis.chrome.runtime.sendMessage;
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
});

afterEach(() => {
    heartbeat.stop();
    vi.useRealTimers();
});

describe("sendNow", () => {
    it("sends heartbeat when session is active", () => {
        heartbeat.start("uuid-1");
        sendMessage.mockClear();

        heartbeat.sendNow();

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith({ type: HEARTBEAT_TYPE, uuid: "uuid-1" });
    });

    it("is no-op when no active session", () => {
        heartbeat.sendNow();

        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("is no-op after stop", () => {
        heartbeat.start("uuid-1");
        heartbeat.stop();
        sendMessage.mockClear();

        heartbeat.sendNow();

        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe("visibilitychange listener", () => {
    it("triggers heartbeat when becoming visible with active session", () => {
        heartbeat.start("uuid-1");
        sendMessage.mockClear();

        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith({ type: HEARTBEAT_TYPE, uuid: "uuid-1" });
    });

    it("does NOT trigger heartbeat when becoming hidden", () => {
        heartbeat.start("uuid-1");
        sendMessage.mockClear();

        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));

        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("is no-op without active session", () => {
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));

        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe("pageshow listener", () => {
    it("triggers heartbeat with active session", () => {
        heartbeat.start("uuid-1");
        sendMessage.mockClear();

        document.dispatchEvent(new Event("pageshow"));

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith({ type: HEARTBEAT_TYPE, uuid: "uuid-1" });
    });
});
