import { describe, it, expect, beforeEach } from 'vitest';
import CensorReplyRestore from '../../content/censor-reply-restore.js';

/**
 * Integration Test: SSE Parsing from Realistic Sample Data
 *
 * Tests end-to-end SSE parsing using realistic DS studio API response patterns.
 * Verifies that:
 * 1. Fragments are correctly parsed and accumulated
 * 2. RESPONSE fragments contain actual content (not status/mode strings)
 * 3. Fragment content does not contain "FINISHED" or other control values
 * 4. The final state reflects proper response assembly
 */
describe('Integration: SSE Parsing with Realistic Sample Data', () => {
    let sseLines;
    let state;

    beforeEach(() => {
        // Realistic SSE lines extracted from a typical DS studio API response
        // This simulates the structure of api-response-second.yml
        sseLines = [
            'data: {"v":{"response":{"message_id":4,"parent_id":3,"thinking_enabled":true,"fragments":[{"id":2,"type":"THINK","content":"用户"}]}}}',
            'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"想知道"}',
            'data: {"v":"維"}',
            'data: {"v":"尼"}',
            'data: {"v":"小熊"}',
            'data: {"p":"response/fragments/-1/elapsed_secs","o":"SET","v":1.316757226}',
            'data: {"p":"response","o":"BATCH","v":[{"p":"fragments","o":"APPEND","v":[{"id":3,"type":"TOOL_SEARCH","status":"WIP","content":null}]},{"p":"has_pending_fragment","o":"SET","v":false}]}',
            'data: {"p":"response/fragments/-1/status","v":"FINISHED"}',
            'data: {"p":"response/fragments","o":"APPEND","v":[{"id":14,"type":"RESPONSE","content":"关于"}]}',
            'data: {"p":"response/fragments/-1/content","v":"\""}',
            'data: {"v":"維"}',
            'data: {"v":"尼"}',
            'data: {"v":"小熊"}',
            'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"\"（"}',
            'data: {"v":"在中国"}',
            'data: {"v":"的情况"}',
            'data: {"v":"，"}',
            'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"。"}',
            'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":647},{"p":"quasi_status","v":"FINISHED"}]}',
            'data: {"p":"response/status","o":"SET","v":"FINISHED"}'
        ];

        // Initialize parsing state
        state = {
            messageId: null,
            fragments: [],
            thinkingElapsedSecs: 0,
            started: false,
            finished: false,
            thinkingEnabled: false
        };
    });

    it('parses all SSE lines without throwing errors', () => {
        expect(sseLines.length).toBeGreaterThan(0);
        expect(() => {
            for (const line of sseLines) {
                CensorReplyRestore._parseSseEvent(state, line);
            }
        }).not.toThrow();
    });

    it('results in fragments array with at least one RESPONSE fragment', () => {
        for (const line of sseLines) {
            CensorReplyRestore._parseSseEvent(state, line);
        }

        expect(state.fragments).toBeDefined();
        expect(state.fragments.length).toBeGreaterThan(0);

        const responseFragments = state.fragments.filter(f => f.type === 'RESPONSE');
        expect(responseFragments.length).toBeGreaterThan(0);
    });

    it('no fragment content equals "FINISHED"', () => {
        for (const line of sseLines) {
            CensorReplyRestore._parseSseEvent(state, line);
        }

        for (const fragment of state.fragments) {
            if (fragment.content) {
                expect(fragment.content).not.toBe('FINISHED');
                expect(fragment.content).not.toBe('CONTENT_FILTER');
            }
        }
    });

    it('RESPONSE fragment contains non-empty actual content without control strings', () => {
        for (const line of sseLines) {
            CensorReplyRestore._parseSseEvent(state, line);
        }

        const responseFragments = state.fragments.filter(f => f.type === 'RESPONSE');
        expect(responseFragments.length).toBeGreaterThan(0);

        for (const responseFragment of responseFragments) {
            if (responseFragment.content) {
                expect(responseFragment.content).toBeTruthy();
                expect(responseFragment.content).not.toContain('FINISHED');
            }
        }
    });

    it('correctly accumulates message_id from initial response event', () => {
        for (const line of sseLines) {
            CensorReplyRestore._parseSseEvent(state, line);
        }

        expect(state.messageId).toBeTruthy();
        expect(typeof state.messageId).toBe('number');
    });

    it('tracks thinking_enabled when THINK fragments are present', () => {
        for (const line of sseLines) {
            CensorReplyRestore._parseSseEvent(state, line);
        }

        const thinkFragments = state.fragments.filter(f => f.type === 'THINK');
        if (thinkFragments.length > 0) {
            expect(state.thinkingEnabled).toBe(true);
        }
    });

    it('final state has started=true and finished=true after complete parsing', () => {
        for (const line of sseLines) {
            CensorReplyRestore._parseSseEvent(state, line);
        }

        expect(state.started).toBe(true);
        expect(state.finished).toBe(true);
    });

    it('extracts renderable content correctly from parsed fragments', () => {
        for (const line of sseLines) {
            CensorReplyRestore._parseSseEvent(state, line);
        }

        const extracted = CensorReplyRestore._extractRenderableFragments(state.fragments);

        expect(extracted).toBeDefined();
        if (state.fragments.some(f => f.type === 'RESPONSE')) {
            expect(extracted.hasResponse).toBe(true);
            expect(extracted.responseContent.length).toBeGreaterThan(0);
            expect(extracted.responseContent).not.toContain('FINISHED');
        }
    });
});
