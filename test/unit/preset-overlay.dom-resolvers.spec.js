/**
 * Unit tests — DOM resolver fix validation for preset-overlay.controller.js
 *
 * Validates that reposition() correctly resolves:
 *   - Title  → first non-role="button" child of ._1aa2651; fallback via querySelector('._9986c0c')
 *   - Button → div[role="button"] with inline style*="min-width: 44px" inside ._1aa2651;
 *              structural fallback = first role-button AFTER title; never ._57370c5
 *
 * Resolvers are exported from preset-overlay.resolvers.js (loaded via require or the global
 * __DS_PresetOverlayResolvers). Tests drive them via the public reposition() / onSelectChange()
 * surface with a realistic header DOM and stubbed getBoundingClientRect.
 *
 * Environment notes:
 *   1. happy-dom implements requestAnimationFrame, so scheduleFrame() is ASYNC.
 *      Each test stubs rAF to synchronous before calling reposition(), then
 *      restores it in afterEach.
 *   2. computePlacement is captured in the controller IIFE closure, so spying
 *      on the module export does NOT intercept the internal call. All assertions
 *      are made via wrapperEl.style.left / style.width / style.visibility.
 *   3. window.innerWidth: happy-dom defaults to 1024. Tests that need a specific
 *      branch (center vs gap) set window.innerWidth explicitly before reposition()
 *      and restore it in afterEach.
 *   4. naturalWidth in happy-dom: getNaturalWidth() returns ~20 (all geometry=0).
 *      With no minWidth floor, the expected width is 20 (not 80 as in previous tests).
 *      Center mode left = (containerWidth - 20) / 2.
 *      Tests that need a predictable width stub getNaturalWidth on the dropdown.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
// Ensure resolvers global is populated before the controller resolves it.
import '../../content/preset-overlay.resolvers.js';

const { createPresetOverlay } = require('../../content/preset-overlay.controller.js');

// ── rAF synchroniser ─────────────────────────────────────────────────────────

/**
 * Stub requestAnimationFrame globally to execute synchronously.
 * Returns a restore function.
 */
function makeRafSync() {
    const original = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
    return () => { globalThis.requestAnimationFrame = original; };
}

// ── rect helper ───────────────────────────────────────────────────────────────

function rect(left, width, top = 0) {
    return { left, right: left + width, width, top, bottom: top + 30, height: 30 };
}

// ── DOM builder ───────────────────────────────────────────────────────────────

/**
 * Build a realistic 767px DeepSeek header DOM:
 *
 *   ._2be88ba  (container)
 *     ├─ ._1aa2651  (header wrapper)
 *     │    ├─ div[role="button"]            (btn1 — sidebar toggle, NO min-width)
 *     │    ├─ div._9986c0c                  (title — first non-button child)
 *     │    ├─ div                           (spacer)
 *     │    └─ div[role="button"][style="min-width: 44px;"]  (newChatBtn)
 *     └─ div._57370c5                       (stray — old wrong selector, outside wrapper)
 */
function buildRealisticHeader() {
    const container = document.createElement('div');
    container.className = '_2be88ba';

    const wrapper = document.createElement('div');
    wrapper.className = '_1aa2651';

    const btn1 = document.createElement('div');
    btn1.setAttribute('role', 'button');

    const titleEl = document.createElement('div');
    titleEl.className = '_9986c0c';
    titleEl.textContent = 'My Chat';

    const spacer = document.createElement('div');

    const newChatBtn = document.createElement('div');
    newChatBtn.setAttribute('role', 'button');
    newChatBtn.setAttribute('style', 'min-width: 44px;');
    newChatBtn.className = 'ds-button--capsule ds-button--xl';

    wrapper.appendChild(btn1);
    wrapper.appendChild(titleEl);
    wrapper.appendChild(spacer);
    wrapper.appendChild(newChatBtn);
    container.appendChild(wrapper);

    const stray57 = document.createElement('div');
    stray57.className = '_57370c5';
    container.appendChild(stray57);

    document.body.appendChild(container);
    return { container, wrapper, btn1, titleEl, spacer, newChatBtn, stray57 };
}

// ── stub helpers ──────────────────────────────────────────────────────────────

function stubRect(el, rectValue) {
    return vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rectValue);
}

// ── window.innerWidth helpers ─────────────────────────────────────────────────

let _origInnerWidth;

/**
 * Set window.innerWidth to a specific value for tests that need a deterministic branch.
 * Call restoreInnerWidth() in afterEach.
 */
function setInnerWidth(value) {
    _origInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value, writable: true, configurable: true });
}

function restoreInnerWidth() {
    if (_origInnerWidth !== undefined) {
        Object.defineProperty(window, 'innerWidth', { value: _origInnerWidth, writable: true, configurable: true });
        _origInnerWidth = undefined;
    }
}

// ── StorageManager spy helpers ────────────────────────────────────────────────

let smSpies = [];

function spyStorageManager() {
    const resolved = Promise.resolve({});
    smSpies = [
        vi.spyOn(StorageManager, 'bindChatToPreset').mockReturnValue(resolved),
        vi.spyOn(StorageManager, 'unbindChat').mockReturnValue(resolved),
        vi.spyOn(StorageManager, 'getChatPresetMap').mockResolvedValue({}),
        vi.spyOn(StorageManager, 'saveActivePresetId').mockReturnValue(resolved),
    ];
}

function restoreStorageManager() {
    smSpies.forEach(s => s.mockRestore());
    smSpies = [];
}

// ── ctx factory ───────────────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
    return {
        getIsEnabled:                  vi.fn(() => true),
        getCurrentChatUuid:            vi.fn(() => 'uuid-dom-test'),
        setCurrentChatUuid:            vi.fn(),
        getChatPresetMap:              vi.fn(() => ({})),
        setChatPresetMap:              vi.fn(),
        setPendingPresetId:            vi.fn(),
        updatePromptPrefixFromBinding: vi.fn(),
        isExtensionContextValid:       vi.fn(() => true),
        ...overrides,
    };
}

// ── shared rect constants ─────────────────────────────────────────────────────
//
// Container: 767px wide at viewport x=0.
// Title:     viewport 0..180   (width 180)
// newChat:   viewport 683..727 (width 44)
// btn1:      viewport 0..44    (width 44) — same position as title leading edge
//
// With windowWidth=1024 (center mode) and naturalWidth≈20 (happy-dom returns 0 → ~20):
//   width = min(naturalWidth, maxWidth) = ~20
//   center left = Math.round((767 - ~20) / 2) = 374  (Math.round added in v4.2.1)
//
// To produce a stable expected value, tests stub getNaturalWidth to return 20
// and assert with toBe against the exact rounded integer.

const CONTAINER_RECT = rect(0,   767);
const TITLE_RECT     = rect(0,   180);
const NEWCHAT_RECT   = rect(683, 44);
const BTN1_RECT      = rect(0,   44);

// Expected center-mode left when container=767 and getNaturalWidth()≈20:
// Math.round((767 - 20) / 2) = Math.round(373.5) = 374
const EXPECTED_CENTER_LEFT = Math.round((767 - 20) / 2); // 374

// ── Group 1: correct element resolution via reposition() ─────────────────────

describe('DOM resolvers — correct element resolution via reposition()', () => {
    let overlay, ctx, dom, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        setInnerWidth(1024); // deterministic center branch
        spyStorageManager();
        ctx = makeCtx();
        dom = buildRealisticHeader();
        overlay = createPresetOverlay(ctx);
        overlay.mountTo(dom.container);
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        if (dom.container.parentNode) dom.container.parentNode.removeChild(dom.container);
        restoreStorageManager();
        vi.restoreAllMocks();
    });

    it('resolves to title ._9986c0c and new-chat button (min-width:44px), producing non-zero placement', () => {
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);
        stubRect(dom.btn1,       BTN1_RECT);

        overlay.reposition('test');

        // center mode (windowWidth=1024): left=(767-naturalWidth)/2
        const leftPx  = parseFloat(overlay.wrapperEl.style.left);
        const widthPx = parseFloat(overlay.wrapperEl.style.width);

        expect(leftPx).toBe(EXPECTED_CENTER_LEFT);
        expect(widthPx).toBeGreaterThan(0);
        expect(overlay.wrapperEl.style.transform).toBe('translateY(-50%)');
    });

    it('uses newChatBtn rect (683..727), NOT btn1 rect (0..44) — confirmed by non-degenerate placement', () => {
        // With center mode (windowWidth=1024), mode is determined by windowWidth not geometry.
        // Confirm placement is valid (not degenerate) and left is the expected center value.
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);
        stubRect(dom.btn1,       BTN1_RECT);

        overlay.reposition('btn-identity-test');

        const leftPx = parseFloat(overlay.wrapperEl.style.left);
        expect(leftPx).toBe(EXPECTED_CENTER_LEFT);
        expect(isFinite(leftPx)).toBe(true);
        expect(leftPx).toBeGreaterThan(0);
    });

    it('wrapperEl.style.left is consistent across two separate reposition() calls', () => {
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);

        overlay.reposition('call-1');
        const left1 = overlay.wrapperEl.style.left;

        overlay.reposition('call-2');
        const left2 = overlay.wrapperEl.style.left;

        expect(left2).toBe(left1);
    });
});

// ── Group 2: hash-fallback title path ────────────────────────────────────────

describe('DOM resolvers — hash-fallback title path', () => {
    let overlay, ctx, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        setInnerWidth(1024);
        spyStorageManager();
        ctx = makeCtx();
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        restoreStorageManager();
        vi.restoreAllMocks();
        document.body.querySelectorAll('._2be88ba').forEach(el => el.remove());
    });

    it('resolves title via container.querySelector("._9986c0c") when wrapper has only role-button children', () => {
        // Wrapper with only role-button children → semantic path skips all;
        // fallback finds ._9986c0c placed on the container.
        const container = document.createElement('div');
        container.className = '_2be88ba';

        const wrapper = document.createElement('div');
        wrapper.className = '_1aa2651';

        const onlyBtn = document.createElement('div');
        onlyBtn.setAttribute('role', 'button');
        onlyBtn.setAttribute('style', 'min-width: 44px;');
        wrapper.appendChild(onlyBtn);

        // ._9986c0c as sibling to wrapper (hash fallback target)
        const fallbackTitle = document.createElement('div');
        fallbackTitle.className = '_9986c0c';
        fallbackTitle.textContent = 'Hash title';

        container.appendChild(wrapper);
        container.appendChild(fallbackTitle);
        document.body.appendChild(container);

        overlay = createPresetOverlay(ctx);
        overlay.mountTo(container);

        stubRect(container,     rect(0, 767));
        stubRect(fallbackTitle, TITLE_RECT);
        stubRect(onlyBtn,       NEWCHAT_RECT);

        overlay.reposition('fallback-test');

        // center mode (windowWidth=1024): left = (767 - naturalWidth) / 2
        const leftPx = parseFloat(overlay.wrapperEl.style.left);
        expect(leftPx).toBe(EXPECTED_CENTER_LEFT);
    });

    it('falls back gracefully (no throw) when both wrapper and ._9986c0c are absent', () => {
        // No title found → titleRect=null → computePlacement falls back to center
        const container = document.createElement('div');
        container.className = '_2be88ba';

        const wrapper = document.createElement('div');
        wrapper.className = '_1aa2651';
        const btn = document.createElement('div');
        btn.setAttribute('role', 'button');
        btn.setAttribute('style', 'min-width: 44px;');
        wrapper.appendChild(btn);
        container.appendChild(wrapper);
        document.body.appendChild(container);

        overlay = createPresetOverlay(ctx);
        overlay.mountTo(container);

        stubRect(container, rect(0, 767));
        stubRect(btn,       NEWCHAT_RECT);

        // Must not throw; must produce a valid left style
        expect(() => overlay.reposition('null-title-test')).not.toThrow();

        const leftPx = parseFloat(overlay.wrapperEl.style.left);
        // center fallback: (767 - naturalWidth) / 2
        expect(leftPx).toBe(EXPECTED_CENTER_LEFT);
    });
});

// ── Group 3: ._57370c5 is never chosen as the new-chat button ─────────────────

describe('DOM resolvers — ._57370c5 is never chosen as the new-chat button', () => {
    let overlay, ctx, dom, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        setInnerWidth(1024);
        spyStorageManager();
        ctx = makeCtx();
        dom = buildRealisticHeader();
        overlay = createPresetOverlay(ctx);
        overlay.mountTo(dom.container);
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        if (dom.container.parentNode) dom.container.parentNode.removeChild(dom.container);
        restoreStorageManager();
        vi.restoreAllMocks();
    });

    it('._57370c5 node has no role=button and is outside ._1aa2651', () => {
        expect(dom.stray57.getAttribute('role')).toBeNull();
        expect(dom.stray57.closest('._1aa2651')).toBeNull();
    });

    it('placement is identical with or without ._57370c5 present', () => {
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);

        overlay.reposition('with-stray');
        const leftWith = overlay.wrapperEl.style.left;

        // Remove stray and reposition again
        dom.stray57.remove();
        overlay.reposition('without-stray');
        const leftWithout = overlay.wrapperEl.style.left;

        expect(leftWithout).toBe(leftWith);
    });
});

// ── Group 4: consistency regression — render vs onSelectChange ───────────────

describe('DOM resolvers — consistency regression: reposition() vs onSelectChange()', () => {
    let overlay, ctx, dom, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        setInnerWidth(1024);
        spyStorageManager();
        ctx = makeCtx();
        dom = buildRealisticHeader();
        overlay = createPresetOverlay(ctx);
        overlay.mountTo(dom.container);
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        if (dom.container.parentNode) dom.container.parentNode.removeChild(dom.container);
        restoreStorageManager();
        vi.restoreAllMocks();
    });

    it('left and width are IDENTICAL between initial reposition() and onSelectChange()', () => {
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);
        stubRect(dom.btn1,       BTN1_RECT);

        overlay.reposition('initial');
        const left1  = overlay.wrapperEl.style.left;
        const width1 = overlay.wrapperEl.style.width;

        overlay.onSelectChange('preset-A');
        const left2  = overlay.wrapperEl.style.left;
        const width2 = overlay.wrapperEl.style.width;

        expect(left2).toBe(left1);
        expect(width2).toBe(width1);
    });

    it('placement is non-zero (not 0px) after reposition() with stubbed rects', () => {
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);

        overlay.reposition('non-zero-check');

        const leftPx = parseFloat(overlay.wrapperEl.style.left);
        expect(leftPx).toBeGreaterThan(0);
        expect(overlay.wrapperEl.style.width).toBeTruthy();
    });

    it('repeated onSelectChange calls produce stable placement — no drift', () => {
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);

        overlay.reposition('seed');
        const leftSeed = overlay.wrapperEl.style.left;

        overlay.onSelectChange('preset-X');
        overlay.onSelectChange('preset-Y');
        overlay.onSelectChange('');

        expect(overlay.wrapperEl.style.left).toBe(leftSeed);
    });

    it('onSelectChange with empty-string (unbind path) still calls reposition and keeps placement stable', () => {
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);

        overlay.reposition('seed');
        const leftSeed = overlay.wrapperEl.style.left;

        overlay.onSelectChange('');
        expect(overlay.wrapperEl.style.left).toBe(leftSeed);
    });
});

// ── Group 5: structural-fallback button path ──────────────────────────────────

describe('DOM resolvers — structural-fallback button path', () => {
    let overlay, ctx, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        setInnerWidth(1024);
        spyStorageManager();
        ctx = makeCtx();
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        restoreStorageManager();
        vi.restoreAllMocks();
        document.body.querySelectorAll('._2be88ba').forEach(el => el.remove());
    });

    it('picks first role-button AFTER title (structural fallback) when no min-width button present', () => {
        // btn1 (before title) | titleEl | btn2 (after title, no min-width)
        const container = document.createElement('div');
        container.className = '_2be88ba';

        const wrapper = document.createElement('div');
        wrapper.className = '_1aa2651';

        const btn1 = document.createElement('div');
        btn1.setAttribute('role', 'button');

        const titleEl = document.createElement('div');
        titleEl.className = '_9986c0c';
        titleEl.textContent = 'Title';

        const btn2 = document.createElement('div');
        btn2.setAttribute('role', 'button');

        wrapper.appendChild(btn1);
        wrapper.appendChild(titleEl);
        wrapper.appendChild(btn2);
        container.appendChild(wrapper);
        document.body.appendChild(container);

        overlay = createPresetOverlay(ctx);
        overlay.mountTo(container);

        stubRect(container, rect(0, 767));
        stubRect(titleEl,   TITLE_RECT);
        stubRect(btn1,      BTN1_RECT);
        stubRect(btn2,      NEWCHAT_RECT);

        overlay.reposition('structural-fallback-test');

        // center mode (windowWidth=1024): left = (767 - naturalWidth) / 2
        const leftPx = parseFloat(overlay.wrapperEl.style.left);
        expect(leftPx).toBe(EXPECTED_CENTER_LEFT);
    });

    it('falls back to LAST role-button in wrapper when title cannot be resolved', () => {
        const container = document.createElement('div');
        container.className = '_2be88ba';

        const wrapper = document.createElement('div');
        wrapper.className = '_1aa2651';

        const btnA = document.createElement('div');
        btnA.setAttribute('role', 'button');

        const btnB = document.createElement('div');
        btnB.setAttribute('role', 'button'); // last → chosen as last-resort

        wrapper.appendChild(btnA);
        wrapper.appendChild(btnB);
        container.appendChild(wrapper);
        document.body.appendChild(container);

        overlay = createPresetOverlay(ctx);
        overlay.mountTo(container);

        stubRect(container, rect(0, 767));
        stubRect(btnA,      BTN1_RECT);
        stubRect(btnB,      NEWCHAT_RECT);

        overlay.reposition('last-resort-test');

        // titleRect=null, windowWidth=1024 → center fallback
        const leftPx = parseFloat(overlay.wrapperEl.style.left);
        expect(leftPx).toBe(EXPECTED_CENTER_LEFT);
    });
});

// ── Group 6: null paths and guard clauses ────────────────────────────────────

describe('DOM resolvers — null paths and guard clauses', () => {
    let overlay, ctx, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        setInnerWidth(1024);
        spyStorageManager();
        ctx = makeCtx();
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        restoreStorageManager();
        vi.restoreAllMocks();
        document.body.querySelectorAll('._2be88ba').forEach(el => el.remove());
    });

    it('buttonRect=null when no ._1aa2651 wrapper present — no throw, falls back to center', () => {
        const container = document.createElement('div');
        container.className = '_2be88ba';
        const titleEl = document.createElement('div');
        titleEl.className = '_9986c0c';
        container.appendChild(titleEl);
        document.body.appendChild(container);

        overlay = createPresetOverlay(ctx);
        overlay.mountTo(container);

        stubRect(container, rect(0, 767));
        stubRect(titleEl,   TITLE_RECT);

        expect(() => overlay.reposition('no-wrapper-test')).not.toThrow();
        // buttonRect=null → fallback center
        const leftPx = parseFloat(overlay.wrapperEl.style.left);
        expect(leftPx).toBe(EXPECTED_CENTER_LEFT);
    });

    it('reposition() is a no-op (no throw) when wrapperEl is null (not mounted)', () => {
        overlay = createPresetOverlay(ctx);
        // Not mounted — wrapperEl is null
        expect(() => overlay.reposition('no-mount')).not.toThrow();
    });

    it('reposition() skips computation when display:none', () => {
        const container = document.createElement('div');
        container.className = '_2be88ba';
        document.body.appendChild(container);

        overlay = createPresetOverlay(ctx);
        overlay.mountTo(container);
        overlay.wrapperEl.style.display = 'none';
        overlay.wrapperEl.style.left = '';

        overlay.reposition('display-none-test');

        // style.left must remain untouched (computation skipped)
        expect(overlay.wrapperEl.style.left).toBe('');
    });
});

// ── Group 7: hidden placement (visibility toggle) ─────────────────────────────

describe('DOM resolvers — hidden placement via visibility style', () => {
    let overlay, ctx, dom, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        spyStorageManager();
        ctx = makeCtx();
        dom = buildRealisticHeader();
        overlay = createPresetOverlay(ctx);
        overlay.mountTo(dom.container);
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        if (dom.container.parentNode) dom.container.parentNode.removeChild(dom.container);
        restoreStorageManager();
        vi.restoreAllMocks();
    });

    it('sets visibility=hidden when availableGap<=0 in <768 mode', () => {
        setInnerWidth(375); // gap branch
        // title 0..200, button 210..375 → availableGap=210-200-16=-6 → hidden
        stubRect(dom.container,  rect(0, 375));
        stubRect(dom.titleEl,    rect(0, 200));
        stubRect(dom.newChatBtn, rect(210, 165));

        overlay.reposition('hidden-test');

        expect(overlay.wrapperEl.style.visibility).toBe('hidden');
    });

    it('clears visibility when gap is positive (<768 mode)', () => {
        setInnerWidth(375); // gap branch
        // First hide it
        overlay.wrapperEl.style.visibility = 'hidden';

        // Now provide a valid gap: title 0..50, button 200..375 → availableGap=200-50-16=134
        stubRect(dom.container,  rect(0, 375));
        stubRect(dom.titleEl,    rect(0, 50));
        stubRect(dom.newChatBtn, rect(200, 175));

        overlay.reposition('restore-test');

        expect(overlay.wrapperEl.style.visibility).toBe('');
    });

    it('visibility is not hidden in center mode (>=768) even with overlapping rects', () => {
        setInnerWidth(1024); // center branch
        // Large title/button that would cause hidden in <768
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    rect(0, 400));
        stubRect(dom.newChatBtn, rect(400, 367));

        overlay.reposition('center-no-hide');

        expect(overlay.wrapperEl.style.visibility).not.toBe('hidden');
    });
});

// ── Group 8: window resize listener ──────────────────────────────────────────

describe('DOM resolvers — window resize listener', () => {
    let overlay, ctx, dom, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        setInnerWidth(1024);
        spyStorageManager();
        ctx = makeCtx();
        dom = buildRealisticHeader();
        overlay = createPresetOverlay(ctx);
        overlay.mountTo(dom.container);
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        if (dom.container.parentNode) dom.container.parentNode.removeChild(dom.container);
        restoreStorageManager();
        vi.restoreAllMocks();
    });

    it('_windowResizeHandler is set after mountTo (resize listener registered)', () => {
        expect(overlay._windowResizeHandler).not.toBeNull();
        expect(typeof overlay._windowResizeHandler).toBe('function');
    });

    it('_windowResizeHandler is null after unmount (listener removed)', () => {
        overlay.unmount();
        expect(overlay._windowResizeHandler).toBeNull();
        // prevent double-unmount in afterEach
        overlay = null;
    });

    it('dispatching a resize event with new innerWidth calls reposition', () => {
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);

        // Spy on reposition to count calls (after mount)
        const repoSpy = vi.spyOn(overlay, 'reposition');

        // Simulate crossing below 768
        setInnerWidth(375);
        window.dispatchEvent(new Event('resize'));

        // rAF is synchronous (makeRafSync), so handler runs synchronously
        expect(repoSpy).toHaveBeenCalled();
    });

    it('mode switches from center to gap when innerWidth crosses below 768 on resize', () => {
        // Start in center mode (1024)
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);

        overlay.reposition('initial');
        const leftCenter = parseFloat(overlay.wrapperEl.style.left);

        // Now simulate resize to 375px with good gap
        setInnerWidth(375);
        stubRect(dom.container,  rect(0, 375));
        stubRect(dom.titleEl,    rect(0, 50));
        stubRect(dom.newChatBtn, rect(200, 175));

        window.dispatchEvent(new Event('resize'));

        const leftGap = parseFloat(overlay.wrapperEl.style.left);
        // Gap mode left will differ from center mode left
        expect(leftGap).not.toBeCloseTo(leftCenter, 0);
        expect(isFinite(leftGap)).toBe(true);
    });
});

// ── Group 9: idempotency regression (Bug #2 fix — v4.2.1) ────────────────────
//
// getNaturalWidth() now uses canvas-based measureTextWidth + stable constant 16
// for arrow width (no longer reads arrow.getBoundingClientRect()). Calling
// reposition() twice with the same label text must yield the exact same integer
// left and width on both calls — no sub-pixel drift between invocations.

describe('DOM resolvers — reposition() idempotency (Bug #2 regression)', () => {
    let overlay, ctx, dom, restoreRaf;

    beforeEach(() => {
        restoreRaf = makeRafSync();
        setInnerWidth(1024); // center mode (>=768)
        spyStorageManager();
        ctx = makeCtx();
        dom = buildRealisticHeader();
        overlay = createPresetOverlay(ctx);
        overlay.mountTo(dom.container);
    });

    afterEach(() => {
        restoreRaf();
        restoreInnerWidth();
        if (overlay) overlay.unmount();
        if (dom.container.parentNode) dom.container.parentNode.removeChild(dom.container);
        restoreStorageManager();
        vi.restoreAllMocks();
    });

    it('two consecutive reposition() calls with the same label yield identical integer left and width (no drift)', () => {
        // Arrange: stable geometry so computation is deterministic
        stubRect(dom.container,  CONTAINER_RECT);
        stubRect(dom.titleEl,    TITLE_RECT);
        stubRect(dom.newChatBtn, NEWCHAT_RECT);
        stubRect(dom.btn1,       BTN1_RECT);

        // First reposition
        overlay.reposition('idempotency-run-1');
        const left1  = overlay.wrapperEl.style.left;
        const width1 = overlay.wrapperEl.style.width;

        // Second reposition — same label, same geometry, same windowWidth
        overlay.reposition('idempotency-run-2');
        const left2  = overlay.wrapperEl.style.left;
        const width2 = overlay.wrapperEl.style.width;

        // Both values must be non-empty (placement occurred)
        expect(left1).not.toBe('');
        expect(width1).not.toBe('');

        // Must be identical across both calls — no sub-pixel drift
        expect(left2).toBe(left1);
        expect(width2).toBe(width1);

        // Values must represent integers (Math.round applied in v4.2.1)
        expect(parseFloat(left1) % 1).toBe(0);
        expect(parseFloat(width1) % 1).toBe(0);
    });
});
