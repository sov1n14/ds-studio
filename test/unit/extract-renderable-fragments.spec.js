import { describe, it, expect, beforeEach } from 'vitest';
import CensorReplyRestore from '../../content/censor-reply-restore.js';

/**
 * Test Suite: Bug 3 — Extract Renderable Fragments
 *
 * Tests the _extractRenderableFragments() method (lines 250-271 in censor-reply-restore.js)
 * which filters and concatenates THINK and RESPONSE fragments for display.
 *
 * Issue: The method should correctly:
 * 1. Collect all THINK fragment contents and join with '\n\n'
 * 2. Accumulate all RESPONSE fragment contents (ignoring TEMPLATE_RESPONSE)
 * 3. Set hasThink and hasResponse flags appropriately
 * 4. Ignore other fragment types (TOOL_SEARCH, TOOL_OPEN, TEMPLATE_RESPONSE)
 */
describe('Bug 3: Extract Renderable Fragments', () => {
    it('(a) extracts pure THINK fragment with no RESPONSE', () => {
        const fragments = [
            { type: 'THINK', content: 'thinking...' }
        ];

        const result = CensorReplyRestore._extractRenderableFragments(fragments);

        expect(result.hasThink).toBe(true);
        expect(result.hasResponse).toBe(false);
        expect(result.thinkContent).toBe('thinking...');
        expect(result.responseContent).toBe('');
    });

    it('(b) extracts multiple THINK fragments joined with double newlines, plus RESPONSE', () => {
        const fragments = [
            { type: 'THINK', content: 't1' },
            { type: 'TOOL_SEARCH', content: 'FINISHED' },
            { type: 'THINK', content: 't2' },
            { type: 'TOOL_OPEN', content: 'x' },
            { type: 'THINK', content: 't3' },
            { type: 'RESPONSE', content: 'hello' }
        ];

        const result = CensorReplyRestore._extractRenderableFragments(fragments);

        expect(result.hasThink).toBe(true);
        expect(result.hasResponse).toBe(true);
        expect(result.thinkContent).toBe('t1\n\nt2\n\nt3');
        expect(result.responseContent).toBe('hello');
    });

    it('(c) ignores TEMPLATE_RESPONSE and uses only RESPONSE', () => {
        const fragments = [
            { type: 'THINK', content: 't' },
            { type: 'RESPONSE', content: 'r1' },
            { type: 'TEMPLATE_RESPONSE', content: 'tmpl' }
        ];

        const result = CensorReplyRestore._extractRenderableFragments(fragments);

        expect(result.hasResponse).toBe(true);
        expect(result.responseContent).toBe('r1');
    });

    it('(d) returns false flags when only TEMPLATE_RESPONSE exists', () => {
        const fragments = [
            { type: 'TEMPLATE_RESPONSE', content: 'tmpl' }
        ];

        const result = CensorReplyRestore._extractRenderableFragments(fragments);

        expect(result.hasThink).toBe(false);
        expect(result.hasResponse).toBe(false);
        expect(result.thinkContent).toBe('');
        expect(result.responseContent).toBe('');
    });

    it('(e) handles empty fragment array', () => {
        const fragments = [];

        const result = CensorReplyRestore._extractRenderableFragments(fragments);

        expect(result.hasThink).toBe(false);
        expect(result.hasResponse).toBe(false);
        expect(result.thinkContent).toBe('');
        expect(result.responseContent).toBe('');
    });

    it('(f) concatenates multiple RESPONSE fragments into single content', () => {
        const fragments = [
            { type: 'RESPONSE', content: 'hel' },
            { type: 'RESPONSE', content: 'lo' }
        ];

        const result = CensorReplyRestore._extractRenderableFragments(fragments);

        expect(result.hasResponse).toBe(true);
        expect(result.responseContent).toBe('hello');
    });

    it('ignores fragments with null/undefined content', () => {
        const fragments = [
            { type: 'THINK', content: null },
            { type: 'THINK', content: 'valid' },
            { type: 'RESPONSE', content: undefined },
            { type: 'RESPONSE', content: 'text' }
        ];

        const result = CensorReplyRestore._extractRenderableFragments(fragments);

        expect(result.thinkContent).toBe('valid');
        expect(result.responseContent).toBe('text');
    });

    it('ignores fragments with null or missing type', () => {
        const fragments = [
            { content: 'orphan' },
            { type: null, content: 'bad' },
            { type: 'RESPONSE', content: 'good' }
        ];

        const result = CensorReplyRestore._extractRenderableFragments(fragments);

        expect(result.responseContent).toBe('good');
        expect(result.hasResponse).toBe(true);
    });
});
