/**
 * Targeted mutant-killer tests for content/websearch-toggle.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../utils/settings-message-constants.js";
import "../../utils/storage-manager.js";
import StorageManager from "../../utils/storage-manager.js";

const MASTER_KEY = "isEnabled";
const MODE_KEY = StorageManager.KEYS.WEBSEARCH_TOGGLE;

function makeButton(pressed) {
    const btn = document.createElement("button");
    btn.className = "ds-toggle-button";
    btn.setAttribute("aria-pressed", pressed);
    btn.click = vi.fn();
    return btn;
}

// Search-button fixture: a real <button> carrying the sample-derived icon
// nesting. Defaults to the search icon (label text is irrelevant to lookup);
// pass null for a label-only button.
function labelledButton(pressed, label, iconPath = SEARCH_ICON_D) {
    const btn = makeButton(pressed);
    if (iconPath !== null) {
        btn.insertAdjacentHTML("beforeend", iconHtml(iconPath));
    }
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
    return btn;
}

// Exact path data copied from to-do/samples/input-bar-{zhCN,zhTW,eng}.html.
const SEARCH_ICON_D =
    " M7.999599933624268,14.849200248718262 C9.598299980163574,14.849200248718262 10.894100189208984,11.78279972076416 10.894100189208984,8 C10.894100189208984,4.217199802398682 9.598299980163574,1.1509000062942505 7.999599933624268,1.1509000062942505";
const DEEP_THINK_ICON_D =
    " M8,6.769999980926514 C8.678836822509766,6.769999980926514 9.229999542236328,7.321163177490234 9.229999542236328,8 C9.229999542236328,8.678836822509766 8.678836822509766,9.229999542236328 8,9.229999542236328 C7.321163177490234,9.229999542236328 6.769999980926514,8.678836822509766 6.769999980926514,8 C6.769999980926514,7.321163177490234 7.321163177490234,6.769999980926514 8,6.769999980926514z";

// Mirrors the real DeepSeek page nesting
// (button > .ds-toggle-button__icon > .ds-icon > div > div > svg > g > g > g > path)
// from to-do/samples/input-bar-*.html. Pass iconPath = null to strip the icon,
// label = null to omit the label span.
function iconHtml(iconPath) {
    return `<div class="ds-toggle-button__icon">
        <div class="ds-icon">
            <div class="_46d2264" aria-hidden="true">
                <div style="width: 14px; height: 14px;">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                        <defs>
                            <clipPath id="__lottie_element_35">
                                <rect width="16" height="16" x="0" y="0"></rect>
                            </clipPath>
                        </defs>
                        <g clip-path="url(#__lottie_element_35)">
                            <g>
                                <g>
                                    <path d="${iconPath}"></path>
                                </g>
                            </g>
                        </g>
                    </svg>
                </div>
            </div>
        </div>
    </div>`;
}

function makeToggle(pressed, label, iconPath, generic = false) {
    const toggle = document.createElement("div");
    toggle.className = generic
        ? ""
        : "ds-toggle-button ds-toggle-button--m" +
          (pressed === "true" ? " ds-toggle-button--selected" : "");
    toggle.setAttribute("tabindex", "0");
    toggle.setAttribute("aria-pressed", pressed);
    if (iconPath !== null) {
        toggle.insertAdjacentHTML("beforeend", iconHtml(iconPath));
    }
    if (label !== null) {
        const labelSpan = document.createElement("span");
        labelSpan.className = "_6dbc175";
        labelSpan.textContent = label;
        toggle.appendChild(labelSpan);
    }
    return toggle;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Messaging harness (same shape as width-feature.spec.js)
// ─────────────────────────────────────────────────────────────────────────────

/** Fresh chrome.runtime.onMessage stub with a fireable listener set. */
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

let onMessage;
let sendMessage;
let WebSearchToggle;

/**
 * Answer every GET_SETTINGS from `values`, returning only the keys the message
 * asked for -- background/settings-routes.js behaves the same way, and this is
 * what keeps the module's own mode GET distinct from feature-toggle's master GET.
 */
function respondFrom(values) {
    sendMessage.mockImplementation((message, callback) => {
        const picked = {};
        (message.keys || []).forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(values, key)) picked[key] = values[key];
        });
        const response = { ok: true, values: picked };
        if (typeof callback === "function") callback(response);
        return Promise.resolve(response);
    });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Storage-change payload shape: { key: { oldValue, newValue } }. */
function change(key, newValue, oldValue) {
    return { [key]: { oldValue, newValue } };
}

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
function broadcast(changes, area = "local") {
    onMessage.callListeners(
        { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes },
        { id: "test-extension-id" },
        () => {},
    );
}

/**
 * Load a fresh WebSearchToggle (plus a fresh feature-toggle and a fresh
 * onMessage stub, so no earlier instance can observe this test's broadcasts)
 * whose auto-start sees `values` as its settings snapshot.
 *
 * Under fake timers the settling tick must run on the fake clock, hence
 * `isFakeTimers` -- awaiting a real setTimeout there would deadlock.
 */
async function loadWebSearch(values = {}, { isFakeTimers = false } = {}) {
    onMessage = createOnMessageStub();
    chrome.runtime.onMessage = onMessage;
    respondFrom(values);
    vi.resetModules();
    await import("../../content/feature-toggle.js");
    WebSearchToggle = (await import("../../content/websearch-toggle.js")).default;
    if (isFakeTimers) {
        await vi.advanceTimersByTimeAsync(0);
    } else {
        await flush();
    }
    return WebSearchToggle;
}

describe("WebSearchToggle mutant killers", () => {
    beforeEach(async () => {
        document.body.innerHTML = "";
        sendMessage = vi.fn();
        chrome.runtime.sendMessage = sendMessage;
        await loadWebSearch({ [MASTER_KEY]: false, [MODE_KEY]: "on" });
    });

    afterEach(() => {
        if (WebSearchToggle) WebSearchToggle.disable();
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    describe("initial state defaults", () => {
        it("enabled defaults to false", () => {
            expect(WebSearchToggle.enabled).toBe(false);
        });
        it("mode defaults to on", () => {
            expect(WebSearchToggle.mode).toBe("on");
        });
        it("_masterEnabled defaults to false", () => {
            expect(WebSearchToggle._masterEnabled).toBe(false);
        });
        it("_isSpent defaults to false", () => {
            expect(WebSearchToggle._isSpent).toBe(false);
        });
    });

    describe("_normalizeMode", () => {
        it("returns exactly off for input off", () => {
            expect(WebSearchToggle._normalizeMode("off")).toBe("off");
        });
        it("returns on for undefined", () => {
            expect(WebSearchToggle._normalizeMode(undefined)).toBe("on");
        });
        it("returns on for default", () => {
            expect(WebSearchToggle._normalizeMode("default")).toBe("on");
        });
    });

    describe("applyToExisting internals", () => {
        it("skips when _isSpent is true", () => {
            const btn = labelledButton("false", "Search");
            document.body.appendChild(btn);
            WebSearchToggle.mode = "on";
            WebSearchToggle._isSpent = true;
            WebSearchToggle.applyToExisting();
            expect(btn.click).not.toHaveBeenCalled();
        });
        it("clicks button when not spent and mode mismatches", () => {
            const btn = labelledButton("false", "Search");
            document.body.appendChild(btn);
            WebSearchToggle.mode = "on";
            WebSearchToggle._isSpent = false;
            WebSearchToggle.applyToExisting();
            expect(btn.click).toHaveBeenCalledOnce();
            expect(WebSearchToggle._isSpent).toBe(true);
        });
        it("nulls the give-up timer on success", () => {
            vi.useFakeTimers();
            WebSearchToggle._giveUpTimer = setTimeout(() => {}, 99999);
            const btn = labelledButton("false", "Search");
            document.body.appendChild(btn);
            WebSearchToggle.mode = "on";
            WebSearchToggle._isSpent = false;
            WebSearchToggle.applyToExisting();
            expect(WebSearchToggle._giveUpTimer).toBeNull();
            vi.useRealTimers();
        });
        it("disconnects and nulls the observer on success", () => {
            const mockObs = { disconnect: vi.fn() };
            WebSearchToggle._observer = mockObs;
            const btn = labelledButton("false", "Search");
            document.body.appendChild(btn);
            WebSearchToggle.mode = "on";
            WebSearchToggle._isSpent = false;
            WebSearchToggle.applyToExisting();
            expect(mockObs.disconnect).toHaveBeenCalled();
            expect(WebSearchToggle._observer).toBeNull();
        });
    });

    describe("_armObserver callback", () => {
        it("stops observer when _isSpent true during callback", async () => {
            WebSearchToggle._armObserver();
            expect(WebSearchToggle._observer).not.toBeNull();
            WebSearchToggle._isSpent = true;
            document.body.appendChild(document.createElement("div"));
            await flush();
            expect(WebSearchToggle._observer).toBeNull();
        });
        it("does not create duplicate observers", () => {
            WebSearchToggle._armObserver();
            const first = WebSearchToggle._observer;
            WebSearchToggle._armObserver();
            expect(WebSearchToggle._observer).toBe(first);
        });
    });

    describe("_cancelGiveUp", () => {
        it("clears active timer and sets null", () => {
            vi.useFakeTimers();
            WebSearchToggle._giveUpTimer = setTimeout(() => {}, 99999);
            expect(WebSearchToggle._giveUpTimer).not.toBeNull();
            WebSearchToggle._cancelGiveUp();
            expect(WebSearchToggle._giveUpTimer).toBeNull();
            vi.useRealTimers();
        });
        it("is safe when no timer exists", () => {
            WebSearchToggle._giveUpTimer = null;
            expect(() => WebSearchToggle._cancelGiveUp()).not.toThrow();
            expect(WebSearchToggle._giveUpTimer).toBeNull();
        });
    });

    describe("_armGiveUp", () => {
        it("cancels previous timer before arming new one", () => {
            vi.useFakeTimers();
            vi.spyOn(console, "warn").mockImplementation(() => {});
            WebSearchToggle._isSpent = false;
            WebSearchToggle._armGiveUp();
            WebSearchToggle._armGiveUp();
            vi.advanceTimersByTime(WebSearchToggle.LOCATE_GIVE_UP_MS + 1);
            expect(console.warn).toHaveBeenCalledTimes(1);
            vi.useRealTimers();
        });
        it("nulls handle after firing", () => {
            vi.useFakeTimers();
            vi.spyOn(console, "warn").mockImplementation(() => {});
            WebSearchToggle._isSpent = false;
            WebSearchToggle._armGiveUp();
            vi.advanceTimersByTime(WebSearchToggle.LOCATE_GIVE_UP_MS);
            expect(WebSearchToggle._giveUpTimer).toBeNull();
            vi.useRealTimers();
        });
        it("does not warn when _isSpent true at expiry", () => {
            vi.useFakeTimers();
            vi.spyOn(console, "warn").mockImplementation(() => {});
            WebSearchToggle._isSpent = false;
            WebSearchToggle._armGiveUp();
            WebSearchToggle._isSpent = true;
            vi.advanceTimersByTime(WebSearchToggle.LOCATE_GIVE_UP_MS);
            expect(console.warn).not.toHaveBeenCalled();
            vi.useRealTimers();
        });
    });

    describe("_recompute", () => {
        it("enables when master on and not spent", () => {
            WebSearchToggle._masterEnabled = true;
            WebSearchToggle._isSpent = false;
            WebSearchToggle.enabled = false;
            WebSearchToggle._recompute();
            expect(WebSearchToggle.enabled).toBe(true);
        });
        it("disables when master off", () => {
            WebSearchToggle._masterEnabled = false;
            WebSearchToggle._isSpent = false;
            WebSearchToggle.enabled = true;
            WebSearchToggle._recompute();
            expect(WebSearchToggle.enabled).toBe(false);
        });
        it("disables when spent even if master on", () => {
            WebSearchToggle._masterEnabled = true;
            WebSearchToggle._isSpent = true;
            WebSearchToggle.enabled = true;
            WebSearchToggle._recompute();
            expect(WebSearchToggle.enabled).toBe(false);
        });
    });

    describe("enable", () => {
        it("is idempotent", () => {
            WebSearchToggle.enabled = false;
            WebSearchToggle._isSpent = false;
            WebSearchToggle.enable();
            expect(WebSearchToggle.enabled).toBe(true);
            const obs = WebSearchToggle._observer;
            WebSearchToggle.enable();
            expect(WebSearchToggle._observer).toBe(obs);
        });
        it("arms observer and give-up when not spent and button absent", () => {
            vi.useFakeTimers();
            vi.spyOn(console, "warn").mockImplementation(() => {});
            WebSearchToggle.enabled = false;
            WebSearchToggle._isSpent = false;
            WebSearchToggle.enable();
            expect(WebSearchToggle._observer).not.toBeNull();
            expect(WebSearchToggle._giveUpTimer).not.toBeNull();
            vi.useRealTimers();
        });
        it("does not arm observer when already spent", () => {
            WebSearchToggle.enabled = false;
            WebSearchToggle._isSpent = true;
            WebSearchToggle.enable();
            expect(WebSearchToggle._observer).toBeNull();
        });
    });

    describe("_rearm", () => {
        it("resets spent and recomputes to enabled when master on", () => {
            WebSearchToggle._masterEnabled = true;
            WebSearchToggle.enabled = true;
            WebSearchToggle._isSpent = true;
            WebSearchToggle._rearm();
            expect(WebSearchToggle._isSpent).toBe(false);
            expect(WebSearchToggle.enabled).toBe(true);
        });
    });

    describe("_handleSettingsChanged guards", () => {
        it("ignores null message", () => {
            expect(() => WebSearchToggle._handleSettingsChanged(null)).not.toThrow();
        });
        it("ignores message with wrong type", () => {
            WebSearchToggle.mode = "on";
            WebSearchToggle._handleSettingsChanged({
                type: "WRONG",
                area: "local",
                changes: { [MODE_KEY]: { newValue: "off" } },
            });
            expect(WebSearchToggle.mode).toBe("on");
        });
        it("ignores non-local area", () => {
            WebSearchToggle.mode = "on";
            WebSearchToggle._handleSettingsChanged({
                type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED,
                area: "sync",
                changes: { [MODE_KEY]: { newValue: "off" } },
            });
            expect(WebSearchToggle.mode).toBe("on");
        });
        it("ignores when relevant key absent from changes", () => {
            WebSearchToggle.mode = "on";
            WebSearchToggle._handleSettingsChanged({
                type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED,
                area: "local",
                changes: { unrelatedKey: { newValue: "whatever" } },
            });
            expect(WebSearchToggle.mode).toBe("on");
        });
        it("handles missing changes property via optional chaining", () => {
            expect(() => {
                WebSearchToggle._handleSettingsChanged({
                    type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED,
                    area: "local",
                });
            }).not.toThrow();
        });
        it("updates mode and rearms on valid change", () => {
            WebSearchToggle.mode = "on";
            WebSearchToggle._masterEnabled = true;
            WebSearchToggle._isSpent = true;
            WebSearchToggle._handleSettingsChanged({
                type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED,
                area: "local",
                changes: { [MODE_KEY]: { newValue: "off", oldValue: "on" } },
            });
            expect(WebSearchToggle.mode).toBe("off");
            expect(WebSearchToggle._isSpent).toBe(false);
        });
    });

    describe("start error handling", () => {
        it("logs error when messageTypes dep is missing", async () => {
            vi.spyOn(console, "error").mockImplementation(() => {});
            onMessage = createOnMessageStub();
            chrome.runtime.onMessage = onMessage;
            sendMessage.mockImplementation(() => Promise.resolve({ ok: true, values: {} }));
            vi.resetModules();
            const savedMsg = globalThis.DSS_SETTINGS_MSG;
            globalThis.DSS_SETTINGS_MSG = undefined;
            await import("../../content/feature-toggle.js");
            await import("../../content/websearch-toggle.js");
            await flush();
            globalThis.DSS_SETTINGS_MSG = savedMsg;
            const relevant = console.error.mock.calls.find(c => typeof c[0] === "string" && c[0].includes("websearch-toggle"));
            expect(relevant).toBeTruthy();
        });
        it("logs error when sendMessage returns ok:false", async () => {
            vi.spyOn(console, "error").mockImplementation(() => {});
            onMessage = createOnMessageStub();
            chrome.runtime.onMessage = onMessage;
            vi.resetModules();
            await import("../../content/feature-toggle.js");
            sendMessage.mockImplementation(() => Promise.resolve({ ok: false, error: "fail" }));
            await import("../../content/websearch-toggle.js");
            await flush();
            const relevant = console.error.mock.calls.find(c => typeof c[0] === "string" && c[0].includes("websearch-toggle"));
            expect(relevant).toBeTruthy();
        });
        it("logs error when sendMessage returns null", async () => {
            vi.spyOn(console, "error").mockImplementation(() => {});
            onMessage = createOnMessageStub();
            chrome.runtime.onMessage = onMessage;
            vi.resetModules();
            await import("../../content/feature-toggle.js");
            sendMessage.mockImplementation(() => Promise.resolve(null));
            await import("../../content/websearch-toggle.js");
            await flush();
            const relevant = console.error.mock.calls.find(c => typeof c[0] === "string" && c[0].includes("websearch-toggle"));
            expect(relevant).toBeTruthy();
        });
    });
});
