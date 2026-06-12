import { describe, it, expect, beforeEach } from 'vitest';
import CensorReplyRestore from '../../content/censor-reply-restore.js';

/**
 * Test Suite: Bug 1 — SSE Catch-All Filter
 *
 * Tests the catch-all branch in _parseSseEvent (censor-reply-restore.js line 664+) that appends SSE
 * event values to fragment content. The fix requires parsed.p.endsWith('/content') to filter out non-content updates.
 *
 * Issue: Without the path check, any string value would be appended to the last fragment's content,
 * causing status values like "FINISHED" or conversation_mode values to leak into fragment content.
 *
 * Fix Applied: The catch-all condition now requires:
 *   - parsed.v is a string
 *   - typeof parsed.p === 'string' AND parsed.p.endsWith('/content')
 *   - fragments array is non-empty
 *
 * This prevents non-content fields (/status, /conversation_mode, etc.) from polluting fragment content.
 */
describe('Bug 1: SSE Catch-All Filter (_parseSseEvent)', () => {
    let state;

    beforeEach(() => {
        state = {
            messageId: 1,
            fragments: [{ id: 1, type: 'RESPONSE', content: '' }],
            started: true
        };
    });

    it('(a) appends valid /content APPEND event to fragment content', () => {
        const line = 'data: {"p":"response/fragments/-1/content","v":"维"}';
        CensorReplyRestore._parseSseEvent(state, line);
        expect(state.fragments[0].content).toBe('维');
    });

    it('(b) does NOT append /status event to fragment content', () => {
        state.fragments[0].content = 'existing';
        const line = 'data: {"p":"response/fragments/-1/status","v":"FINISHED"}';
        CensorReplyRestore._parseSseEvent(state, line);
        // Content should remain unchanged
        expect(state.fragments[0].content).toBe('existing');
    });

    it('(c) does NOT append /conversation_mode event to fragment content', () => {
        state.fragments[0].content = 'hello';
        const line = 'data: {"p":"response/conversation_mode","v":"DEEP_SEARCH"}';
        CensorReplyRestore._parseSseEvent(state, line);
        // Content should remain unchanged
        expect(state.fragments[0].content).toBe('hello');
    });

    it('(d) does NOT append non-string values to fragment content', () => {
        state.fragments[0].content = 'test';
        const line = 'data: {"p":"response/has_pending_fragment","v":true}';
        CensorReplyRestore._parseSseEvent(state, line);
        // Content should remain unchanged (v is boolean, not string)
        expect(state.fragments[0].content).toBe('test');
    });

    it('handles multiple consecutive /content appends correctly', () => {
        const line1 = 'data: {"p":"response/fragments/-1/content","v":"hel"}';
        const line2 = 'data: {"p":"response/fragments/-1/content","v":"lo"}';

        CensorReplyRestore._parseSseEvent(state, line1);
        expect(state.fragments[0].content).toBe('hel');

        CensorReplyRestore._parseSseEvent(state, line2);
        expect(state.fragments[0].content).toBe('hello');
    });
});
