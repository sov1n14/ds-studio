/**
 * Unit tests — preset overlay DOM resolvers (preset-overlay.resolvers.js) and the placement that
 * reposition() derives from the elements they return.
 *
 * Fixtures are DeepSeek chat header containers captured verbatim from the live page, with chat titles
 * replaced by a placeholder (test/fixtures/ds-snapshots/):
 *   - conversation-header.html: desktop conversation page. Container children in DOM order:
 *       [0] centred title header (holds a second copy of the chat title)
 *       [1] title row: sidebar toggle button, chat title div, two spacer divs, new-chat button (last child)
 *       [2] share button (role="button", a direct child of the container, outside the title row)
 *   - home-header.html: desktop new-chat (home) page; same title row with an empty title div, no share button.
 *   - mobile-ua-home-header.html: mobile-UA home page; the title row also holds the download-app pill in a wrapper div.
 * Tests locate the expected elements by this captured position, never through the selectors under test.
 *
 * Required behaviour:
 *   - title: the chat title div of the title row (the div right after the sidebar toggle).
 *   - new-chat button: the last button of the title row; never the share button or the sidebar toggle.
 *   - no title row: both resolvers return { el: null, path: 'none' }.
 *
 * Placement assertions run in the < 768 px gap branch, where the result depends on which title and
 * button rects the controller reads; the >= 768 px center branch ignores both rects, so it cannot show
 * a wrong pick. Every decoy element gets its own rect, chosen so that reading it instead of the real
 * element produces a different left / visibility.
 *
 * Environment notes:
 *   1. happy-dom implements requestAnimationFrame, so scheduleFrame() is ASYNC. Each test stubs rAF to a
 *      synchronous trampoline before mounting and restores it in afterEach.
 *   2. computePlacement is captured in the controller IIFE closure, so assertions read
 *      wrapperEl.style.left / width / visibility instead of spying on it.
 *   3. Gap-branch tests stub dropdown.getNaturalWidth() to 80 so the expected left is exact.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import '../../content/ds-selectors.js';
// Ensure resolvers global is populated before the controller resolves it.
import '../../content/preset-overlay.resolvers.js';

const { resolveTitleEl, resolveNewChatButtonEl } = require('../../content/preset-overlay.resolvers.js');
const { createPresetOverlay } = require('../../content/preset-overlay.controller.js');

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/ds-snapshots');
const TITLE_PLACEHOLDER = 'Chat title placeholder';

// ── fixture loader ───────────────────────────────────────────────────────────

/** Mounts a captured header container as the only body child and returns its parts by captured position. */
function loadHeader(fileName) {
    document.body.innerHTML = fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8');
    const container = document.body.firstElementChild;
    const centredHeader = container.children[0];
    const titleRow = container.children[1];
    return {
        container,
        titleRow,
        centredTitle: centredHeader.firstElementChild,
        sidebarToggle: titleRow.children[0],
        titleEl: titleRow.children[1],
        newChatBtn: titleRow.lastElementChild,
        shareBtn: container.children[2] || null,
    };
}

// ── rAF synchroniser ─────────────────────────────────────────────────────────

/**
 * Stub requestAnimationFrame with a bounded trampoline: the settle loop reschedules itself every frame,
 * so callbacks are queued and drained iteratively (no stack growth) up to RAF_FLUSH_CAP iterations.
 * Returns a restore function.
 */
const RAF_FLUSH_CAP = 200;

function makeRafSync() {
    const original = globalThis.requestAnimationFrame;
    const queue = [];
    let flushing = false;

    globalThis.requestAnimationFrame = function (fn) {
        queue.push(fn);
        if (!flushing) {
            flushing = true;
            let ticks = 0;
            while (queue.length > 0 && ticks < RAF_FLUSH_CAP) {
                const cb = queue.shift();
                ticks++;
                cb();
            }
            flushing = false;
        }
        return 0;
    };

    return () => {
        globalThis.requestAnimationFrame = original;
    };
}

// ── rect / window helpers ────────────────────────────────────────────────────

function rect(left, width, top = 0) {
    return { left, right: left + width, width, top, bottom: top + 30, height: 30 };
}

function stubRect(el, rectValue) {
    return vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rectValue);
}

let _origInnerWidth;

function setInnerWidth(value) {
    if (_origInnerWidth === undefined) _origInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value, writable: true, configurable: true });
}

function restoreInnerWidth() {
    if (_origInnerWidth !== undefined) {
        Object.defineProperty(window, 'innerWidth', { value: _origInnerWidth, writable: true, configurable: true });
        _origInnerWidth = undefined;
    }
}

// ── StorageManager spies / ctx ───────────────────────────────────────────────

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

function makeCtx(overrides = {}) {
    return {
        getIsEnabled:                  vi.fn(() => true),
        getCurrentChatUuid:            vi.fn(() => 'uuid-dom-test'),
        getChatPresetMap:              vi.fn(() => ({})),
        setChatPresetMap:              vi.fn(),
        setPendingPresetId:            vi.fn(),
        updatePromptPrefixFromBinding: vi.fn(),
        isExtensionContextValid:       vi.fn(() => true),
        ...overrides,
    };
}

// ── gap-branch geometry (375 px viewport, natural width stubbed to 80) ────────
//
// Real elements:  title 48..148, new-chat button 323..367
//   availableGap = 323 - 148 - 2*8 = 159 → width = 80
//   left = round(148 + 8 + 159/2 - 0 - 80/2) = round(195.5) = 196
// Decoys, each producing a different left if read instead of the real element:
//   share button 281..315 as button      → gap 117 → left 175
//   centred title 100..275 as title      → gap 32  → left 283
//   sidebar toggle 4..48 as title        → gap 259 → left 146

const GAP_VIEWPORT = 375;
const NATURAL_WIDTH = 80;
const GAP_EXPECTED_LEFT = '196px';
const GAP_EXPECTED_WIDTH = '80px';

function applyGapGeometry(dom) {
    stubRect(dom.container,     rect(0, GAP_VIEWPORT));
    stubRect(dom.sidebarToggle, rect(4, 44));
    stubRect(dom.titleEl,       rect(48, 100));
    stubRect(dom.centredTitle,  rect(100, 175));
    stubRect(dom.newChatBtn,    rect(323, 44));
    if (dom.shareBtn) stubRect(dom.shareBtn, rect(281, 34));
}

/** Asserts the resolver returned this exact node (toBe: toEqual would accept any structurally equal node). */
function expectResolved(result, expectedEl) {
    expect(result.el).toBe(expectedEl);
    expect(result.path).toBe('semantic');
}

// ── Group 1: fixture sanity ──────────────────────────────────────────────────

describe('DOM resolvers — captured conversation header fixture', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('holds the title row parts and the share button outside the title row in captured order', () => {
        const dom = loadHeader('conversation-header.html');
        expect(dom.sidebarToggle.getAttribute('role')).toBe('button');
        expect(dom.titleEl.textContent.trim()).toBe(TITLE_PLACEHOLDER);
        expect(dom.centredTitle.textContent.trim()).toBe(TITLE_PLACEHOLDER);
        expect(dom.newChatBtn.getAttribute('role')).toBe('button');
        expect(dom.shareBtn.getAttribute('role')).toBe('button');
        expect(dom.titleRow.contains(dom.shareBtn)).toBe(false);
        expect(dom.container.lastElementChild).toBe(dom.shareBtn);
    });
});

// ── Group 2: resolveTitleEl ──────────────────────────────────────────────────

describe('resolveTitleEl — real header markup', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('conversation page: returns the title-row chat title, not the centred title copy', () => {
        const dom = loadHeader('conversation-header.html');
        const result = resolveTitleEl(dom.container);
        expect(result.el, 'resolver picked the centred title header copy').not.toBe(dom.centredTitle);
        expectResolved(result, dom.titleEl);
    });

    it('desktop new-chat page: returns the empty title div of the title row', () => {
        const dom = loadHeader('home-header.html');
        expectResolved(resolveTitleEl(dom.container), dom.titleEl);
    });

    it('mobile-UA home page: returns the empty title div of the title row', () => {
        const dom = loadHeader('mobile-ua-home-header.html');
        expectResolved(resolveTitleEl(dom.container), dom.titleEl);
    });

    it('returns { el: null, path: "none" } when the title row is absent', () => {
        const dom = loadHeader('conversation-header.html');
        dom.titleRow.remove();
        expect(resolveTitleEl(dom.container)).toEqual({ el: null, path: 'none' });
    });
});

// ── Group 3: resolveNewChatButtonEl ──────────────────────────────────────────
// The mobile-UA download-app pill case lives in preset-overlay.resolvers.real-markup.spec.js.

describe('resolveNewChatButtonEl — real header markup', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('conversation page: returns the last title-row button, not the share button or the sidebar toggle', () => {
        const dom = loadHeader('conversation-header.html');
        const result = resolveNewChatButtonEl(dom.container);
        expect(result.el, 'resolver picked the share button outside the title row').not.toBe(dom.shareBtn);
        expect(result.el, 'resolver picked the sidebar toggle').not.toBe(dom.sidebarToggle);
        expectResolved(result, dom.newChatBtn);
    });

    it('conversation page: still returns the new-chat button after it loses its inline style', () => {
        const dom = loadHeader('conversation-header.html');
        dom.newChatBtn.removeAttribute('style');
        expectResolved(resolveNewChatButtonEl(dom.container), dom.newChatBtn);
    });

    it('desktop new-chat page: returns the new-chat button', () => {
        const dom = loadHeader('home-header.html');
        expectResolved(resolveNewChatButtonEl(dom.container), dom.newChatBtn);
    });

    it('returns { el: null, path: "none" } when the title row is absent, even though the share button remains', () => {
        const dom = loadHeader('conversation-header.html');
        dom.titleRow.remove();
        expect(resolveNewChatButtonEl(dom.container)).toEqual({ el: null, path: 'none' });
    });

    it('returns { el: null, path: "none" } when the title row holds no button', () => {
        const dom = loadHeader('conversation-header.html');
        dom.sidebarToggle.remove();
        dom.newChatBtn.remove();
        expect(resolveNewChatButtonEl(dom.container)).toEqual({ el: null, path: 'none' });
    });
});

// ── shared overlay harness ───────────────────────────────────────────────────

/** Mounts an overlay on a captured header; returns handles plus a teardown. */
function setupOverlay(fileName, { viewport = GAP_VIEWPORT, stubNaturalWidth = true } = {}) {
    const restoreRaf = makeRafSync();
    setInnerWidth(viewport);
    spyStorageManager();
    const dom = loadHeader(fileName);
    const overlay = createPresetOverlay(makeCtx());
    overlay.mountTo(dom.container);
    if (stubNaturalWidth) vi.spyOn(overlay.dropdown, 'getNaturalWidth').mockReturnValue(NATURAL_WIDTH);
    const teardown = () => {
        restoreRaf();
        restoreInnerWidth();
        overlay.unmount();
        restoreStorageManager();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    };
    return { dom, overlay, teardown };
}

// ── Group 4: gap-branch placement uses the resolved elements ──────────────────

describe('DOM resolvers — gap-branch placement via reposition()', () => {
    let h;
    afterEach(() => h.teardown());

    it('places the overlay in the gap between the title-row title and the new-chat button', () => {
        h = setupOverlay('conversation-header.html');
        applyGapGeometry(h.dom);

        h.overlay.reposition();

        expect(h.overlay.wrapperEl.style.visibility).toBe('');
        expect(h.overlay.wrapperEl.style.left).toBe(GAP_EXPECTED_LEFT);
        expect(h.overlay.wrapperEl.style.width).toBe(GAP_EXPECTED_WIDTH);
        expect(h.overlay.wrapperEl.style.transform).toBe('translateY(-50%)');
    });

    it('sets visibility=hidden when the title-row title and the new-chat button leave no gap', () => {
        h = setupOverlay('conversation-header.html');
        applyGapGeometry(h.dom);
        // title 0..200, button 210..375 → availableGap = 210 - 200 - 16 = -6 → hidden.
        // Each decoy keeps a positive gap, so a wrong pick stays visible: share button as button 281 - 200 - 16 = 65,
        // centred title (100..150) as title 210 - 150 - 16 = 44, sidebar toggle (4..48) as title 210 - 48 - 16 = 146.
        stubRect(h.dom.titleEl,      rect(0, 200));
        stubRect(h.dom.newChatBtn,   rect(210, 165));
        stubRect(h.dom.centredTitle, rect(100, 50));

        h.overlay.reposition();

        expect(h.overlay.wrapperEl.style.visibility).toBe('hidden');
    });

    it('clears a previous visibility=hidden once the gap is positive again', () => {
        h = setupOverlay('conversation-header.html');
        h.overlay.wrapperEl.style.visibility = 'hidden';
        applyGapGeometry(h.dom);

        h.overlay.reposition();

        expect(h.overlay.wrapperEl.style.visibility).toBe('');
        expect(h.overlay.wrapperEl.style.left).toBe(GAP_EXPECTED_LEFT);
    });

    it('falls back to container centring (no throw) when the title row is absent', () => {
        h = setupOverlay('conversation-header.html');
        applyGapGeometry(h.dom);
        h.dom.titleRow.remove();

        expect(() => h.overlay.reposition()).not.toThrow();

        // center fallback: round((375 - 80) / 2) = round(147.5) = 148
        expect(h.overlay.wrapperEl.style.left).toBe('148px');
        expect(h.overlay.wrapperEl.style.width).toBe(GAP_EXPECTED_WIDTH);
    });
});

// ── Group 5: consistency — reposition() vs onSelectChange() ──────────────────

describe('DOM resolvers — consistency: reposition() vs onSelectChange()', () => {
    let h;
    beforeEach(() => {
        h = setupOverlay('conversation-header.html');
        applyGapGeometry(h.dom);
    });
    afterEach(() => h.teardown());

    it('onSelectChange() places the overlay exactly where reposition() does', () => {
        h.overlay.reposition();
        expect(h.overlay.wrapperEl.style.left).toBe(GAP_EXPECTED_LEFT);

        h.overlay.wrapperEl.style.left = '';
        h.overlay.wrapperEl.style.width = '';
        h.overlay.onSelectChange('preset-A');

        expect(h.overlay.wrapperEl.style.left).toBe(GAP_EXPECTED_LEFT);
        expect(h.overlay.wrapperEl.style.width).toBe(GAP_EXPECTED_WIDTH);
    });

    it('repeated onSelectChange() calls, including the empty (unbind) choice, keep the same placement', () => {
        h.overlay.reposition();

        for (const id of ['preset-X', 'preset-Y', '']) {
            h.overlay.wrapperEl.style.left = '';
            h.overlay.onSelectChange(id);
            expect(h.overlay.wrapperEl.style.left, 'after onSelectChange(' + JSON.stringify(id) + ')').toBe(GAP_EXPECTED_LEFT);
        }
    });
});

// ── Group 6: guard clauses ───────────────────────────────────────────────────

describe('DOM resolvers — guard clauses', () => {
    let h;
    afterEach(() => { if (h) h.teardown(); h = null; });

    it('reposition() is a no-op (no throw) when the overlay is not mounted', () => {
        spyStorageManager();
        const overlay = createPresetOverlay(makeCtx());
        expect(() => overlay.reposition()).not.toThrow();
        expect(overlay.wrapperEl).toBeNull();
        restoreStorageManager();
    });

    it('reposition() leaves the placement untouched while the wrapper is display:none', () => {
        h = setupOverlay('conversation-header.html');
        applyGapGeometry(h.dom);
        h.overlay.wrapperEl.style.display = 'none';
        h.overlay.wrapperEl.style.left = '';

        h.overlay.reposition();

        expect(h.overlay.wrapperEl.style.left).toBe('');
    });
});

// ── Group 7: center branch (>= 768 px) ───────────────────────────────────────

describe('DOM resolvers — center branch ignores the title and button rects', () => {
    let h;
    afterEach(() => h.teardown());

    it('centres in the container and stays visible even when title and button overlap', () => {
        h = setupOverlay('conversation-header.html', { viewport: 1024 });
        stubRect(h.dom.container,  rect(0, 767));
        stubRect(h.dom.titleEl,    rect(0, 400));
        stubRect(h.dom.newChatBtn, rect(400, 367));

        h.overlay.reposition();

        // round((767 - 80) / 2) = round(343.5) = 344
        expect(h.overlay.wrapperEl.style.visibility).not.toBe('hidden');
        expect(h.overlay.wrapperEl.style.left).toBe('344px');
    });
});

// ── Group 8: window resize listener ──────────────────────────────────────────

describe('DOM resolvers — window resize listener', () => {
    let h;
    beforeEach(() => { h = setupOverlay('conversation-header.html', { viewport: 1024 }); });
    afterEach(() => { if (h) h.teardown(); });

    it('registers a resize handler on mount and removes it on unmount', () => {
        expect(typeof h.overlay._windowResizeHandler).toBe('function');
        h.overlay.unmount();
        expect(h.overlay._windowResizeHandler).toBeNull();
    });

    it('switches from center to gap placement when a resize crosses below 768 px', () => {
        stubRect(h.dom.container, rect(0, 767));
        h.overlay.reposition();
        expect(h.overlay.wrapperEl.style.left).toBe('344px');

        setInnerWidth(GAP_VIEWPORT);
        applyGapGeometry(h.dom);
        window.dispatchEvent(new Event('resize'));

        expect(h.overlay.wrapperEl.style.left).toBe(GAP_EXPECTED_LEFT);
    });
});

// ── Group 9: idempotency regression (Bug #2 fix — v4.2.1) ────────────────────
//
// getNaturalWidth() uses canvas-based measureTextWidth plus a stable arrow-width constant (it no longer
// reads arrow.getBoundingClientRect()), so two reposition() calls with the same label must yield the exact
// same integer left and width. The real getNaturalWidth() runs here (no stub), since it is the subject.

describe('DOM resolvers — reposition() idempotency (Bug #2 regression)', () => {
    let h;
    afterEach(() => h.teardown());

    it('two consecutive reposition() calls with the same label yield identical integer left and width', () => {
        h = setupOverlay('conversation-header.html', { viewport: 1024, stubNaturalWidth: false });
        stubRect(h.dom.container, rect(0, 767));

        h.overlay.reposition();
        const left1  = h.overlay.wrapperEl.style.left;
        const width1 = h.overlay.wrapperEl.style.width;

        h.overlay.reposition();

        expect(left1).not.toBe('');
        expect(width1).not.toBe('');
        expect(h.overlay.wrapperEl.style.left).toBe(left1);
        expect(h.overlay.wrapperEl.style.width).toBe(width1);
        expect(parseFloat(left1) % 1).toBe(0);
        expect(parseFloat(width1) % 1).toBe(0);
    });
});
