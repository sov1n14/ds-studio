// @vitest-environment jsdom
/**
 * content/mobile-sidebar-swipe.js — a left swipe closes an open sidebar and never opens a closed one.
 *
 * Requirement: docs/FEATURES.md「Mobile Sidebar Swipe Gesture」(right-swipe opens the sidebar, left-swipe closes it; only a clear horizontal swipe — >= 50px, mostly horizontal, < 500ms — starting in the central 80% area acts) and docs/spec/03-ui-adjustments.md section 19 (trigger area, five conditions, direction detection).
 *
 * Live facts this fixture reproduces (emulated Android phone, master switch on, test/e2e/mobile-sidebar-swipe.e2e.js):
 *   - DeepSeek's sidebar toggle (div[role=button].ds-button--iconLabelTertiary.ds-button--capsule, svg path starting "M9.67272" with fill-rule) stays mounted while the drawer is closed, with a 0x0 bounding rect.
 *   - That toggle accepts an untrusted click: a probe recorded an isTrusted=false click on it while closed, and the drawer opened. A left swipe while open closes the drawer through the same toggle.
 *   - A right swipe opens the drawer (the header's iconLabelPrimary button, path "M17.2027").
 * The toggle markup is copied from test/fixtures/ds-snapshots/sidebar-expanded.html; the header is test/fixtures/ds-snapshots/mobile-ua-home-header.html. The open-state toggle size (34x34) comes from that snapshot's --dsl-button-height: 34px, not from a mobile capture.
 * checkVisibility() of the closed toggle was not captured, so the fixture leaves it unmodelled (jsdom 31 has no checkVisibility).
 *
 * Only trust boundaries are faked: chrome.runtime (settings round trip) and navigator (device profile). Touches are real events dispatched on document.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';

const readSnapshot = (name) => fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots', name), 'utf8');
const MOBILE_HEADER = readSnapshot('mobile-ua-home-header.html');
const SIDEBAR_PANEL = readSnapshot('sidebar-expanded.html');

// Pixel 8 Chrome 的真實裝置資料與 CSS 視窗大小（與 E2E 規格相同）；中央 80% 區域為 x ∈ [41.2, 370.8]、y ∈ [91.5, 823.5]。
const PIXEL_8 = Object.freeze({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv81',
    maxTouchPoints: 5,
});
const VIEWPORT = Object.freeze({ width: 412, height: 915 });
// 起點都在中央區域內；水平位移 180px 遠超過 50px 門檻、垂直位移 0、同步送出（歷時遠低於 500ms）。
const MID_Y = 450;
const LEFT_SWIPE = Object.freeze({ from: { x: 300, y: MID_Y }, to: { x: 120, y: MID_Y } });
const RIGHT_SWIPE = Object.freeze({ from: { x: 120, y: MID_Y }, to: { x: 300, y: MID_Y } });
// 開啟時的切換鈕尺寸取自 sidebar-expanded.html 的 --dsl-button-height: 34px。
const OPEN_TOGGLE_SIZE_PX = 34;

let MobileSidebarSwipe;
let originalViewport;

/** chrome.runtime.onMessage 替身（與 mobile-sidebar-swipe.spec.js 同形）。 */
function createOnMessageStub() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        callListeners: (...args) => [...listeners].forEach((fn) => fn(...args)),
    };
}

/** 讓 DSS_GET_SETTINGS 回應指定的設定值。 */
function respondWith(values) {
    chrome.runtime.sendMessage = vi.fn((_message, callback) => {
        const response = { ok: true, values };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function setViewport({ width, height }) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
}

function rect(left, top, width, height) {
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
}

/**
 * 掛上手機頁面：真實的手機版標題列與側邊欄面板，加上一個模擬 DeepSeek 抽屜狀態的替身。
 * 切換鈕（M9.67272）關閉時 0×0（實測），開啟時 34×34；點擊即切換抽屜（實測接受 isTrusted=false 的點擊）。
 * 標題列的 iconLabelPrimary 按鈕（M17.2027）點擊開啟抽屜（實測右滑會開啟）。
 * 回傳抽屜狀態（含切換鈕被觸發的次數）與切換鈕。
 */
function mountPhonePage({ isOpen }) {
    document.body.innerHTML = MOBILE_HEADER + SIDEBAR_PANEL;
    const state = { isOpen, toggleActivations: 0 };

    const toggle = document.querySelector('div[role="button"].ds-button--iconLabelTertiary:has(path[d^="M9.67272"])');
    const hamburger = document.querySelector('div[role="button"]:has(path[d^="M17.2027"])');
    if (!toggle || !hamburger) throw new Error('fixture: sidebar toggle or header hamburger missing from the snapshots');

    // 切換鈕的幾何依抽屜狀態而定：關閉時 0×0（live probe），開啟時位於面板內、34×34。
    toggle.getBoundingClientRect = () => (state.isOpen ? rect(8, 8, OPEN_TOGGLE_SIZE_PX, OPEN_TOGGLE_SIZE_PX) : rect(0, 0, 0, 0));
    Object.defineProperty(toggle, 'offsetWidth', { get: () => (state.isOpen ? OPEN_TOGGLE_SIZE_PX : 0), configurable: true });
    Object.defineProperty(toggle, 'offsetHeight', { get: () => (state.isOpen ? OPEN_TOGGLE_SIZE_PX : 0), configurable: true });

    toggle.addEventListener('click', () => {
        state.toggleActivations += 1;
        state.isOpen = !state.isOpen;
    });
    hamburger.addEventListener('click', () => {
        state.isOpen = true;
    });
    return { state, toggle };
}

function dispatchTouch(type, { x, y }) {
    const event = new Event(type, { bubbles: true });
    event.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
    document.dispatchEvent(event);
}

function swipe({ from, to }) {
    dispatchTouch('touchstart', from);
    dispatchTouch('touchmove', to);
    dispatchTouch('touchend', to);
}

/** 以真實的共用模組載入功能；總開關由 DSS_GET_SETTINGS 回應為開啟，頁面須先掛好。 */
async function loadWithMasterOn() {
    respondWith({ isEnabled: true });
    vi.resetModules();
    await import('../../content/mobile-device.js');
    await import('../../content/retry-until.js');
    await import('../../content/feature-toggle.js');
    await import('../../content/mobile-sidebar-swipe.button.js');
    await import('../../content/mobile-sidebar-swipe.gesture.js');
    await import('../../content/mobile-sidebar-swipe.bind.js');
    await import('../../content/mobile-sidebar-swipe.lifecycle.js');
    const mod = await import('../../content/mobile-sidebar-swipe.js');
    MobileSidebarSwipe = mod.default ?? mod;
    await flush();
}

beforeEach(() => {
    originalViewport = { width: window.innerWidth, height: window.innerHeight };
    setViewport(VIEWPORT);
    vi.stubGlobal('navigator', { ...PIXEL_8 });
    chrome.runtime.onMessage = createOnMessageStub();
    MobileSidebarSwipe = null;
});

afterEach(() => {
    if (MobileSidebarSwipe) {
        MobileSidebarSwipe.destroy();
        MobileSidebarSwipe._unbindTouchEvents();
        MobileSidebarSwipe = null;
    }
    document.body.innerHTML = '';
    setViewport(originalViewport);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('phone fixture self-check', () => {
    it('reproduces the live toggle: 0x0 while closed, and a click on it while closed opens the drawer', () => {
        const { state, toggle } = mountPhonePage({ isOpen: false });

        expect(toggle.getBoundingClientRect().width, 'closed toggle width (live probe: 0)').toBe(0);
        expect(toggle.getBoundingClientRect().height, 'closed toggle height (live probe: 0)').toBe(0);
        toggle.click();
        expect(state.isOpen, 'an untrusted click on the hidden toggle opens the drawer, as the live probe recorded').toBe(true);
        expect(toggle.getBoundingClientRect().width, 'open toggle width').toBe(OPEN_TOGGLE_SIZE_PX);
    });
});

describe('left swipe on a phone (master switch on)', () => {
    it('with the sidebar open, a valid left swipe closes it (control)', async () => {
        const { state } = mountPhonePage({ isOpen: true });
        await loadWithMasterOn();

        swipe(LEFT_SWIPE);

        expect(state.isOpen, 'a clear left swipe must close an open sidebar').toBe(false);
        expect(state.toggleActivations, 'the sidebar toggle is activated exactly once').toBe(1);
    });

    it('with the sidebar closed, a valid left swipe does not open it', async () => {
        const { state } = mountPhonePage({ isOpen: false });
        await loadWithMasterOn();

        swipe(LEFT_SWIPE);

        expect(state.isOpen, 'a left swipe must not open a closed sidebar').toBe(false);
        expect(state.toggleActivations, 'the hidden sidebar toggle must not be activated while the sidebar is closed').toBe(0);

        // 正向對照：手勢確實已綁定，同一頁面上的右滑會開啟側邊欄。
        swipe(RIGHT_SWIPE);
        expect(state.isOpen, 'a clear right swipe opens the sidebar (proves the gesture is armed)').toBe(true);
    });

    it('right swipe opens, left swipe closes, and a second left swipe keeps it closed', async () => {
        const { state } = mountPhonePage({ isOpen: false });
        await loadWithMasterOn();

        swipe(RIGHT_SWIPE);
        expect(state.isOpen, 'a right swipe opens the sidebar').toBe(true);
        swipe(LEFT_SWIPE);
        expect(state.isOpen, 'a left swipe closes the sidebar').toBe(false);
        swipe(LEFT_SWIPE);
        expect(state.isOpen, 'a second left swipe must not reopen the closed sidebar').toBe(false);
    });
});
