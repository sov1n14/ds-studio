/**
 * Session messages posted by the REAL main-world hook (content/censor-xhr-hook.js).
 *
 * Contract (utils/temporary-chat-constants.js):
 *   - DSS_CHAT_CREATE_DETECTED { createdSessionId } is posted when a /api/v0/chat_session/create
 *     response arrives; createdSessionId is data.biz_data.chat_session.id of the response. A response
 *     the hook cannot read posts nothing and logs one [DSS] warning, so the session is never marked.
 *   - DSS_CHAT_COMPLETION_DETECTED { chatSessionId } is posted for a /api/v0/chat/completion request;
 *     chatSessionId is the chat_session_id of the request body.
 *   - Reading a fetch response or Request body must not consume the body the page itself reads.
 *
 * The hook runs through test/helpers/deepseek-page-harness.js: the only fakes are the network
 * (FakeXHR, the page fetch supplied per test) and the cross-world postMessage bridge, which delivers
 * each post to this window asynchronously with source: window. Assertions read the messages this
 * window receives, the way the content script sees them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    bootDeepSeekPage,
    CREATE_URL,
    COMPLETION_URL,
    createResponseBody,
    completionRequestBody,
} from '../helpers/deepseek-page-harness.js';

const N = '26c81320-1ce0-4172-bd5e-cb5b7a55f332';
const X = 'da794fe0-243a-4ba5-817a-b88ff327e634';
const CREATE_TYPE = 'DSS_CHAT_CREATE_DETECTED';
const COMPLETION_TYPE = 'DSS_CHAT_COMPLETION_DETECTED';

let received;
let warnSpy;

function onMessage(event) {
    received.push(event.data);
}

/** Messages of one type this window has received so far. */
function receivedOfType(type) {
    return received.filter((data) => data?.type === type);
}

/** [DSS] warnings logged so far. */
function dssWarnings() {
    return warnSpy.mock.calls.filter(([first]) => String(first).startsWith('[DSS]'));
}

/** Let the bridge task, fetch promise chains and body reads settle. */
async function settle() {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(text) {
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
    received = [];
    window.addEventListener('message', onMessage);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    window.removeEventListener('message', onMessage);
    vi.restoreAllMocks();
});

describe('censor-xhr-hook: create over XHR posts the created session id', () => {
    it.each([
        ['responseType "" (read as responseText)', ''],
        ['responseType "json" (read as response)', 'json'],
    ])('%s: posts nothing at send, then { createdSessionId } from the response', async (_label, responseType) => {
        const page = bootDeepSeekPage(window);

        const create = page.createSession(N, { responseType });
        await settle();
        expect(receivedOfType(CREATE_TYPE), 'the session id exists only in the response, so nothing is posted before it arrives').toEqual([]);

        create.respond();
        await settle();

        expect(receivedOfType(CREATE_TYPE)).toEqual([{ type: CREATE_TYPE, createdSessionId: N }]);
        expect(dssWarnings()).toEqual([]);
    });

    it('leaves the read of the response by the page intact', async () => {
        const page = bootDeepSeekPage(window);

        const create = page.createSession(N, { responseType: 'json' });
        create.respond();
        await settle();

        expect(create.xhr.response.data.biz_data.chat_session.id).toBe(N);
    });

    it('posts no create message for another chat_session endpoint or a completion', async () => {
        const page = bootDeepSeekPage(window, { fetch: async () => jsonResponse('{"code":0}') });

        await page.fetch('https://chat.deepseek.com/api/v0/chat_session/delete', { method: 'POST', body: JSON.stringify({ chat_session_id: X }) });
        page.sendCompletion(X);
        await settle();

        expect(receivedOfType(CREATE_TYPE)).toEqual([]);
    });
});

describe('censor-xhr-hook: create over fetch posts the created session id', () => {
    it('posts { createdSessionId } and the page still reads the same response body', async () => {
        const page = bootDeepSeekPage(window, { fetch: async () => jsonResponse(createResponseBody(N)) });

        const response = await page.fetch(CREATE_URL, { method: 'POST', body: '{}' });
        const pageBody = await response.json();
        await settle();

        expect(pageBody.data.biz_data.chat_session.id, 'the page must still be able to read its create response').toBe(N);
        expect(receivedOfType(CREATE_TYPE)).toEqual([{ type: CREATE_TYPE, createdSessionId: N }]);
    });

    it('a create sent as a Request object is observed too', async () => {
        const page = bootDeepSeekPage(window, { fetch: async () => jsonResponse(createResponseBody(N)) });

        const response = await page.fetch(new Request(CREATE_URL, { method: 'POST', body: '{}' }));
        await response.json();
        await settle();

        expect(receivedOfType(CREATE_TYPE)).toEqual([{ type: CREATE_TYPE, createdSessionId: N }]);
    });
});

describe('censor-xhr-hook: an unreadable create response posts nothing and warns once', () => {
    const UNREADABLE = [
        ['a non-JSON body', 'upstream gateway error'],
        ['JSON without data.biz_data.chat_session.id', JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: {} } })],
        ['an empty chat_session.id', JSON.stringify({ code: 0, data: { biz_data: { chat_session: { id: '' } } } })],
    ];

    it.each(UNREADABLE)('XHR with %s', async (_label, text) => {
        const page = bootDeepSeekPage(window);

        page.createSession(N).respond(text);
        await settle();

        expect(receivedOfType(CREATE_TYPE)).toEqual([]);
        expect(dssWarnings()).toHaveLength(1);
    });

    it('XHR with responseType "json" and a non-JSON body', async () => {
        const page = bootDeepSeekPage(window);

        page.createSession(N, { responseType: 'json' }).respond('not json');
        await settle();

        expect(receivedOfType(CREATE_TYPE)).toEqual([]);
        expect(dssWarnings()).toHaveLength(1);
    });

    it.each(UNREADABLE)('fetch with %s', async (_label, text) => {
        const page = bootDeepSeekPage(window, { fetch: async () => jsonResponse(text) });

        const response = await page.fetch(CREATE_URL, { method: 'POST', body: '{}' });
        await response.text();
        await settle();

        expect(receivedOfType(CREATE_TYPE)).toEqual([]);
        expect(dssWarnings()).toHaveLength(1);
    });
});

describe('censor-xhr-hook: completion posts the chat_session_id it was sent for', () => {
    it('XHR: chatSessionId comes from the send() body', async () => {
        const page = bootDeepSeekPage(window);

        page.sendCompletion(X);
        await settle();

        expect(receivedOfType(COMPLETION_TYPE)).toEqual([{ type: COMPLETION_TYPE, chatSessionId: X }]);
    });

    it('fetch: chatSessionId comes from init.body', async () => {
        const page = bootDeepSeekPage(window, { fetch: async () => new Response('', { status: 200 }) });

        await page.fetch(COMPLETION_URL, { method: 'POST', body: completionRequestBody(X) });
        await settle();

        expect(receivedOfType(COMPLETION_TYPE)).toEqual([{ type: COMPLETION_TYPE, chatSessionId: X }]);
    });

    it('fetch with a Request: chatSessionId comes from the Request body, which still reaches the network unread', async () => {
        const networkBodies = [];
        const page = bootDeepSeekPage(window, {
            fetch: async (request) => {
                networkBodies.push(await request.text());
                return new Response('', { status: 200 });
            },
        });

        await page.fetch(new Request(COMPLETION_URL, { method: 'POST', body: completionRequestBody(X) }));
        await settle();

        expect(receivedOfType(COMPLETION_TYPE)).toEqual([{ type: COMPLETION_TYPE, chatSessionId: X }]);
        expect(networkBodies, 'the hook must not consume the body the page sends').toEqual([completionRequestBody(X)]);
    });
});
