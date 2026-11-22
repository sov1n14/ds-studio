// `test` for offline-lane specs that open a recorded conversation: `openRecorded(role)` opens the conversation the recording holds for `role` (a key of the replay picks) and resolves its parsed data.

import { test as base } from '../fixtures.js';
import { openConversation } from './conversations.js';

const HISTORY_PATH = '/api/v0/chat/history_messages';
// After the first load of a conversation the site revalidates its cache on the next load with these two query parameters; the recording holds each conversation's full history under the bare url only.
const CACHE_REVALIDATION_PARAMS = ['cache_version', 'cache_reset_at'];

export const test = base.extend({
    // Worker-scoped and automatic: a later load of a conversation in the same browser profile asks for a cache revalidation the recording cannot answer, so the page would stay empty.
    // The route is registered after the replay (a later route runs first) and hands the request on to it without the revalidation parameters.
    historyRevalidationStripped: [async ({ offlineLane, deepseekReplay }, use) => {
        if (offlineLane && deepseekReplay) {
            await offlineLane.context.route((url) => url.pathname === HISTORY_PATH && CACHE_REVALIDATION_PARAMS.some((name) => url.searchParams.has(name)), (route) => {
                const url = new URL(route.request().url());
                CACHE_REVALIDATION_PARAMS.forEach((name) => url.searchParams.delete(name));
                return route.fallback({ url: url.href });
            });
        }
        await use();
    }, { scope: 'worker', auto: true }],

    // The conversation is chosen at run time from the recording (har-replay.js), so a re-record needs no spec change.
    openRecorded: async ({ page, deepseekReplay }, use) => {
        await use(async (role) => {
            const conversation = deepseekReplay.requireConversation(role);
            await openConversation(page, conversation.id);
            return conversation;
        });
    },
});

export { expect } from '../fixtures.js';
