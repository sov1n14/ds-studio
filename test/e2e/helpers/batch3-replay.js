// Batch 3 helpers for specs that open a recorded conversation in the offline lane (HAR replay, har-replay.js).
// After a conversation has loaded once, the site stores a cache version for it and asks again with `cache_version` and `cache_reset_at` in the url, which the recording never holds; the reload then renders no message.
// The route below strips those two parameters, so the replay answers with the recorded body of that conversation.

import { readFileSync } from 'node:fs';
import { MESSAGE_IN_VIEW_SELECTOR, openConversation } from './conversations.js';

const HISTORY_PATH = '/api/v0/chat/history_messages';
const CACHE_PARAMS = ['cache_version', 'cache_reset_at'];
const patchedContexts = new WeakSet();

/** Makes history requests of every page of `context` match the recording whatever cache parameters the site adds; installs once per context. */
export async function serveHistoryWithoutCacheParams(context) {
    if (patchedContexts.has(context)) return;
    patchedContexts.add(context);
    await context.route((url) => url.pathname === HISTORY_PATH && CACHE_PARAMS.some((name) => url.searchParams.has(name)), (route) => {
        const url = new URL(route.request().url());
        for (const name of CACHE_PARAMS) url.searchParams.delete(name);
        return route.fallback({ url: url.toString() });
    });
}

/** Opens the recorded conversation filling `role` in `page`, waits until a message renders and resolves the conversation record (`id`, `messageCount`, `thinkingReplyCount`, ...). */
export async function openRecordedConversation(page, deepseekReplay, role) {
    await serveHistoryWithoutCacheParams(page.context());
    const conversation = deepseekReplay.requireConversation(role);
    await openConversation(page, conversation.id);
    return conversation;
}

const ANSWER_FRAGMENT_TYPES = new Set(['RESPONSE', 'TEMPLATE_RESPONSE']);

/**
 * What each reply of the recorded conversation `conversationId` holds, in order: `{ hasThinking, hasAnswer }`, read from the recording's longest history response of that conversation.
 * An export spec derives its per-reply expectations from this, so they follow the recording instead of a hard-coded account.
 */
export function recordedReplyShapes(deepseekReplay, conversationId) {
    const har = JSON.parse(readFileSync(deepseekReplay.harPath, 'utf8'));
    let longest = [];
    for (const entry of har.log.entries) {
        const { url, method } = entry.request;
        const content = entry.response.content;
        if (method !== 'GET' || !url.includes(HISTORY_PATH) || !url.includes(conversationId) || !content?.text) continue;
        const text = content.encoding === 'base64' ? Buffer.from(content.text, 'base64').toString('utf8') : content.text;
        const messages = JSON.parse(text)?.data?.biz_data?.chat_messages ?? [];
        if (messages.length > longest.length) longest = messages;
    }
    return longest.filter((message) => message.role === 'ASSISTANT').map((reply) => {
        const fragments = reply.fragments ?? [];
        return {
            hasThinking: fragments.some((fragment) => fragment.type === 'THINK'),
            hasAnswer: fragments.some((fragment) => ANSWER_FRAGMENT_TYPES.has(fragment.type) && (fragment.content ?? '') !== ''),
        };
    });
}

export { MESSAGE_IN_VIEW_SELECTOR };
