/**
 * Scenario — auto-retry / auto-continue own-key toggles, fresh install to live change.
 *
 * Requirement (product decision, final):
 *   - Two own-key toggles, stored in chrome.storage.local under the keys
 *     "isAutoRetryEnabled" and "isAutoContinueEnabled", both published in
 *     StorageManager.KEYS and both defaulting to false in StorageManager.DEFAULTS.
 *   - Each feature is effectively on only when the master "isEnabled" is on AND
 *     its own key is true. A fresh install (own keys never stored) with the
 *     master on leaves BOTH features off.
 *   - Turning an own key on (storage write -> SETTINGS_CHANGED broadcast) enables
 *     that feature alone; the master off disables it regardless of the own key.
 *
 * Scenario shape (CLAUDE.md Scenario Unit Tests — cross-module state: the
 * storage schema owns the default, background/settings-routes.js reads it,
 * content/feature-toggle.js decides on it):
 *   Real modules: StorageManager (KEYS / DEFAULTS), background/settings-routes.js
 *   (GET_SETTINGS read path + SETTINGS_CHANGED broadcast), content/feature-toggle.js.
 *   Mocked trust boundaries only: chrome.storage (in-memory mock from setup),
 *   chrome.runtime.sendMessage / onMessage and chrome.tabs.query / sendMessage,
 *   wired as a loopback between the background and the content context.
 *   Assertions are on the observable end-state: whether each feature is on.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import StorageManager from "../../utils/storage-manager.js";
import { resetStorageOnChangedListeners } from "../setup/vitest.setup.js";
import "../../utils/message-constants.js";
import "../../background/settings-routes.js";

const MASTER_KEY = "isEnabled";
const RETRY_KEY = "isAutoRetryEnabled";
const CONTINUE_KEY = "isAutoContinueEnabled";
const TAB_ID = 7;

/** Drain the setTimeout(0)-based storage mock and the message loopback. */
const flush = async (ticks = 8) => {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
};

/** chrome.runtime.onMessage stub for one extension context. */
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

const backgroundOnMessage = createOnMessageStub();
let contentOnMessage;
let registerFeatureToggle;

/** Content -> background request, answered by the real settings-routes handler. */
function loopbackSendMessage(message, callback) {
    return new Promise((resolve) => {
        const sendResponse = (response) => {
            if (typeof callback === "function") callback(response);
            resolve(response);
        };
        backgroundOnMessage.callListeners(message, { id: "test-extension-id", tab: { id: TAB_ID } }, sendResponse);
    });
}

/** Background -> content tab broadcast, delivered to the content context listeners. */
function loopbackTabsSendMessage(tabId, message) {
    if (tabId === TAB_ID) contentOnMessage.callListeners(message, { id: "test-extension-id" }, () => {});
    return Promise.resolve(undefined);
}

/**
 * Register a feature through the real toggle module and expose whether it is
 * currently on, derived purely from the enable/disable callbacks it received.
 */
async function registerFeature(ownKey) {
    const feature = { isOn: false };
    registerFeatureToggle({
        ownKey,
        onEnable: () => { feature.isOn = true; },
        onDisable: () => { feature.isOn = false; },
    });
    await flush();
    return feature;
}

beforeAll(() => {
    resetStorageOnChangedListeners();
    const originalOnMessage = chrome.runtime.onMessage;
    chrome.runtime.onMessage = backgroundOnMessage;
    globalThis.DSSSettingsRoutes.install();
    chrome.runtime.onMessage = originalOnMessage;
});

beforeEach(async () => {
    // The global setup clears storage, which emits an onChanged broadcast; drain it
    // before the content context exists so it cannot reach the features under test.
    contentOnMessage = createOnMessageStub();
    chrome.tabs.query = vi.fn().mockResolvedValue([{ id: TAB_ID }]);
    chrome.tabs.sendMessage = vi.fn(loopbackTabsSendMessage);
    await flush();

    chrome.runtime.onMessage = contentOnMessage;
    chrome.runtime.sendMessage = vi.fn(loopbackSendMessage);

    vi.resetModules();
    await import("../../content/feature-toggle.js");
    registerFeatureToggle = globalThis.DSSFeatureToggle.registerFeatureToggle;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("storage schema — the two own keys exist and default to off", () => {
    it.each([RETRY_KEY, CONTINUE_KEY])("StorageManager.KEYS publishes %s", (key) => {
        expect(Object.values(StorageManager.KEYS)).toContain(key);
    });

    it.each([RETRY_KEY, CONTINUE_KEY])("StorageManager.DEFAULTS[%s] is false", (key) => {
        expect(StorageManager.DEFAULTS).toHaveProperty(key, false);
    });
});

describe("GET_SETTINGS read path — the own keys round-trip", () => {
    it("answers false for both own keys on a fresh install", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true });

        const response = await loopbackSendMessage({
            type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS,
            keys: [RETRY_KEY, CONTINUE_KEY],
        });

        expect(response).toEqual({ ok: true, values: { [RETRY_KEY]: false, [CONTINUE_KEY]: false } });
    });

    it("answers the stored value once the user has turned a toggle on", async () => {
        await chrome.storage.local.set({ [RETRY_KEY]: true, [CONTINUE_KEY]: false });

        const response = await loopbackSendMessage({
            type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS,
            keys: [RETRY_KEY, CONTINUE_KEY],
        });

        expect(response).toEqual({ ok: true, values: { [RETRY_KEY]: true, [CONTINUE_KEY]: false } });
    });
});

describe("fresh install — master on, own keys never stored", () => {
    it("leaves auto-retry off", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true });

        const retry = await registerFeature(RETRY_KEY);

        expect(retry.isOn, "auto-retry must default OFF on a fresh install").toBe(false);
    });

    it("leaves auto-continue off", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true });

        const cont = await registerFeature(CONTINUE_KEY);

        expect(cont.isOn, "auto-continue must default OFF on a fresh install").toBe(false);
    });
});

describe("live changes — own key on enables that feature alone; master off wins", () => {
    it("turning isAutoRetryEnabled on enables auto-retry and leaves auto-continue off", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true });
        const retry = await registerFeature(RETRY_KEY);
        const cont = await registerFeature(CONTINUE_KEY);

        await chrome.storage.local.set({ [RETRY_KEY]: true });
        await flush();

        expect(retry.isOn, "auto-retry after its own key turned on").toBe(true);
        expect(cont.isOn, "auto-continue must stay off").toBe(false);
    });

    it("turning isAutoContinueEnabled on enables auto-continue and leaves auto-retry off", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true });
        const retry = await registerFeature(RETRY_KEY);
        const cont = await registerFeature(CONTINUE_KEY);

        await chrome.storage.local.set({ [CONTINUE_KEY]: true });
        await flush();

        expect(cont.isOn, "auto-continue after its own key turned on").toBe(true);
        expect(retry.isOn, "auto-retry must stay off").toBe(false);
    });

    it("turning the own key back off disables the feature", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [RETRY_KEY]: true });
        const retry = await registerFeature(RETRY_KEY);
        expect(retry.isOn, "precondition: both switches on").toBe(true);

        await chrome.storage.local.set({ [RETRY_KEY]: false });
        await flush();

        expect(retry.isOn).toBe(false);
    });

    it.each([RETRY_KEY, CONTINUE_KEY])("master off keeps %s off even when its own key is true", async (key) => {
        await chrome.storage.local.set({ [MASTER_KEY]: false, [key]: true });

        const feature = await registerFeature(key);

        expect(feature.isOn).toBe(false);
    });

    it.each([RETRY_KEY, CONTINUE_KEY])("switching master off disables a live %s feature", async (key) => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [key]: true });
        const feature = await registerFeature(key);
        expect(feature.isOn, "precondition: both switches on").toBe(true);

        await chrome.storage.local.set({ [MASTER_KEY]: false });
        await flush();

        expect(feature.isOn).toBe(false);
    });

    it("an own key turned on while master is off stays off until master turns on", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: false });
        const retry = await registerFeature(RETRY_KEY);

        await chrome.storage.local.set({ [RETRY_KEY]: true });
        await flush();
        expect(retry.isOn, "master still off").toBe(false);

        await chrome.storage.local.set({ [MASTER_KEY]: true });
        await flush();
        expect(retry.isOn, "master now on, own key true").toBe(true);
    });
});
