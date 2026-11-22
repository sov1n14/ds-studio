// Reads the recorded DeepSeek HAR (tools/recordings/*.har) for the offline lane: finds the newest recording, filters it for Playwright's replay and parses what specs choose from it.
// The recording is the user's own session: nothing in it is copied into a spec; specs read it at run time, so a re-record needs no spec change.

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const RECORDINGS_DIR = path.join('tools', 'recordings');
const RE_RECORD_PROCEDURE = '.claude/skills/version-bump/SKILL.md#release-har-freshness-check';
const SETTINGS_PATH = '/api/v0/client/settings';
const HISTORY_PATH = '/api/v0/chat/history_messages';

/** The path with the latest modification time among `files` (`{ path, mtimeMs }`), or null when there is none. */
export function selectNewestHar(files) {
    let newest = null;
    for (const file of files) {
        if (newest === null || file.mtimeMs > newest.mtimeMs) newest = file;
    }
    return newest?.path ?? null;
}

/** The newest `.har` under `tools/recordings` of `repoRoot`; throws, naming the directory and the re-record procedure, when there is none. */
export function locateNewestHar(repoRoot) {
    const directory = path.join(repoRoot, RECORDINGS_DIR);
    let names = [];
    try {
        names = readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.har'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const files = names.map((name) => ({ path: path.join(directory, name), mtimeMs: statSync(path.join(directory, name)).mtimeMs }));
    const newest = selectNewestHar(files);
    if (newest === null) {
        throw new Error(`The offline lane replays a recorded DeepSeek session, but ${RECORDINGS_DIR.replaceAll(path.sep, '/')}/ holds no .har file. Record one as ${RE_RECORD_PROCEDURE} describes (a sanitized export of chat.deepseek.com, saved there), then rerun.`);
    }
    return newest;
}

/** The response body of a HAR entry as text (base64 decoded), or null when the entry recorded none. */
function bodyOf(entry) {
    const content = entry.response?.content;
    if (!content?.text) return null;
    return content.encoding === 'base64' ? Buffer.from(content.text, 'base64').toString('utf8') : content.text;
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * A copy of `har` that Playwright's `routeFromHAR` can replay: OPTIONS preflights, entries recorded with status 0 and entries without a response body are dropped.
 * Without the filter a repeated GET replays the first matching entry, which may be a bodiless one.
 */
export function filterHar(har) {
    const entries = har.log.entries.filter((entry) => entry.request.method !== 'OPTIONS' && entry.response.status !== 0 && bodyOf(entry) !== null);
    return { ...har, log: { ...har.log, entries } };
}

/**
 * Builds the answer for `client/settings` requests: the site asks with a device id it makes up on a cold profile, so the recorded request never matches.
 * The returned function maps a request url to the first recorded body of its `scope` (`{ status, contentType, body }`), or null for another path or a scope the recording lacks.
 */
export function createSettingsResponder(har) {
    const byScope = new Map();
    for (const entry of har.log.entries) {
        const url = new URL(entry.request.url);
        const body = bodyOf(entry);
        if (url.pathname !== SETTINGS_PATH || entry.request.method !== 'GET' || entry.response.status !== 200 || body === null) continue;
        const scope = url.searchParams.get('scope');
        if (scope !== null && !byScope.has(scope)) byScope.set(scope, { status: 200, contentType: entry.response.content.mimeType, body });
    }
    return (requestUrl) => {
        const url = new URL(requestUrl);
        if (url.pathname !== SETTINGS_PATH) return null;
        return byScope.get(url.searchParams.get('scope')) ?? null;
    };
}

/** The HTML of the first recorded document (the page shell the single-page app boots from), or null when the recording holds none. */
export function readShellHtml(har) {
    for (const entry of har.log.entries) {
        const html = entry._resourceType === 'document' && entry.request.method === 'GET' ? bodyOf(entry) : null;
        if (html !== null) return html;
    }
    return null;
}

/** The urls of scripts the recording holds with no body: fetched by the proof-of-work worker, whose chunks the export cannot save. Each url is listed once. */
export function bodilessScriptUrls(har) {
    const urls = new Set();
    for (const entry of har.log.entries) {
        const isScript = /javascript/i.test(entry.response.content?.mimeType ?? '');
        if (entry.request.method === 'GET' && entry.response.status === 200 && isScript && bodyOf(entry) === null) urls.add(entry.request.url);
    }
    return [...urls];
}

function describeConversation(body) {
    const data = parseJson(body)?.data?.biz_data;
    const id = data?.chat_session?.id;
    const messages = Array.isArray(data?.chat_messages) ? data.chat_messages : [];
    if (!id || messages.length === 0) return null;
    const replies = messages.filter((message) => message.role === 'ASSISTANT');
    const repliesWith = (test) => replies.filter((reply) => (reply.fragments ?? []).some((fragment) => test(fragment.type))).length;
    return {
        id,
        messageCount: messages.length,
        replyCount: replies.length,
        thinkingReplyCount: repliesWith((type) => type === 'THINK'),
        searchReplyCount: repliesWith((type) => /SEARCH/.test(type)),
        hasContentFilter: messages.some((message) => message.status === 'CONTENT_FILTER'),
    };
}

/**
 * The conversations the recording holds, one entry per id, in recorded order: `{ id, messageCount, replyCount, thinkingReplyCount, searchReplyCount, hasContentFilter }`.
 * An id recorded several times keeps the response with the most messages; responses without messages or not JSON are skipped.
 */
export function listConversations(har) {
    const byId = new Map();
    for (const entry of har.log.entries) {
        const body = bodyOf(entry);
        if (!new URL(entry.request.url).pathname.endsWith(HISTORY_PATH) || entry.request.method !== 'GET' || body === null) continue;
        const conversation = describeConversation(body);
        if (conversation && conversation.messageCount > (byId.get(conversation.id)?.messageCount ?? 0)) byId.set(conversation.id, conversation);
    }
    return [...byId.values()];
}

function firstWithMost(conversations, score) {
    let best = null;
    for (const conversation of conversations) {
        if (score(conversation) > (best ? score(best) : 0)) best = conversation;
    }
    return best;
}

/**
 * Chooses a conversation per role, or null where none fills it (the first listed wins a tie):
 * `withThinking` (most replies with a thinking block), `withSearch` (most replies with a search), `withContentFilter` (holds a filtered message), `mostMessages`.
 */
export function pickConversations(conversations) {
    return {
        withThinking: firstWithMost(conversations, (conversation) => conversation.thinkingReplyCount),
        withSearch: firstWithMost(conversations, (conversation) => conversation.searchReplyCount),
        withContentFilter: firstWithMost(conversations, (conversation) => Number(conversation.hasContentFilter)),
        mostMessages: firstWithMost(conversations, (conversation) => conversation.messageCount),
    };
}
