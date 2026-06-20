import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

/**
 * Unit tests for censor-xhr-hook.js — edit_message endpoint support (v2.9+)
 *
 * Coverage:
 *   A. URL matching: getMatchedEndpoint observable behavior via send() guard
 *   B. edit_message SSE end-to-end parsing (THINK + BATCH CONTENT_FILTER + TEMPLATE_RESPONSE)
 *   C. Request-body extraction for edit_message payload
 *   D. Obsolescence guard: both endpoints must be intercepted
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ── Helpers to load IIFEs ────────────────────────────────────────────────────

function loadSseParser() {
    const src = fs.readFileSync(path.join(ROOT, 'content', 'sse-parser.js'), 'utf-8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox.SseParser;
}

/**
 * Load censor-xhr-hook.js into a controlled sandbox.
 * Returns an object with:
 *   - openProto: the patched XMLHttpRequest.prototype.open replacement
 *   - sendProto: the patched XMLHttpRequest.prototype.send replacement
 *   - postedMessages: array of messages captured from window.postMessage
 */
function loadXhrHook(SseParser) {
    const postedMessages = [];

    // Build a minimal XMLHttpRequest class that records calls.
    // The IIFE patches XMLHttpRequest.prototype.open/send.
    class MockXMLHttpRequest {
        constructor() {
            this._dssUrl = '';
            this._eventListeners = {};
            this.readyState = 0;
            this.responseText = '';
        }
        addEventListener(event, cb) {
            this._eventListeners[event] = cb;
        }
    }
    // Expose original prototypes that the IIFE will capture via closure.
    const originalOpen = vi.fn(function (method, url) {});
    const originalSend = vi.fn(function (body) {});
    MockXMLHttpRequest.prototype.open = originalOpen;
    MockXMLHttpRequest.prototype.send = originalSend;

    const sandbox = {
        XMLHttpRequest: MockXMLHttpRequest,
        SseParser,
        window: { postMessage: vi.fn((data) => postedMessages.push(data)) },
    };
    vm.createContext(sandbox);

    const hookSrc = fs.readFileSync(path.join(ROOT, 'content', 'censor-xhr-hook.js'), 'utf-8');
    vm.runInContext(hookSrc, sandbox);

    return {
        MockXMLHttpRequest,
        originalOpen,
        originalSend,
        postedMessages,
        sandbox,
    };
}

/**
 * Simulate a complete XHR lifecycle for the given URL and body.
 * Returns { messages, wasHooked } where wasHooked is true if the hook
 * installed a readystatechange listener (i.e. the URL was intercepted).
 */
function simulateXhr(hookCtx, url, body, sseText) {
    const xhr = new hookCtx.MockXMLHttpRequest();
    // Trigger patched open (captures _dssUrl)
    xhr.open('POST', url);
    // Trigger patched send (sets up listener if URL matches)
    xhr.send(body);
    const wasHooked = Boolean(xhr._eventListeners.readystatechange);
    // Simulate SSE delivery + completion
    xhr.responseText = sseText;
    xhr.readyState = 4;
    if (xhr._eventListeners.readystatechange) {
        xhr._eventListeners.readystatechange();
    }
    return { messages: hookCtx.postedMessages, wasHooked };
}

// ── Fixture SSE strings ──────────────────────────────────────────────────────

// edit_message fixture modeled on edit-message-api.yaml:
//   event: ready → response_message_id: 4 (NOT request message_id: 3)
//   THINK fragments accumulated
//   BATCH with CONTENT_FILTER + TEMPLATE_RESPONSE (must be filtered out)
//   event: close
const EDIT_MESSAGE_SSE = [
    'event: ready',
    'data: {"request_message_id":3,"response_message_id":4,"model_type":"default"}',
    '',
    'event: update_session',
    'data: {"updated_at":1780826417.212539}',
    '',
    'data: {"v":{"response":{"message_id":4,"parent_id":3,"model":"","role":"ASSISTANT","thinking_enabled":true,"ban_edit":false,"ban_regenerate":false,"status":"WIP","incomplete_message":null,"accumulated_token_usage":0,"feedback":null,"inserted_at":1780826417.200605,"search_enabled":true,"fragments":[{"id":2,"type":"THINK","content":"用户"}],"conversation_mode":"DEFAULT","has_pending_fragment":false,"auto_continue":false,"search_triggered":true}}}',
    '',
    'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"想知道"}',
    'data: {"v":"中国"}',
    'data: {"v":"为什么"}',
    'data: {"v":"禁止"}',
    'data: {"p":"response/fragments/-1/elapsed_secs","o":"SET","v":1.9737199749999998}',
    '',
    'data: {"p":"response","o":"BATCH","v":[{"p":"ban_regenerate","v":true},{"p":"status","v":"CONTENT_FILTER"},{"p":"accumulated_token_usage","v":78},{"p":"fragments","v":[{"id":3,"type":"TEMPLATE_RESPONSE","content":"Sorry, that\'s beyond my current scope. Let\'s talk about something else."}]},{"p":"has_pending_fragment","v":false},{"p":"quasi_status","v":"CONTENT_FILTER"}]}',
    '',
    'event: update_session',
    'data: {"updated_at":1780826420.173213}',
    '',
    'event: close',
    'data: {"click_behavior":"none","auto_resume":false}',
    '',
].join('\n');

// Normal completion SSE (no censorship) for comparison
const COMPLETION_SSE = [
    'data: {"v":{"response":{"message_id":10,"parent_id":9,"fragments":[{"id":1,"type":"THINK","content":""}]}}}',
    'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"thinking..."}',
    'data: {"p":"response/fragments","o":"APPEND","v":[{"id":2,"type":"RESPONSE","content":"Here is the answer."}]}',
    'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
].join('\n');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('censor-xhr-hook — edit_message endpoint support', () => {
    let SseParser;
    let hookCtx;

    beforeEach(() => {
        SseParser = loadSseParser();
        hookCtx = loadXhrHook(SseParser);
    });

    // ── Group A: URL matching ────────────────────────────────────────────────

    describe('A. URL matching — getMatchedEndpoint observable behavior', () => {
        // Observable proxy for getMatchedEndpoint: the hook installs a
        // readystatechange listener ONLY for matched URLs. wasHooked captures this.

        it('A1: intercepts /api/v0/chat/completion (short path)', () => {
            const { wasHooked } = simulateXhr(hookCtx, '/api/v0/chat/completion', '{}', COMPLETION_SSE);
            expect(wasHooked).toBe(true);
        });

        it('A2: intercepts /api/v0/chat/edit_message (short path)', () => {
            const { wasHooked } = simulateXhr(hookCtx, '/api/v0/chat/edit_message', '{}', EDIT_MESSAGE_SSE);
            expect(wasHooked).toBe(true);
        });

        it('A3: intercepts full https://chat.deepseek.com/api/v0/chat/edit_message URL', () => {
            const { wasHooked } = simulateXhr(hookCtx, 'https://chat.deepseek.com/api/v0/chat/edit_message', '{}', EDIT_MESSAGE_SSE);
            expect(wasHooked).toBe(true);
        });

        it('A4: passes through /api/v0/chat/history un-hooked', () => {
            const { wasHooked } = simulateXhr(hookCtx, '/api/v0/chat/history', '{}', '');
            expect(wasHooked).toBe(false);
        });

        it('A5: passes through /api/v0/file/upload un-hooked', () => {
            const { wasHooked } = simulateXhr(hookCtx, '/api/v0/file/upload', '{}', '');
            expect(wasHooked).toBe(false);
        });

        it('A6: passes through empty URL un-hooked', () => {
            const { wasHooked } = simulateXhr(hookCtx, '', '{}', '');
            expect(wasHooked).toBe(false);
        });

        // Tests A7 and A8 (console.log endpoint label assertions) were removed in v3.1.3
        // because all diagnostic console.* logging was purged from censor-xhr-hook.js.
        // URL matching behavior is sufficiently covered by A1-A6 (wasHooked assertions).
    });

    // ── Group B: edit_message SSE end-to-end ─────────────────────────────────

    describe('B. edit_message SSE parsing end-to-end', () => {
        let msg;

        beforeEach(() => {
            const editMessageBody = JSON.stringify({
                chat_session_id: '53fe6752-e786-4374-9712-825bf1bd5abc',
                message_id: 3,
                prompt: 'Current Time: 2026/06/07 18:10:26\n\n<user-input>\n중국은 왜 곰돌이 푸를 금지했을까요?\n</user-input>',
                search_enabled: true,
                thinking_enabled: true,
                action: null,
            });
            const { messages } = simulateXhr(hookCtx, '/api/v0/chat/edit_message', editMessageBody, EDIT_MESSAGE_SSE);
            msg = messages[0];
        });

        it('B1: dispatches exactly one DSS_FRAGMENT_COMPLETE message', () => {
            expect(hookCtx.postedMessages).toHaveLength(1);
            expect(msg.type).toBe('DSS_FRAGMENT_COMPLETE');
        });

        it('B2: messageId is 4 (from SSE response_message_id / message_id), NOT request message_id 3', () => {
            expect(msg.messageId).toBe(4);
        });

        it('B3: censored is true (BATCH contained CONTENT_FILTER status)', () => {
            expect(msg.censored).toBe(true);
        });

        it('B4: finished is true (CONTENT_FILTER terminates the stream)', () => {
            expect(msg.aborted).toBe(false);
        });

        it('B5: TEMPLATE_RESPONSE fragment is excluded from msg.fragments', () => {
            const templateFrags = msg.fragments.filter(f => f.type === 'TEMPLATE_RESPONSE');
            expect(templateFrags).toHaveLength(0);
        });

        it('B6: THINK fragment is present in msg.fragments', () => {
            const thinkFrags = msg.fragments.filter(f => f.type === 'THINK');
            expect(thinkFrags.length).toBeGreaterThan(0);
        });

        it('B7: THINK fragment accumulated content from APPEND and short-format events', () => {
            const thinkFrag = msg.fragments.find(f => f.type === 'THINK');
            expect(thinkFrag).toBeDefined();
            // Initial content "用户" + APPEND "想知道" + short-format "中国", "为什么", "禁止"
            expect(thinkFrag.content).toContain('用户');
            expect(thinkFrag.content).toContain('想知道');
            expect(thinkFrag.content).toContain('中国');
        });

        it('B8: thinkingElapsedSecs is set from elapsed_secs SET event', () => {
            expect(msg.thinkingElapsedSecs).toBeCloseTo(1.9737199749999998);
        });
    });

    // ── Group C: Request-body extraction for edit_message ───────────────────

    describe('C. Request-body extraction — edit_message payload', () => {
        it('C1: extracts chat_session_id from edit_message request body', () => {
            const body = JSON.stringify({
                chat_session_id: '53fe6752-e786-4374-9712-825bf1bd5abc',
                message_id: 3,
                prompt: 'test prompt',
            });
            simulateXhr(hookCtx, '/api/v0/chat/edit_message', body, EDIT_MESSAGE_SSE);
            const msg = hookCtx.postedMessages[0];
            expect(msg.chatSessionId).toBe('53fe6752-e786-4374-9712-825bf1bd5abc');
        });

        it('C2: extracts prompt from edit_message request body', () => {
            const body = JSON.stringify({
                chat_session_id: '53fe6752-e786-4374-9712-825bf1bd5abc',
                message_id: 3,
                prompt: 'Current Time: 2026/06/07 18:10:26\n\n<user-input>\n중국은 왜?\n</user-input>',
            });
            simulateXhr(hookCtx, '/api/v0/chat/edit_message', body, EDIT_MESSAGE_SSE);
            const msg = hookCtx.postedMessages[0];
            expect(msg.promptText).toBe('Current Time: 2026/06/07 18:10:26\n\n<user-input>\n중국은 왜?\n</user-input>');
        });

        it('C3: chatSessionId is null when body has no chat_session_id', () => {
            const body = JSON.stringify({ message_id: 3, prompt: 'test' });
            simulateXhr(hookCtx, '/api/v0/chat/edit_message', body, EDIT_MESSAGE_SSE);
            const msg = hookCtx.postedMessages[0];
            expect(msg.chatSessionId).toBeNull();
        });

        it('C4: promptText is null when body has non-string prompt', () => {
            const body = JSON.stringify({ chat_session_id: 'aabbccdd-0000-0000-0000-000000000000', prompt: 42 });
            simulateXhr(hookCtx, '/api/v0/chat/edit_message', body, EDIT_MESSAGE_SSE);
            const msg = hookCtx.postedMessages[0];
            expect(msg.promptText).toBeNull();
        });

        it('C5: gracefully handles non-JSON body (null chatSessionId and promptText)', () => {
            simulateXhr(hookCtx, '/api/v0/chat/edit_message', 'not-json', EDIT_MESSAGE_SSE);
            const msg = hookCtx.postedMessages[0];
            expect(msg.chatSessionId).toBeNull();
            expect(msg.promptText).toBeNull();
        });

        it('C6: body extraction works identically for completion endpoint', () => {
            const body = JSON.stringify({
                chat_session_id: 'aabbccdd-1111-2222-3333-444444444444',
                prompt: 'hello world',
            });
            simulateXhr(hookCtx, '/api/v0/chat/completion', body, COMPLETION_SSE);
            // Note: /chat/completion now also posts DSS_CHAT_COMPLETION_DETECTED before DSS_FRAGMENT_COMPLETE
            const msg = hookCtx.postedMessages.find(m => m.type === 'DSS_FRAGMENT_COMPLETE');
            expect(msg.chatSessionId).toBe('aabbccdd-1111-2222-3333-444444444444');
            expect(msg.promptText).toBe('hello world');
        });
    });

    // ── Group D: Regression — both endpoints must remain intercepted ─────────

    describe('D. Regression: both endpoints are intercepted', () => {
        it('D1: both completion and edit_message URLs install the SSE listener (wasHooked=true)', () => {
            const ctx2 = loadXhrHook(SseParser);
            const r1 = simulateXhr(ctx2, '/api/v0/chat/completion', '{}', COMPLETION_SSE);
            const r2 = simulateXhr(ctx2, '/api/v0/chat/edit_message', '{}', EDIT_MESSAGE_SSE);
            expect(r1.wasHooked).toBe(true);
            expect(r2.wasHooked).toBe(true);
        });

        it('D2: exactly 2 DSS_FRAGMENT_COMPLETE messages dispatched for one completion + one edit_message call', () => {
            const ctx2 = loadXhrHook(SseParser);
            simulateXhr(ctx2, '/api/v0/chat/completion', '{}', COMPLETION_SSE);
            simulateXhr(ctx2, '/api/v0/chat/edit_message', '{}', EDIT_MESSAGE_SSE);
            // Note: /chat/completion also posts DSS_CHAT_COMPLETION_DETECTED; filter for fragment messages only
            const fragmentMessages = ctx2.postedMessages.filter(m => m.type === 'DSS_FRAGMENT_COMPLETE');
            expect(fragmentMessages).toHaveLength(2);
        });
    });
});
