/**
 * Scenario tests: paths outside the chat-map writer (resolveSyncConflict, retrySync, initialize's migration push, legacy migration) must not write chat-map keys (chatPresetMapMeta, chatPresetMap_<n>, legacy chatPresetMap) behind the service-worker single writer's back.
 *
 * Real SW StorageManager + real background/chat-map-routes.js + real never-initialized clients (test/helpers/chat-map-writer-harness.js). Mocked trust boundaries only: chrome.storage areas and chrome.runtime messaging. A concurrent SW commit is injected with h.interleaveBeforeNextWrite: it lands after the caller took its snapshot and before the caller's first write, which is exactly the window a stale write-back exploits. Assertions read durable storage end-state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChatMapWriterHarness, restoreChromeBoundaries, byteLen, NO_RECEIVER, within } from '../helpers/chat-map-writer-harness.js';

const MSG = globalThis.DSS_CHAT_MAP_MSG;
const LEGACY = 'chatPresetMap';
const AUTH = 'dsLocalAuth';
const LOCAL_ONLY = ['restored_messages', 'isEnabled', 'globalPromptEnabled'];

let h;
let a;
let b;

beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h = await createChatMapWriterHarness({ clientCount: 2 });
    [a, b] = h.clients;
});

afterEach(() => {
    restoreChromeBoundaries();
    vi.restoreAllMocks();
});

/** Every DEFAULTS key except the legacy map in local, minus local-only keys in sync, so initialize()'s default fill is a no-op and the migration-push branch is the one exercised. */
async function seedSettingsDefaults() {
    const all = { ...h.sw.DEFAULTS, syncInitialized: true };
    delete all[LEGACY];
    const syncItems = { ...all };
    LOCAL_ONLY.forEach((k) => delete syncItems[k]);
    await h.local.set(all);
    await h.sync.set(syncItems);
}

/** Chat-map keys as stored in `area` (meta, chunks, legacy). */
async function chatMapKeys(area) {
    const all = await area.get(null);
    return Object.fromEntries(Object.entries(all).filter(([k]) => k === LEGACY || k.startsWith('chatPresetMap')));
}

async function expectInterleaved(ix) {
    expect(ix.hasTripped(), 'the concurrent SW commit must have been injected before a write by the code under test').toBe(true);
    await within(ix.done(), 3000, 'concurrent SW commit');
}

describe('W1 resolveSyncConflict never writes chat-map keys from its snapshot', () => {
    it('a chunk appended by the SW mid-resolve stays visible: meta keeps chunkCount 2', async () => {
        await h.seedChatMap([h.fullChunk()]);
        await h.local.set({ syncConflictPending: true });
        const ix = h.interleaveBeforeNextWrite(() => b.bindChatToPreset('uNew', 'p1'));

        await a.resolveSyncConflict();
        await expectInterleaved(ix);

        const stored = await h.readStored();
        expect(stored.meta.chunkCount, 'a stale chunkCount 1 hides chunk 1').toBe(2);
        expect(stored.map.uNew).toBe('p1');
        expect(h.layoutProblems(stored)).toEqual([]);
    });

    it('a legacy chatPresetMap left in local is not written back to sync', async () => {
        await h.seedChatMap([{ keep: 'p1' }]);
        await h.local.set({ syncConflictPending: true, [LEGACY]: { stale: 'p9' } });

        await a.resolveSyncConflict();

        const syncAfter = await h.sync.get(null);
        expect(syncAfter).not.toHaveProperty(LEGACY);
        expect((await h.readStored()).map).toEqual({ keep: 'p1' });
    });
});

describe('W2 retrySync republishes parked chat-map keys through the SW', () => {
    it('a parked chunk is not reverted: sync ends with the SW-committed value, the keys leave dsLocalAuth, a parked setting is still pushed', async () => {
        const v1 = { a: 'p1' };
        const meta = { version: 1, chunkCount: 1, chunkSizes: [byteLen(v1)] };
        await h.sync.set({ [h.metaKey]: meta, [h.chunkKey(0)]: { a: 'p0' }, dsChatWidth: 50 });
        await h.local.set({ [h.metaKey]: meta, [h.chunkKey(0)]: v1, dsChatWidth: 90, [AUTH]: [h.chunkKey(0), h.metaKey, 'dsChatWidth'] });
        let committed;
        const ix = h.interleaveBeforeNextWrite(async () => {
            await b.bindChatToPreset('b', 'p2');
            committed = (await h.local.get(h.chunkKey(0)))[h.chunkKey(0)];
        });

        await a.retrySync();
        await expectInterleaved(ix);

        expect(committed?.b, 'precondition: the SW commit wrote the chunk to local').toBe('p2');
        const stored = await h.readStored();
        expect(stored.chunks[0], 'sync must hold the SW-committed chunk, not the parked snapshot').toEqual(committed);
        expect((await h.local.get(h.chunkKey(0)))[h.chunkKey(0)], 'local must not be reverted either').toEqual(committed);
        expect(stored.map.b).toBe('p2');
        expect(h.layoutProblems(stored)).toEqual([]);
        const auth = (await h.local.get(AUTH))[AUTH] ?? [];
        expect(auth).not.toContain(h.chunkKey(0));
        expect(auth).not.toContain(h.metaKey);
        expect(auth).not.toContain('dsChatWidth');
        expect((await h.sync.get('dsChatWidth')).dsChatWidth).toBe(90);
    });

    it('route REPUBLISH_PARKED: a parked key gone from local is removed from sync and unparked', async () => {
        await h.sync.set({ [h.chunkKey(1)]: { z: 'p1' } });
        await h.local.set({ [AUTH]: [h.chunkKey(1)] });

        const res = await within(chrome.runtime.sendMessage({ type: MSG.REPUBLISH_PARKED, keys: [h.chunkKey(1)] }), 3000, 'REPUBLISH_PARKED');

        expect(res).toMatchObject({ ok: true });
        expect(await h.sync.get(null)).not.toHaveProperty(h.chunkKey(1));
        expect((await h.local.get(AUTH))[AUTH] ?? []).not.toContain(h.chunkKey(1));
    });

    it('route REPUBLISH_PARKED: a parked key is pushed with its current local value and unparked', async () => {
        const current = { c: 'p3' };
        await h.sync.set({ [h.chunkKey(0)]: { c: 'old' } });
        await h.local.set({ [h.chunkKey(0)]: current, [AUTH]: [h.chunkKey(0)] });

        const res = await within(chrome.runtime.sendMessage({ type: MSG.REPUBLISH_PARKED, keys: [h.chunkKey(0)] }), 3000, 'REPUBLISH_PARKED');

        expect(res).toMatchObject({ ok: true });
        expect((await h.sync.get(h.chunkKey(0)))[h.chunkKey(0)]).toEqual(current);
        expect((await h.local.get(AUTH))[AUTH] ?? []).not.toContain(h.chunkKey(0));
    });
});

describe('W3 initialize migration push never writes chatPresetMapMeta', () => {
    it('meta written by the SW mid-initialize survives; a missing setting is still pushed', async () => {
        await seedSettingsDefaults();
        await h.local.set({ [h.metaKey]: { version: 1, chunkCount: 0, chunkSizes: [] }, includeThinking: false });
        await h.sync.remove(['includeThinking', h.metaKey]);
        const ix = h.interleaveBeforeNextWrite(() => b.bindChatToPreset('uMid', 'p1'));

        await a.initialize();
        await expectInterleaved(ix);

        expect((await h.sync.get('includeThinking')).includeThinking, 'precondition: the migration-push branch ran').toBe(false);
        const stored = await h.readStored();
        expect(stored.meta?.chunkCount, 'a start-of-initialize meta snapshot must not overwrite the SW commit').toBe(1);
        expect(stored.map.uMid).toBe('p1');
    });
});

describe('W4 legacy chatPresetMap migration goes through the SW (MIGRATE_LEGACY)', () => {
    const legacy = { 'uuid-1': 'preset-a', 'uuid-2': 'preset-b' };

    it('client initialize() resolves; chunks + meta hold the legacy bindings; the legacy key is gone in sync and local', async () => {
        await h.sync.set({ [LEGACY]: legacy });
        await h.local.set({ [LEGACY]: legacy });

        await expect(within(a.initialize(), 5000, 'client initialize')).resolves.toBeUndefined();

        const stored = await h.readStored();
        expect(stored.map).toEqual(legacy);
        expect(h.layoutProblems(stored)).toEqual([]);
        expect(await h.sync.get(null)).not.toHaveProperty(LEGACY);
        expect(await h.local.get(null)).not.toHaveProperty(LEGACY);
    });

    it('running initialize() again is a no-op for chat-map keys', async () => {
        await h.sync.set({ [LEGACY]: legacy });
        await a.initialize();
        const syncBefore = await chatMapKeys(h.sync);
        const localBefore = await chatMapKeys(h.local);

        await expect(within(a.initialize(), 5000, 'second initialize')).resolves.toBeUndefined();

        expect(await chatMapKeys(h.sync)).toEqual(syncBefore);
        expect(await chatMapKeys(h.local)).toEqual(localBefore);
        expect((await h.readStored()).map).toEqual(legacy);
    });

    it('with meta already present the legacy key is removed and the chunks are not overwritten', async () => {
        await h.seedChatMap([{ x: 'p1' }]);
        await h.sync.set({ [LEGACY]: { old: 'p9' } });
        await h.local.set({ [LEGACY]: { old: 'p9' } });

        await expect(within(a.initialize(), 5000, 'client initialize')).resolves.toBeUndefined();

        expect((await h.readStored()).map).toEqual({ x: 'p1' });
        expect(await h.sync.get(null)).not.toHaveProperty(LEGACY);
        expect(await h.local.get(null)).not.toHaveProperty(LEGACY);
    });

    it('SW unreachable: initialize() still resolves', async () => {
        await h.sync.set({ [LEGACY]: legacy });
        h.transport.failAlways('reject', NO_RECEIVER);

        await expect(within(a.initialize(), 5000, 'client initialize')).resolves.toBeUndefined();
    });

    it('route MIGRATE_LEGACY: migrates, answers ok, and a repeat changes nothing', async () => {
        await h.sync.set({ [LEGACY]: legacy });

        const first = await within(chrome.runtime.sendMessage({ type: MSG.MIGRATE_LEGACY }), 3000, 'MIGRATE_LEGACY');
        expect(first).toMatchObject({ ok: true });
        expect((await h.readStored()).map).toEqual(legacy);
        const after = await chatMapKeys(h.sync);
        expect(after).not.toHaveProperty(LEGACY);

        const second = await within(chrome.runtime.sendMessage({ type: MSG.MIGRATE_LEGACY }), 3000, 'MIGRATE_LEGACY repeat');
        expect(second).toMatchObject({ ok: true });
        expect(await chatMapKeys(h.sync)).toEqual(after);
    });
});
