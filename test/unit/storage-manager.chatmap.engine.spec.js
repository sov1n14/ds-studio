import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Writer-mode chatPresetMap engine contract (service-worker single-writer). Every assertion is on storage.sync end-state or on the map the call resolves to.
 *
 * Each test loads a fresh StorageManager via vi.resetModules() + import of the real entry file (the bundle parts are preloaded by vitest.setup.js), so no queue or cache state crosses tests. Storage is seeded directly in chrome.storage.sync (plus the local mirror) using the persisted schema: chatPresetMap_<n> chunks and chatPresetMapMeta { version, chunkCount, chunkSizes }.
 *
 * enableChatMapWriterMode is invoked through optional chaining on purpose: its existence is pinned by its own test, and in the target design a non-writer instance rejects every mutation, so the optional call can never let a behavior test pass vacuously.
 */

const META = 'chatPresetMapMeta';
const chunkKey = (i) => `chatPresetMap_${i}`;
const byteLen = (o) => new TextEncoder().encode(JSON.stringify(o)).length;
// A new entry this large cannot fit a "full" chunk under any reasonable room rule, and fits a near-empty chunk easily.
const LONG = 'P'.repeat(500);

let SM;
let LIMIT;

async function loadFresh() {
    vi.resetModules();
    const mod = await import('../../utils/storage-manager.js');
    return mod.default ?? mod;
}

async function loadWriter() {
    const sm = await loadFresh();
    sm.enableChatMapWriterMode?.();
    return sm;
}

// Chunk whose byte size sits ~200 bytes under the soft limit: no room for a LONG entry.
const fullChunk = (id) => ({ [id]: 'F'.repeat(LIMIT - 200 - id.length) });

async function seed(chunks, version = 5) {
    const items = { [META]: { version, chunkCount: chunks.length, chunkSizes: chunks.map(byteLen) } };
    chunks.forEach((c, i) => { items[chunkKey(i)] = c; });
    await chrome.storage.sync.set(items);
    await chrome.storage.local.set(items);
}

const syncState = () => chrome.storage.sync.get(null);

// What a reader holding `meta` sees when it reads chunks 0..meta.chunkCount-1 from `state`.
function readerView(state, meta) {
    const out = {};
    for (let i = 0; i < (meta?.chunkCount ?? 0); i++) Object.assign(out, state[chunkKey(i)] || {});
    return out;
}

const chunkKeysIn = (state) => Object.keys(state).filter(k => k.startsWith('chatPresetMap_')).sort();

beforeEach(async () => {
    SM = await loadWriter();
    LIMIT = SM.CHUNK_SOFT_LIMIT_BYTES;
    // Loader sanity: the real entry file loaded and exposes the engine.
    expect(typeof SM.mutateChatPresetMap, 'storage-manager.js did not load the chatmap engine').toBe('function');
    expect(typeof LIMIT, 'CHUNK_SOFT_LIMIT_BYTES missing').toBe('number');
});

describe('writer mode switch', () => {
    it('StorageManager exposes enableChatMapWriterMode()', () => {
        expect(typeof SM.enableChatMapWriterMode).toBe('function');
    });
});

describe('1. no cache: every mutation reads a fresh snapshot', () => {
    it('respects an external entry added to chunk 0 (with meta bump) after a prior writer mutation', async () => {
        await seed([{ a: 'p1' }]);
        await SM.mutateChatPresetMap(m => { m.b = 'p2'; });

        const before = await syncState();
        const extChunk = { ...before[chunkKey(0)], ext: 'pX' };
        const extVersion = before[META].version + 1;
        await chrome.storage.sync.set({
            [chunkKey(0)]: extChunk,
            [META]: { ...before[META], version: extVersion, chunkSizes: [byteLen(extChunk)] },
        });

        const result = await SM.mutateChatPresetMap(m => { m.c = 'p3'; });

        const expected = { a: 'p1', b: 'p2', ext: 'pX', c: 'p3' };
        const after = await syncState();
        expect(readerView(after, after[META]), 'storage lost the external entry or the new one').toEqual(expected);
        expect(result, 'resolved map').toEqual(expected);
        expect(after[META].version, 'version must build on the externally bumped version').toBe(extVersion + 1);
    });

    it('respects an external append of chunk 1 (chunkCount 1 -> 2) after a prior writer mutation', async () => {
        await seed([{ a: 'p1' }]);
        await SM.mutateChatPresetMap(m => { m.b = 'p2'; });

        const before = await syncState();
        const ext = { ext: 'pX' };
        await chrome.storage.sync.set({
            [chunkKey(1)]: ext,
            [META]: { version: before[META].version + 1, chunkCount: 2, chunkSizes: [byteLen(before[chunkKey(0)]), byteLen(ext)] },
        });

        const result = await SM.mutateChatPresetMap(m => { m.c = 'p3'; });

        const expected = { a: 'p1', b: 'p2', ext: 'pX', c: 'p3' };
        const after = await syncState();
        expect(readerView(after, after[META]), 'externally appended chunk dropped').toEqual(expected);
        expect(after[chunkKey(1)], 'external chunk 1 must survive intact').toEqual(ext);
        expect(result).toEqual(expected);
    });
});

describe('2. mutator runs exactly once per call', () => {
    it('single-chunk in-place change', async () => {
        await seed([{ a: 'p1' }]);
        let calls = 0;
        await SM.mutateChatPresetMap(m => { calls++; m.b = 'p2'; });
        expect(calls).toBe(1);
    });

    it('multi-chunk path: change that appends a new chunk', async () => {
        await seed([fullChunk('full0')]);
        let calls = 0;
        await SM.mutateChatPresetMap(m => { calls++; m.n = LONG; });
        const after = await syncState();
        expect(after[META].chunkCount, 'precondition: the path must append a chunk').toBe(2);
        expect(calls).toBe(1);
    });

    it('multi-chunk path: change spanning two chunks that trims the trailing one', async () => {
        await seed([{ a: 'p1' }, { z: 'p9' }]);
        let calls = 0;
        await SM.mutateChatPresetMap(m => { calls++; m.a = 'p1-new'; delete m.z; });
        expect((await syncState())[META].chunkCount, 'precondition: the trailing chunk must be trimmed').toBe(1);
        expect(calls).toBe(1);
    });
});

describe('3. client mode rejects and writes nothing', () => {
    it('mutateChatPresetMap on a non-writer instance rejects with a writer-only error; storage untouched', async () => {
        const client = await loadFresh();
        await seed([{ a: 'p1' }]);
        const syncBefore = await syncState();
        const localBefore = await chrome.storage.local.get(null);

        await expect((async () => client.mutateChatPresetMap(m => { m.b = 'p2'; }))()).rejects.toThrow(/writer/i);

        expect(await syncState()).toEqual(syncBefore);
        expect(await chrome.storage.local.get(null)).toEqual(localBefore);
    });
});

describe('4. trailing-empty trimming', () => {
    it('emptying the last chunk leaves chunk keys exactly 0..chunkCount-1', async () => {
        await seed([{ a: 'p1' }, { b: 'p2' }, { y: 'p8', z: 'p9' }]);
        await SM.mutateChatPresetMap(m => { delete m.y; delete m.z; });

        const after = await syncState();
        expect(after[META].chunkCount).toBe(2);
        expect(after[META].chunkSizes).toHaveLength(2);
        expect(chunkKeysIn(after)).toEqual([chunkKey(0), chunkKey(1)]);
        expect(readerView(after, after[META])).toEqual({ a: 'p1', b: 'p2' });
    });

    it('trims consecutive trailing empties, keeping a non-trailing empty chunk', async () => {
        await seed([{ a: 'p1' }, {}, { y: 'p8' }, { z: 'p9' }]);
        await SM.mutateChatPresetMap(m => { delete m.y; delete m.z; });

        const after = await syncState();
        expect(after[META].chunkCount).toBe(1);
        expect(chunkKeysIn(after)).toEqual([chunkKey(0)]);
    });
});

describe('5. placement', () => {
    it('new uuid goes to the first chunk with room, even when it is not the last chunk', async () => {
        await seed([fullChunk('full0'), { small: 'p1' }, fullChunk('full2')]);
        const before = await syncState();
        await SM.mutateChatPresetMap(m => { m.n = LONG; });

        const after = await syncState();
        expect(after[META].chunkCount).toBe(3);
        expect(after[chunkKey(1)]).toEqual({ small: 'p1', n: LONG });
        expect(after[chunkKey(0)]).toEqual(before[chunkKey(0)]);
        expect(after[chunkKey(2)]).toEqual(before[chunkKey(2)]);
    });

    it('when every chunk is full, a new chunk is appended', async () => {
        await seed([fullChunk('full0'), fullChunk('full1')]);
        const before = await syncState();
        await SM.mutateChatPresetMap(m => { m.n = LONG; });

        const after = await syncState();
        expect(after[META].chunkCount).toBe(3);
        expect(after[chunkKey(2)]).toEqual({ n: LONG });
        expect(after[chunkKey(0)]).toEqual(before[chunkKey(0)]);
        expect(after[chunkKey(1)]).toEqual(before[chunkKey(1)]);
    });

    it('rebinding an existing uuid keeps it in its chunk even when an earlier chunk has room', async () => {
        await seed([{ a: 'p1' }, { b: 'p2', c: 'p3' }]);
        await SM.mutateChatPresetMap(m => { m.b = 'p2-new'; });

        const after = await syncState();
        expect(after[chunkKey(0)]).toEqual({ a: 'p1' });
        expect(after[chunkKey(1)]).toEqual({ b: 'p2-new', c: 'p3' });
    });
});

describe('6. version', () => {
    it('each committed mutation bumps meta.version by exactly 1', async () => {
        await seed([{ a: 'p1' }], 5);
        await SM.mutateChatPresetMap(m => { m.b = 'p2'; });
        expect((await syncState())[META].version).toBe(6);
        await SM.mutateChatPresetMap(m => { m.b = 'p2-new'; });
        expect((await syncState())[META].version).toBe(7);
        await SM.mutateChatPresetMap(m => { delete m.b; });
        expect((await syncState())[META].version).toBe(8);
    });

    it('concurrent calls are applied FIFO, each seeing the previous commit, one bump each', async () => {
        await seed([{ a: 'x' }], 5);
        const results = await Promise.all([
            SM.mutateChatPresetMap(m => { m.a = m.a + '1'; }),
            SM.mutateChatPresetMap(m => { m.a = m.a + '2'; }),
            SM.mutateChatPresetMap(m => { m.b = 'p3'; }),
        ]);

        const after = await syncState();
        expect(readerView(after, after[META])).toEqual({ a: 'x12', b: 'p3' });
        expect(results[0]).toEqual({ a: 'x1' });
        expect(results[2]).toEqual({ a: 'x12', b: 'p3' });
        expect(after[META].version).toBe(8);
    });

    // Decision: a mutation whose result equals the current map is a no-op: no storage write and no version bump (matches the isNoop short-circuit in the current chatmap.diff.js / chatmap.js).
    it('a no-op mutation writes nothing, does not bump version, and resolves to the current map', async () => {
        await seed([{ a: 'p1' }, { b: 'p2' }], 5);
        const before = await syncState();

        const result = await SM.mutateChatPresetMap(m => { m.a = 'p1'; });

        expect(await syncState()).toEqual(before);
        expect(result).toEqual({ a: 'p1', b: 'p2' });
    });
});

describe('7. orphan removal precedes the chunk/meta set', () => {
    it('no reader, holding the old or the current meta, ever sees a deleted binding during the commit', async () => {
        await seed([{ keep: 'p1' }, { gone1: 'p2', gone2: 'p3' }]);
        const mirror = await syncState();
        const oldMeta = structuredClone(mirror[META]);
        const states = [];
        // Rebuild the sync area from its change events so every state a concurrent reader could observe is recorded.
        const listener = (changes, area) => {
            if (area !== 'sync') return;
            for (const [k, { newValue }] of Object.entries(changes)) {
                if (newValue === undefined) delete mirror[k]; else mirror[k] = newValue;
            }
            states.push(structuredClone(mirror));
        };
        chrome.storage.onChanged.addListener(listener);
        try {
            // Also touching chunk 0 makes the commit span two chunks plus a trim.
            await SM.mutateChatPresetMap(m => { m.keep = 'p1-new'; delete m.gone1; delete m.gone2; });
        } finally {
            chrome.storage.onChanged.removeListener(listener);
        }

        expect(states.length, 'mutation produced no sync change events').toBeGreaterThan(0);
        states.forEach((state, i) => {
            for (const [label, meta] of [['old', oldMeta], ['current', state[META]]]) {
                const seen = Object.keys(readerView(state, meta));
                expect(seen, `state #${i}: reader with ${label} meta sees a deleted binding`).not.toContain('gone1');
                expect(seen, `state #${i}: reader with ${label} meta sees a deleted binding`).not.toContain('gone2');
            }
        });
        const final = states[states.length - 1];
        expect(final[chunkKey(1)]).toBeUndefined();
        expect(readerView(final, final[META])).toEqual({ keep: 'p1-new' });
    });
});
