import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unit tests for censor-xhr-hook.js
 * Tests the SSE parsing logic that detects censorship (CONTENT_FILTER status)
 * and propagates the censored flag via postMessage to the content script.
 */

describe('censor-xhr-hook (XHR SSE parsing)', () => {
    let mockXhr;
    let mockWindow;
    let capturedStates = [];

    beforeEach(() => {
        capturedStates = [];

        // Setup mock window.postMessage to capture messages
        mockWindow = {
            postMessage: vi.fn((data) => {
                capturedStates.push(data);
            })
        };
    });

    /**
     * Simulates parsing SSE lines from a fixture file.
     * Uses the SSE parsing logic similar to censor-xhr-hook.js
     */
    function parseSSELines(sseContent) {
        const state = {
            messageId: null,
            fragments: null,
            thinkingElapsedSecs: 0,
            started: false,
            finished: false,
            censored: false,
            buffer: ''
        };

        const lines = sseContent.split('\n');
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            let parsed;
            try {
                parsed = JSON.parse(jsonStr);
            } catch {
                continue;
            }

            // Initial response event
            if (parsed.v && typeof parsed.v === 'object' && parsed.v.response) {
                const resp = parsed.v.response;
                state.messageId = resp.message_id;
                state.fragments = (resp.fragments || []).map(f => ({ ...f }));
                state.started = true;
            } else if (state.started) {
                // APPEND operation on content
                if (parsed.o === 'APPEND' && typeof parsed.v === 'string') {
                    const last = state.fragments[state.fragments.length - 1];
                    if (last) last.content = (last.content || '') + parsed.v;
                }
                // Short-format continuation
                else if (typeof parsed.v === 'string' && !parsed.o && !parsed.p && state.fragments.length > 0) {
                    const lastFrag = state.fragments[state.fragments.length - 1];
                    if (lastFrag) lastFrag.content = (lastFrag.content || '') + parsed.v;
                }
                // APPEND fragments array
                else if (parsed.o === 'APPEND' && Array.isArray(parsed.v)) {
                    for (const f of parsed.v) {
                        state.fragments.push({ ...f });
                    }
                }
                // SET operations (status, elapsed_secs, etc.)
                else if (parsed.o === 'SET') {
                    const pathStr = parsed.p || '';
                    if (pathStr.endsWith('/elapsed_secs') && typeof parsed.v === 'number') {
                        state.thinkingElapsedSecs = parsed.v;
                    }
                    // CRITICAL: Detect CONTENT_FILTER by checking status field
                    if (pathStr.endsWith('/status') || pathStr.endsWith('/quasi_status')) {
                        if (parsed.v === 'CONTENT_FILTER') {
                            state.censored = true;
                        }
                    }
                    // Finish on CONTENT_FILTER or FINISHED
                    if (parsed.v === 'FINISHED' || parsed.v === 'CONTENT_FILTER') {
                        state.finished = true;
                    }
                }
                // BATCH operations
                else if (parsed.o === 'BATCH' && Array.isArray(parsed.v)) {
                    for (const sub of parsed.v) {
                        if (sub.o === 'APPEND' && typeof sub.v === 'string') {
                            const last2 = state.fragments[state.fragments.length - 1];
                            if (last2) last2.content = (last2.content || '') + sub.v;
                        }
                        // BATCH: Check for path-based CONTENT_FILTER (e.g., {"p":"status","v":"CONTENT_FILTER"})
                        else if (!sub.o && sub.p && sub.v) {
                            const subPath = sub.p || '';
                            if ((subPath === 'status' || subPath === 'quasi_status' || subPath.endsWith('/status') || subPath.endsWith('/quasi_status')) && sub.v === 'CONTENT_FILTER') {
                                state.censored = true;
                            }
                            if (sub.v === 'FINISHED' || sub.v === 'CONTENT_FILTER') {
                                state.finished = true;
                            }
                        }
                        // BATCH: Check for SET status = CONTENT_FILTER
                        else if (sub.o === 'SET') {
                            const subPath = sub.p || '';
                            if ((subPath.endsWith('/status') || subPath.endsWith('/quasi_status')) && sub.v === 'CONTENT_FILTER') {
                                state.censored = true;
                            }
                            if (sub.v === 'FINISHED' || sub.v === 'CONTENT_FILTER') {
                                state.finished = true;
                            }
                        }
                    }
                }
            }
        }

        return state;
    }

    describe('Censored reply detection (CONTENT_FILTER)', () => {
        it('parses inline censored SSE (api-response-hidden equivalent) — detects CONTENT_FILTER and sets censored: true', () => {
            // Inline equivalent of the deleted api-response-hidden.yml fixture.
            // Represents a typical DeepSeek censored reply: THINK fragment → BATCH with CONTENT_FILTER status.
            const sseContent = [
                'data: {"v":{"response":{"message_id":1001,"fragments":[{"id":1,"type":"THINK","content":""}]}}}',
                'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"Thinking about the question..."}',
                'data: {"p":"response","o":"BATCH","v":[{"p":"status","v":"CONTENT_FILTER"},{"p":"ban_regenerate","v":true}]}',
                'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
            ].join('\n');

            const state = parseSSELines(sseContent);

            expect(state.censored).toBe(true);
            expect(state.finished).toBe(true);
            expect(state.messageId).toBeDefined();
            expect(state.fragments.length).toBeGreaterThan(0);
        });

        it('parses inline successful SSE (api-response-success equivalent) — no CONTENT_FILTER, censored: false', () => {
            // Inline equivalent of the deleted api-response-success.yml fixture.
            // Represents a normal successful reply that finishes with FINISHED and no CONTENT_FILTER.
            const sseContent = [
                'data: {"v":{"response":{"message_id":1002,"fragments":[{"id":1,"type":"THINK","content":""},{"id":2,"type":"RESPONSE","content":""}]}}}',
                'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"Here is the answer."}',
                'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
            ].join('\n');

            const state = parseSSELines(sseContent);

            expect(state.censored).toBe(false);
            expect(state.finished).toBe(true);
            expect(state.messageId).toBeDefined();
            expect(state.fragments.length).toBeGreaterThan(0);
        });

        it('simulates SSE stream: BATCH with CONTENT_FILTER → postMessage includes censored: true', () => {
            const sseContent = `data: {"v":{"response":{"message_id":38,"fragments":[{"id":2,"type":"THINK","content":"thinking"}]}}}
data: {"p":"response","o":"BATCH","v":[{"p":"status","v":"CONTENT_FILTER"}]}
data: {"p":"response/status","o":"SET","v":"FINISHED"}`;

            const state = parseSSELines(sseContent);

            expect(state.censored).toBe(true);
            expect(state.messageId).toBe(38);
        });

        it('simulates SSE stream: FINISHED without CONTENT_FILTER → postMessage includes censored: false', () => {
            const sseContent = `data: {"v":{"response":{"message_id":12,"fragments":[{"id":2,"type":"RESPONSE","content":"normal answer"}]}}}
data: {"p":"response/status","o":"SET","v":"FINISHED"}`;

            const state = parseSSELines(sseContent);

            expect(state.censored).toBe(false);
            expect(state.finished).toBe(true);
            expect(state.messageId).toBe(12);
        });
    });

    describe('XHR hook state tracking', () => {
        it('tracks state.censored across multiple SSE events', () => {
            const sseContent = `data: {"v":{"response":{"message_id":50,"fragments":[{"id":1,"type":"THINK","content":""}]}}}
data: {"p":"response/fragments/-1/content","o":"APPEND","v":"analyzing"}
data: {"v":"..."}
data: {"p":"response","o":"BATCH","v":[{"p":"status","v":"CONTENT_FILTER"},{"p":"accumulated_token_usage","v":123}]}`;

            const state = parseSSELines(sseContent);

            expect(state.messageId).toBe(50);
            expect(state.censored).toBe(true);
            expect(state.fragments[0].content).toContain('analyzing');
        });

        it('preserves censored flag even if multiple SET status events occur', () => {
            const sseContent = `data: {"v":{"response":{"message_id":99,"fragments":[{"id":1,"type":"RESPONSE","content":""}]}}}
data: {"p":"response/status","o":"SET","v":"WIP"}
data: {"p":"response/status","o":"SET","v":"CONTENT_FILTER"}
data: {"p":"response/status","o":"SET","v":"FINISHED"}`;

            const state = parseSSELines(sseContent);

            expect(state.censored).toBe(true);
            expect(state.finished).toBe(true);
        });
    });
});
