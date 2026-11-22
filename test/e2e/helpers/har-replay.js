// Replays the recorded DeepSeek session (tools/recordings/*.har, see har-recording.js) inside the browser context of the offline lane, so a DeepSeek page renders with no network.
// Playwright runs the latest registered route first, so the order below is the reverse of the lookup: the proof-of-work worker stub, the settings answer, the conversation shell, the HAR replay,
// then the miss route, which aborts and records what the recording cannot answer; the request guard registered at launch (offline-lane.js) sits behind all of them and still sees anything left to `fallback`.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    bodilessScriptUrls,
    createSettingsResponder,
    filterHar,
    listConversations,
    locateNewestHar,
    pickConversations,
    readShellHtml,
} from './har-recording.js';
import { POW_WORKER_STUB_SOURCE } from './pow-worker-stub.js';

const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com';
const TOKEN_KEY = 'userToken';
// The page boots signed out unless a token is stored; the value is a dummy, no request is ever sent to a real server.
const DUMMY_TOKEN = JSON.stringify({ value: 'offline-replay-token', __version: '0' });
const SETTINGS_PATH = '/api/v0/client/settings';
const CONVERSATION_PATH = /^\/a\/chat\/s\/([0-9a-f-]{36})$/i;
const NETWORK_URL = /^https?:\/\//;

/**
 * Installs the replay on `context` and resolves `{ harPath, conversations, picks, requireConversation(role) }`.
 * `workDir` receives the filtered copy of the recording; `misses` (replay-misses.js) records each request the recording cannot answer, which is aborted in the browser.
 * Throws, naming `tools/recordings/` and the re-record procedure, when the repository holds no recording.
 */
export async function installHarReplay(context, { repoRoot, workDir, misses }) {
    const harPath = locateNewestHar(repoRoot);
    const har = JSON.parse(readFileSync(harPath, 'utf8'));
    const filteredPath = path.join(workDir, 'replay.har');
    writeFileSync(filteredPath, JSON.stringify(filterHar(har)));

    const conversations = listConversations(har);
    const picks = pickConversations(conversations);
    const recordedIds = new Set(conversations.map(({ id }) => id));
    const shellHtml = readShellHtml(har);
    const respondToSettings = createSettingsResponder(har);
    const powWorkerUrls = new Set(bodilessScriptUrls(har));

    await context.addInitScript(({ origin, key, value }) => {
        if (location.origin === origin && localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }, { origin: DEEPSEEK_ORIGIN, key: TOKEN_KEY, value: DUMMY_TOKEN });

    await context.route(NETWORK_URL, (route) => {
        misses.record(route.request().method(), route.request().url());
        return route.abort('failed');
    });
    await context.routeFromHAR(filteredPath, { notFound: 'fallback', url: NETWORK_URL });

    // A document the recording holds only for other conversations: the shell is the same page for every conversation.
    await context.route((url) => url.origin === DEEPSEEK_ORIGIN && recordedIds.has(CONVERSATION_PATH.exec(url.pathname)?.[1]), (route) => {
        if (shellHtml === null || !route.request().isNavigationRequest()) return route.fallback();
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: shellHtml });
    });

    // The site asks with a device id it makes up on a cold profile, so the recorded request never matches.
    await context.route((url) => url.pathname === SETTINGS_PATH, (route) => {
        const answer = respondToSettings(route.request().url());
        return answer ? route.fulfill({ status: answer.status, contentType: answer.contentType, body: answer.body }) : route.fallback();
    });

    await context.route((url) => powWorkerUrls.has(url.href), (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: POW_WORKER_STUB_SOURCE }));

    return {
        harPath,
        conversations,
        picks,
        /** The recorded conversation filling `role` (a key of `picks`); throws, naming the role, when the recording holds none. */
        requireConversation(role) {
            const conversation = picks[role];
            if (!conversation) throw new Error(`The recording ${path.basename(harPath)} holds no conversation for the role "${role}". Re-record a session that includes one, or pick another role.`);
            return conversation;
        },
    };
}
