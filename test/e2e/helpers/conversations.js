// Kept conversations on the logged-in test account and a loader that waits until messages render.

import { DSSelectors } from './selectors.js';

export const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com';

export const CONVERSATIONS = Object.freeze({
    /** One reply with a thinking block and web-search references. */
    thinkingWithSearch: '7606c947-b0b1-4f8d-b517-4f3b10e303ed',
    /** Five replies, each with a thinking block. */
    fiveThinkingReplies: '8176d3c0-ab31-451d-b913-1599192b6b0c',
    /** Long conversation with code blocks (too slow to export). */
    longWithCode: '992fe9b3-9d38-46c1-8eb5-109193fc300d',
    /** Very long conversation (bottom scrollTop about 45800 at 1280x720) whose first mounted message still reaches into the viewport at the bottom; never delete it, go-top-native.e2e.js depends on it. */
    veryLongThread: '0ecaa661-fdb2-4d41-9f87-41d8262af32d',
});

export const MESSAGE_IN_VIEW_SELECTOR = `${DSSelectors.VISIBLE_ITEMS_SELECTOR} ${DSSelectors.MESSAGE_SELECTOR}`;

function conversationUrl(uuid) {
    return `${DEEPSEEK_ORIGIN}/a/chat/s/${uuid}`;
}

/** Navigates `page` to conversation `uuid` and waits until at least one message is rendered. */
export async function openConversation(page, uuid) {
    await page.goto(conversationUrl(uuid));
    await page.locator(MESSAGE_IN_VIEW_SELECTOR).first().waitFor({ state: 'attached', timeout: 30_000 });
}
