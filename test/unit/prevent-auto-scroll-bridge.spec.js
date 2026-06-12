/**
 * Unit tests for content/prevent-auto-scroll-bridge.js
 *
 * Coverage map:
 *   § 1  enable()     — creates bridge element with dataset.enabled='true';
 *                       injects script tag with correct id and src;
 *                       idempotent: second call reuses bridge, does NOT duplicate script tag
 *   § 2  disable()    — sets bridge dataset.enabled='false';
 *                       creates bridge element if absent
 *   § 3  isEnabled()  — returns false when bridge absent;
 *                       returns true after enable();
 *                       returns false after disable()
 *
 * Architecture note:
 *   prevent-auto-scroll-bridge.js is an IIFE that installs itself on
 *   window.DSstudio.PreventAutoScroll AND exports via module.exports.
 *   We import via the module.exports path for clean unit testing.
 *
 * chrome.runtime.getURL is provided by the jest-chrome mock via vitest.setup.js.
 * We stub it to return a predictable URL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants that must match the production source
// ─────────────────────────────────────────────────────────────────────────────

const BRIDGE_ID = 'dss-prevent-auto-scroll-bridge';
const SCRIPT_INJECT_ID = 'dss-prevent-auto-scroll-script';
const FAKE_SCRIPT_URL = 'chrome-extension://fake-ext-id/content/prevent-auto-scroll.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Module re-load helper
//
//  prevent-auto-scroll-bridge.js is a side-effectful IIFE: importing it once
//  installs the module, but the bridge element and injected script persist in
//  document across tests unless we clean up.  We do NOT vi.resetModules()
//  because that would re-run the IIFE's window.DSstudio install block
//  each time which is harder to manage.  Instead we:
//    1. Import once at module scope (below).
//    2. In beforeEach, strip the bridge element and script tag from the DOM.
//    3. Let enable/disable re-create them as needed.
// ─────────────────────────────────────────────────────────────────────────────

import bridgeModule from '../../content/prevent-auto-scroll-bridge.js';
const { enable, disable, isEnabled } = bridgeModule;

function cleanDom() {
    document.getElementById(BRIDGE_ID)?.remove();
    document.getElementById(SCRIPT_INJECT_ID)?.remove();
    // Also clean any script tags that were appended but not yet removed
    // (production code removes them via onload, which doesn't fire in happy-dom)
    document.querySelectorAll(`script[id="${SCRIPT_INJECT_ID}"]`).forEach(s => s.remove());
}

// ─────────────────────────────────────────────────────────────────────────────
//  Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    cleanDom();
    // Stub chrome.runtime.getURL to return a deterministic URL
    chrome.runtime.getURL.mockReturnValue(FAKE_SCRIPT_URL);
});

afterEach(() => {
    cleanDom();
    vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 1  enable()
// ─────────────────────────────────────────────────────────────────────────────

describe('enable()', () => {
    it('creates the bridge element with id="dss-prevent-auto-scroll-bridge"', () => {
        enable();
        expect(document.getElementById(BRIDGE_ID)).not.toBeNull();
    });

    it('sets bridge dataset.enabled to "true"', () => {
        enable();
        const bridge = document.getElementById(BRIDGE_ID);
        expect(bridge.dataset.enabled).toBe('true');
    });

    it('bridge element is hidden (display:none)', () => {
        enable();
        const bridge = document.getElementById(BRIDGE_ID);
        expect(bridge.style.display).toBe('none');
    });

    it('injects a <script> element with id="dss-prevent-auto-scroll-script"', () => {
        enable();
        // In happy-dom, script.onload never fires so the tag is NOT auto-removed.
        // We can find it on documentElement.
        const script = document.getElementById(SCRIPT_INJECT_ID);
        expect(script).not.toBeNull();
    });

    it('injected script src matches chrome.runtime.getURL result', () => {
        enable();
        const script = document.getElementById(SCRIPT_INJECT_ID);
        expect(script?.src).toBe(FAKE_SCRIPT_URL);
    });

    it('calling enable() twice does NOT inject a second script tag', () => {
        enable();
        enable();
        const scripts = document.querySelectorAll(`#${SCRIPT_INJECT_ID}`);
        expect(scripts).toHaveLength(1);
    });

    it('calling enable() twice does NOT create a second bridge element', () => {
        enable();
        enable();
        const bridges = document.querySelectorAll(`#${BRIDGE_ID}`);
        expect(bridges).toHaveLength(1);
    });

    it('calling enable() a second time still leaves dataset.enabled="true"', () => {
        enable();
        enable();
        expect(document.getElementById(BRIDGE_ID)?.dataset.enabled).toBe('true');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 2  disable()
// ─────────────────────────────────────────────────────────────────────────────

describe('disable()', () => {
    it('sets bridge dataset.enabled to "false" after enable()', () => {
        enable();
        disable();
        expect(document.getElementById(BRIDGE_ID)?.dataset.enabled).toBe('false');
    });

    it('creates bridge element if it did not exist yet, with dataset.enabled="false"', () => {
        // Call disable() without a prior enable() — bridge element absent
        disable();
        const bridge = document.getElementById(BRIDGE_ID);
        expect(bridge).not.toBeNull();
        expect(bridge.dataset.enabled).toBe('false');
    });

    it('enable() → disable() → enable() leaves dataset.enabled="true"', () => {
        enable();
        disable();
        enable();
        expect(document.getElementById(BRIDGE_ID)?.dataset.enabled).toBe('true');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 3  isEnabled()
// ─────────────────────────────────────────────────────────────────────────────

describe('isEnabled()', () => {
    it('returns false when bridge element is absent', () => {
        // DOM cleaned in beforeEach
        expect(isEnabled()).toBe(false);
    });

    it('returns true after enable()', () => {
        enable();
        expect(isEnabled()).toBe(true);
    });

    it('returns false after disable()', () => {
        enable();
        disable();
        expect(isEnabled()).toBe(false);
    });

    it('returns false when bridge exists but dataset.enabled is not "true"', () => {
        // Create bridge manually without setting dataset
        const bridge = document.createElement('div');
        bridge.id = BRIDGE_ID;
        document.documentElement.appendChild(bridge);
        expect(isEnabled()).toBe(false);
    });

    it('returns false when bridge exists with dataset.enabled="false"', () => {
        const bridge = document.createElement('div');
        bridge.id = BRIDGE_ID;
        bridge.dataset.enabled = 'false';
        document.documentElement.appendChild(bridge);
        expect(isEnabled()).toBe(false);
    });
});
