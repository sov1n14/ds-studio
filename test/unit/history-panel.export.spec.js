import { describe, it, expect } from 'vitest';
import HistoryPanelExport from '../../content/history-panel.export.js';

const { toMarkdown, buildFilename } = HistoryPanelExport;

function makeMessage({ role, insertedAt, fragments }) {
    return { role, insertedAt, fragments };
}

describe('HistoryPanelExport', () => {
    // ─────────────────────────────────────
    //  toMarkdown
    // ─────────────────────────────────────

    describe('toMarkdown', () => {
        it('returns "" when threadResult is nullish', () => {
            expect(toMarkdown(null)).toBe('');
            expect(toMarkdown(undefined)).toBe('');
        });

        it('returns "" when threadResult.ok is false', () => {
            expect(toMarkdown({ ok: false, reason: 'NO_RECORD', messages: [] })).toBe('');
        });

        it('returns "" when messages is empty', () => {
            expect(toMarkdown({ ok: true, title: 'x', messages: [] })).toBe('');
        });

        it('builds an H1 title from threadResult.title', () => {
            const result = toMarkdown({
                ok: true,
                title: 'My Chat',
                messages: [makeMessage({ role: 'USER', insertedAt: 1000, fragments: [{ type: 'TEXT', content: 'hi' }] })],
            });
            expect(result.startsWith('# My Chat\n')).toBe(true);
        });

        it('falls back to default title when title is empty/missing', () => {
            const result = toMarkdown({
                ok: true,
                title: '',
                messages: [makeMessage({ role: 'USER', insertedAt: 1000, fragments: [{ type: 'TEXT', content: 'hi' }] })],
            });
            expect(result.startsWith('# DeepSeek 對話\n')).toBe(true);
        });

        it('renders a USER speaker heading', () => {
            const result = toMarkdown({
                ok: true,
                title: 't',
                messages: [makeMessage({ role: 'USER', insertedAt: 1000, fragments: [{ type: 'TEXT', content: 'hi' }] })],
            });
            expect(result).toContain('## 🧑 使用者');
        });

        it('renders an ASSISTANT speaker heading', () => {
            const result = toMarkdown({
                ok: true,
                title: 't',
                messages: [makeMessage({ role: 'ASSISTANT', insertedAt: 1000, fragments: [{ type: 'TEXT', content: 'hi' }] })],
            });
            expect(result).toContain('## 🤖 助理');
        });

        it('excludes THINK fragment content from the output', () => {
            const result = toMarkdown({
                ok: true,
                title: 't',
                messages: [
                    makeMessage({
                        role: 'ASSISTANT',
                        insertedAt: 1000,
                        fragments: [
                            { type: 'THINK', content: 'secret reasoning' },
                            { type: 'TEXT', content: 'visible reply' },
                        ],
                    }),
                ],
            });
            expect(result).not.toContain('secret reasoning');
            expect(result).toContain('visible reply');
        });

        it('includes non-THINK content in fragment order', () => {
            const result = toMarkdown({
                ok: true,
                title: 't',
                messages: [
                    makeMessage({
                        role: 'ASSISTANT',
                        insertedAt: 1000,
                        fragments: [
                            { type: 'TEXT', content: 'first' },
                            { type: 'TEXT', content: 'second' },
                        ],
                    }),
                ],
            });
            const firstIdx = result.indexOf('first');
            const secondIdx = result.indexOf('second');
            expect(firstIdx).toBeGreaterThan(-1);
            expect(secondIdx).toBeGreaterThan(firstIdx);
        });

        it('derives the datetime line from insertedAt (epoch seconds)', () => {
            const insertedAt = 1700000000; // fixed epoch seconds
            const expected = new Date(insertedAt * 1000).toLocaleString();
            const result = toMarkdown({
                ok: true,
                title: 't',
                messages: [makeMessage({ role: 'USER', insertedAt, fragments: [{ type: 'TEXT', content: 'hi' }] })],
            });
            expect(result).toContain(`*${expected}*`);
        });

        it('joins multiple messages with a horizontal rule separator', () => {
            const result = toMarkdown({
                ok: true,
                title: 't',
                messages: [
                    makeMessage({ role: 'USER', insertedAt: 1, fragments: [{ type: 'TEXT', content: 'q' }] }),
                    makeMessage({ role: 'ASSISTANT', insertedAt: 2, fragments: [{ type: 'TEXT', content: 'a' }] }),
                ],
            });
            expect(result).toContain('\n\n---\n\n');
        });
    });

    // ─────────────────────────────────────
    //  buildFilename
    // ─────────────────────────────────────

    describe('buildFilename', () => {
        it('returns fallback filename for nullish threadResult', () => {
            expect(buildFilename(null)).toBe('deepseek-conversation.md');
            expect(buildFilename(undefined)).toBe('deepseek-conversation.md');
        });

        it('uses fallback title when title is empty/missing', () => {
            expect(buildFilename({ title: '' })).toBe('deepseek-conversation.md');
        });

        it('sanitizes illegal filename characters \\ / : * ? " < > |', () => {
            const result = buildFilename({ title: 'a\\b/c:d*e?f"g<h>i|j' });
            expect(result).toBe('deepseek-abcdefghij.md');
        });

        it('strips control characters', () => {
            const result = buildFilename({ title: 'a\x00b\x1Fc' });
            expect(result).toBe('deepseek-abc.md');
        });

        it('collapses whitespace runs into a single hyphen', () => {
            const result = buildFilename({ title: 'hello   world  foo' });
            expect(result).toBe('deepseek-hello-world-foo.md');
        });

        it('caps the title at ~50 characters', () => {
            const longTitle = 'x'.repeat(100);
            const result = buildFilename({ title: longTitle });
            expect(result).toBe(`deepseek-${'x'.repeat(50)}.md`);
        });

        it('always ends with .md extension', () => {
            expect(buildFilename({ title: 'anything' })).toMatch(/\.md$/);
        });

        it('appends sessionId suffix when present', () => {
            const result = buildFilename({ title: 'chat', sessionId: 'abc123' });
            expect(result).toBe('deepseek-chat-abc123.md');
        });

        it('omits session suffix when sessionId is absent', () => {
            const result = buildFilename({ title: 'chat' });
            expect(result).toBe('deepseek-chat.md');
        });
    });
});
