import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

/**
 * Unit tests for content/sse-parser.js — migrated from the orphaned
 * test/unit/sse-parser.test.js (never collected: it used a .test.js
 * extension while test/vitest.config.js only includes unit/**\/*.spec.js,
 * and its own `node` runner crashed under the ESM "type": "module" package).
 *
 * This file is the single home for SseParser unit tests. It covers:
 *   - SseParser.joinPath (5 direct cases)
 *   - Bare top-level array CONTENT_FILTER detection (no "o":"BATCH" wrapper,
 *     no top-level "p")
 *   - Absolute sub-path inside a BATCH envelope
 *   - parseLine(): initial response event, APPEND to content and to fragments,
 *     elapsed_secs, FINISHED, recursive BATCH, short-format continuation,
 *     invalid JSON
 *   - Short-format continuation accumulation across a multi-event sequence
 *   - censored-flag detection: relative-path CONTENT_FILTER inside a BATCH, and
 *     a clean FINISHED reply leaving censored false
 *
 * The last three groups were moved here out of censor-reply-restore.spec.js,
 * which tests a different module. TEMPLATE_RESPONSE filtering is covered in
 * censor-xhr-hook-edit-message.spec.js (groups B3, B5, B7).
 *
 * The fixture-based describe blocks from the original file (first/second/
 * third/fourth-API-resopnse) depended on test/samples/debugging/*.yaml,
 * which does not exist in this repo, and are not portable.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadSseParser() {
    const src = fs.readFileSync(path.join(ROOT, 'content', 'sse-parser.js'), 'utf-8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox.SseParser;
}

describe('SseParser', () => {
    let SseParser;

    beforeEach(() => {
        SseParser = loadSseParser();
    });

    describe('joinPath edge cases', () => {
        it('top-level call with full path (parentP=undefined) passes through', () => {
            expect(SseParser.joinPath(undefined, 'response/status')).toBe('response/status');
        });

        it('bare-array recursion with empty parent prepends /', () => {
            expect(SseParser.joinPath('', 'status')).toBe('/status');
        });

        it('BATCH recursion with parent path joins parent+child', () => {
            expect(SseParser.joinPath('response', 'status')).toBe('response/status');
        });

        it('absolute child path is returned as-is, overriding the parent', () => {
            expect(SseParser.joinPath('response', '/absolute/path')).toBe('/absolute/path');
        });

        it('null parent is treated as undefined (top-level)', () => {
            expect(SseParser.joinPath(null, 'response/status')).toBe('response/status');
        });
    });

    describe('CONTENT_FILTER detection — branches with no BATCH-relative-path coverage elsewhere', () => {
        it('bare top-level array (no "o":"BATCH", no top-level "p") detects CONTENT_FILTER', () => {
            const state = SseParser.createState();
            state.started = true;
            SseParser.parseLine(state, 'data: {"v":[{"p":"status","v":"CONTENT_FILTER"},{"p":"quasi_status","v":"CONTENT_FILTER"}]}');
            expect(state.censored).toBe(true);
        });

        it('absolute sub-path inside a BATCH envelope still sets censored', () => {
            const state = SseParser.createState();
            state.started = true;
            SseParser.parseLine(state, 'data: {"p":"response","o":"BATCH","v":[{"p":"/response/status","v":"CONTENT_FILTER"}]}');
            expect(state.censored).toBe(true);
        });
    });

    describe('SseParser.parseLine()', () => {
        let SseParser;

        beforeEach(() => {
            SseParser = loadSseParser();
        });

        // Shared boilerplate for every case below: clone an initial state, feed one SSE
        // line through the parser, and return the mutated state for assertions.
        function applyEvent(initialState, line) {
            const state = { ...initialState };
            SseParser.parseLine(state, line);
            return state;
        }

        it('parses initial response event with message_id and fragments', () => {
            const state = applyEvent({}, 'data: {"v":{"response":{"message_id":38,"fragments":[{"id":2,"type":"THINK","content":"We"}]}}}');
            expect(state.messageId).toBe(38);
            expect(state.fragments).toHaveLength(1);
            expect(state.fragments[0].type).toBe('THINK');
            expect(state.started).toBe(true);
        });

        it('appends content to the last fragment on APPEND /content', () => {
            const state = applyEvent(
                { messageId: 38, fragments: [{ id: 2, type: 'THINK', content: 'We' }], started: true },
                'data: {"p":"response/fragments/-1/content","o":"APPEND","v":" need"}'
            );
            expect(state.fragments[0].content).toBe('We need');
        });

        it('pushes new fragment on APPEND /fragments', () => {
            const state = applyEvent(
                { messageId: 38, fragments: [{ id: 2, type: 'THINK', content: 'We' }], started: true },
                'data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"Hi"}]}'
            );
            expect(state.fragments).toHaveLength(2);
            expect(state.fragments[1].type).toBe('RESPONSE');
        });

        it('sets elapsed_secs on SET /elapsed_secs', () => {
            const state = applyEvent(
                { messageId: 38, fragments: [{ id: 2, type: 'THINK', content: 'We' }], started: true },
                'data: {"p":"response/fragments/-1/elapsed_secs","o":"SET","v":1.425}'
            );
            expect(state.thinkingElapsedSecs).toBe(1.425);
        });

        it('marks finished on SET FINISHED', () => {
            const state = applyEvent(
                { messageId: 38, fragments: [{ id: 2, type: 'THINK', content: 'We' }], started: true },
                'data: {"p":"response/status","o":"SET","v":"FINISHED"}'
            );
            expect(state.finished).toBe(true);
        });

        it('handles BATCH operations recursively', () => {
            const state = applyEvent(
                { messageId: 38, fragments: [{ id: 2, type: 'THINK', content: '' }], started: true },
                'data: {"o":"BATCH","v":[{"o":"APPEND","v":"hello"},{"o":"SET","p":"x/elapsed_secs","v":0.5}]}'
            );
            expect(state.fragments[0].content).toBe('hello');
        });

        it('handles short format {"v":"..."} as continuation APPEND to fragments/-1/content', () => {
            // Event with v value but no p (path) or o (operation) — is a short-format continuation.
            // Should append to last fragment's content per SSE spec.
            const state = applyEvent(
                { messageId: 38, fragments: [{ id: 2, type: 'THINK', content: 'ab' }], started: true },
                'data: {"v":"cd"}'
            );
            // Content should be appended to produce combined value
            expect(state.fragments[0].content).toBe('abcd');
        });

        it('ignores short format {"v":"..."} when fragments is empty', () => {
            // Short-format event with empty fragments should be silently ignored
            const state = applyEvent({ messageId: 38, fragments: [], started: true }, 'data: {"v":"cd"}');
            // Fragments should remain empty, no error thrown
            expect(state.fragments).toHaveLength(0);
        });

        it('silently ignores invalid JSON', () => {
            const state = { started: true, fragments: [] };
            const line = 'data: {invalid';
            expect(() => SseParser.parseLine(state, line)).not.toThrow();
            expect(state.fragments).toHaveLength(0);
        });
    });

    describe('SSE short format continuation patches', () => {
        it('accumulates multiple short-format continuation events into fragment content', () => {
            const SseParser = loadSseParser();
            const state = {
                messageId: 38,
                fragments: [{ id: 2, type: 'THINK', content: '用户' }],
                started: true
            };

            // Simulate the sequence from api-response-first.yml:
            // 1. Initial APPEND with path
            let line = 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"提问"}';
            SseParser.parseLine(state, line);

            // 2-7. Multiple short-format continuation events
            const shortFormEvents = ['为什么', '中国', '禁止', '了', '小熊'];
            for (const value of shortFormEvents) {
                line = `data: {"v":"${value}"}`;
                SseParser.parseLine(state, line);
            }

            // After all events, the content should be the concatenation
            expect(state.fragments[0].content).toBe('用户提问为什么中国禁止了小熊');
            // Verify that content was actually accumulated (not just first 4 chars or similar regression)
            expect(state.fragments[0].content.length).toBeGreaterThan(4);
        });
    });

    describe('SseParser.parseLine() — censored flag detection', () => {
        let SseParser;

        beforeEach(() => {
            SseParser = loadSseParser();
        });

        it('parses SSE with BATCH containing CONTENT_FILTER — sets state.censored to true', () => {
            const state = {
                messageId: 24,
                fragments: [{ type: 'THINK', content: '用户问' }],
                started: true,
                censored: false,
                finished: false
            };
            const line = 'data: {"p":"response","o":"BATCH","v":[{"p":"ban_regenerate","v":true},{"p":"response/status","o":"SET","v":"CONTENT_FILTER"}]}';
            SseParser.parseLine(state, line);
            expect(state.censored).toBe(true);
        });

        it('parses fully normal reply (FINISHED with no CONTENT_FILTER) — sets state.censored to false', () => {
            const state = {
                messageId: 12,
                fragments: [{ type: 'THINK', content: '嗯' }, { type: 'RESPONSE', content: '這是一個重要問題' }],
                started: true,
                censored: false,
                finished: false
            };
            const line = 'data: {"p":"response/status","o":"SET","v":"FINISHED"}';
            SseParser.parseLine(state, line);
            expect(state.finished).toBe(true);
            expect(state.censored).toBe(false);
        });
    });
});
