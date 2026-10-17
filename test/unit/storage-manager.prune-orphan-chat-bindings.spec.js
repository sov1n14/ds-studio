/**
 * pruneOrphanChatBindings under the single-writer design. Requirement: a client StorageManager calls pruneOrphanChatBindings() with no argument; the service worker reads dsPresetIndex from storage itself and drops every chat binding whose preset id is not in it. An empty index is a no-op (never a "drop everything"). Bindings with a falsy preset id are kept. initialize() on a client triggers the prune, and a failed prune dispatch only warns: initialize() still resolves and the settings still load.
 *
 * Real client and SW StorageManagers through the real background/chat-map-routes.js (test/helpers/chat-map-writer-harness.js); only chrome.storage and chrome.runtime messaging are doubled. Assertions read durable storage.sync end-state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChatMapWriterHarness, restoreChromeBoundaries, within, CONTEXT_INVALIDATED } from '../helpers/chat-map-writer-harness.js';

const LIVE = { id: 'p-live', name: 'Live', content: 'c', createdAt: 1000, updatedAt: 1000 };

let h;
let client;

beforeEach(async () => {
    h = await createChatMapWriterHarness({ clientCount: 1 });
    [client] = h.clients;
});

afterEach(() => {
    restoreChromeBoundaries();
    vi.restoreAllMocks();
});

describe('pruneOrphanChatBindings() dispatched to the SW writer', () => {
    it('drops bindings whose preset id is absent from the stored dsPresetIndex and keeps the rest', async () => {
        await h.seedPresetIndex(['p1', 'p2']);
        await h.seedChatMap([{ a: 'p1', b: 'gone' }, { c: 'p2', d: 'gone' }]);

        await client.pruneOrphanChatBindings();

        const stored = await h.readStored();
        expect(stored.map).toEqual({ a: 'p1', c: 'p2' });
        expect(h.layoutProblems(stored)).toEqual([]);
    });

    it('uses the index the SW reads from storage, not a list the caller passes', async () => {
        await h.seedPresetIndex(['p1']);
        await h.seedChatMap([{ a: 'p1', b: 'p-other' }]);

        await client.pruneOrphanChatBindings(['p-other']);

        expect((await h.readStored()).map).toEqual({ a: 'p1' });
    });

    it('an empty dsPresetIndex is a no-op: storage is left untouched', async () => {
        await h.seedPresetIndex([]);
        await h.seedChatMap([{ a: 'p1', b: 'gone' }]);
        const before = await h.sync.get(null);

        await client.pruneOrphanChatBindings();

        expect(await h.sync.get(null)).toEqual(before);
    });

    it('keeps bindings whose preset id is falsy', async () => {
        await h.seedPresetIndex(['p1']);
        await h.seedChatMap([{ empty: '', nul: null, a: 'p1', b: 'gone' }]);

        await client.pruneOrphanChatBindings();

        expect((await h.readStored()).map).toEqual({ empty: '', nul: null, a: 'p1' });
    });
});

describe('initialize() on a client', () => {
    it('prunes orphan bindings through the SW', async () => {
        await client.savePromptPresets([LIVE]);
        await h.seedChatMap([{ 'uuid-live': LIVE.id, 'uuid-orphan': 'p-deleted' }]);

        await client.initialize();

        expect((await h.readStored()).map).toEqual({ 'uuid-live': LIVE.id });
    });

    it('resolves and still loads settings when the prune dispatch rejects', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await client.savePromptPresets([LIVE]);
        await client.saveActivePresetId(LIVE.id);
        await h.seedChatMap([{ 'uuid-orphan': 'p-deleted' }]);
        h.transport.failAlways('reject', CONTEXT_INVALIDATED);

        const outcome = await within(client.initialize(), 3000, 'initialize with a failing prune dispatch').then(() => 'resolved', (err) => err);
        expect(outcome).toBe('resolved');

        const settings = await client.getSettings();
        expect(settings.activePresetId).toBe(LIVE.id);
        expect(settings.promptPresets.map((p) => p.id)).toEqual([LIVE.id]);
        expect((await h.readStored()).map, 'the failed prune must not have changed the map').toEqual({ 'uuid-orphan': 'p-deleted' });
    });
});
