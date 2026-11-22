// Replays the recorded DeepSeek session (tools/recordings/*.har, see har-recording.js) inside the browser context of the offline lane, so a DeepSeek page renders with no network.
// Playwright runs the latest registered route first, so the order below is the reverse of the lookup: the proof-of-work worker stub, the settings answer, the conversation shell, the history parameter strip (and its latency),
// the main recording, the purpose recordings, then the miss route, which aborts and records what the recordings cannot answer (a top-level navigation to a host outside DeepSeek is left to the guard); the request guard registered at launch (offline-lane.js) sits behind all of them and still sees anything left to `fallback`.
// A purpose recording answers only what the main recording does not (the main recording is looked up first), so an identical url (`users/current`, the page document) is served from the main one.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    bodilessScriptUrls,
    createSettingsResponder,
    filterHar,
    listHistoryResponses,
    locateNewestHar,
    locatePurposeHars,
    pickConversations,
    pickPurposeConversations,
    readShellHtml,
    readSidebarResponse,
} from './har-recording.js';
import { POW_WORKER_STUB_SOURCE } from './pow-worker-stub.js';

const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com';
const TOKEN_KEY = 'userToken';
// The page boots signed out unless a token is stored; the value is a dummy, no request is ever sent to a real server.
const DUMMY_TOKEN = JSON.stringify({ value: 'offline-replay-token', __version: '0' });
const SETTINGS_PATH = '/api/v0/client/settings';
const HISTORY_PATH = '/api/v0/chat/history_messages';
const CREATE_PATH = '/api/v0/chat_session/create';
const SIDEBAR_PATH = '/api/v0/chat_session/fetch_page';
const CONVERSATION_PATH = /^\/a\/chat\/s\/([0-9a-f-]{36})$/i;
const NETWORK_URL = /^https?:\/\//;
// After the first load of a conversation the site revalidates its cache on the next load with these two query parameters; the recording holds each history under the bare url only.
const CACHE_REVALIDATION_PARAMS = ['cache_version', 'cache_reset_at'];

const PURPOSE_RECORDINGS = 'purpose recordings';
const isDeepSeekHost = (hostname) => hostname === 'deepseek.com' || hostname.endsWith('.deepseek.com');
const delay =(milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Installs the replay on `context` and resolves the replay handle:
 * `{ harPath, conversations, picks, requireConversation(role), purposeConversations, requirePurposeConversation(role), historyOf(id), serveConversationAs(target, id, source), useSidebarOf(page, purpose), setLatency({ historyMs, createMs }) }`.
 * `conversations` and `picks` come from the main recording only; `purposeConversations` (each with its `purpose`) from the purpose recordings.
 * `workDir` receives the filtered copies of the recordings; `misses` (replay-misses.js) records each request the recordings cannot answer, which is aborted in the browser.
 * Throws, naming `tools/recordings/` and the re-record procedure, when the repository holds no main recording.
 */
export async function installHarReplay(context, { repoRoot, workDir, misses }) {
    const harPath = locateNewestHar(repoRoot);
    const har = JSON.parse(readFileSync(harPath, 'utf8'));
    const filteredPath = path.join(workDir, 'replay.har');
    writeFileSync(filteredPath, JSON.stringify(filterHar(har)));

    const mainHistories = listHistoryResponses(har);
    const conversations = [...mainHistories.values()].map(({ summary }) => summary);
    const picks = pickConversations(conversations);
    const shellHtml = readShellHtml(har);
    const respondToSettings = createSettingsResponder(har);
    const powWorkerUrls = new Set(bodilessScriptUrls(har));

    const bodiesById = new Map([...mainHistories].map(([id, { body }]) => [id, body]));
    const purposeConversations = [];
    const sidebarsByPurpose = new Map();
    const purposeFilteredPaths = [];
    for (const [purpose, purposePath] of locatePurposeHars(repoRoot)) {
        const purposeHar = JSON.parse(readFileSync(purposePath, 'utf8'));
        purposeFilteredPaths.push(path.join(workDir, `replay-purpose-${purposeFilteredPaths.length}.har`));
        writeFileSync(purposeFilteredPaths.at(-1), JSON.stringify(filterHar(purposeHar)));
        for (const [id, { summary, body }] of listHistoryResponses(purposeHar)) {
            if (bodiesById.has(id)) continue;
            bodiesById.set(id, body);
            purposeConversations.push({ ...summary, purpose });
        }
        sidebarsByPurpose.set(purpose, readSidebarResponse(purposeHar));
    }
    const purposePicks = pickPurposeConversations(purposeConversations);
    const latency = { historyMs: 0, createMs: 0 };

    await context.addInitScript(({ origin, key, value }) => {
        if (location.origin === origin && localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }, { origin: DEEPSEEK_ORIGIN, key: TOKEN_KEY, value: DUMMY_TOKEN });

    // A top-level navigation to a host outside DeepSeek is no gap of the recordings but an escape: it goes on to the request guard, which aborts and records it.
    await context.route(NETWORK_URL, (route) => {
        const request = route.request();
        if (request.isNavigationRequest() && !isDeepSeekHost(new URL(request.url()).hostname)) return route.fallback();
        misses.record(request.method(), request.url());
        return route.abort('failed');
    });
    for (const purposeFilteredPath of purposeFilteredPaths) {
        await context.routeFromHAR(purposeFilteredPath, { notFound: 'fallback', url: NETWORK_URL });
    }
    await context.routeFromHAR(filteredPath, { notFound: 'fallback', url: NETWORK_URL });

    // The history of a conversation opened again carries the cache parameters the recordings never hold: the route hands the request on without them, so the replay answers with the recorded history.
    // A later route runs first, so this one (registered after the replay) also delays the answer by the latency set with `setLatency`.
    await context.route((url) => url.pathname === HISTORY_PATH, async (route) => {
        const url = new URL(route.request().url());
        CACHE_REVALIDATION_PARAMS.forEach((name) => url.searchParams.delete(name));
        if (latency.historyMs > 0) await delay(latency.historyMs);
        return route.fallback({ url: url.href });
    });
    await context.route((url) => url.pathname === CREATE_PATH, async (route) => {
        if (latency.createMs > 0) await delay(latency.createMs);
        return route.fallback();
    });

    // A document the recordings hold only for other conversations: the shell is the same page for every conversation, and for the home page whatever its query.
    const isShellUrl = (url) => url.origin === DEEPSEEK_ORIGIN && (bodiesById.has(CONVERSATION_PATH.exec(url.pathname)?.[1]) || (url.pathname === '/' && url.search !== ''));
    await context.route(isShellUrl, (route) => {
        if (shellHtml === null || !route.request().isNavigationRequest()) return route.fallback();
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: shellHtml });
    });

    // The site asks with a device id it makes up on a cold profile, so the recorded request never matches.
    await context.route((url) => url.pathname === SETTINGS_PATH, (route) => {
        const answer = respondToSettings(route.request().url());
        return answer ? route.fulfill({ status: answer.status, contentType: answer.contentType, body: answer.body }) : route.fallback();
    });

    await context.route((url) => powWorkerUrls.has(url.href), (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: POW_WORKER_STUB_SOURCE }));

    const mainRecording = `recording ${path.basename(harPath)}`;
    const requireRole = (roles, holder, role) => {
        const conversation = roles[role];
        if (!conversation) throw new Error(`The ${holder} holds no conversation for the role "${role}". Re-record a session that includes one, or pick another role.`);
        return conversation;
    };
    // `source` names a role of either set or a conversation id.
    const resolveSourceId = (source) => {
        if (source in picks) return requireRole(picks, mainRecording, source).id;
        if (source in purposePicks) return requireRole(purposePicks, PURPOSE_RECORDINGS, source).id;
        return source;
    };
    const historyOf = (id) => {
        if (!bodiesById.has(id)) throw new Error('The recordings hold no history for the requested conversation id.');
        return structuredClone(bodiesById.get(id));
    };

    return {
        harPath,
        conversations,
        picks,
        /** The recorded conversation filling `role` (a key of `picks`); throws, naming the role, when the recording holds none. */
        requireConversation: (role) => requireRole(picks, mainRecording, role),
        purposeConversations,
        /** The purpose-recording conversation filling `role` (`longThread`, `withCodeBlocks`); throws, naming the role, when the purpose recordings hold none. */
        requirePurposeConversation: (role) => requireRole(purposePicks, PURPOSE_RECORDINGS, role),
        /** A copy of the recorded history response of conversation `id`, from any recording; throws when none holds it. */
        historyOf,
        /**
         * Makes `target` (a page, or the context) open conversation `id` with the messages of `source` (a role of `picks` or of the purpose picks, or a conversation id): the page shell for its url and a history response whose conversation id is `id`.
         * The routes belong to `target` and go away with it.
         */
        async serveConversationAs(target, id, source) {
            const history = historyOf(resolveSourceId(source));
            history.data.biz_data.chat_session.id = id;
            await target.route((url) => url.origin === DEEPSEEK_ORIGIN && url.pathname === `/a/chat/s/${id}`, (route) => {
                if (shellHtml === null || !route.request().isNavigationRequest()) return route.fallback();
                return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: shellHtml });
            });
            await target.route((url) => url.pathname === HISTORY_PATH && url.searchParams.get('chat_session_id') === id, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history) }));
        },
        /** Makes `page` load the chat list (sidebar) of the purpose recording `purpose`, so the next load of the page shows it, and resolves `{ sessionIds }` of that list. Throws, naming the purposes found, when there is none. */
        async useSidebarOf(page, purpose) {
            const sidebar = sidebarsByPurpose.get(purpose);
            if (!sidebar) throw new Error(`No purpose recording named "${purpose}" holds a chat list; found: ${[...sidebarsByPurpose.keys()].join(', ') || 'no purpose recording'}.`);
            await page.route((url) => url.pathname === SIDEBAR_PATH, (route) => route.fulfill({ status: 200, contentType: sidebar.contentType, body: sidebar.body }));
            return { sessionIds: JSON.parse(sidebar.body).data.biz_data.chat_sessions.map((session) => session.id) };
        },
        /** Delays each history answer by `historyMs` and each session-create answer by `createMs` (a real server's latency); 0 answers at once. */
        setLatency({ historyMs = 0, createMs = 0 }) {
            latency.historyMs = historyMs;
            latency.createMs = createMs;
        },
    };
}
