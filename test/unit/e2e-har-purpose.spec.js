/**
 * test/e2e/helpers/har-recording.js — the purpose recordings and history listing the offline lane adds to the main recording.
 *
 * Requirement (lead decision, offline replay stage 3): purpose recordings (`deepseek-YYYY-MM-DD-<purpose>.har`) are located next to the main recording, the newest date per purpose;
 * the longest history response of every conversation id is listed with its summary (the count of replies holding a fenced code block included); a long thread and a code-block conversation are chosen from the purpose recordings by role.
 * Fixtures are invented (test/fixtures/har/synthetic-har.js); the folder holds the main recording and every kind of neighbour the real folder holds.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { API, entry, fakeId, harOf, messagesBody, syntheticHar } from '../fixtures/har/synthetic-har.js';
import { listConversations, listHistoryResponses, locatePurposeHars, pickPurposeConversations, readSidebarResponse } from '../e2e/helpers/har-recording.js';

const FENCE = '```';

describe('locatePurposeHars(repoRoot)', () => {
    const roots = [];
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    function repoWith(files) {
        const root = mkdtempSync(path.join(os.tmpdir(), 'dss-har-purpose-'));
        roots.push(root);
        const recordings = path.join(root, 'tools', 'recordings');
        mkdirSync(recordings, { recursive: true });
        for (const [name, modifiedAtSeconds] of Object.entries(files)) {
            const file = path.join(recordings, name);
            writeFileSync(file, '{}');
            utimesSync(file, modifiedAtSeconds, modifiedAtSeconds);
        }
        return root;
    }

    it('maps each purpose name, hyphens kept, to its file and skips the main recording and every other file', () => {
        const root = repoWith({
            'deepseek-2026-11-23.har': 5_000,
            'deepseek-2026-11-23-scroll-chat-list.har': 1_000,
            'deepseek-2026-11-23-single-long-chat.har': 2_000,
            'deepseek-2026-11-23-.har': 6_000,
            'notes.har': 7_000,
            'deepseek-2026-11-23-scroll-chat-list.har.bak': 8_000,
        });
        const recordings = path.join(root, 'tools', 'recordings');
        expect(locatePurposeHars(root)).toEqual(new Map([
            ['scroll-chat-list', path.join(recordings, 'deepseek-2026-11-23-scroll-chat-list.har')],
            ['single-long-chat', path.join(recordings, 'deepseek-2026-11-23-single-long-chat.har')],
        ]));
    });

    it('keeps the newest name date of a purpose, whatever the modification times', () => {
        const root = repoWith({ 'deepseek-2026-11-23-scroll-chat-list.har': 1_000, 'deepseek-2026-11-20-scroll-chat-list.har': 9_000, 'deepseek-2026-11-22-scroll-chat-list.har': 5_000 });
        expect([...locatePurposeHars(root).values()]).toEqual([path.join(root, 'tools', 'recordings', 'deepseek-2026-11-23-scroll-chat-list.har')]);
    });

    it('answers an empty map when the folder holds only the main recording or does not exist', () => {
        expect(locatePurposeHars(repoWith({ 'deepseek-2026-11-23.har': 1_000 })).size).toBe(0);
        const bare = mkdtempSync(path.join(os.tmpdir(), 'dss-har-purpose-'));
        roots.push(bare);
        expect(locatePurposeHars(bare).size).toBe(0);
    });
});

describe('listHistoryResponses(har)', () => {
    const history = (id, query = '') => `${API}/chat/history_messages?chat_session_id=${id}${query}`;
    const turns = (count) => Array.from({ length: count }, (_, index) => ({ role: index % 2 === 0 ? 'USER' : 'ASSISTANT', fragments: [{ type: index % 2 === 0 ? 'REQUEST' : 'RESPONSE', content: 'plain' }] }));

    it('keeps, per id, the history with the most messages, however it is ordered among the recorded ones', () => {
        const har = harOf(
            entry({ url: history(fakeId(1)), body: messagesBody(fakeId(1), turns(2)) }),
            entry({ url: history(fakeId(1)), body: messagesBody(fakeId(1), turns(6)) }),
            entry({ url: history(fakeId(1), '&cache_version=1&cache_reset_at=1'), body: messagesBody(fakeId(1), []) }),
            entry({ url: history(fakeId(1)), body: messagesBody(fakeId(1), turns(4)) }),
        );
        const found = listHistoryResponses(har).get(fakeId(1));
        expect(found.summary.messageCount, 'the 6-message history wins over later, shorter and empty ones').toBe(6);
        expect(found.body.data.biz_data.chat_messages, 'the body is the parsed response of that history').toHaveLength(6);
    });

    it('lists each id once, in the order each was first recorded, reading base64 bodies and skipping empty or non-JSON ones', () => {
        const har = harOf(
            entry({ url: history(fakeId(2)), body: messagesBody(fakeId(2), turns(2)), isBase64: true }),
            entry({ url: history(fakeId(3)), body: 'not json' }),
            entry({ url: history(fakeId(4)), body: messagesBody(fakeId(4), []) }),
            entry({ url: history(fakeId(5)), body: messagesBody(fakeId(5), turns(2)) }),
            entry({ url: history(fakeId(2)), body: messagesBody(fakeId(2), turns(4)) }),
            entry({ url: `${API}/chat/status`, body: messagesBody(fakeId(6), turns(2)) }),
        );
        const listed = listHistoryResponses(har);
        expect([...listed.keys()]).toEqual([fakeId(2), fakeId(5)]);
        expect(listed.get(fakeId(2)).summary.messageCount).toBe(4);
    });

    it('answers for each id the summary listConversations gives, over the synthetic recording', () => {
        const har = syntheticHar();
        expect([...listHistoryResponses(har).values()].map(({ summary }) => summary)).toEqual(listConversations(har));
    });
});

describe('the code-block reply count of a conversation summary', () => {
    const reply = (...fragments) => ({ role: 'ASSISTANT', fragments });
    const countOf = (...messages) => {
        const id = fakeId(7);
        return listConversations(harOf(entry({ url: `${API}/chat/history_messages?chat_session_id=${id}`, body: messagesBody(id, [{ role: 'USER', fragments: [{ type: 'REQUEST', content: 'ask' }] }, ...messages]) })))[0].codeBlockReplyCount;
    };

    it('counts a reply once however many fences or fragments it holds, and a fence opening a later line', () => {
        expect(countOf(
            reply({ type: 'RESPONSE', content: `intro\n${FENCE}js\nlet a;\n${FENCE}\nmore\n${FENCE}\nb\n${FENCE}` }),
            reply({ type: 'RESPONSE', content: `${FENCE}py\nx\n${FENCE}` }, { type: 'RESPONSE', content: `${FENCE}\ny\n${FENCE}` }),
            reply({ type: 'RESPONSE', content: 'no code here' }),
        )).toBe(2);
    });

    it('skips a fence inside a thinking block, a fence in the middle of a line and a fence in the user message', () => {
        expect(countOf(
            reply({ type: 'THINK', content: `${FENCE}js\nthought\n${FENCE}` }, { type: 'RESPONSE', content: 'answer' }),
            reply({ type: 'RESPONSE', content: `write ${FENCE} to open a block` }),
        ), 'only a RESPONSE fragment with a fence opening a line counts').toBe(0);
        const id = fakeId(8);
        const userFence = { role: 'USER', fragments: [{ type: 'REQUEST', content: `${FENCE}\npasted\n${FENCE}` }] };
        const [summary] = listConversations(harOf(entry({ url: `${API}/chat/history_messages?chat_session_id=${id}`, body: messagesBody(id, [userFence, reply({ type: 'RESPONSE', content: 'ok' })]) })));
        expect(summary.codeBlockReplyCount, 'a pasted fence in the question is not a code reply').toBe(0);
    });

    it('is 0 for a reply without fragments', () => {
        expect(countOf({ role: 'ASSISTANT' })).toBe(0);
    });
});

describe('pickPurposeConversations(conversations)', () => {
    const conversation = (id, overrides) => ({ id, purpose: 'p', messageCount: 2, codeBlockReplyCount: 0, ...overrides });

    it('picks the longest thread and, apart, the conversation with the most code replies', () => {
        const picks = pickPurposeConversations([
            conversation('short-code', { messageCount: 4, codeBlockReplyCount: 1 }),
            conversation('longest-plain', { messageCount: 90 }),
            conversation('most-code', { messageCount: 12, codeBlockReplyCount: 5 }),
            conversation('long-code', { messageCount: 60, codeBlockReplyCount: 3 }),
        ]);
        expect(picks.longThread.id).toBe('longest-plain');
        expect(picks.withCodeBlocks.id).toBe('most-code');
    });

    it('picks the first listed conversation on a tie', () => {
        const picks = pickPurposeConversations([conversation('first', { messageCount: 8, codeBlockReplyCount: 2 }), conversation('second', { messageCount: 8, codeBlockReplyCount: 2 })]);
        expect([picks.longThread.id, picks.withCodeBlocks.id]).toEqual(['first', 'first']);
    });

    it('answers null for withCodeBlocks when no reply holds code, and null for every role without conversations', () => {
        expect(pickPurposeConversations([conversation('plain')]).withCodeBlocks).toBeNull();
        expect(pickPurposeConversations([])).toEqual({ longThread: null, withCodeBlocks: null });
    });
});

describe('readSidebarResponse(har)', () => {
    const SIDEBAR_URL = `${API}/chat_session/fetch_page?lte_cursor.pinned=false`;
    const sessions = (marker) => JSON.stringify({ code: 0, data: { biz_data: { chat_sessions: [{ id: marker }], has_more: false } } });

    it('answers the content type and text of the first successful GET of the chat list, decoding base64', () => {
        const har = harOf(
            entry({ url: SIDEBAR_URL, body: sessions('first'), mimeType: 'application/json; charset=utf-8', isBase64: true }),
            entry({ url: SIDEBAR_URL, body: sessions('second') }),
        );
        expect(readSidebarResponse(har)).toEqual({ contentType: 'application/json; charset=utf-8', body: sessions('first') });
    });

    it('skips a failed, bodiless or POST answer of the same path and the answers of neighbouring paths', () => {
        const har = harOf(
            entry({ url: `${API}/chat_session/fetch_page_extra`, body: sessions('other-path') }),
            entry({ url: SIDEBAR_URL, status: 500, body: sessions('failed') }),
            entry({ url: SIDEBAR_URL, body: undefined }),
            entry({ method: 'POST', url: SIDEBAR_URL, body: sessions('posted') }),
            entry({ url: SIDEBAR_URL, body: sessions('wanted') }),
        );
        expect(readSidebarResponse(har).body).toBe(sessions('wanted'));
    });

    it('answers null when the recording holds no chat list', () => {
        expect(readSidebarResponse(harOf(entry({ url: `${API}/chat/status`, body: '{}' })))).toBeNull();
    });
});
