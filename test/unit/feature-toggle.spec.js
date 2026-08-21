/**
 * content/feature-toggle.js — shared master/own-key toggle plumbing contract.
 *
 * Requirement (from the design contract; no production file exists yet):
 *   globalThis.DSSFeatureToggle.registerFeatureToggle({ ownKey, onEnable, onDisable })
 *
 *   Initial state:
 *     - On registration the module asks background for the current values by
 *       sending { type: DSS_SETTINGS_MSG.GET_SETTINGS, keys: [MASTER_KEY, ownKey] }.
 *     - Effective-on = master isEnabled !== false AND own key !== false.
 *     - onEnable is called once when effective-on; when effective-off NOTHING is
 *       called, because features start dormant and have nothing to tear down.
 *     - ownKey null / undefined means the feature follows the master switch only,
 *       and only the master key is requested.
 *
 *   Change propagation:
 *     - ONE shared chrome.runtime.onMessage listener serves every registered
 *       feature, no matter how many are registered.
 *     - On { type: DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes } the module
 *       recomputes the effective state of each feature whose master key or own
 *       key appears in changes: off -> on calls onEnable, on -> off calls
 *       onDisable, an unchanged effective state calls nothing, and changes
 *       naming neither key call nothing.
 *     - Only area === 'local' is processed. A broadcast for any other area is
 *       ignored outright, even when its changes name the master or an own key.
 *
 *   Lifetime and isolation:
 *     - registerFeatureToggle returns an unregister function; after calling it
 *       the feature receives no further callbacks.
 *     - A callback that throws must not prevent the other registered features
 *       from being notified.
 *
 * Classic script; the global assignment is its only load-time effect (in
 * particular, loading the file must not register any chrome listener).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../utils/settings-message-constants.js";

const MASTER_KEY = "isEnabled";
const OWN_KEY = "isGoTopEnabled";
const OTHER_KEY = "isHideThinkingEnabled";

/**
 * Fresh chrome.runtime.onMessage stub that mirrors the shared mock (addListener /
 * removeListener / hasListener / callListeners) and additionally reports how many
 * listeners are currently registered.
 */
function createOnMessageStub() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        callListeners: (...args) => [...listeners].forEach((fn) => fn(...args)),
        listenerCount: () => listeners.size,
    };
}

/** Build the background response shape produced by background/settings-routes.js. */
function settingsResponse(values) {
    return { ok: true, values };
}

/** Let the pending sendMessage round trip settle. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Storage-change payload shape: { key: { oldValue, newValue } }. */
function change(key, newValue, oldValue) {
    return { [key]: { oldValue, newValue } };
}

let onMessage;
let registerFeatureToggle;
let sendMessage;

/** Queue the response the next GET_SETTINGS call resolves with. */
function respondWith(values) {
    sendMessage.mockImplementation((_message, callback) => {
        const response = settingsResponse(values);
        if (typeof callback === "function") callback(response);
        return Promise.resolve(response);
    });
}

beforeEach(async () => {
    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;
    respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true, [OTHER_KEY]: true });

    vi.resetModules();
    await import("../../content/feature-toggle.js");
    registerFeatureToggle = globalThis.DSSFeatureToggle.registerFeatureToggle;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("content/feature-toggle.js — module surface", () => {
    it("publishes registerFeatureToggle on globalThis.DSSFeatureToggle", () => {
        expect(globalThis.DSSFeatureToggle).toBeTypeOf("object");
        expect(globalThis.DSSFeatureToggle.registerFeatureToggle).toBeTypeOf("function");
    });

    it("registers no chrome listener merely by being loaded", () => {
        expect(onMessage.listenerCount()).toBe(0);
    });
});

describe("registerFeatureToggle — initial state fetch", () => {
    it("asks background for the master key and the own key", async () => {
        registerFeatureToggle({ ownKey: OWN_KEY, onEnable: vi.fn(), onDisable: vi.fn() });
        await flush();

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage.mock.calls[0][0]).toEqual({
            type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS,
            keys: [MASTER_KEY, OWN_KEY],
        });
    });

    it("asks only for the master key when ownKey is null", async () => {
        registerFeatureToggle({ ownKey: null, onEnable: vi.fn(), onDisable: vi.fn() });
        await flush();

        expect(sendMessage.mock.calls[0][0]).toEqual({
            type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS,
            keys: [MASTER_KEY],
        });
    });

    it("asks only for the master key when ownKey is omitted", async () => {
        registerFeatureToggle({ onEnable: vi.fn(), onDisable: vi.fn() });
        await flush();

        expect(sendMessage.mock.calls[0][0]).toEqual({
            type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS,
            keys: [MASTER_KEY],
        });
    });
});

describe("registerFeatureToggle — initial callbacks", () => {
    it("enables the feature once when master and own key are both on", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true });

        registerFeatureToggle({ ownKey: OWN_KEY, onEnable, onDisable });
        await flush();

        expect(onEnable).toHaveBeenCalledTimes(1);
        expect(onDisable).not.toHaveBeenCalled();
    });

    it("enables the feature when its own key has never been stored", async () => {
        const onEnable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: undefined });

        registerFeatureToggle({ ownKey: OWN_KEY, onEnable, onDisable: vi.fn() });
        await flush();

        expect(onEnable).toHaveBeenCalledTimes(1);
    });

    it("stays dormant with no callback at all when the master switch is off", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: false, [OWN_KEY]: true });

        registerFeatureToggle({ ownKey: OWN_KEY, onEnable, onDisable });
        await flush();

        expect(onEnable).not.toHaveBeenCalled();
        expect(onDisable).not.toHaveBeenCalled();
    });

    it("stays dormant with no callback at all when the own key is off", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: false });

        registerFeatureToggle({ ownKey: OWN_KEY, onEnable, onDisable });
        await flush();

        expect(onEnable).not.toHaveBeenCalled();
        expect(onDisable).not.toHaveBeenCalled();
    });

    it("follows the master switch alone when ownKey is null", async () => {
        const onEnable = vi.fn();
        respondWith({ [MASTER_KEY]: true });

        registerFeatureToggle({ ownKey: null, onEnable, onDisable: vi.fn() });
        await flush();

        expect(onEnable).toHaveBeenCalledTimes(1);
    });

    it("stays dormant and does not throw when the settings fetch fails", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        sendMessage.mockImplementation((_message, callback) => {
            const response = { ok: false, error: "boom" };
            if (typeof callback === "function") callback(response);
            return Promise.resolve(response);
        });

        registerFeatureToggle({ ownKey: OWN_KEY, onEnable, onDisable });
        await flush();

        expect(onEnable).not.toHaveBeenCalled();
        expect(onDisable).not.toHaveBeenCalled();
    });
});

/** Register a feature and settle its initial fetch. */
async function register(options) {
    const unregister = registerFeatureToggle(options);
    await flush();
    return unregister;
}

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
function broadcastChange(changes, area = "local") {
    onMessage.callListeners(
        { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes },
        { id: "test-extension-id" },
        () => {},
    );
}

describe("registerFeatureToggle — transitions from SETTINGS_CHANGED", () => {
    it("enables a dormant feature when its own key turns on", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: false });
        await register({ ownKey: OWN_KEY, onEnable, onDisable });

        broadcastChange(change(OWN_KEY, true, false));

        expect(onEnable).toHaveBeenCalledTimes(1);
        expect(onDisable).not.toHaveBeenCalled();
    });

    it("enables a dormant feature when the master switch turns on", async () => {
        const onEnable = vi.fn();
        respondWith({ [MASTER_KEY]: false, [OWN_KEY]: true });
        await register({ ownKey: OWN_KEY, onEnable, onDisable: vi.fn() });

        broadcastChange(change(MASTER_KEY, true, false));

        expect(onEnable).toHaveBeenCalledTimes(1);
    });

    it("disables a live feature when its own key turns off", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true });
        await register({ ownKey: OWN_KEY, onEnable, onDisable });
        expect(onEnable).toHaveBeenCalledTimes(1);

        broadcastChange(change(OWN_KEY, false, true));

        expect(onDisable).toHaveBeenCalledTimes(1);
        expect(onEnable).toHaveBeenCalledTimes(1);
    });

    it("disables a live feature when the master switch turns off", async () => {
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true });
        await register({ ownKey: OWN_KEY, onEnable: vi.fn(), onDisable });

        broadcastChange(change(MASTER_KEY, false, true));

        expect(onDisable).toHaveBeenCalledTimes(1);
    });

    it("keeps a feature dormant when the master turns on but its own key is off", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: false, [OWN_KEY]: false });
        await register({ ownKey: OWN_KEY, onEnable, onDisable });

        broadcastChange(change(MASTER_KEY, true, false));

        expect(onEnable).not.toHaveBeenCalled();
        expect(onDisable).not.toHaveBeenCalled();
    });

    it("calls nothing when a change leaves the effective state unchanged", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true });
        await register({ ownKey: OWN_KEY, onEnable, onDisable });
        onEnable.mockClear();

        broadcastChange(change(MASTER_KEY, true, true));
        broadcastChange(change(OWN_KEY, true, false));

        expect(onEnable).not.toHaveBeenCalled();
        expect(onDisable).not.toHaveBeenCalled();
    });

    it("calls nothing for a change naming neither the master nor the own key", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true });
        await register({ ownKey: OWN_KEY, onEnable, onDisable });
        onEnable.mockClear();

        broadcastChange(change(OTHER_KEY, false, true));

        expect(onEnable).not.toHaveBeenCalled();
        expect(onDisable).not.toHaveBeenCalled();
    });

    it("ignores messages of an unrelated type", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true });
        await register({ ownKey: OWN_KEY, onEnable, onDisable });
        onEnable.mockClear();

        onMessage.callListeners({ type: "DSS_SOMETHING_ELSE", area: "local", changes: change(OWN_KEY, false, true) }, {}, () => {});

        expect(onEnable).not.toHaveBeenCalled();
        expect(onDisable).not.toHaveBeenCalled();
    });

    it("ignores a SETTINGS_CHANGED broadcast for the sync area", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true });
        await register({ ownKey: OWN_KEY, onEnable, onDisable });
        onEnable.mockClear();

        broadcastChange(change(MASTER_KEY, false, true), "sync");
        broadcastChange(change(OWN_KEY, false, true), "sync");

        expect(onDisable).not.toHaveBeenCalled();
        expect(onEnable).not.toHaveBeenCalled();
    });

    it("toggles a master-only feature on every master change", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: false });
        await register({ ownKey: null, onEnable, onDisable });

        broadcastChange(change(MASTER_KEY, true, false));
        expect(onEnable).toHaveBeenCalledTimes(1);

        broadcastChange(change(MASTER_KEY, false, true));
        expect(onDisable).toHaveBeenCalledTimes(1);

        broadcastChange(change(MASTER_KEY, true, false));
        expect(onEnable).toHaveBeenCalledTimes(2);
    });
});

describe("registerFeatureToggle — one shared listener for all features", () => {
    it("adds exactly one chrome.runtime.onMessage listener for three features", async () => {
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true, [OTHER_KEY]: true, isAutoRetryEnabled: true });

        await register({ ownKey: OWN_KEY, onEnable: vi.fn(), onDisable: vi.fn() });
        await register({ ownKey: OTHER_KEY, onEnable: vi.fn(), onDisable: vi.fn() });
        await register({ ownKey: "isAutoRetryEnabled", onEnable: vi.fn(), onDisable: vi.fn() });

        expect(onMessage.listenerCount()).toBe(1);
    });

    it("disables every live feature from a single master-off broadcast", async () => {
        const first = { onEnable: vi.fn(), onDisable: vi.fn() };
        const second = { onEnable: vi.fn(), onDisable: vi.fn() };
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true, [OTHER_KEY]: true });

        await register({ ownKey: OWN_KEY, ...first });
        await register({ ownKey: OTHER_KEY, ...second });

        broadcastChange(change(MASTER_KEY, false, true));

        expect(first.onDisable).toHaveBeenCalledTimes(1);
        expect(second.onDisable).toHaveBeenCalledTimes(1);
    });

    it("notifies only the feature whose own key changed", async () => {
        const first = { onEnable: vi.fn(), onDisable: vi.fn() };
        const second = { onEnable: vi.fn(), onDisable: vi.fn() };
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true, [OTHER_KEY]: true });

        await register({ ownKey: OWN_KEY, ...first });
        await register({ ownKey: OTHER_KEY, ...second });

        broadcastChange(change(OWN_KEY, false, true));

        expect(first.onDisable).toHaveBeenCalledTimes(1);
        expect(second.onDisable).not.toHaveBeenCalled();
    });
});

describe("registerFeatureToggle — unregister", () => {
    it("returns a function", async () => {
        const unregister = await register({ ownKey: OWN_KEY, onEnable: vi.fn(), onDisable: vi.fn() });
        expect(unregister).toBeTypeOf("function");
    });

    it("stops all further callbacks for the unregistered feature", async () => {
        const onEnable = vi.fn();
        const onDisable = vi.fn();
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true });
        const unregister = await register({ ownKey: OWN_KEY, onEnable, onDisable });
        onEnable.mockClear();

        unregister();
        broadcastChange(change(OWN_KEY, false, true));
        broadcastChange(change(MASTER_KEY, false, true));
        broadcastChange(change(OWN_KEY, true, false));

        expect(onDisable).not.toHaveBeenCalled();
        expect(onEnable).not.toHaveBeenCalled();
    });

    it("leaves the remaining features working after one unregisters", async () => {
        const first = { onEnable: vi.fn(), onDisable: vi.fn() };
        const second = { onEnable: vi.fn(), onDisable: vi.fn() };
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true, [OTHER_KEY]: true });

        const unregisterFirst = await register({ ownKey: OWN_KEY, ...first });
        await register({ ownKey: OTHER_KEY, ...second });

        unregisterFirst();
        broadcastChange(change(MASTER_KEY, false, true));

        expect(first.onDisable).not.toHaveBeenCalled();
        expect(second.onDisable).toHaveBeenCalledTimes(1);
    });

    it("tolerates being unregistered twice", async () => {
        const unregister = await register({ ownKey: OWN_KEY, onEnable: vi.fn(), onDisable: vi.fn() });
        expect(() => { unregister(); unregister(); }).not.toThrow();
    });
});

describe("registerFeatureToggle — callback isolation", () => {
    it("still notifies the other features when one onDisable throws", async () => {
        const thrower = {
            onEnable: vi.fn(),
            onDisable: vi.fn(() => { throw new Error("feature A tear-down exploded"); }),
        };
        const survivor = { onEnable: vi.fn(), onDisable: vi.fn() };
        respondWith({ [MASTER_KEY]: true, [OWN_KEY]: true, [OTHER_KEY]: true });

        await register({ ownKey: OWN_KEY, ...thrower });
        await register({ ownKey: OTHER_KEY, ...survivor });

        expect(() => broadcastChange(change(MASTER_KEY, false, true))).not.toThrow();

        expect(thrower.onDisable).toHaveBeenCalledTimes(1);
        expect(survivor.onDisable).toHaveBeenCalledTimes(1);
    });

    it("still notifies the other features when one onEnable throws", async () => {
        const thrower = {
            onEnable: vi.fn(() => { throw new Error("feature A start-up exploded"); }),
            onDisable: vi.fn(),
        };
        const survivor = { onEnable: vi.fn(), onDisable: vi.fn() };
        respondWith({ [MASTER_KEY]: false, [OWN_KEY]: true, [OTHER_KEY]: true });

        await register({ ownKey: OWN_KEY, ...thrower });
        await register({ ownKey: OTHER_KEY, ...survivor });

        expect(() => broadcastChange(change(MASTER_KEY, true, false))).not.toThrow();

        expect(thrower.onEnable).toHaveBeenCalledTimes(1);
        expect(survivor.onEnable).toHaveBeenCalledTimes(1);
    });

    it("keeps a feature whose enable threw in the on state, so the next off still disables it", async () => {
        const onDisable = vi.fn();
        const onEnable = vi.fn(() => { throw new Error("start-up exploded"); });
        respondWith({ [MASTER_KEY]: false, [OWN_KEY]: true });
        await register({ ownKey: OWN_KEY, onEnable, onDisable });

        broadcastChange(change(MASTER_KEY, true, false));
        broadcastChange(change(MASTER_KEY, false, true));

        expect(onDisable).toHaveBeenCalledTimes(1);
    });
});
