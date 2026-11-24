// Reads and sets DeepSeek's own sidebar: whether its chat-list panel is shown, its native collapsed-rail structure, and its rendered width.

import { expect } from '@playwright/test';
import { DSSelectors } from './selectors.js';

const NATIVE_CLICK_TIMEOUT_MS = 10_000;

/** DeepSeek's "collapse sidebar" button inside the expanded panel (same icon as the rail's open button). */
const COLLAPSE_BUTTON_SELECTOR = `${DSSelectors.SIDEBAR_INNER_SELECTOR} div.ds-button[role="button"]:has(path[d^="M9.67272"])`;

/** Narrowest width at which the chat-list panel counts as shown (the native panel is about 261px at a 1280px viewport). */
const PANEL_MIN_WIDTH_PX = 200;

/** Selectors handed to page functions. */
export const SIDEBAR_STATE_ARG = Object.freeze({
    wrapper: DSSelectors.SIDEBAR_WRAPPER_SELECTOR,
    collapsed: DSSelectors.SIDEBAR_WRAPPER_COLLAPSED_SELECTOR,
    inner: DSSelectors.SIDEBAR_INNER_SELECTOR,
    minWidth: PANEL_MIN_WIDTH_PX,
});

/** Page function: true while DeepSeek's chat-list panel is rendered, at least PANEL_MIN_WIDTH_PX wide and inside the viewport. */
export function isPanelShownInPage({ inner, minWidth }) {
    const panel = document.querySelector(inner);
    if (!panel || !panel.checkVisibility()) return false;
    const rect = panel.getBoundingClientRect();
    return rect.width >= minWidth && rect.left >= 0;
}

/** 頁面函式：isPanelShownInPage 的反面，用來觀察已顯示的面板始終沒有被收起；頁面函式無法呼叫另一個頁面函式，所以自成一體。 */
export function isPanelHiddenInPage({ inner, minWidth }) {
    const panel = document.querySelector(inner);
    if (!panel || !panel.checkVisibility()) return true;
    const rect = panel.getBoundingClientRect();
    return !(rect.width >= minWidth && rect.left >= 0);
}

/** Runs a page read, answering null while a navigation (reload, SPA redirect) replaces the document, so a poll retries instead of failing. */
async function readAcrossNavigation(read) {
    try {
        return await read();
    } catch (error) {
        if (/Execution context was destroyed|navigation/i.test(String(error?.message))) return null;
        throw error;
    }
}

/** `{ panelShown, nativelyCollapsed, width }`: what the user sees, DeepSeek's collapsed-rail structure, and the wrapper's rendered width in px; null while the page is not readable. */
export function readSidebar(page) {
    return readAcrossNavigation(() => readSidebarNow(page));
}

async function readSidebarNow(page) {
    const structure = await page.evaluate(({ wrapper, collapsed }) => {
        const el = document.querySelector(wrapper);
        if (!el) return null;
        return { nativelyCollapsed: el.matches(collapsed), width: Math.round(el.getBoundingClientRect().width) };
    }, SIDEBAR_STATE_ARG);
    if (!structure) return null;
    return { panelShown: await page.evaluate(isPanelShownInPage, SIDEBAR_STATE_ARG), ...structure };
}

/** Clicks DeepSeek's own collapse button in the expanded sidebar, as a user would. */
export async function collapseSidebarNatively(page) {
    await page.locator(COLLAPSE_BUTTON_SELECTOR).first().click({ timeout: NATIVE_CLICK_TIMEOUT_MS });
}

/** Clicks DeepSeek's own open button on the collapsed rail, as a user would. */
async function openSidebarNatively(page) {
    await page.locator(DSSelectors.SIDEBAR_OPEN_BUTTON_SELECTOR).first().click({ timeout: NATIVE_CLICK_TIMEOUT_MS });
}

/** Brings a settled sidebar to `wantCollapsed` with DeepSeek's own buttons (no-op when already there) and waits until the panel shows or hides. */
export async function setNativeSidebar(page, wantCollapsed) {
    const state = await readSidebar(page);
    if (!state) throw new Error('DeepSeek sidebar wrapper is not rendered');
    if (state.panelShown === wantCollapsed) {
        if (wantCollapsed) await collapseSidebarNatively(page);
        else await openSidebarNatively(page);
    }
    await expect.poll(async () => (await readSidebar(page))?.panelShown, {
        message: `DeepSeek sidebar panel is ${wantCollapsed ? 'hidden' : 'shown'}`,
    }).toBe(!wantCollapsed);
}

/** Moves the mouse to the middle of the chat area, away from the sidebar. */
export async function moveMouseAwayFromSidebar(page) {
    const { width, height } = page.viewportSize();
    await page.mouse.move(Math.round(width * 0.7), Math.round(height / 2));
}

/** Moves the mouse onto the sidebar's left edge (inside even a 60px auto-hidden sidebar). */
export async function moveMouseOntoSidebar(page) {
    const { height } = page.viewportSize();
    await page.mouse.move(30, Math.round(height / 2));
}
