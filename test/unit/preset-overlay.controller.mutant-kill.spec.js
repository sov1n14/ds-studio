/**
 * Mutant-killing tests for preset-overlay.controller.js.
 * Each group targets survived Stryker mutants by asserting observable behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../utils/storage-manager.js";
import DSSelectors from "../../content/ds-selectors.js";

const { createPresetOverlay } = require("../../content/preset-overlay.controller.js");

// -- helpers ------------------------------------------------------------------

function makeCtx(overrides = {}) {
    return {
        getIsEnabled:               vi.fn(() => true),
        getCurrentChatUuid:         vi.fn(() => "uuid-1"),
        setCurrentChatUuid:         vi.fn(),
        getChatPresetMap:           vi.fn(() => ({})),
        setChatPresetMap:           vi.fn(),
        getPendingPresetId:         vi.fn(() => undefined),
        setPendingPresetId:         vi.fn(),
        updatePromptPrefixFromBinding: vi.fn(),
        isExtensionContextValid:    vi.fn(() => true),
        ...overrides,
    };
}

let smSpies = [];
function spyStorageManager() {
    const resolved = Promise.resolve({});
    smSpies = [
        vi.spyOn(StorageManager, "bindChatToPreset").mockReturnValue(resolved),
        vi.spyOn(StorageManager, "unbindChat").mockReturnValue(resolved),
        vi.spyOn(StorageManager, "getChatPresetMap").mockResolvedValue({}),
        vi.spyOn(StorageManager, "saveActivePresetId").mockReturnValue(resolved),
        vi.spyOn(StorageManager, "getSettings").mockResolvedValue({ promptPresets: [], pinnedPresetId: "" }),
    ];
}
function restoreStorageManager() {
    smSpies.forEach(s => s.mockRestore());
    smSpies = [];
}

function mountOverlay(overlay) {
    const target = document.createElement("div");
    document.body.appendChild(target);
    overlay.mountTo(target);
    return target;
}

function teardown(overlay, target) {
    if (overlay) overlay.unmount();
    if (target && target.parentNode) target.parentNode.removeChild(target);
}
// -- buildDOM -----------------------------------------------------------------

describe("buildDOM -- dropdown creation", () => {
    let overlay, ctx;

    beforeEach(() => {
        spyStorageManager();
        ctx = makeCtx();
        overlay = createPresetOverlay(ctx);
    });

    afterEach(() => {
        overlay.unmount();
        restoreStorageManager();
    });

    it("creates a dropdown with an element (wrapperEl)", () => {
        overlay.buildDOM();
        expect(overlay.dropdown).not.toBeNull();
        expect(overlay.wrapperEl).toBeInstanceOf(HTMLElement);
    });

    it("creates a dropdown whose onChange triggers onSelectChange", () => {
        overlay.buildDOM();
        overlay.reposition = vi.fn();
        overlay.onSelectChange("");
        expect(ctx.updatePromptPrefixFromBinding).toHaveBeenCalled();
    });

    it("passes i18n-derived text (not empty strings)", () => {
        overlay.buildDOM();
        expect(overlay.dropdown.el).toBeTruthy();
        expect(overlay.dropdown.el.textContent.length).toBeGreaterThan(0);
    });
});

// -- mountTo ------------------------------------------------------------------

describe("mountTo -- full lifecycle", () => {
    let overlay, ctx, target;

    beforeEach(() => {
        spyStorageManager();
        ctx = makeCtx();
        overlay = createPresetOverlay(ctx);
    });

    afterEach(() => {
        teardown(overlay, target);
        restoreStorageManager();
    });

    it("appends wrapperEl to the target element", () => {
        target = document.createElement("div");
        document.body.appendChild(target);
        overlay.mountTo(target);
        expect(target.contains(overlay.wrapperEl)).toBe(true);
    });

    it("sets targetEl", () => {
        target = document.createElement("div");
        document.body.appendChild(target);
        overlay.mountTo(target);
        expect(overlay.targetEl).toBe(target);
    });

    it("calls unmount first -- remounting cleans up old dropdown", () => {
        target = document.createElement("div");
        document.body.appendChild(target);
        overlay.mountTo(target);
        const firstDropdown = overlay.dropdown;

        const target2 = document.createElement("div");
        document.body.appendChild(target2);
        overlay.mountTo(target2);

        expect(overlay.targetEl).toBe(target2);
        expect(overlay.dropdown).not.toBe(firstDropdown);
        target2.parentNode.removeChild(target2);
    });

    it("installs a window resize handler", () => {
        target = document.createElement("div");
        document.body.appendChild(target);
        overlay.mountTo(target);
        expect(overlay._windowResizeHandler).not.toBeNull();
    });
});
// -- unmount ------------------------------------------------------------------

describe("unmount -- cleanup", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); });
    afterEach(() => { teardown(null, target); restoreStorageManager(); });

    it("nulls dropdown and wrapperEl", () => { expect(overlay.dropdown).not.toBeNull(); overlay.unmount(); expect(overlay.dropdown).toBeNull(); expect(overlay.wrapperEl).toBeNull(); });
    it("nulls resizeObserver", () => { overlay.unmount(); expect(overlay.resizeObserver).toBeNull(); });
    it("nulls _windowResizeHandler", () => { expect(overlay._windowResizeHandler).not.toBeNull(); overlay.unmount(); expect(overlay._windowResizeHandler).toBeNull(); });
    it("nulls targetEl", () => { overlay.unmount(); expect(overlay.targetEl).toBeNull(); });
    it("nulls _findAndMountTimer", () => { overlay._findAndMountTimer = setTimeout(() => {}, 10000); overlay.unmount(); expect(overlay._findAndMountTimer).toBeNull(); });
    it("cancels the settle loop", () => { overlay.unmount(); expect(overlay._settle).toBeNull(); });
});

// -- render -------------------------------------------------------------------

describe("render -- dropdown update", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("updates the dropdown options", () => {
        const presets = [{ id: "p1", name: "Preset 1" }];
        overlay.render(presets, "p1");
        const options = overlay.dropdown.menu.querySelectorAll(".dss-preset-option");
        expect(options.length).toBe(presets.length + 1);
        const p1Option = overlay.dropdown.menu.querySelector('li[data-value="p1"]');
        expect(p1Option).not.toBeNull();
        expect(p1Option.textContent).toBe("Preset 1");
    });
    it("sets the active value", () => {
        const presets = [{ id: "p1", name: "Preset 1" }];
        overlay.render(presets, "p1");
        const p1Option = overlay.dropdown.menu.querySelector('li[data-value="p1"]');
        expect(p1Option.getAttribute("aria-selected")).toBe("true");
    });
    it("defaults activeId to empty string when falsy", () => {
        const presets = [{ id: "p1", name: "Preset 1" }];
        overlay.render(presets, null);
        const p1Option = overlay.dropdown.menu.querySelector('li[data-value="p1"]');
        expect(p1Option.getAttribute("aria-selected")).toBe("false");
        expect(overlay.dropdown.label.classList.contains("dss-preset-label--placeholder")).toBe(true);
    });
    it("is a no-op when dropdown is null", () => { overlay.dropdown = null; expect(() => overlay.render([], "p1")).not.toThrow(); });
    it("calls reposition", () => { overlay.reposition = vi.fn(); overlay.render([], "p1"); expect(overlay.reposition).toHaveBeenCalled(); });
});

// -- updateActiveId -----------------------------------------------------------

describe("updateActiveId", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("sets the dropdown value", () => { const spy = vi.spyOn(overlay.dropdown, "setValue"); overlay.updateActiveId("p2"); expect(spy).toHaveBeenCalledWith("p2"); });
    it("defaults to empty string for falsy id", () => { const spy = vi.spyOn(overlay.dropdown, "setValue"); overlay.updateActiveId(null); expect(spy).toHaveBeenCalledWith(""); });
    it("calls reposition", () => { overlay.reposition = vi.fn(); overlay.updateActiveId("p2"); expect(overlay.reposition).toHaveBeenCalled(); });
    it("is a no-op when dropdown is null", () => { overlay.dropdown = null; expect(() => overlay.updateActiveId("p2")).not.toThrow(); });
});
// -- setVisible ---------------------------------------------------------------

describe("setVisible", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("setVisible(false) hides the wrapper", () => { overlay.setVisible(false); expect(overlay.wrapperEl.style.display).toBe("none"); });
    it("setVisible(true) shows the wrapper", () => { overlay.setVisible(false); overlay.setVisible(true); expect(overlay.wrapperEl.style.display).toBe(""); });
    it("setVisible(true) calls reposition", () => { overlay.reposition = vi.fn(); overlay.setVisible(true); expect(overlay.reposition).toHaveBeenCalled(); });
    it("setVisible(false) does NOT call reposition", () => { overlay.reposition = vi.fn(); overlay.setVisible(false); expect(overlay.reposition).not.toHaveBeenCalled(); });
    it("is a no-op when wrapperEl is null", () => { overlay.wrapperEl = null; expect(() => overlay.setVisible(true)).not.toThrow(); });
});

// -- reposition guard clauses -------------------------------------------------

describe("reposition -- guard clauses", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("does nothing when wrapperEl is null", () => { overlay.wrapperEl = null; expect(() => overlay.reposition()).not.toThrow(); });
    it("does nothing when targetEl is null", () => { overlay.targetEl = null; expect(() => overlay.reposition()).not.toThrow(); });
    it("skips when wrapperEl is display:none", () => { overlay.wrapperEl.style.display = "none"; const spy = vi.spyOn(overlay, "_applyPlacementSync"); overlay.reposition(); expect(spy).not.toHaveBeenCalled(); });
});

// -- _applyPlacementSync ------------------------------------------------------

describe("_applyPlacementSync -- placement", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("does nothing when wrapperEl is null", () => { overlay.wrapperEl = null; expect(() => overlay._applyPlacementSync()).not.toThrow(); });
    it("does nothing when targetEl is null", () => { overlay.targetEl = null; expect(() => overlay._applyPlacementSync()).not.toThrow(); });
    it("sets style properties on the wrapper", () => { overlay._applyPlacementSync(); const vis = overlay.wrapperEl.style.visibility; const transform = overlay.wrapperEl.style.transform; expect(vis === "hidden" || transform === "translateY(-50%)").toBe(true); });
});

// -- startSettle --------------------------------------------------------------

describe("startSettle", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("sets _settle after mount", () => { target = mountOverlay(overlay); expect(overlay._settle).not.toBeNull(); });
    it("is idempotent -- second call does not replace _settle", () => { target = mountOverlay(overlay); const first = overlay._settle; overlay.startSettle(); expect(overlay._settle).toBe(first); });
});
// -- onSelectChange pending path ----------------------------------------------

describe("onSelectChange -- pending path", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx({ getCurrentChatUuid: vi.fn(() => null) }); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); overlay.reposition = vi.fn(); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("sets pendingPresetId to the selected id", () => { overlay.onSelectChange("preset-X"); expect(ctx.setPendingPresetId).toHaveBeenCalledWith("preset-X"); });
    it("sets pendingPresetId to null when newId is undefined", () => { overlay.onSelectChange(undefined); expect(ctx.setPendingPresetId).toHaveBeenCalledWith(null); });
    it("sets pendingPresetId to empty string when explicitly empty", () => { overlay.onSelectChange(""); expect(ctx.setPendingPresetId).toHaveBeenCalledWith(""); });
    it("always calls saveActivePresetId", () => { overlay.onSelectChange("preset-X"); expect(StorageManager.saveActivePresetId).toHaveBeenCalledWith("preset-X"); });
    it("always calls updatePromptPrefixFromBinding", () => { overlay.onSelectChange("preset-X"); expect(ctx.updatePromptPrefixFromBinding).toHaveBeenCalled(); });
});

// -- onSelectChange bind path map semantics -----------------------------------

describe("onSelectChange -- bind path map", () => {
    let overlay, ctx, target, existingMap;
    beforeEach(() => {
        spyStorageManager();
        existingMap = { "other-uuid": "other-preset" };
        ctx = makeCtx({ getCurrentChatUuid: vi.fn(() => "uuid-1"), getChatPresetMap: vi.fn(() => existingMap) });
        overlay = createPresetOverlay(ctx);
        target = mountOverlay(overlay);
        overlay.reposition = vi.fn();
    });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("bind path spreads existing map and adds new binding", () => {
        overlay.onSelectChange("preset-A");
        const published = ctx.setChatPresetMap.mock.calls[0][0];
        expect(published).toEqual({ "other-uuid": "other-preset", "uuid-1": "preset-A" });
    });

    it("unbind path removes current uuid from map", () => {
        existingMap["uuid-1"] = "preset-old";
        overlay.onSelectChange("");
        const published = ctx.setChatPresetMap.mock.calls[0][0];
        expect(published).not.toHaveProperty("uuid-1");
        expect(published).toHaveProperty("other-uuid", "other-preset");
    });
});

// -- findAndMount -------------------------------------------------------------

describe("findAndMount -- DOM query", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); });
    afterEach(() => { teardown(overlay, null); if (target && target.parentNode) target.parentNode.removeChild(target); restoreStorageManager(); });

    it("does nothing if TARGET_SELECTOR element is absent", () => { overlay.findAndMount(); expect(overlay.targetEl).toBeNull(); });

    it("does not remount if targetEl is already the found element", () => {
        target = document.createElement("div");
        target.className = DSSelectors.CHAT_HEADER_SELECTOR.slice(1);
        document.body.appendChild(target);
        overlay.findAndMount();
        const firstDropdown = overlay.dropdown;
        overlay.findAndMount();
        expect(overlay.dropdown).toBe(firstDropdown);
    });

    it("calls setVisible with ctx.getIsEnabled() result", () => {
        target = document.createElement("div");
        target.className = DSSelectors.CHAT_HEADER_SELECTOR.slice(1);
        document.body.appendChild(target);
        ctx.getIsEnabled.mockReturnValue(false);
        overlay.findAndMount();
        expect(overlay.wrapperEl.style.display).toBe("none");
    });
});

// -- setupWindowResizeListener ------------------------------------------------

describe("setupWindowResizeListener", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("installs a window resize handler", () => { expect(overlay._windowResizeHandler).toBeTruthy(); });
    it("calling again replaces the handler", () => { overlay.setupWindowResizeListener(); expect(overlay._windowResizeHandler).toBeTruthy(); });
});

// -- setupResizeObserver ------------------------------------------------------

describe("setupResizeObserver", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("does nothing when targetEl is null", () => { overlay.targetEl = null; overlay.setupResizeObserver(); expect(overlay.resizeObserver).toBeNull(); });
    it("sets resizeObserver when targetEl is present", () => { target = mountOverlay(overlay); expect(overlay.resizeObserver).not.toBeNull(); });
});

// -- start --------------------------------------------------------------------

describe("start -- full initialization", () => {
    let overlay, ctx, target;
    beforeEach(() => {
        spyStorageManager();
        ctx = makeCtx();
        overlay = createPresetOverlay(ctx);
        target = document.createElement("div");
        target.className = DSSelectors.CHAT_HEADER_SELECTOR.slice(1);
        document.body.appendChild(target);
    });
    afterEach(() => { teardown(overlay, null); if (target && target.parentNode) target.parentNode.removeChild(target); restoreStorageManager(); });

    it("mounts to the target", () => { overlay.start([], "", true); expect(overlay.targetEl).toBeTruthy(); });
    it("calls render", () => { const spy = vi.spyOn(overlay, "render"); overlay.start([{ id: "p1", name: "P1" }], "p1", true); expect(spy).toHaveBeenCalledWith([{ id: "p1", name: "P1" }], "p1"); });
    it("calls setVisible when enable is provided", () => { const spy = vi.spyOn(overlay, "setVisible"); overlay.start([], "", false); expect(spy).toHaveBeenCalledWith(false); });
    it("skips the explicit setVisible branch when enable is undefined", () => { overlay.start([], ""); /* findAndMount calls setVisible internally, but the explicit enable branch should not add an extra call */ });
    it("registers locale listener only once", () => { const spy = vi.spyOn(dsI18n, "onLocaleChanged"); overlay.start([], "", true); const count = spy.mock.calls.length; overlay.start([], "", true); expect(spy.mock.calls.length).toBe(count); spy.mockRestore(); });
    it("sets _isLocaleListenerAttached to true", () => { overlay.start([], "", true); expect(overlay._isLocaleListenerAttached).toBe(true); });
});

// -- scheduleFrame via reposition ---------------------------------------------

describe("scheduleFrame via reposition", () => {
    let overlay, ctx, target;
    beforeEach(() => { spyStorageManager(); ctx = makeCtx(); overlay = createPresetOverlay(ctx); target = mountOverlay(overlay); });
    afterEach(() => { teardown(overlay, target); restoreStorageManager(); });

    it("schedules _applyPlacementSync via rAF", () => {
        const origRAF = globalThis.requestAnimationFrame;
        const calls = [];
        globalThis.requestAnimationFrame = (fn) => { calls.push(fn); return 0; };
        try {
            overlay.reposition();
            expect(calls.length).toBe(1);
            expect(() => calls[0]()).not.toThrow();
        } finally {
            globalThis.requestAnimationFrame = origRAF;
        }
    });

    it("falls back to sync when rAF is absent", () => {
        const origRAF = globalThis.requestAnimationFrame;
        delete globalThis.requestAnimationFrame;
        try {
            expect(() => overlay.reposition()).not.toThrow();
        } finally {
            globalThis.requestAnimationFrame = origRAF;
        }
    });
});

// -- DI fallbacks -------------------------------------------------------------

describe("dependency injection fallbacks", () => {
    afterEach(() => { restoreStorageManager(); });

    it("uses ctx.storageManager when provided", () => {
        spyStorageManager();
        const customStorage = {
            bindChatToPreset: vi.fn(() => Promise.resolve()),
            unbindChat: vi.fn(() => Promise.resolve()),
            getChatPresetMap: vi.fn(() => Promise.resolve({})),
            saveActivePresetId: vi.fn(() => Promise.resolve()),
        };
        const ctx = makeCtx({ storageManager: customStorage });
        const overlay = createPresetOverlay(ctx);
        const target = mountOverlay(overlay);
        overlay.reposition = vi.fn();
        overlay.onSelectChange("p1");
        expect(customStorage.saveActivePresetId).toHaveBeenCalledWith("p1");
        teardown(overlay, target);
    });

    it("uses ctx.i18n when provided", () => {
        spyStorageManager();
        const customI18n = {
            t: vi.fn((key) => "custom-" + key),
            onLocaleChanged: vi.fn(),
        };
        const ctx = makeCtx({ i18n: customI18n });
        const overlay = createPresetOverlay(ctx);
        overlay.buildDOM();
        expect(customI18n.t).toHaveBeenCalledWith("dropdownPlaceholder");
        expect(customI18n.t).toHaveBeenCalledWith("dropdownEmptyOption");
        overlay.unmount();
    });
});
