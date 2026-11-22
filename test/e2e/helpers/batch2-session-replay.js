// Serves a conversation id the recording never held (one DeepSeek created during a test) as if it were a recorded conversation, so it can be reopened or refreshed in the offline lane.
// The page shell and the history are read from the recording at run time (the same file har-replay.js replays); nothing of the recording is copied into a spec.
// Without it a document load of an unrecorded conversation url, and its history request, are replay misses: the page shows no messages, or goes back to the home page when the history is empty.

import { readFileSync } from 'node:fs';
import { readShellHtml } from './har-recording.js';

const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com';
const HISTORY_PATH = '/api/v0/chat/history_messages';
const harByPath = new Map();

function loadHar(harPath) {
    if (!harByPath.has(harPath)) harByPath.set(harPath, JSON.parse(readFileSync(harPath, 'utf8')));
    return harByPath.get(harPath);
}

function bodyText(entry) {
    const content = entry.response?.content;
    if (!content?.text) return null;
    return content.encoding === 'base64' ? Buffer.from(content.text, 'base64').toString('utf8') : content.text;
}

/** The page shell HTML of the recording `replay` (the `deepseekReplay` fixture); throws when the recording holds none. */
export function recordedShellHtml(replay) {
    const shellHtml = readShellHtml(loadHar(replay.harPath));
    if (shellHtml === null) throw new Error('The recording holds no page shell to serve a url from.');
    return shellHtml;
}

/** The recorded history response of `sourceId` with the most messages, parsed; throws when the recording holds none. */
function recordedHistory(har, sourceId) {
    let best = null;
    for (const entry of har.log.entries) {
        const url = new URL(entry.request.url);
        const text = bodyText(entry);
        if (!url.pathname.endsWith(HISTORY_PATH) || entry.request.method !== 'GET' || url.searchParams.get('chat_session_id') !== sourceId || text === null) continue;
        let body;
        try {
            body = JSON.parse(text);
        } catch {
            continue;
        }
        const count = body?.data?.biz_data?.chat_messages?.length ?? 0;
        if (count > (best?.data.biz_data.chat_messages.length ?? 0)) best = body;
    }
    if (best === null) throw new Error(`The recording holds no history for the conversation chosen as the source (${sourceId}).`);
    return best;
}

/**
 * Makes `page` open conversation `id` with the messages of the recorded conversation `source` (an entry of `replay.conversations`): the page shell for its url and a history response whose conversation id is `id`.
 * The routes belong to `page` and go away with it.
 * @param {import('@playwright/test').Page} page
 * @param {{ harPath: string }} replay the `deepseekReplay` fixture
 */
export async function serveConversationAs(page, replay, id, source) {
    const shellHtml = recordedShellHtml(replay);
    const history = recordedHistory(loadHar(replay.harPath), source.id);
    history.data.biz_data.chat_session.id = id;

    await page.route((url) => url.origin === DEEPSEEK_ORIGIN && url.pathname === `/a/chat/s/${id}`, (route) => {
        if (!route.request().isNavigationRequest()) return route.fallback();
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: shellHtml });
    });
    await page.route((url) => url.pathname === HISTORY_PATH && url.searchParams.get('chat_session_id') === id, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history) }));
}
