/**
 * Unit tests for computePlacement (preset-dropdown.position.js).
 * Pure-function tests — no DOM required; all inputs are plain rect objects.
 *
 * New contract (post-rewrite):
 *   computePlacement({ containerRect, titleRect, buttonRect, naturalWidth,
 *                       maxWidth, gapSafety, windowWidth })
 *     → { mode: 'center'|'gap'|'hidden', left: number, width: number, hidden: boolean }
 *
 *   windowWidth >= 768 → mode 'center': left=(containerWidth-width)/2, hidden=false always.
 *   windowWidth <  768 → mode 'gap': centered between titleRight and buttonLeft; or
 *                         mode 'hidden': when availableGap <= 0.
 *   No minimum width floor exists (minWidth parameter removed).
 *   left is container-relative px.
 */

import { describe, it, expect } from 'vitest';
const { computePlacement } = require('../../content/preset-dropdown.position.js');

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal DOMRect-like object.
 * @param {number} left
 * @param {number} width
 * @param {number} [top=0]
 * @returns {{ left: number, right: number, width: number, top: number }}
 */
function rect(left, width, top = 0) {
    return { left, right: left + width, width, top, bottom: top + 30 };
}

/**
 * Invoke computePlacement with defaults filled in.
 * windowWidth defaults to 1024 (desktop / center branch).
 */
function place(overrides) {
    return computePlacement({
        maxWidth:    200,
        gapSafety:   8,
        windowWidth: 1024,
        ...overrides,
    });
}

/**
 * Invoke computePlacement in the <768 (gap) branch.
 */
function placeGap(overrides) {
    return computePlacement({
        maxWidth:    200,
        gapSafety:   8,
        windowWidth: 375,
        ...overrides,
    });
}

// ── Group A: center mode (windowWidth >= 768) ──────────────────────────────

describe('computePlacement — center mode (windowWidth >= 768)', () => {
    it('returns mode=center and hidden=false for windowWidth=1024', () => {
        const containerRect = rect(0, 800);
        const titleRect     = rect(0, 150);
        const buttonRect    = rect(650, 150);

        const result = place({ containerRect, titleRect, buttonRect, naturalWidth: 120 });

        expect(result.mode).toBe('center');
        expect(result.hidden).toBe(false);
        expect(result.width).toBe(120);
        // left = (800 - 120) / 2 = 340
        expect(result.left).toBe(340);
    });

    it('returns mode=center for exact boundary windowWidth=768', () => {
        const containerRect = rect(0, 768);
        const titleRect     = rect(0, 150);
        const buttonRect    = rect(618, 150);

        const result = computePlacement({
            containerRect, titleRect, buttonRect, naturalWidth: 120,
            maxWidth: 200, gapSafety: 8, windowWidth: 768,
        });

        expect(result.mode).toBe('center');
        expect(result.hidden).toBe(false);
    });

    it('returns mode=gap for windowWidth=767 (just below boundary)', () => {
        const containerRect = rect(0, 767);
        const titleRect     = rect(0, 150);
        const buttonRect    = rect(617, 150);

        const result = computePlacement({
            containerRect, titleRect, buttonRect, naturalWidth: 120,
            maxWidth: 200, gapSafety: 8, windowWidth: 767,
        });

        expect(result.mode).toBe('gap');
    });

    it('clamps width to maxWidth(200) in center mode when naturalWidth > 200', () => {
        const containerRect = rect(0, 1000);
        const titleRect     = rect(0, 100);
        const buttonRect    = rect(900, 100);

        const result = place({ containerRect, titleRect, buttonRect, naturalWidth: 500 });

        expect(result.mode).toBe('center');
        expect(result.width).toBe(200);
        // left = (1000 - 200) / 2 = 400
        expect(result.left).toBe(400);
    });

    it('does NOT floor width to 80 in center mode when naturalWidth < 80 (no minimum)', () => {
        const containerRect = rect(0, 800);
        const titleRect     = rect(0, 100);
        const buttonRect    = rect(700, 100);

        const result = place({ containerRect, titleRect, buttonRect, naturalWidth: 30 });

        expect(result.mode).toBe('center');
        expect(result.width).toBe(30); // not floored to 80
        // left = (800 - 30) / 2 = 385
        expect(result.left).toBe(385);
    });

    it('left = (containerWidth - width) / 2 for various container widths', () => {
        const containerRect = rect(0, 600);
        const titleRect     = rect(0, 80);
        const buttonRect    = rect(520, 80);

        const result = place({ containerRect, titleRect, buttonRect, naturalWidth: 100 });

        expect(result.mode).toBe('center');
        expect(result.width).toBe(100);
        expect(result.left).toBe((600 - 100) / 2);
    });

    it('is independent of container.left offset (uses relative left)', () => {
        // Container starts at x=200 (viewport-relative) with width 800.
        const containerRect = rect(200, 800);
        const titleRect     = rect(200, 150);
        const buttonRect    = rect(850, 150);

        const result = place({ containerRect, titleRect, buttonRect, naturalWidth: 120 });

        expect(result.mode).toBe('center');
        expect(result.width).toBe(120);
        expect(result.left).toBe(340);
    });

    it('hidden is always false in center mode regardless of title/button overlap', () => {
        // Overlapping title/button in a wide window — center never hides
        const containerRect = rect(0, 800);
        const titleRect     = rect(0, 400); // very wide title
        const buttonRect    = rect(400, 400);

        const result = place({ containerRect, titleRect, buttonRect, naturalWidth: 120 });

        expect(result.mode).toBe('center');
        expect(result.hidden).toBe(false);
    });

    it('windowWidth=375 produces mode=gap (not center)', () => {
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 100);
        const buttonRect    = rect(275, 100);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 60 });

        expect(result.mode).toBe('gap');
        expect(result.mode).not.toBe('center');
    });
});

// ── Group B: gap mode (<768) — ample gap ───────────────────────────────────

describe('computePlacement — gap mode (windowWidth < 768, ample gap)', () => {
    it('gap mode: naturalWidth fits in gap → width = naturalWidth exactly', () => {
        // Container 375px, title 0..50, button 200..375
        // availableGap = 200 - 50 - 16 = 134; naturalWidth=60 fits → width=60
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 50);
        const buttonRect    = rect(200, 175);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 60 });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(60);
        expect(result.hidden).toBe(false);
    });

    it('gap mode: naturalWidth exceeds gap → width = availableGap (shrink, no floor)', () => {
        // Container 375px, title 0..100, button 220..375
        // availableGap = 220 - 100 - 16 = 104; naturalWidth=150 > 104 → width=104
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 100);
        const buttonRect    = rect(220, 155);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 150 });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(104);
        expect(result.hidden).toBe(false);
    });

    it('gap mode: left positions box centred within the gap (container-relative)', () => {
        // Container 375px at x=0, title 0..100, button 220..375
        // gapSafety=8, titleRight=100, buttonLeft=220
        // availableGap = 220 - 100 - 16 = 104
        // naturalWidth=80 fits: finalWidth=80
        // gapCenterAbs = 100 + 8 + 104/2 = 100+8+52 = 160
        // gapLeft = 160 - 0 - 80/2 = 160 - 40 = 120
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 100);
        const buttonRect    = rect(220, 155);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 80 });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(80);
        expect(result.left).toBeCloseTo(120, 5);
    });

    it('gap mode: small naturalWidth (30) is NOT floored — width stays 30', () => {
        // windowWidth=375, gap=100, naturalWidth=30 → width=30 (no minimum floor)
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 50);
        const buttonRect    = rect(166, 209); // availableGap = 166-50-16=100

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 30 });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(30);
    });

    it('gap mode: naturalWidth=60, gap=100 → width=60 (fits, no truncation)', () => {
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 50);
        const buttonRect    = rect(166, 209); // availableGap=100

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 60 });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(60);
    });

    it('gap mode: naturalWidth=150, gap=80 → width=80 (shrunk to gap)', () => {
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 100);
        const buttonRect    = rect(196, 179); // availableGap = 196-100-16=80

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 150 });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(80);
    });

    it('gap mode still respects maxWidth upper cap', () => {
        // availableGap=300, naturalWidth=250 > maxWidth=200 → width=200
        const containerRect = rect(0, 600);
        const titleRect     = rect(0, 50);
        const buttonRect    = rect(366, 234); // availableGap = 366-50-16=300

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 250 });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(200);
    });
});

// ── Group C: hidden branch (<768, availableGap <= 0) ──────────────────────

describe('computePlacement — hidden branch (availableGap <= 0)', () => {
    it('returns hidden=true when availableGap = 0 exactly', () => {
        // titleRight=200, buttonLeft=216, gapSafety=8 → availableGap=216-200-16=0
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 200);
        const buttonRect    = rect(216, 159);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 100 });

        expect(result.hidden).toBe(true);
        expect(result.mode).toBe('hidden');
    });

    it('returns hidden=true when availableGap < 0 (elements overlap)', () => {
        // titleRight=200, buttonLeft=210, availableGap=210-200-16=-6
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 200);
        const buttonRect    = rect(210, 165);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 100 });

        expect(result.hidden).toBe(true);
        expect(result.mode).toBe('hidden');
    });

    it('returns hidden=true when button is to the left of title', () => {
        const containerRect = rect(0, 375);
        const titleRect     = rect(200, 100);
        const buttonRect    = rect(0, 50);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 80 });

        expect(result.hidden).toBe(true);
    });

    it('hidden branch: left and width are 0 (values are meaningless when hidden)', () => {
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 200);
        const buttonRect    = rect(210, 165);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 100 });

        expect(result.left).toBe(0);
        expect(result.width).toBe(0);
    });

    it('gap becomes available again → hidden=false', () => {
        // Wide gap: titleRight=50, buttonLeft=200, availableGap=200-50-16=134
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 50);
        const buttonRect    = rect(200, 175);

        const result = placeGap({ containerRect, titleRect, buttonRect, naturalWidth: 80 });

        expect(result.hidden).toBe(false);
    });
});

// ── Group D: missing titleRect / buttonRect fallback ───────────────────────

describe('computePlacement — missing titleRect or buttonRect → fallback', () => {
    it('<768: falls back to center when titleRect is null', () => {
        const containerRect = rect(0, 600);

        const result = placeGap({ containerRect, titleRect: null, buttonRect: rect(500, 100), naturalWidth: 120 });

        expect(result.mode).toBe('center');
        expect(result.hidden).toBe(false);
        expect(result.width).toBe(120);
        expect(result.left).toBe((600 - 120) / 2);
    });

    it('<768: falls back to center when buttonRect is null', () => {
        const containerRect = rect(0, 600);

        const result = placeGap({ containerRect, titleRect: rect(0, 100), buttonRect: null, naturalWidth: 120 });

        expect(result.mode).toBe('center');
        expect(result.hidden).toBe(false);
        expect(result.width).toBe(120);
        expect(result.left).toBe((600 - 120) / 2);
    });

    it('<768: falls back to center when both titleRect and buttonRect are omitted', () => {
        const containerRect = rect(0, 600);

        const result = placeGap({ containerRect, naturalWidth: 150 });

        expect(result.mode).toBe('center');
        expect(result.width).toBe(150);
        expect(result.left).toBe((600 - 150) / 2);
    });

    it('>=768: center mode with no rects (rects are ignored)', () => {
        const containerRect = rect(0, 800);

        const result = place({ containerRect, naturalWidth: 150 });

        expect(result.mode).toBe('center');
        expect(result.width).toBe(150);
        expect(result.left).toBe((800 - 150) / 2);
    });

    it('<768 fallback: left is at least 0 when naturalWidth equals containerWidth', () => {
        const containerRect = rect(0, 80);

        const result = placeGap({ containerRect, naturalWidth: 80 });

        expect(result.mode).toBe('center');
        expect(result.left).toBeGreaterThanOrEqual(0);
    });
});

// ── Group E: guard clause — missing containerRect ─────────────────────────

describe('computePlacement — guard: missing containerRect', () => {
    it('throws when input is null', () => {
        expect(() => computePlacement(null)).toThrow('containerRect is required');
    });

    it('throws when containerRect is absent', () => {
        expect(() => computePlacement({ naturalWidth: 100 })).toThrow('containerRect is required');
    });
});

// ── Group F: hidden field is a boolean in all branches ─────────────────────

describe('computePlacement — hidden field type guarantee', () => {
    it('returns hidden:false (boolean) in center mode (>=768)', () => {
        const result = place({ containerRect: rect(0, 800), naturalWidth: 100 });
        expect(typeof result.hidden).toBe('boolean');
        expect(result.hidden).toBe(false);
    });

    it('returns hidden:false (boolean) in gap mode (<768, positive gap)', () => {
        const result = placeGap({
            containerRect: rect(0, 375),
            titleRect: rect(0, 50),
            buttonRect: rect(200, 175),
            naturalWidth: 60,
        });
        expect(typeof result.hidden).toBe('boolean');
        expect(result.hidden).toBe(false);
    });

    it('returns hidden:true (boolean) in hidden mode (<768, gap<=0)', () => {
        const result = placeGap({
            containerRect: rect(0, 375),
            titleRect: rect(0, 200),
            buttonRect: rect(210, 165),
            naturalWidth: 100,
        });
        expect(typeof result.hidden).toBe('boolean');
        expect(result.hidden).toBe(true);
    });
});

// ── Group G: realistic header variant cases ────────────────────────────────

describe('computePlacement — realistic header variant cases', () => {
    it('Desktop >=768: wide header → center mode with naturalWidth', () => {
        // Container 1200px, naturalWidth=160, windowWidth=1200
        const containerRect = rect(0, 1200);
        const titleRect     = rect(0, 200);
        const buttonRect    = rect(1000, 200);

        const result = computePlacement({
            containerRect, titleRect, buttonRect, naturalWidth: 160,
            maxWidth: 200, gapSafety: 8, windowWidth: 1200,
        });

        expect(result.mode).toBe('center');
        expect(result.width).toBe(160);
        expect(result.left).toBe((1200 - 160) / 2);
        expect(result.hidden).toBe(false);
    });

    it('Desktop >=768: sidebar open, narrower container → still center mode', () => {
        // Container 900px, windowWidth=900
        const containerRect = rect(0, 900);
        const titleRect     = rect(0, 180);
        const buttonRect    = rect(730, 100);

        const result = computePlacement({
            containerRect, titleRect, buttonRect, naturalWidth: 140,
            maxWidth: 200, gapSafety: 8, windowWidth: 900,
        });

        expect(result.mode).toBe('center');
        expect(result.width).toBe(140);
        expect(result.left).toBe((900 - 140) / 2);
    });

    it('Mobile <768: tight gap causes shrink (no minWidth floor)', () => {
        // Container 375px, title 0..150, button 195..375
        // availableGap = 195 - 150 - 16 = 29; naturalWidth=80 > 29 → width=29, NOT floored to 80
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 150);
        const buttonRect    = rect(195, 180);

        const result = computePlacement({
            containerRect, titleRect, buttonRect, naturalWidth: 80,
            maxWidth: 200, gapSafety: 8, windowWidth: 375,
        });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(29);
        expect(result.hidden).toBe(false);
    });

    it('Mobile <768: very tight header → hidden (gap<=0)', () => {
        // Container 375px, title 0..200, button 210..375 → availableGap = 210-200-16 = -6
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 200);
        const buttonRect    = rect(210, 165);

        const result = computePlacement({
            containerRect, titleRect, buttonRect, naturalWidth: 80,
            maxWidth: 200, gapSafety: 8, windowWidth: 375,
        });

        expect(result.mode).toBe('hidden');
        expect(result.hidden).toBe(true);
    });

    it('windowWidth=768 exact boundary → center (not gap)', () => {
        const containerRect = rect(0, 768);

        const result = computePlacement({
            containerRect, naturalWidth: 120,
            maxWidth: 200, gapSafety: 8, windowWidth: 768,
        });

        expect(result.mode).toBe('center');
        expect(result.hidden).toBe(false);
    });
});

// ── Group H: default parameter values ─────────────────────────────────────

describe('computePlacement — default parameter values', () => {
    it('naturalWidth defaults to 80 when not provided', () => {
        const containerRect = rect(0, 600);

        const result = computePlacement({ containerRect, windowWidth: 1024 });

        // naturalWidth=80 (default), maxWidth=200 (default) → width=80
        expect(result.width).toBe(80);
    });

    it('maxWidth defaults to 200 — caps naturalWidth in center mode', () => {
        const containerRect = rect(0, 600);

        const result = computePlacement({ containerRect, naturalWidth: 9999, windowWidth: 1024 });

        expect(result.width).toBe(200);
    });

    it('windowWidth defaults to window.innerWidth (>=768 in happy-dom test env → center mode)', () => {
        const containerRect = rect(0, 600);

        // No windowWidth passed — controller uses window.innerWidth (1024 in happy-dom)
        const result = computePlacement({ containerRect, naturalWidth: 100 });

        // happy-dom window.innerWidth is 1024 → center branch
        expect(result.mode).toBe('center');
    });

    it('gapSafety defaults to 8 — confirmed via gap calculation', () => {
        // titleRight=100, buttonLeft=220, gapSafety omitted → defaults to 8
        // availableGap = 220 - 100 - 16 = 104; naturalWidth=60 → width=60
        const containerRect = rect(0, 375);
        const titleRect     = rect(0, 100);
        const buttonRect    = rect(220, 155);

        const result = computePlacement({
            containerRect, titleRect, buttonRect, naturalWidth: 60, windowWidth: 375,
        });

        expect(result.mode).toBe('gap');
        expect(result.width).toBe(60);
    });
});
