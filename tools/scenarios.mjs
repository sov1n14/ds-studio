/**
 * Scenario definitions for the capture harness.
 * Each scenario: { label, description, group, run: async (page, helpers) => {} }
 * group: scenarios sharing a group run on the same page session in order.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DSSelectors = require('../content/ds-selectors.js');

import {
  waitForTextarea, ensureDeepThinkOn, ensureSmartSearchOn,
  submitPrompt, waitForStreamingStart,
  clickSidebarToggle, openFirstConversation,
} from './scenario-helpers.mjs';

const DEEPSEEK_URL = 'https://chat.deepseek.com/';

// ── scenario list ──────────────────────────────────────────────────

export const scenarios = [
  // ── Group A: chained conversation flow (1→2→3→4→5) ──
  {
    label: 'new-chat',
    description: 'Fresh chat page before submitting',
    group: 'A',
    run: async (page) => {
      await page.goto(DEEPSEEK_URL, { waitUntil: 'networkidle', timeout: 60_000 });
      await waitForTextarea(page);
      // Ensure DeepThink and Smart Search are ON for the entire chain
      await ensureDeepThinkOn(page).catch(() => {});
      await ensureSmartSearchOn(page).catch(() => {});
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'generating',
    description: 'Capture WHILE the reply is still streaming',
    group: 'A',
    run: async (page) => {
      // Double-check toggles are on before the critical prompt
      await ensureDeepThinkOn(page).catch(() => {});
      await ensureSmartSearchOn(page).catch(() => {});
      await submitPrompt(page, 'Search online for the latest weather');
      // Capture the moment streaming starts — send icon disappears
      await waitForStreamingStart(page);
    },
  },
  {
    label: 'in-conversation',
    description: 'Reply complete, thinking block expanded',
    group: 'A',
    run: async (page) => {
      // Wait for the textarea to become editable again (reply finished)
      await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 120_000 });
      await page.waitForTimeout(2000);
    },
  },
  {
    label: 'think-collapsed',
    description: 'Thinking block collapsed',
    group: 'A',
    run: async (page) => {
      // Click the think block header to collapse it
      const thinkHeader = page.locator(`[class*="${DSSelectors.THINK_HEADER_TOGGLE_CLASS}"]`).first();
      if (await thinkHeader.count() > 0) {
        await thinkHeader.click({ timeout: 10_000 });
      } else {
        // Fallback: try any think-block header-like element
        const fallback = page.locator(DSSelectors.THINK_BLOCK_SELECTOR + ' > div').first();
        if (await fallback.count() > 0) await fallback.click({ timeout: 5_000 });
        else throw new Error('No think-block header found — DeepThink may not have been enabled');
      }
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'edit-window',
    description: 'Edit window open on the submitted message',
    group: 'A',
    run: async (page) => {
      const editBtn = page.locator(`[class*="${DSSelectors.EDIT_MESSAGE_BUTTON_CLASS}"]`).first();
      await editBtn.click({ timeout: 10_000 });
      await page.waitForTimeout(1000);
    },
  },

  // ── Independent scenarios ──

  {
    label: 'sidebar-collapsed',
    description: 'Sidebar collapsed',
    group: 'B',
    run: async (page) => {
      await page.goto(DEEPSEEK_URL, { waitUntil: 'networkidle', timeout: 60_000 });
      await waitForTextarea(page);
      // Ensure sidebar is currently expanded, then collapse it
      const collapsed = await page.locator(DSSelectors.SIDEBAR_NATIVE_COLLAPSED_SELECTOR).count();
      if (collapsed > 0) {
        // Already collapsed — expand first so we can collapse it fresh
        await clickSidebarToggle(page);
      }
      const clicked = await clickSidebarToggle(page);
      if (!clicked) throw new Error('Sidebar toggle not found');
      // Verify collapse happened
      await page.locator(DSSelectors.SIDEBAR_NATIVE_COLLAPSED_SELECTOR).first()
        .waitFor({ state: 'visible', timeout: 5_000 });
    },
  },
  {
    label: 'sidebar-expanded',
    description: 'Sidebar expanded again',
    group: 'B',
    run: async (page) => {
      // Re-expand from the collapsed state left by the previous scenario
      const clicked = await clickSidebarToggle(page);
      if (!clicked) {
        // Direct click on collapsed rail
        const rail = page.locator(DSSelectors.SIDEBAR_NATIVE_COLLAPSED_SELECTOR).first();
        if (await rail.isVisible().catch(() => false)) {
          await rail.click({ timeout: 5_000 });
        }
      }
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'dropdown-open',
    description: 'Dropdown or floating menu open',
    group: 'C',
    run: async (page) => {
      await page.goto(DEEPSEEK_URL, { waitUntil: 'networkidle', timeout: 60_000 });
      await waitForTextarea(page);
      const modelBtn = page.locator('.' + DSSelectors.DS_BUTTON_CAPSULE_CLASS).first();
      await modelBtn.click({ timeout: 10_000 });
      await page.waitForTimeout(1000);
    },
  },
  {
    label: 'code-block',
    description: 'Reply containing a code block',
    group: 'D',
    run: async (page) => {
      await page.goto(DEEPSEEK_URL, { waitUntil: 'networkidle', timeout: 60_000 });
      await waitForTextarea(page);
      await submitPrompt(page, 'Write a hello world in Python');
      await page.locator('.md-code-block').first().waitFor({ state: 'visible', timeout: 120_000 });
      await page.waitForTimeout(2000);
    },
  },
  {
    label: 'search-reply',
    description: 'Assistant reply with search citations',
    group: 'E',
    run: async (page) => {
      await page.goto(DEEPSEEK_URL, { waitUntil: 'networkidle', timeout: 60_000 });
      await waitForTextarea(page);
      await ensureSmartSearchOn(page);
      await submitPrompt(page, 'What is the weather in Tokyo today?');
      // Wait for 5 action buttons below the assistant reply (response fully rendered)
      await page.waitForFunction(() => {
        const messages = document.querySelectorAll('.ds-message');
        if (messages.length === 0) return false;
        const lastMsg = messages[messages.length - 1];
        const parent = lastMsg.closest('[class]')?.parentElement;
        if (!parent) return false;
        const buttons = parent.querySelectorAll('div[role="button"]');
        return buttons.length >= 5;
      }, { timeout: 120_000 });
      await page.waitForTimeout(2000);
    },
  },
  {
    label: 'long-conversation',
    description: 'Long scrollable conversation',
    group: 'E',
    run: async (page) => {
      await page.goto(DEEPSEEK_URL, { waitUntil: 'networkidle', timeout: 60_000 });
      await waitForTextarea(page);
      await openFirstConversation(page);
    },
  },
];
