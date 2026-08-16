import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../utils/storage-manager.js";
import WebSearchToggle from "../../content/websearch-toggle.js";
import { resetStorageOnChangedListeners } from "../setup/vitest.setup.js";

const MASTER_KEY = "isEnabled";
const MODE_KEY = "dsWebSearchToggle";

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WebSearchToggle", () => {
    beforeEach(() => {
        resetStorageOnChangedListeners();
        WebSearchToggle.disable();
        WebSearchToggle.enabled = false;
        WebSearchToggle.mode = "on";
        WebSearchToggle._masterEnabled = false;
        WebSearchToggle._isSpent = false;
        document.body.innerHTML = "";
    });

    afterEach(() => {
        if (WebSearchToggle._observer) {
            WebSearchToggle._observer.disconnect();
            WebSearchToggle._observer = null;
        }
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

describe("apply()", () => {
    it("clicks when aria-pressed mismatches the target mode", () => {
        const btn = makeButton("true");
        document.body.appendChild(btn);
        WebSearchToggle.mode = "off";
        WebSearchToggle.apply(btn);
        expect(btn.click).toHaveBeenCalledOnce();
        btn.click.mockClear();
        btn.setAttribute("aria-pressed", "false");
        WebSearchToggle.mode = "on";
        WebSearchToggle.apply(btn);
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("does not click when aria-pressed already matches the target mode", () => {
        const btn = makeButton("true");
        document.body.appendChild(btn);
        WebSearchToggle.mode = "on";
        WebSearchToggle.apply(btn);
        expect(btn.click).not.toHaveBeenCalled();
        btn.setAttribute("aria-pressed", "false");
        WebSearchToggle.mode = "off";
        WebSearchToggle.apply(btn);
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("does not click a disconnected button", () => {
        const btn = makeButton("true");
        WebSearchToggle.mode = "off";
        WebSearchToggle.apply(btn);
        expect(btn.click).not.toHaveBeenCalled();
    });
});

describe("findButton() -- button-detection preference", () => {
    it("picks the search toggle over an earlier deep-think toggle", () => {
        const deepThink = labelledButton("false", "深度思考", DEEP_THINK_ICON_D);
        const webSearch = labelledButton("false", "智能搜索", SEARCH_ICON_D);
        document.body.appendChild(deepThink);
        document.body.appendChild(webSearch);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("still picks the search toggle when it comes first", () => {
        const webSearch = labelledButton("false", "智能搜索", SEARCH_ICON_D);
        const deepThink = labelledButton("false", "深度思考", DEEP_THINK_ICON_D);
        document.body.appendChild(webSearch);
        document.body.appendChild(deepThink);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("refuses to guess: never returns a lone deep-thinking toggle it cannot identify as the search toggle (no label text involved)", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const deepThink = makeToggle("true", null, DEEP_THINK_ICON_D);
        document.body.appendChild(deepThink);
        expect(WebSearchToggle.findButton()).toBeNull();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("generic fallback: icon tier locates a plain aria-pressed element (no .ds-toggle-button class) by its search-icon path", () => {
        const search = makeToggle("false", "an arbitrary label", SEARCH_ICON_D, true);
        document.body.appendChild(search);
        expect(WebSearchToggle.findButton()).toBe(search);
    });

    it("generic fallback: plain aria-pressed elements without the icon path and no .ds-toggle-button candidates -- returns null and warns once", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const first = makeToggle("false", "an arbitrary label", null, true);
        const second = makeToggle("false", "another arbitrary label", null, true);
        document.body.appendChild(first);
        document.body.appendChild(second);
        expect(WebSearchToggle.findButton()).toBeNull();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });
});

describe("findButton() -- two-tier locator: icon path, then positional fallback", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("1: zh-CN labels with correct icon paths -- returns the search toggle", () => {
        const deepThink = makeToggle("true", "深度思考", DEEP_THINK_ICON_D);
        const webSearch = makeToggle("false", "联网检索", SEARCH_ICON_D);
        document.body.appendChild(deepThink);
        document.body.appendChild(webSearch);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("2: zh-TW labels with correct icon paths -- returns the search toggle", () => {
        const deepThink = makeToggle("true", "深度思考", DEEP_THINK_ICON_D);
        const webSearch = makeToggle("true", "智慧搜尋", SEARCH_ICON_D);
        document.body.appendChild(deepThink);
        document.body.appendChild(webSearch);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("3: English labels with correct icon paths -- returns the search toggle", () => {
        const deepThink = makeToggle("true", "DeepThink", DEEP_THINK_ICON_D);
        const webSearch = makeToggle("true", "Search", SEARCH_ICON_D);
        document.body.appendChild(deepThink);
        document.body.appendChild(webSearch);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("4: labels in an unrelated language with correct icon paths -- returns the search toggle", () => {
        const deepThink = makeToggle("true", "foo", DEEP_THINK_ICON_D);
        const webSearch = makeToggle("true", "bar", SEARCH_ICON_D);
        document.body.appendChild(deepThink);
        document.body.appendChild(webSearch);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("5: search toggle rendered off (aria-pressed=false, no --selected class) -- still located", () => {
        const deepThink = makeToggle("false", "深度思考", DEEP_THINK_ICON_D);
        const webSearch = makeToggle("false", "智能搜索", SEARCH_ICON_D);
        document.body.appendChild(deepThink);
        document.body.appendChild(webSearch);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("6: icon paths stripped, two candidates -- falls back to the second toggle (index 1)", () => {
        const deepThink = makeToggle("false", "深度思考", null);
        const webSearch = makeToggle("false", "深度推理", null);
        document.body.appendChild(deepThink);
        document.body.appendChild(webSearch);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("7: icon paths stripped, only one candidate -- returns null and warns once", () => {
        const lone = makeToggle("false", "深度思考", null);
        document.body.appendChild(lone);
        expect(WebSearchToggle.findButton()).toBeNull();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("8: no .ds-toggle-button[aria-pressed] candidates at all -- returns null and warns once", () => {
        expect(document.querySelector(".ds-toggle-button")).toBeNull();
        expect(WebSearchToggle.findButton()).toBeNull();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("9: deep-thinking toggle AFTER the search toggle in DOM order -- still returns the search toggle", () => {
        const webSearch = makeToggle("true", "Search", SEARCH_ICON_D);
        const deepThink = makeToggle("true", "DeepThink", DEEP_THINK_ICON_D);
        document.body.appendChild(webSearch);
        document.body.appendChild(deepThink);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });
});

describe("one-shot page-entry default", () => {
    it("master switch off: applies nothing and clicks nothing", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: false, [MODE_KEY]: "off" });
        const btn = labelledButton("true", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("CORE: user manually flips the already-applied button -- no click-back", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
        btn.click.mockClear();
        btn.setAttribute("aria-pressed", "false");
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("unset mode key defaults to target on", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("legacy stored value default is treated as target on", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "default" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("applies once when the button appears later via a DOM mutation, then disconnects", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "off" });
        await WebSearchToggle.start();
        await flush();
        const btn = labelledButton("true", "智能搜索");
        document.body.appendChild(btn);
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
        const secondBtn = labelledButton("true", "智能搜索");
        document.body.appendChild(secondBtn);
        await flush();
        expect(secondBtn.click).not.toHaveBeenCalled();
    });

    it("storage.onChanged after the one-shot is spent re-arms and triggers exactly one re-apply (REPLACES obsolete no-re-apply expectation)", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
        btn.click.mockClear();
        // Simulate the DOM effect of the real click the stub cannot perform:
        // after start() clicked once, the button is now genuinely pressed (on).
        btn.setAttribute("aria-pressed", "true");
        await chrome.storage.local.set({ [MODE_KEY]: "off" });
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("turning the master switch off then back on after the one-shot is spent re-applies exactly once on the on-transition (REPLACES obsolete no-re-click expectation)", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
        btn.click.mockClear();
        await chrome.storage.local.set({ [MASTER_KEY]: false });
        await flush();
        await chrome.storage.local.set({ [MASTER_KEY]: true });
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("master switch turned on later uses the current mode for the still-pending application", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: false, [MODE_KEY]: "on" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
        await chrome.storage.local.set({ [MASTER_KEY]: true });
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("mode change before the button is found is honored by the pending single application", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        await WebSearchToggle.start();
        await flush();
        await chrome.storage.local.set({ [MODE_KEY]: "off" });
        await flush();
        const btn = labelledButton("true", "智能搜索");
        document.body.appendChild(btn);
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("turning the master switch off while an application is still pending cancels it", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        await WebSearchToggle.start();
        await flush();
        await chrome.storage.local.set({ [MASTER_KEY]: false });
        await flush();
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

describe("post one-shot activation events (storage.onChanged widened scope)", () => {
    it("1: mismatched mode change via onChanged clicks exactly once", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        const btn = labelledButton("true", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        btn.click.mockClear();
        await chrome.storage.local.set({ [MODE_KEY]: "off" });
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("2: mismatched mode change the other direction clicks exactly once", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "off" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        btn.click.mockClear();
        await chrome.storage.local.set({ [MODE_KEY]: "on" });
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
    });

    it("3: mode change that already matches current aria-pressed does not click", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "off" });
        const btn = labelledButton("true", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        btn.click.mockClear();
        await chrome.storage.local.set({ [MODE_KEY]: "on" });
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("4: release-again -- a subsequent DOM mutation after a storage-driven re-apply does not cause a second click", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        const btn = labelledButton("true", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        btn.click.mockClear();
        await chrome.storage.local.set({ [MODE_KEY]: "off" });
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
        btn.click.mockClear();
        document.body.appendChild(document.createElement("div"));
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("5: master off -- a mode change via onChanged is ignored entirely", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: false, [MODE_KEY]: "on" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        await chrome.storage.local.set({ [MODE_KEY]: "off" });
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("7: master switch transition to off never clicks", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        btn.click.mockClear();
        await chrome.storage.local.set({ [MASTER_KEY]: false });
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("8: no leaked observer after master-off -- pending mode-driven wait is cancelled by a master-off event, so a later-appearing button is not clicked", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        await WebSearchToggle.start();
        await flush();
        await chrome.storage.local.set({ [MODE_KEY]: "off" });
        await flush();
        await chrome.storage.local.set({ [MASTER_KEY]: false });
        await flush();
        const btn = labelledButton("true", "智能搜索");
        document.body.appendChild(btn);
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("10: a change arriving in a non-local storage namespace is ignored entirely", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        btn.click.mockClear();
        await chrome.storage.sync.set({ [MODE_KEY]: "off" });
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });
});
});
});
