/**
 * test/e2e/helpers/har-recording.js — reads the recorded DeepSeek HAR that feeds the offline E2E lane.
 *
 * Requirement (lead decision, offline harness stage 2): the lane replays the newest HAR under tools/recordings/. A run without a recording fails with a message that names
 * the directory and the re-record procedure. The recording is filtered before Playwright replays it (preflights, failed and bodiless entries are dropped, otherwise a repeated GET
 * replays the first, bodiless match). Specs choose conversations from the recording by role, so a re-record needs no spec change. The fixtures are invented (test/fixtures/har/synthetic-har.js).
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { API, STATIC, SHELL_URL, entry, fakeId, syntheticHar } from '../fixtures/har/synthetic-har.js';
import {
    bodilessScriptUrls,
    createSettingsResponder,
    filterHar,
    listConversations,
    locateNewestHar,
    pickConversations,
    readShellHtml,
    selectNewestHar,
} from '../e2e/helpers/har-recording.js';

function harOf(...entries) {
    return { log: { version: '1.2', creator: { name: 'synthetic', version: '0' }, pages: [], entries } };
}

describe('selectNewestHar(files)', () => {
    it('answers the path with the latest modification time', () => {
        const files = [{ path: 'a.har', mtimeMs: 1_000 }, { path: 'b.har', mtimeMs: 3_000 }, { path: 'c.har', mtimeMs: 2_000 }];
        expect(selectNewestHar(files)).toBe('b.har');
    });

    it('answers null when there is no file', () => {
        expect(selectNewestHar([])).toBeNull();
    });
});

describe('locateNewestHar(repoRoot)', () => {
    const roots = [];
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    function repoWith(files) {
        const root = mkdtempSync(path.join(os.tmpdir(), 'dss-har-locate-'));
        roots.push(root);
        if (files) {
            const recordings = path.join(root, 'tools', 'recordings');
            mkdirSync(recordings, { recursive: true });
            for (const [name, modifiedAtSeconds] of Object.entries(files)) {
                const file = path.join(recordings, name);
                writeFileSync(file, '{}');
                utimesSync(file, modifiedAtSeconds, modifiedAtSeconds);
            }
        }
        return root;
    }

    it('answers the newest .har of tools/recordings and ignores other files', () => {
        const root = repoWith({ 'older.har': 1_700_000_000, 'newer.har': 1_800_000_000, 'notes.txt': 1_900_000_000 });
        expect(locateNewestHar(root)).toBe(path.join(root, 'tools', 'recordings', 'newer.har'));
    });

    it('fails when tools/recordings does not exist, naming the directory and the re-record procedure', () => {
        const root = repoWith(null);
        expect(() => locateNewestHar(root)).toThrowError(/tools\/recordings/);
        expect(() => locateNewestHar(root)).toThrowError(/\.claude\/skills\/version-bump\/SKILL\.md#release-har-freshness-check/);
    });

    it('fails when tools/recordings holds no .har file, naming the directory and the re-record procedure', () => {
        const root = repoWith({ 'notes.txt': 1_800_000_000 });
        expect(() => locateNewestHar(root)).toThrowError(/tools\/recordings/);
        expect(() => locateNewestHar(root)).toThrowError(/release-har-freshness-check/);
    });
});

describe('filterHar(har)', () => {
    const bodied = (overrides) => entry({ body: '{"ok":true}', ...overrides });

    it('drops OPTIONS preflights even when they carry a body', () => {
        const kept = bodied({ url: `${API}/a` });
        const filtered = filterHar(harOf(bodied({ method: 'OPTIONS', url: `${API}/a` }), kept));
        expect(filtered.log.entries).toEqual([kept]);
    });

    it('drops entries recorded with status 0 (the request never completed)', () => {
        const kept = bodied({ url: `${API}/a` });
        expect(filterHar(harOf(bodied({ url: `${API}/b`, status: 0 }), kept)).log.entries).toEqual([kept]);
    });

    it('drops entries whose response has no body, so a repeated GET replays the one with a body', () => {
        const withBody = bodied({ url: `${API}/same` });
        const filtered = filterHar(harOf(entry({ url: `${API}/same` }), withBody, entry({ url: `${API}/same`, body: '' })));
        expect(filtered.log.entries).toEqual([withBody]);
    });

    it('keeps every other entry in recorded order, base64 bodies included', () => {
        const first = bodied({ url: `${API}/1`, isBase64: true });
        const second = bodied({ method: 'POST', url: `${API}/2` });
        expect(filterHar(harOf(first, second)).log.entries).toEqual([first, second]);
    });

    it('keeps the log metadata and leaves its input unchanged', () => {
        const har = harOf(entry({ url: `${API}/gone` }), bodied({ url: `${API}/kept` }));
        const snapshot = structuredClone(har);
        const filtered = filterHar(har);
        expect(har).toEqual(snapshot);
        expect(filtered.log.version).toBe('1.2');
        expect(filtered.log.creator).toEqual({ name: 'synthetic', version: '0' });
    });

    it('filters the synthetic recording down to the entries Playwright can replay', () => {
        const filtered = filterHar(syntheticHar());
        expect(filtered.log.entries.map(({ request }) => request.method)).not.toContain('OPTIONS');
        expect(filtered.log.entries.every(({ response }) => response.status !== 0 && response.content.text)).toBe(true);
        expect(filtered.log.entries).toHaveLength(11);
    });
});

describe('createSettingsResponder(har)', () => {
    const respond = (url) => createSettingsResponder(syntheticHar())(url);

    it('answers the first recorded body of a scope for any device id', () => {
        const response = respond(`${API}/client/settings?did=a-brand-new-device&scope=main`);
        expect(response.status).toBe(200);
        expect(response.contentType).toBe('application/json');
        expect(JSON.parse(response.body).data.biz_data.settings.marker.value).toBe('main-one');
    });

    it('answers each scope with its own body and decodes a base64 recording', () => {
        expect(JSON.parse(respond(`${API}/client/settings?did=x&scope=model`).body).data.biz_data.settings.marker.value).toBe('model-one');
    });

    it('answers the same body whatever host serves the request', () => {
        expect(respond('https://other.example.test/api/v0/client/settings?did=x&scope=main')).not.toBeNull();
    });

    it('answers null for a scope the recording does not hold', () => {
        expect(respond(`${API}/client/settings?did=x&scope=never-recorded`)).toBeNull();
    });

    it('answers null when the request has no scope', () => {
        expect(respond(`${API}/client/settings?did=x`)).toBeNull();
    });

    it('answers null for any other path, the settings report included', () => {
        expect(respond(`${API}/client/settings/report?did=x&scope=main`)).toBeNull();
        expect(respond(`${API}/chat/status?scope=main`)).toBeNull();
    });
});

describe('readShellHtml(har)', () => {
    it('answers the HTML of the first recorded document', () => {
        expect(readShellHtml(syntheticHar())).toBe('<!doctype html><title>synthetic shell</title>');
    });

    it('decodes a base64 document', () => {
        const html = '<!doctype html><title>encoded</title>';
        expect(readShellHtml(harOf(entry({ url: SHELL_URL, mimeType: 'text/html', body: html, isBase64: true, resourceType: 'document' })))).toBe(html);
    });

    it('answers null when the recording holds no document with a body', () => {
        expect(readShellHtml(harOf(entry({ url: SHELL_URL, mimeType: 'text/html', resourceType: 'document' }), entry({ url: `${API}/a`, body: '{}' })))).toBeNull();
    });
});

describe('bodilessScriptUrls(har)', () => {
    it('lists the scripts recorded without a body (the worker chunks the page fetched)', () => {
        expect(bodilessScriptUrls(syntheticHar())).toEqual([`${STATIC}/worker.bbbb.js`]);
    });

    it('skips scripts that have a body, non-script entries and failed fetches', () => {
        const har = harOf(
            entry({ url: `${STATIC}/with-body.js`, mimeType: 'text/javascript', body: 'x', resourceType: 'script' }),
            entry({ url: `${STATIC}/image.png`, mimeType: 'image/png', resourceType: 'image' }),
            entry({ url: `${STATIC}/redirected.js`, mimeType: 'text/javascript', status: 302, resourceType: 'script' }),
            entry({ method: 'POST', url: `${STATIC}/posted.js`, mimeType: 'text/javascript', resourceType: 'script' }),
        );
        expect(bodilessScriptUrls(har)).toEqual([]);
    });

    it('lists a script once however often it was fetched', () => {
        const fetched = entry({ url: `${STATIC}/worker.js`, mimeType: 'application/javascript', resourceType: 'other' });
        expect(bodilessScriptUrls(harOf(fetched, fetched))).toEqual([`${STATIC}/worker.js`]);
    });
});

describe('listConversations(har)', () => {
    const conversations = () => listConversations(syntheticHar());
    const byId = (id) => conversations().find((conversation) => conversation.id === id);

    it('lists each conversation that has messages once, by its id', () => {
        expect(conversations().map(({ id }) => id).sort()).toEqual([fakeId(1), fakeId(2), fakeId(3)]);
    });

    it('counts the messages and the replies of a conversation', () => {
        expect(byId(fakeId(1))).toMatchObject({ messageCount: 4, replyCount: 2 });
        expect(byId(fakeId(2))).toMatchObject({ messageCount: 6, replyCount: 3 });
    });

    it('counts the replies that carry a thinking fragment, reading a base64 recording', () => {
        expect(byId(fakeId(1)).thinkingReplyCount).toBe(0);
        expect(byId(fakeId(2)).thinkingReplyCount).toBe(2);
        expect(byId(fakeId(3)).thinkingReplyCount).toBe(1);
    });

    it('counts the replies that carry a search fragment', () => {
        expect(byId(fakeId(1)).searchReplyCount).toBe(0);
        expect(byId(fakeId(3)).searchReplyCount).toBe(1);
    });

    it('counts a tool-search fragment as a search', () => {
        const messages = [['REQUEST'], ['TOOL_SEARCH', 'RESPONSE']];
        const har = harOf(entry({ url: `${API}/chat/history_messages?chat_session_id=${fakeId(4)}`, body: JSON.stringify({ data: { biz_data: { chat_session: { id: fakeId(4) }, chat_messages: messages.map((types) => ({ role: types.includes('REQUEST') ? 'USER' : 'ASSISTANT', status: 'FINISHED', fragments: types.map((type) => ({ type })) })) } } }) }));
        expect(listConversations(har)[0].searchReplyCount).toBe(1);
    });

    it('flags a conversation holding a message the site filtered', () => {
        const body = JSON.stringify({ data: { biz_data: { chat_session: { id: fakeId(5) }, chat_messages: [{ role: 'USER', status: 'FINISHED', fragments: [{ type: 'REQUEST' }] }, { role: 'ASSISTANT', status: 'CONTENT_FILTER', fragments: [] }] } } });
        const [conversation] = listConversations(harOf(entry({ url: `${API}/chat/history_messages?chat_session_id=${fakeId(5)}`, body })));
        expect(conversation.hasContentFilter).toBe(true);
        expect(byId(fakeId(1)).hasContentFilter).toBe(false);
    });

    it('answers an empty list when the recording holds no conversation', () => {
        expect(listConversations(harOf(entry({ url: `${API}/chat/status`, body: '{}' })))).toEqual([]);
    });

    it('skips a history response that is not JSON instead of failing', () => {
        const har = harOf(entry({ url: `${API}/chat/history_messages?chat_session_id=${fakeId(6)}`, body: 'not json' }));
        expect(listConversations(har)).toEqual([]);
    });
});

describe('pickConversations(conversations)', () => {
    const conversation = (id, overrides) => ({ id, messageCount: 2, replyCount: 1, thinkingReplyCount: 0, searchReplyCount: 0, hasContentFilter: false, ...overrides });

    it('picks, by role, the conversation with the most thinking replies, the most search replies and the most messages', () => {
        const list = [
            conversation('thinks-a-little', { thinkingReplyCount: 1 }),
            conversation('thinks-a-lot', { thinkingReplyCount: 4, messageCount: 8 }),
            conversation('searches', { searchReplyCount: 2, thinkingReplyCount: 1, messageCount: 4 }),
            conversation('longest', { messageCount: 30 }),
        ];
        const picks = pickConversations(list);
        expect(picks.withThinking.id).toBe('thinks-a-lot');
        expect(picks.withSearch.id).toBe('searches');
        expect(picks.mostMessages.id).toBe('longest');
    });

    it('picks the first listed conversation when roles tie', () => {
        const list = [conversation('first', { thinkingReplyCount: 2 }), conversation('second', { thinkingReplyCount: 2 })];
        expect(pickConversations(list).withThinking.id).toBe('first');
    });

    it('answers null for a role no conversation fills', () => {
        const picks = pickConversations([conversation('plain')]);
        expect(picks.withThinking).toBeNull();
        expect(picks.withSearch).toBeNull();
        expect(picks.withContentFilter).toBeNull();
        expect(picks.mostMessages.id).toBe('plain');
    });

    it('picks the conversation holding a filtered message for that role', () => {
        const picks = pickConversations([conversation('plain'), conversation('filtered', { hasContentFilter: true })]);
        expect(picks.withContentFilter.id).toBe('filtered');
    });

    it('answers every role null for an empty list', () => {
        expect(pickConversations([])).toEqual({ withThinking: null, withSearch: null, withContentFilter: null, mostMessages: null });
    });

    it('picks from the synthetic recording what its fixture holds', () => {
        const picks = pickConversations(listConversations(syntheticHar()));
        expect(picks.withThinking.id).toBe(fakeId(2));
        expect(picks.withSearch.id).toBe(fakeId(3));
        expect(picks.mostMessages.id).toBe(fakeId(2));
    });
});
