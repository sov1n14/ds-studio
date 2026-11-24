// Loader that opens a conversation by uuid and waits until messages render.

import { DSSelectors } from './selectors.js';

export const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com';

export const MESSAGE_IN_VIEW_SELECTOR = `${DSSelectors.VISIBLE_ITEMS_SELECTOR} ${DSSelectors.MESSAGE_SELECTOR}`;

function conversationUrl(uuid) {
    return `${DEEPSEEK_ORIGIN}/a/chat/s/${uuid}`;
}

/** Navigates `page` to conversation `uuid` and waits until at least one message is rendered. */
export async function openConversation(page, uuid) {
    await page.goto(conversationUrl(uuid));
    await page.locator(MESSAGE_IN_VIEW_SELECTOR).first().waitFor({ state: 'attached', timeout: 30_000 });
}

// 在小型錄製上 `requireConversation` 的每個角色都會解析成同一個對話；需要第二個不同的對話或最短對話的 spec，從錄製自己的清單（`deepseekReplay.conversations`）挑選。

/** The first recorded conversation whose id differs from `excludedId`; throws, naming the need, when the recording holds only that one. */
export function conversationOtherThan(replay, excludedId) {
    const other = replay.conversations.find((conversation) => conversation.id !== excludedId);
    if (!other) throw new Error('The recording holds no second conversation, which this spec needs to compare with the first. Re-record a session that opens at least two conversations.');
    return other;
}

/** The recorded conversation with the fewest messages (the first listed wins a tie); throws when the recording holds none. */
export function shortestConversation(replay) {
    let shortest = null;
    for (const conversation of replay.conversations) {
        if (shortest === null || conversation.messageCount < shortest.messageCount) shortest = conversation;
    }
    if (shortest === null) throw new Error('The recording holds no conversation. Re-record a session that opens one.');
    return shortest;
}
