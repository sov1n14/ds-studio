/**
 * Scenario tests for the single-writer chat→preset map: two real never-initialized client StorageManagers (content-script shape) dispatch every write to one real service-worker StorageManager through the real background/chat-map-routes.js router. Only chrome.storage and chrome.runtime messaging are doubled (test/helpers/chat-map-writer-harness.js). Every assertion reads durable storage or a returned map; no call sequence is asserted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createChatMapWriterHarness, restoreChromeBoundaries } from '../helpers/chat-map-writer-harness.js';

describe('chat map single writer — concurrent clients converge through the SW', () => {
    let h;
    let a;
    let b;

    beforeEach(async () => {
        h = await createChatMapWriterHarness({ clientCount: 2 });
        [a, b] = h.clients;
    });

    afterEach(() => {
        restoreChromeBoundaries();
    });

    it('A: two clients binding different uuids into the same chunk both persist in one chunk', async () => {
        await h.seedChatMap([{ '@seed': 'seed' }]);

        await Promise.all([a.bindChatToPreset('uA', 'pA'), b.bindChatToPreset('uB', 'pB')]);

        const stored = await h.readStored();
        expect(stored.map).toEqual({ '@seed': 'seed', uA: 'pA', uB: 'pB' });
        expect(stored.meta.chunkCount).toBe(1);
        expect(stored.meta.version).toBeGreaterThan(1);
        expect(h.layoutProblems(stored)).toEqual([]);
    });

    it('B: a bind concurrent with PRUNE_ORPHANS survives while orphans are removed', async () => {
        await h.seedPresetIndex(['pAlive']);
        await h.seedChatMap([{ keep: 'pAlive', orphan1: 'pGone', orphan2: 'pGone' }]);

        const [, pruned] = await Promise.all([a.bindChatToPreset('uNew', 'pAlive'), b.pruneOrphanChatBindings()]);

        const stored = await h.readStored();
        expect(stored.map).toEqual({ keep: 'pAlive', uNew: 'pAlive' });
        expect(pruned.keep).toBe('pAlive');
        expect(Object.values(pruned)).not.toContain('pGone');
        expect(h.layoutProblems(stored)).toEqual([]);
    });

    it('C: a multi-chunk unbindChatsForPresets concurrent with a bind removes every target entry and keeps the bind', async () => {
        await h.seedChatMap([
            { d0: 'pDel', k0: 'pKeep' },
            { d1: 'pDel', k1: 'pKeep', d2: 'pDel' },
        ]);

        const [unbound] = await Promise.all([b.unbindChatsForPresets(['pDel']), a.bindChatToPreset('uNew', 'pKeep')]);

        const stored = await h.readStored();
        expect(stored.map).toEqual({ k0: 'pKeep', k1: 'pKeep', uNew: 'pKeep' });
        expect(Object.values(unbound)).not.toContain('pDel');
        expect(h.layoutProblems(stored)).toEqual([]);
    });

    it('D: two concurrent binds into a full chunk share one appended chunk (chunkCount 2, not 3)', async () => {
        const full = h.fullChunk();
        await h.seedChatMap([full]);

        await Promise.all([a.bindChatToPreset('uA', 'pA'), b.bindChatToPreset('uB', 'pB')]);

        const stored = await h.readStored();
        expect(stored.map).toEqual({ ...full, uA: 'pA', uB: 'pB' });
        expect(stored.meta.chunkCount).toBe(2);
        expect(stored.chunks[1]).toEqual({ uA: 'pA', uB: 'pB' });
        expect(h.layoutProblems(stored)).toEqual([]);
    });

    it('E: an unbind emptying the trailing chunk concurrent with a bind keeps the bind and leaves no dangling chunk', async () => {
        const full = h.fullChunk();
        await h.seedChatMap([full, { uTail: 'pX' }]);

        await Promise.all([a.unbindChat('uTail'), b.bindChatToPreset('uNew', 'pY')]);

        const stored = await h.readStored();
        expect(stored.map).toEqual({ ...full, uNew: 'pY' });
        expect(stored.meta.chunkCount).toBe(2);
        expect(stored.chunks[1]).toEqual({ uNew: 'pY' });
        expect(h.layoutProblems(stored)).toEqual([]);
    });

    it('F: read-your-writes — a bind followed by getChatPresetMap on the same client shows the binding', async () => {
        await h.seedChatMap([{ '@seed': 'seed' }]);

        const isBound = await a.bindChatToPreset('uF', 'pF');
        const map = await a.getChatPresetMap();

        expect(isBound).toBe(true);
        expect(map).toEqual({ '@seed': 'seed', uF: 'pF' });
    });

    it('G: a never-initialized client that already read the map sees a chunk the SW appended for another client', async () => {
        const full = h.fullChunk();
        await h.seedChatMap([full]);
        expect(await a.getChatPresetMap()).toEqual(full);

        await b.bindChatToPreset('uG', 'pG');

        expect((await h.readStored()).meta.chunkCount).toBe(2);
        expect(await a.getChatPresetMap()).toEqual({ ...full, uG: 'pG' });
    });

    it('H: a restarted SW sees the durable state of a committed op and applies a new op on top of it', async () => {
        await h.seedChatMap([{ '@seed': 'seed' }]);
        await a.bindChatToPreset('u1', 'p1');
        const versionBeforeRestart = (await h.readStored()).meta.version;

        await h.restartServiceWorker();
        await b.bindChatToPreset('u2', 'p2');

        const stored = await h.readStored();
        expect(stored.map).toEqual({ '@seed': 'seed', u1: 'p1', u2: 'p2' });
        expect(stored.meta.version).toBeGreaterThan(versionBeforeRestart);
        expect(h.layoutProblems(stored)).toEqual([]);
    });

    it('I: crash state with chunkCount above the chunks present reads missing chunks as empty and the next op repairs the layout', async () => {
        await h.seedChatMap([{ a1: 'p1' }, null, { c1: 'p1' }], { version: 4, chunkCount: 3 });
        expect(h.layoutProblems(await h.readStored())).not.toEqual([]);

        expect(await a.getChatPresetMap()).toEqual({ a1: 'p1', c1: 'p1' });
        await a.bindChatToPreset('uI', 'pI');

        const stored = await h.readStored();
        expect(stored.map).toEqual({ a1: 'p1', c1: 'p1', uI: 'pI' });
        expect(stored.meta.version).toBeGreaterThan(4);
        expect(h.layoutProblems(stored)).toEqual([]);
    });
});
