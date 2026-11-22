// Offline lane only: the fixture set of fixtures.js plus `revisitedHistory`, which lets a conversation opened a second time in the same browser reach the recorded history.
// DeepSeek stores a cache version after the first load of a conversation and asks for it again as `history_messages?chat_session_id=<id>&cache_version=<n>&cache_reset_at=<t>`; the recording holds the request without those two parameters, so the replay aborts every revisit as a miss and the page renders no messages.
// The route drops the two cache parameters and hands the request on, so the HAR replay answers it with the recorded history.
// The route also delays every history answer by the latency a real server has: the replay answers instantly, the overlay of the extension then shows before the binding of the opened conversation is resolved, and a spec that watches the overlay of a conversation sees the group of the previously opened one flash (observed: 2 of 10 runs of the chat-binding overlay test without the delay, 0 of 10 with it).
// `revisitedHistory` also serves the page shell for a home url that carries a query string (`/?tab=a`), which the recording holds only without one; the home page is the same shell whatever its query.
// The fixture `createLatency` (opt-in) delays each `chat_session/create` answer by the latency a real server has: the page creates its session while it boots, and an instant replay answers before the extension's page-world hook is installed, so the hook never sees that create and no session is ever paired with the first send.
// The live lane (`deepseekReplay` is null there) keeps its requests untouched.

import { test as base, expect } from '../fixtures.js';
import { recordedShellHtml } from './batch2-session-replay.js';

const HISTORY_PATH = '/api/v0/chat/history_messages';
const CREATE_PATH = '/api/v0/chat_session/create';
// Observed to be long enough for the hook to be installed before the create answer arrives.
const CREATE_LATENCY_MS = 400;
// Observed to be long enough for the binding of the opened conversation to be resolved before the overlay shows.
const HISTORY_LATENCY_MS = 400;
const CACHE_PARAMS = ['cache_version', 'cache_reset_at'];

function isHistoryRequest(url) {
    return url.pathname === HISTORY_PATH;
}

function isHomeWithQuery(url) {
    return url.origin === 'https://chat.deepseek.com' && url.pathname === '/' && url.search !== '';
}

export const test = base.extend({
    createLatency: async ({ context, deepseekReplay }, use) => {
        if (!deepseekReplay) {
            await use(null);
            return;
        }
        const isCreate = (url) => url.pathname === CREATE_PATH;
        const handler = async (route) => {
            await new Promise((resolve) => setTimeout(resolve, CREATE_LATENCY_MS));
            await route.fallback();
        };
        await context.route(isCreate, handler);
        try {
            await use(null);
        } finally {
            await context.unroute(isCreate, handler);
        }
    },

    revisitedHistory: [async ({ context, deepseekReplay }, use) => {
        if (!deepseekReplay) {
            await use(null);
            return;
        }
        const handler = async (route) => {
            const url = new URL(route.request().url());
            CACHE_PARAMS.forEach((name) => url.searchParams.delete(name));
            await new Promise((resolve) => setTimeout(resolve, HISTORY_LATENCY_MS));
            return route.fallback({ url: url.toString() });
        };
        const shellHtml = recordedShellHtml(deepseekReplay);
        const serveShell = (route) => (route.request().isNavigationRequest()
            ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: shellHtml })
            : route.fallback());
        await context.route(isHistoryRequest, handler);
        await context.route(isHomeWithQuery, serveShell);
        try {
            await use(null);
        } finally {
            await context.unroute(isHomeWithQuery, serveShell);
            await context.unroute(isHistoryRequest, handler);
        }
    }, { auto: true }],
});

export { expect };
