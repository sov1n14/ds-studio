import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../../utils/storage-manager.js";
const { createPresetOverlay } = require("../../content/preset-overlay.controller.js");

function makeCtx(overrides = {}) {
    return {
        getIsEnabled: vi.fn(() => true),
        getCurrentChatUuid: vi.fn(() => "uuid-1"),
        setCurrentChatUuid: vi.fn(),
        getChatPresetMap: vi.fn(() => ({})),
        setChatPresetMap: vi.fn(),
        getPendingPresetId: vi.fn(() => undefined),
        setPendingPresetId: vi.fn(),
        updatePromptPrefixFromBinding: vi.fn(),
        isExtensionContextValid: vi.fn(() => true),
        ...overrides,
    };
}

let smSpies = [];
function spySM() {
    const r = Promise.resolve({});
    smSpies = [
        vi.spyOn(StorageManager, "bindChatToPreset").mockReturnValue(r),
        vi.spyOn(StorageManager, "unbindChat").mockReturnValue(r),
        vi.spyOn(StorageManager, "getChatPresetMap").mockResolvedValue({}),
        vi.spyOn(StorageManager, "saveActivePresetId").mockReturnValue(r),
        vi.spyOn(StorageManager, "getSettings").mockResolvedValue({ promptPresets: [], pinnedPresetId: "" }),
    ];
}
function restoreSM() { smSpies.forEach(s => s.mockRestore()); smSpies = []; }
function mount(o) { const t = document.createElement("div"); document.body.appendChild(t); o.mountTo(t); return t; }
function td(o, t) { if (o) o.unmount(); if (t && t.parentNode) t.parentNode.removeChild(t); }
describe("unmount -- side effect calls", () => {
    let o, ctx, t;
    beforeEach(() => { spySM(); ctx = makeCtx(); o = createPresetOverlay(ctx); t = mount(o); });
    afterEach(() => { td(null, t); restoreSM(); });

    it("calls window.removeEventListener(resize) on unmount", () => {
        const removeSpy = vi.spyOn(window, "removeEventListener");
        const handler = o._windowResizeHandler;
        o.unmount();
        expect(removeSpy).toHaveBeenCalledWith("resize", handler);
        removeSpy.mockRestore();
    });

    it("calls dropdown.destroy", () => {
        const spy = vi.spyOn(o.dropdown, "destroy");
        o.unmount();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("calls resizeObserver.disconnect", () => {
        if (o.resizeObserver) {
            const spy = vi.spyOn(o.resizeObserver, "disconnect");
            o.unmount();
            expect(spy).toHaveBeenCalledTimes(1);
        } else { o.unmount(); }
    });
});

describe("mountTo -- setup method calls", () => {
    let o, ctx, t;
    beforeEach(() => { spySM(); ctx = makeCtx(); o = createPresetOverlay(ctx); });
    afterEach(() => { td(o, t); restoreSM(); });

    it("calls unmount", () => { const s = vi.spyOn(o, "unmount"); t = document.createElement("div"); document.body.appendChild(t); o.mountTo(t); expect(s).toHaveBeenCalled(); });
    it("calls startSettle", () => { const s = vi.spyOn(o, "startSettle"); t = document.createElement("div"); document.body.appendChild(t); o.mountTo(t); expect(s).toHaveBeenCalled(); });
    it("calls setupResizeObserver", () => { const s = vi.spyOn(o, "setupResizeObserver"); t = document.createElement("div"); document.body.appendChild(t); o.mountTo(t); expect(s).toHaveBeenCalled(); });
    it("calls setupWindowResizeListener", () => { const s = vi.spyOn(o, "setupWindowResizeListener"); t = document.createElement("div"); document.body.appendChild(t); o.mountTo(t); expect(s).toHaveBeenCalled(); });
});

describe("setupWindowResizeListener -- old handler removal", () => {
    let o, ctx, t, removeSpy;
    beforeEach(() => { spySM(); ctx = makeCtx(); o = createPresetOverlay(ctx); t = mount(o); removeSpy = vi.spyOn(window, "removeEventListener"); });
    afterEach(() => { td(o, t); removeSpy.mockRestore(); restoreSM(); });

    it("removes old handler before installing new", () => { const old = o._windowResizeHandler; o.setupWindowResizeListener(); expect(removeSpy).toHaveBeenCalledWith("resize", old); });
});

describe("startSettle -- settle object", () => {
    let o, ctx, t;
    beforeEach(() => { spySM(); ctx = makeCtx(); o = createPresetOverlay(ctx); });
    afterEach(() => { td(o, t); restoreSM(); });

    it("has a cancel method", () => { t = mount(o); expect(o._settle).not.toBeNull(); expect(typeof o._settle.cancel).toBe("function"); });
});

describe("start -- enable branching", () => {
    let o, ctx, t;
    beforeEach(() => { spySM(); ctx = makeCtx(); o = createPresetOverlay(ctx); t = document.createElement("div"); t.className = "_2be88ba"; document.body.appendChild(t); });
    afterEach(() => { td(o, null); if (t && t.parentNode) t.parentNode.removeChild(t); restoreSM(); });

    it("false hides", () => { o.start([], "", false); expect(o.wrapperEl.style.display).toBe("none"); });
    it("true shows", () => { o.start([], "", true); expect(o.wrapperEl.style.display).not.toBe("none"); });
});

describe("scheduleFrame -- rAF invocation", () => {
    let o, ctx, t;
    beforeEach(() => { spySM(); ctx = makeCtx(); o = createPresetOverlay(ctx); t = mount(o); });
    afterEach(() => { td(o, t); restoreSM(); });

    it("passes a function to rAF", () => {
        const orig = globalThis.requestAnimationFrame;
        let arg = null;
        globalThis.requestAnimationFrame = (fn) => { arg = fn; return 0; };
        try { o.reposition(); expect(typeof arg).toBe("function"); }
        finally { globalThis.requestAnimationFrame = orig; }
    });
});

describe("_applyPlacementSync -- sets styles", () => {
    let o, ctx, t;
    beforeEach(() => { spySM(); ctx = makeCtx(); o = createPresetOverlay(ctx); t = mount(o); });
    afterEach(() => { td(o, t); restoreSM(); });

    it("sets left or visibility", () => {
        o._applyPlacementSync();
        const left = o.wrapperEl.style.left;
        const vis = o.wrapperEl.style.visibility;
        expect(left || vis === "hidden").toBeTruthy();
    });
});

describe("onSelectChange -- storage error logging", () => {
    let o, ctx, t, errSpy;
    beforeEach(() => { spySM(); ctx = makeCtx(); o = createPresetOverlay(ctx); t = mount(o); o.reposition = vi.fn(); errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
    afterEach(() => { errSpy.mockRestore(); td(o, t); restoreSM(); });

    it("catches bindChatToPreset rejection with [DSS] log", async () => {
        StorageManager.bindChatToPreset.mockRejectedValue(new Error("fail"));
        StorageManager.getChatPresetMap.mockRejectedValue(new Error("fail"));
        o.onSelectChange("preset-A");
        await new Promise(r => setTimeout(r, 20));
        const dss = errSpy.mock.calls.filter(a => String(a[0]).includes("[DSS]"));
        expect(dss.length).toBeGreaterThan(0);
    });
});
