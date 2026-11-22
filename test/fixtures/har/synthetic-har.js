// A small synthetic HAR for the HAR-replay unit specs: every host, id, title and body is invented, shaped like a Chrome DevTools export (`log.entries[]`, `_resourceType`, base64 bodies).

export const SHELL_URL = 'https://chat.example.test/';
export const API = 'https://chat.example.test/api/v0';
export const STATIC = 'https://static.example.test/chat/static';

/** An uuid-shaped id built from a digit, so a spec can name conversations without a real id. */
export function fakeId(digit) {
    return `${String(digit).repeat(8)}-0000-4000-8000-${String(digit).repeat(12)}`;
}

/** One HAR entry; `body` is a string (stored as is, or as base64 with `isBase64`) and a missing `body` records a bodiless response. */
export function entry({ method = 'GET', url, status = 200, mimeType = 'application/json', body, isBase64 = false, resourceType = 'xhr' }) {
    const content = { size: body?.length ?? 0, mimeType };
    if (body !== undefined) {
        content.text = isBase64 ? Buffer.from(body, 'utf8').toString('base64') : body;
        if (isBase64) content.encoding = 'base64';
    }
    return {
        _resourceType: resourceType,
        startedDateTime: '2000-01-01T00:00:00.000Z',
        request: { method, url, headers: [], queryString: [], headersSize: -1, bodySize: 0, cookies: [], httpVersion: 'HTTP/1.1' },
        response: { status, statusText: '', headers: [{ name: 'content-type', value: mimeType }], cookies: [], content, redirectURL: '', headersSize: -1, bodySize: 0, httpVersion: 'HTTP/1.1' },
        cache: {},
        timings: { send: 0, wait: 0, receive: 0 },
        time: 0,
    };
}

/** A DeepSeek-shaped `history_messages` response body for conversation `id`; `messages` are lists of fragment types, user turns first, then replies alternating. */
export function historyBody(id, messages) {
    return JSON.stringify({
        code: 0,
        data: {
            biz_code: 0,
            biz_data: {
                chat_session: { id, title: `synthetic ${id.slice(0, 1)}` },
                chat_messages: messages.map((fragmentTypes, index) => ({
                    message_id: index + 1,
                    role: fragmentTypes.includes('REQUEST') ? 'USER' : 'ASSISTANT',
                    status: 'FINISHED',
                    fragments: fragmentTypes.map((type, fragmentIndex) => ({ id: fragmentIndex + 1, type, content: `synthetic ${type}` })),
                })),
            },
        },
    });
}

/** The conversation with user turn and reply pairs given by `replies` (one fragment-type list per reply). */
export function conversationMessages(replies) {
    return replies.flatMap((fragmentTypes) => [['REQUEST'], fragmentTypes]);
}

/** A DeepSeek-shaped `history_messages` response body whose messages are given in full: `{ role, status?, fragments: [{ type, content }] }` each. */
export function messagesBody(id, messages) {
    return JSON.stringify({ code: 0, data: { biz_data: { chat_session: { id }, chat_messages: messages.map((message) => ({ status: 'FINISHED', ...message })) } } });
}

/** A HAR holding `entries` only. */
export function harOf(...entries) {
    return { log: { version: '1.2', creator: { name: 'synthetic', version: '0' }, pages: [], entries } };
}

export function settingsBody(marker) {
    return JSON.stringify({ code: 0, data: { biz_data: { settings: { marker: { value: marker } } } } });
}

/** The HAR of one synthetic recording session: shell document, scoped settings (recorded twice with different device ids), three conversations, a bodiless worker chunk, preflights and a failed request. */
export function syntheticHar() {
    const plain = ['RESPONSE'];
    const thinking = ['THINK', 'RESPONSE'];
    const searching = ['SEARCH', 'THINK', 'RESPONSE'];
    return {
        log: {
            version: '1.2',
            creator: { name: 'synthetic', version: '0' },
            pages: [],
            entries: [
                entry({ url: SHELL_URL, mimeType: 'text/html', body: '<!doctype html><title>synthetic shell</title>', resourceType: 'document' }),
                entry({ url: `${SHELL_URL}a/chat/s/${fakeId(1)}`, mimeType: 'text/html', body: '<!doctype html><title>synthetic shell</title>', resourceType: 'document' }),
                entry({ url: `${STATIC}/main.aaaa.js`, mimeType: 'text/javascript', body: 'window.__synthetic = 1;', resourceType: 'script' }),
                entry({ url: `${STATIC}/worker.bbbb.js`, mimeType: 'text/javascript', resourceType: 'other' }),
                entry({ url: `${API}/client/settings?did=device-one&scope=main`, body: settingsBody('main-one') }),
                entry({ url: `${API}/client/settings?did=device-two&scope=main`, body: settingsBody('main-two') }),
                entry({ url: `${API}/client/settings?did=device-one&scope=model`, body: settingsBody('model-one'), isBase64: true }),
                entry({ url: `${API}/chat/history_messages?chat_session_id=${fakeId(1)}`, body: historyBody(fakeId(1), conversationMessages([plain, plain])) }),
                entry({ url: `${API}/chat/history_messages?chat_session_id=${fakeId(2)}`, body: historyBody(fakeId(2), conversationMessages([thinking, thinking, plain])), isBase64: true }),
                entry({ url: `${API}/chat/history_messages?chat_session_id=${fakeId(3)}`, body: historyBody(fakeId(3), conversationMessages([searching])) }),
                entry({ url: `${API}/chat/history_messages?chat_session_id=${fakeId(1)}&cache_version=1&cache_reset_at=1`, body: historyBody(fakeId(1), []) }),
                entry({ url: `${API}/chat/history_messages?chat_session_id=${fakeId(1)}`, body: undefined }),
                entry({ method: 'OPTIONS', url: `${API}/telemetry`, status: 200, resourceType: 'preflight' }),
                entry({ method: 'GET', url: 'https://hif.example.test/query', status: 0, resourceType: 'xhr' }),
                entry({ method: 'POST', url: `${API}/chat/create_pow_challenge`, body: '{"code":0}' }),
            ],
        },
    };
}
