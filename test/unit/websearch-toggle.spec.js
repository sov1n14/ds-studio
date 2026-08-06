import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../utils/storage-manager.js";
import WebSearchToggle from "../../content/websearch-toggle.js";

const MASTER_KEY = "isEnabled";
const MODE_KEY = "dsWebSearchToggle";

function makeButton(pressed) {
    const btn = document.createElement("button");
    btn.className = "ds-toggle-button";
    btn.setAttribute("aria-pressed", pressed);
    btn.click = vi.fn();
    return btn;
}

function labelledButton(pressed, label) {
    const btn = makeButton(pressed);
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
    return btn;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WebSearchToggle", () => {
    beforeEach(() => {
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

describe("findButton() -- button-detection preference (unchanged)", () => {
    it("picks the search toggle over an earlier deep-think toggle", () => {
        const deepThink = labelledButton("false", "深度思考");
        const webSearch = labelledButton("false", "智能搜索");
        document.body.appendChild(deepThink);
        document.body.appendChild(webSearch);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("still picks the search toggle when it comes first", () => {
        const webSearch = labelledButton("false", "智能搜索");
        const deepThink = labelledButton("false", "深度思考");
        document.body.appendChild(webSearch);
        document.body.appendChild(deepThink);
        expect(WebSearchToggle.findButton()).toBe(webSearch);
    });

    it("returns null when no candidate label contains the search term, refusing to guess", () => {
        const first = labelledButton("false", "深度思考");
        const second = labelledButton("false", "深度推理");
        document.body.appendChild(first);
        document.body.appendChild(second);
        expect(WebSearchToggle.findButton()).toBeNull();
    });

    it("generic fallback: picks a search-labelled aria-pressed element when no .ds-toggle-button exists", () => {
        const plain = document.createElement("div");
        plain.setAttribute("aria-pressed", "false");
        const search = document.createElement("div");
        search.setAttribute("aria-pressed", "false");
        const label = document.createElement("span");
        label.textContent = "智能搜索";
        search.appendChild(label);
        document.body.appendChild(plain);
        document.body.appendChild(search);
        expect(WebSearchToggle.findButton()).toBe(search);
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

    it("storage.onChanged after the one-shot is spent does not trigger a re-apply", async () => {
        await chrome.storage.local.set({ [MASTER_KEY]: true, [MODE_KEY]: "on" });
        const btn = labelledButton("false", "智能搜索");
        document.body.appendChild(btn);
        await WebSearchToggle.start();
        await flush();
        expect(btn.click).toHaveBeenCalledOnce();
        btn.click.mockClear();
        await chrome.storage.local.set({ [MODE_KEY]: "off" });
        await flush();
        expect(btn.click).not.toHaveBeenCalled();
    });

    it("turning the master switch off then back on after the one-shot is spent does not re-click", async () => {
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
        expect(btn.click).not.toHaveBeenCalled();
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
});
});
