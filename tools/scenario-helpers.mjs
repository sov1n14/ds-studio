/**
 * Reusable helpers for scenario definitions.
 * Extracted to keep scenarios.mjs under 250 lines.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DSSelectors = require('../content/ds-selectors.js');

export async function waitForTextarea(page) {
  return page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Ensure a toggle button is in the active/on state.
 * Searches for buttons containing labelText and checks aria-pressed or visual active state.
 * Tries multiple strategies since DeepSeek's toggle structure varies by locale.
 */
export async function enableToggleIfOff(page, labelTexts) {
  const candidates = Array.isArray(labelTexts) ? labelTexts : [labelTexts];
  for (const text of candidates) {
    // Strategy 1: aria-pressed toggle near the label
    const toggle = page.locator(DSSelectors.TOGGLE_BUTTON_SELECTOR).filter({ hasText: text });
    if (await toggle.count() > 0) {
      const pressed = await toggle.first().getAttribute('aria-pressed');
      if (pressed === 'false') await toggle.first().click();
      return true;
    }
    // Strategy 2: any element with aria-pressed near matching text
    const byText = page.locator('[aria-pressed]').filter({ hasText: text });
    if (await byText.count() > 0) {
      const pressed = await byText.first().getAttribute('aria-pressed');
      if (pressed === 'false') await byText.first().click();
      return true;
    }
  }
  return false;
}

export async function ensureDeepThinkOn(page) {
  await enableToggleIfOff(page, ['深度思考', 'DeepThink', '深度思考(R1)']);
}

export async function ensureSmartSearchOn(page) {
  await enableToggleIfOff(page, ['联网搜索', '智慧搜尋', '智能搜索', 'Search']);
}

export async function submitPrompt(page, text) {
  const ta = page.locator('textarea').first();
  await ta.fill(text);
  await ta.press('Enter');
}

/**
 * Wait until the send-button icon disappears (streaming started).
 * The send arrow SVG is gone while the model is generating.
 */
export async function waitForStreamingStart(page) {
  const iconSel = DSSelectors.SEND_BUTTON_ICON_SELECTOR;
  // First wait for a .ds-message to appear (reply container mounted)
  await page.locator(DSSelectors.MESSAGE_SELECTOR).first().waitFor({ state: 'visible', timeout: 30_000 });
  // Then confirm the send icon is gone (replaced by stop button) — or a loading-dots element appeared
  await page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length === 0,
    iconSel,
    { timeout: 15_000 }
  ).catch(() => {});
  // Brief settle for think-block to mount
  await page.waitForTimeout(500);
}

/**
 * Click the sidebar collapse/expand toggle in the header area.
 * The toggle button contains an SVG path starting with "M9.67272" (sidebar panel icon).
 * Returns true if the click changed the collapsed state.
 */
export async function clickSidebarToggle(page) {
  const collapsedSel = DSSelectors.SIDEBAR_NATIVE_COLLAPSED_SELECTOR;
  const wasBefore = await page.locator(collapsedSel).count();
  const toggleBtn = page.locator('div[role="button"]:has(svg path[d^="M9.67272"])');
  if (await toggleBtn.count() === 0) return false;
  await toggleBtn.first().click({ timeout: 5_000 });
  await page.waitForTimeout(800);
  const wasAfter = await page.locator(collapsedSel).count();
  return wasBefore !== wasAfter;
}

/**
 * Open the first conversation in the sidebar history.
 * Assumes the page is already on DeepSeek and the first chat is a long conversation.
 */
export async function openFirstConversation(page) {
  const link = page.locator(DSSelectors.SIDEBAR_CHAT_LINK_SELECTOR).first();
  await link.waitFor({ state: 'visible', timeout: 15_000 });
  await link.click();
  await page.locator(DSSelectors.MESSAGE_SELECTOR).first().waitFor({ state: 'visible', timeout: 30_000 });
  // Scroll every large scrollable element to top so React mounts the native go-bottom button.
  // Brute-force: targeting a specific selector matches the wrong element first on some layouts.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight && el.scrollHeight > 1000) {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll', { bubbles: false }));
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    }
  });
  await page.waitForTimeout(3000);
  return true;
}

