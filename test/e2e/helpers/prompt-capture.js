// Reads the prompt DeepSeek would have posted: send requests are aborted in the browser, so nothing reaches DeepSeek.

import { expect } from '@playwright/test';
import { blockSendRequests, composer } from './composer.js';
import { DEEPSEEK_ORIGIN } from './conversations.js';
import { presetOverlay } from './presets.js';

const COMPLETION_PATH = '/api/v0/chat/completion';

/** Loads `url` (the home page by default) in `page` and waits for the preset overlay. */
export async function gotoWithOverlay(page, url = DEEPSEEK_ORIGIN + '/') {
    await page.goto(url);
    await expect(presetOverlay(page), 'the preset overlay is shown (precondition)').toBeVisible();
}

/** Opens a new tab on the DeepSeek home page (a new conversation), runs `check(tab)`, then closes the tab. */
export async function inNewHomeTab(context, check) {
    const tab = await context.newPage();
    try {
        await gotoWithOverlay(tab, DEEPSEEK_ORIGIN + '/');
        await check(tab);
    } finally {
        await tab.close();
    }
}

/** Blocks every send request of `page`, then loads `url` (the home page by default) and waits for the preset overlay. */
export async function openBlockingSends(page, url = DEEPSEEK_ORIGIN + '/') {
    const blocked = await blockSendRequests(page);
    await gotoWithOverlay(page, url);
    return blocked;
}

/** Presses Enter on `text` in the composer and resolves the prompt of the (aborted) completion request it produced. */
export async function sendAndCapturePrompt(page, blocked, text) {
    const before = blocked.requests().length;
    await composer(page).fill(text);
    await composer(page).press('Enter');
    const isCompletion = ({ url }) => new URL(url).pathname === COMPLETION_PATH;
    await expect.poll(() => blocked.requests().slice(before).some(isCompletion), { message: 'pressing Enter posts a completion request (aborted)' }).toBe(true);
    const completion = blocked.requests().slice(before).find(isCompletion);
    expect(typeof completion.body?.prompt, 'the completion request carries a prompt field').toBe('string');
    return completion.body.prompt;
}

/** The prompt layout of docs/spec/01-prompt-system.md §2: the system-reminder block (omitted when `reminder` is empty), then the user-input block. */
export function documentedPrompt({ reminder = '', text }) {
    const userInput = `<user-input>\n${text}\n</user-input>`;
    return reminder ? `<system-reminder>\n${reminder}\n</system-reminder>\n\n${userInput}` : userInput;
}

/** 攔截 `page` 的所有送出請求，再載入 `url`（預設為首頁）並等待輸入框出現；不等待預設浮層，因為總開關關閉時浮層不會出現。 */
export async function openBlockingSendsWithoutOverlay(page, url = DEEPSEEK_ORIGIN + '/') {
    const blocked = await blockSendRequests(page);
    await page.goto(url);
    await expect(composer(page), 'the composer is shown (precondition)').toBeVisible();
    return blocked;
}
