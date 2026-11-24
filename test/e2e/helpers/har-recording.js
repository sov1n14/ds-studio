// Reads the recorded DeepSeek HAR (tools/recordings/*.har) for the offline lane: finds the main recording (the newest `deepseek-YYYY-MM-DD.har`, purpose recordings with a name suffix excluded), filters it for Playwright's replay and parses what specs choose from it.
// The purpose recordings (`deepseek-YYYY-MM-DD-<purpose>.har`, each saved from its own account) add the conversations and sidebar lists the main recording lacks; `locatePurposeHars` finds them.
// The recording is the user's own session: nothing in it is copied into a spec; specs read it at run time, so a re-record needs no spec change.

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const RECORDINGS_DIR = path.join('tools', 'recordings');
const RE_RECORD_PROCEDURE = '.claude/skills/version-bump/SKILL.md#release-har-freshness-check';
const SETTINGS_PATH = '/api/v0/client/settings';
const HISTORY_PATH = '/api/v0/chat/history_messages';
const SIDEBAR_PATH = '/api/v0/chat_session/fetch_page';

// 主錄檔名稱固定為 deepseek-YYYY-MM-DD.har；帶用途後綴的檔案（如 deepseek-2026-11-23-scroll-chat-list.har）是專用錄檔，不當主錄檔
const MAIN_HAR_NAME = /^deepseek-(\d{4}-\d{2}-\d{2})\.har$/i;
const PURPOSE_HAR_NAME = /^deepseek-(\d{4}-\d{2}-\d{2})-(.+)\.har$/i;

/** The path of the file among `files` (`{ path, mtimeMs }`) whose name matches `pattern` (capture 1 is the date) with the latest date, a date tie going to the latest modification time; null when none matches. */
function newestByName(files, pattern) {
    let newest = null;
    for (const file of files) {
        const match = pattern.exec(path.basename(file.path));
        if (match === null) continue;
        const candidate = { file, date: match[1] };
        // 日期字串為 ISO 格式，字典序即時間序；同日才比修改時間
        if (newest === null || candidate.date > newest.date || (candidate.date === newest.date && file.mtimeMs > newest.file.mtimeMs)) newest = candidate;
    }
    return newest?.file.path ?? null;
}

/** The main recording among `files` (`{ path, mtimeMs }`): the file named `deepseek-YYYY-MM-DD.har` with the latest date, a date tie going to the latest modification time; null when none is named that way. */
export function selectNewestHar(files) {
    return newestByName(files, MAIN_HAR_NAME);
}

/** The `.har` files of `tools/recordings` under `repoRoot` as `{ path, mtimeMs }`; empty when the directory does not exist. */
function listRecordingFiles(repoRoot) {
    const directory = path.join(repoRoot, RECORDINGS_DIR);
    let names = [];
    try {
        names = readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.har'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    return names.map((name) => ({ path: path.join(directory, name), mtimeMs: statSync(path.join(directory, name)).mtimeMs }));
}

/** The main recording (`selectNewestHar`) under `tools/recordings` of `repoRoot`; throws, naming the directory and the re-record procedure, when there is none. */
export function locateNewestHar(repoRoot) {
    const newest = selectNewestHar(listRecordingFiles(repoRoot));
    if (newest === null) {
        throw new Error(`The offline lane replays a recorded DeepSeek session, but ${RECORDINGS_DIR.replaceAll(path.sep, '/')}/ holds no .har file. Record one as ${RE_RECORD_PROCEDURE} describes (a sanitized export of chat.deepseek.com, saved there), then rerun.`);
    }
    return newest;
}

/** The purpose recordings (`deepseek-YYYY-MM-DD-<purpose>.har`) under `tools/recordings` of `repoRoot` as a map of purpose name to its file with the latest date; empty when there is none. */
export function locatePurposeHars(repoRoot) {
    const filesByPurpose = new Map();
    for (const file of listRecordingFiles(repoRoot)) {
        const purpose = PURPOSE_HAR_NAME.exec(path.basename(file.path))?.[2];
        if (purpose !== undefined) filesByPurpose.set(purpose, [...(filesByPurpose.get(purpose) ?? []), file]);
    }
    return new Map([...filesByPurpose].map(([purpose, files]) => [purpose, newestByName(files, PURPOSE_HAR_NAME)]));
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

// 回覆的 RESPONSE 片段內有一行以 ``` 開頭，才算含程式碼區塊；行內提到 ``` 或思考區塊中的不算
const CODE_FENCE_LINE = /^```/m;

function describeConversation(body) {
    const data = body?.data?.biz_data;
    const id = data?.chat_session?.id;
    const messages = Array.isArray(data?.chat_messages) ? data.chat_messages : [];
    if (!id || messages.length === 0) return null;
    const replies = messages.filter((message) => message.role === 'ASSISTANT');
    const repliesWith = (test) => replies.filter((reply) => (reply.fragments ?? []).some(test)).length;
    return {
        id,
        messageCount: messages.length,
        replyCount: replies.length,
        thinkingReplyCount: repliesWith((fragment) => fragment.type === 'THINK'),
        searchReplyCount: repliesWith((fragment) => /SEARCH/.test(fragment.type)),
        codeBlockReplyCount: repliesWith((fragment) => fragment.type === 'RESPONSE' && CODE_FENCE_LINE.test(fragment.content ?? '')),
        hasContentFilter: messages.some((message) => message.status === 'CONTENT_FILTER'),
    };
}

/**
 * The history the recording holds per conversation id, a map in first-recorded order of `{ summary, body }`: the summary of `listConversations` and the parsed response body.
 * An id recorded several times keeps the response with the most messages; responses without messages or not JSON are skipped.
 */
export function listHistoryResponses(har) {
    const byId = new Map();
    for (const entry of har.log.entries) {
        const text = bodyOf(entry);
        if (!new URL(entry.request.url).pathname.endsWith(HISTORY_PATH) || entry.request.method !== 'GET' || text === null) continue;
        const body = parseJson(text);
        const summary = describeConversation(body);
        if (summary && summary.messageCount > (byId.get(summary.id)?.summary.messageCount ?? 0)) byId.set(summary.id, { summary, body });
    }
    return byId;
}

/**
 * The conversations the recording holds, one entry per id, in recorded order: `{ id, messageCount, replyCount, thinkingReplyCount, searchReplyCount, codeBlockReplyCount, hasContentFilter }`.
 * `codeBlockReplyCount` counts the replies whose answer text opens a line with a code fence.
 */
export function listConversations(har) {
    return [...listHistoryResponses(har).values()].map(({ summary }) => summary);
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

/**
 * Chooses a conversation per role among the conversations of the purpose recordings, or null where none fills it (the first listed wins a tie):
 * `longThread` (most messages), `withCodeBlocks` (most replies holding a code block).
 */
export function pickPurposeConversations(conversations) {
    return {
        longThread: firstWithMost(conversations, (conversation) => conversation.messageCount),
        withCodeBlocks: firstWithMost(conversations, (conversation) => conversation.codeBlockReplyCount),
    };
}

/** The first successful GET answer of the chat list (the sidebar) as `{ contentType, body }`, or null when the recording holds none. */
export function readSidebarResponse(har) {
    for (const entry of har.log.entries) {
        const body = bodyOf(entry);
        if (new URL(entry.request.url).pathname === SIDEBAR_PATH && entry.request.method === 'GET' && entry.response.status === 200 && body !== null) {
            return { contentType: entry.response.content.mimeType, body };
        }
    }
    return null;
}
