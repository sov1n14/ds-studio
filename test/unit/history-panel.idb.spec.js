import { describe, it, expect } from 'vitest';
import HistoryPanelIdb from '../../content/history-panel.idb.js';

const { parseFragments, buildActiveThread, normalizeThread, loadActiveThread } = HistoryPanelIdb;

describe('HistoryPanelIdb', () => {
    // ─────────────────────────────────────
    //  parseFragments
    // ─────────────────────────────────────

    describe('parseFragments', () => {
        it('parses a valid JSON string of fragments', () => {
            const raw = JSON.stringify([{ type: 'TEXT', content: 'hello' }, { type: 'THINK', content: 'thinking' }]);
            expect(parseFragments(raw)).toEqual([
                { type: 'TEXT', content: 'hello' },
                { type: 'THINK', content: 'thinking' },
            ]);
        });

        it('passes through an already-array value', () => {
            const arr = [{ type: 'TEXT', content: 'a' }];
            expect(parseFragments(arr)).toEqual([{ type: 'TEXT', content: 'a' }]);
        });

        it('returns [] for null', () => {
            expect(parseFragments(null)).toEqual([]);
        });

        it('returns [] for undefined', () => {
            expect(parseFragments(undefined)).toEqual([]);
        });

        it('returns [] for invalid JSON string', () => {
            expect(parseFragments('{not valid json')).toEqual([]);
        });

        it('returns [] when parsed JSON is not an array', () => {
            expect(parseFragments(JSON.stringify({ type: 'TEXT' }))).toEqual([]);
        });

        it('returns [] for a non-string, non-array value (e.g. number)', () => {
            expect(parseFragments(42)).toEqual([]);
        });
    });

    // ─────────────────────────────────────
    //  buildActiveThread
    // ─────────────────────────────────────

    describe('buildActiveThread', () => {
        it('returns [] for empty/nullish messages', () => {
            expect(buildActiveThread(null, '1')).toEqual([]);
            expect(buildActiveThread(undefined, '1')).toEqual([]);
            expect(buildActiveThread([], '1')).toEqual([]);
        });

        it('walks a normal linear thread from currentMessageId to root, returning oldest -> newest', () => {
            const messages = [
                { message_id: '1', parent_id: '0', inserted_at: 100 },
                { message_id: '2', parent_id: '1', inserted_at: 200 },
                { message_id: '3', parent_id: '2', inserted_at: 300 },
            ];
            const result = buildActiveThread(messages, '3');
            expect(result.map((m) => m.message_id)).toEqual(['1', '2', '3']);
        });

        it('stops walking when parent_id is missing/null/"0"', () => {
            const messagesNull = [
                { message_id: '1', parent_id: null, inserted_at: 100 },
                { message_id: '2', parent_id: '1', inserted_at: 200 },
            ];
            expect(buildActiveThread(messagesNull, '2').map((m) => m.message_id)).toEqual(['1', '2']);

            const messagesZero = [
                { message_id: '1', parent_id: '0', inserted_at: 100 },
                { message_id: '2', parent_id: '1', inserted_at: 200 },
            ];
            expect(buildActiveThread(messagesZero, '2').map((m) => m.message_id)).toEqual(['1', '2']);
        });

        it('returns only the branch reachable from currentMessageId in a tree with sibling/regenerated branches', () => {
            const messages = [
                { message_id: '1', parent_id: '0', inserted_at: 100 },
                { message_id: '2a', parent_id: '1', inserted_at: 200 }, // regenerated sibling, not on active branch
                { message_id: '2b', parent_id: '1', inserted_at: 210 }, // active branch
                { message_id: '3', parent_id: '2b', inserted_at: 300 },
            ];
            const result = buildActiveThread(messages, '3');
            expect(result.map((m) => m.message_id)).toEqual(['1', '2b', '3']);
        });

        it('falls back to sorting all messages by inserted_at ascending when currentMessageId is not found', () => {
            const messages = [
                { message_id: '1', parent_id: '0', inserted_at: 300 },
                { message_id: '2', parent_id: '1', inserted_at: 100 },
                { message_id: '3', parent_id: '2', inserted_at: 200 },
            ];
            const result = buildActiveThread(messages, 'missing-id');
            expect(result.map((m) => m.message_id)).toEqual(['2', '3', '1']);
        });

        it('falls back to sorted-all when currentMessageId is null/undefined', () => {
            const messages = [
                { message_id: '1', parent_id: '0', inserted_at: 200 },
                { message_id: '2', parent_id: '1', inserted_at: 100 },
            ];
            expect(buildActiveThread(messages, null).map((m) => m.message_id)).toEqual(['2', '1']);
            expect(buildActiveThread(messages, undefined).map((m) => m.message_id)).toEqual(['2', '1']);
        });

        it('guards against infinite loop when parent chain cycles back on itself', () => {
            const messages = [
                { message_id: '1', parent_id: '2', inserted_at: 100 },
                { message_id: '2', parent_id: '1', inserted_at: 200 },
            ];
            const result = buildActiveThread(messages, '1');
            // visitedIds set prevents infinite loop; both nodes visited once
            expect(result.map((m) => m.message_id).sort()).toEqual(['1', '2']);
        });
    });

    // ─────────────────────────────────────
    //  normalizeThread
    // ─────────────────────────────────────

    describe('normalizeThread', () => {
        it('returns [] for empty/nullish rawMessages', () => {
            expect(normalizeThread(null, '1')).toEqual([]);
            expect(normalizeThread([], '1')).toEqual([]);
        });

        it('maps a linear thread to clean shape, oldest -> newest', () => {
            const raw = [
                {
                    message_id: '1',
                    parent_id: '0',
                    role: 'USER',
                    inserted_at: '100',
                    fragments: JSON.stringify([{ type: 'TEXT', content: 'hi' }]),
                },
                {
                    message_id: '2',
                    parent_id: '1',
                    role: 'ASSISTANT',
                    inserted_at: '200',
                    fragments: JSON.stringify([{ type: 'THINK', content: 'reasoning' }, { type: 'TEXT', content: 'reply' }]),
                },
            ];

            expect(normalizeThread(raw, '2')).toEqual([
                { messageId: '1', parentId: null, role: 'USER', insertedAt: 100, fragments: [{ type: 'TEXT', content: 'hi' }] },
                {
                    messageId: '2',
                    parentId: '1',
                    role: 'ASSISTANT',
                    insertedAt: 200,
                    fragments: [{ type: 'THINK', content: 'reasoning' }, { type: 'TEXT', content: 'reply' }],
                },
            ]);
        });
    });

    // ─────────────────────────────────────
    //  loadActiveThread — guard path only (no fake-indexeddb dependency installed)
    // ─────────────────────────────────────

    describe('loadActiveThread', () => {
        it('returns NO_SESSION_ID guard failure when sessionId is falsy, without touching IndexedDB', async () => {
            expect(await loadActiveThread(null)).toEqual({ ok: false, reason: 'NO_SESSION_ID' });
            expect(await loadActiveThread(undefined)).toEqual({ ok: false, reason: 'NO_SESSION_ID' });
            expect(await loadActiveThread('')).toEqual({ ok: false, reason: 'NO_SESSION_ID' });
        });

        // GAP: NO_RECORD / NO_MESSAGES / success paths require a real or fake IndexedDB.
        // `fake-indexeddb` is NOT listed in test/package.json devDependencies, and adding a
        // new dependency is out of scope for this task, so those DB-touching branches of
        // loadActiveThread() are not covered here. Add them if `fake-indexeddb` is introduced.
    });
});
