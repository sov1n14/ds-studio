/**
 * Targeted mutant-killer tests for utils/storage-manager.chatmap.js and .chatmap.diff.js (writer-mode engine).
 * Every instance is fresh (vi.resetModules) and switched to writer mode; assertions are on chrome.storage end-state or resolved values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const LARGE_VALUE = (i) => 'D'.repeat(200) + String(i);
const byteLen = (o) => new TextEncoder().encode(JSON.stringify(o)).length;

async function loadWriter() {
    vi.resetModules();
    const mod = await import('../../utils/storage-manager.js');
    const sm = mod.default ?? mod;
    sm.enableChatMapWriterMode();
    return sm;
}

describe('mutateChatPresetMap single-chunk diff path', () => {
    let SM;
    beforeEach(async () => { SM = await loadWriter(); });

    it('single-chunk change updates value', async () => {
        await SM.bindChatToPreset('uuid-x', 'old-val');
        await SM.mutateChatPresetMap(m => { m['uuid-x'] = 'new-val'; });
        const map = await SM.getChatPresetMap();
        expect(map['uuid-x']).toBe('new-val');
    });

    it('single-chunk delete removes key from map', async () => {
        await SM.bindChatToPreset('uuid-del', 'val');
        await SM.bindChatToPreset('uuid-keep', 'val2');
        await SM.mutateChatPresetMap(m => { delete m['uuid-del']; });
        const map = await SM.getChatPresetMap();
        expect(map['uuid-del']).toBeUndefined();
        expect(map['uuid-keep']).toBe('val2');
    });

    it('single-chunk add inserts key into map', async () => {
        await SM.bindChatToPreset('uuid-exist', 'val');
        await SM.mutateChatPresetMap(m => { m['uuid-new'] = 'new-val'; });
        const map = await SM.getChatPresetMap();
        expect(map['uuid-new']).toBe('new-val');
        expect(map['uuid-exist']).toBe('val');
    });
});

describe('mutateChatPresetMap multi-chunk path', () => {
    let SM;
    beforeEach(async () => { SM = await loadWriter(); });

    it('no-op on a multi-chunk map does not bump version', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['mc-' + i] = LARGE_VALUE(i); });
        const metaBefore = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta;
        expect(metaBefore.chunkCount, 'precondition: multi-chunk').toBeGreaterThan(1);
        await SM.mutateChatPresetMap(() => {});
        const metaAfter = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta;
        expect(metaAfter.version).toBe(metaBefore.version);
    }, 30000);

    it('removes trailing empty chunks after a mutate that also modifies chunk 0', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['trim-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        const lastKeys = Object.keys(syncBefore['chatPresetMap_' + (countBefore - 1)]);
        const firstKey = Object.keys(syncBefore['chatPresetMap_0'])[0];
        await SM.mutateChatPresetMap(m => {
            for (const k of lastKeys) delete m[k];
            m[firstKey] = 'modified-value';
        });
        const syncAfter = await chrome.storage.sync.get(null);
        expect(syncAfter.chatPresetMapMeta.chunkCount).toBeLessThan(countBefore);
        expect(syncAfter['chatPresetMap_0'][firstKey]).toBe('modified-value');
    }, 30000);

    it('cleans up orphaned chunk keys on shrink', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['orp-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        expect(countBefore).toBeGreaterThan(1);
        await SM.mutateChatPresetMap(() => ({ single: 'entry' }));
        const syncAfter = await chrome.storage.sync.get(null);
        expect(syncAfter.chatPresetMapMeta.chunkCount).toBe(1);
        for (let i = 1; i < countBefore; i++) expect(syncAfter['chatPresetMap_' + i]).toBeUndefined();
    }, 30000);

    it('writes new chunks beyond original chunkCount', async () => {
        await SM.bindChatToPreset('seed-1', 'val');
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['expand-' + i] = LARGE_VALUE(i); });
        const syncData = await chrome.storage.sync.get(null);
        const meta = syncData.chatPresetMapMeta;
        expect(meta.chunkCount).toBeGreaterThan(1);
        for (let i = 0; i < meta.chunkCount; i++) expect(syncData['chatPresetMap_' + i]).toBeDefined();
    }, 30000);

    it('a rebind after a multi-chunk add+delete updates the new key; the deleted key stays gone', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 40; i++) m['rb-' + i] = LARGE_VALUE(i); });
        await SM.mutateChatPresetMap(m => { m['rb-new'] = 'new-val'; delete m['rb-0']; });
        await SM.bindChatToPreset('rb-new', 'updated-val');
        const map = await SM.getChatPresetMap();
        expect(map['rb-new']).toBe('updated-val');
        expect(map['rb-0']).toBeUndefined();
        expect(Object.keys(map)).toHaveLength(40);
    }, 30000);

    it('a committed change on a multi-chunk map persists and bumps meta.version by 1', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['wr-' + i] = LARGE_VALUE(i); });
        const versionBefore = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta.version;
        await SM.mutateChatPresetMap(m => { m['wr-0'] = 'changed'; });
        const meta = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta;
        expect(meta.version).toBe(versionBefore + 1);
        expect((await SM.getChatPresetMap())['wr-0']).toBe('changed');
    }, 30000);

    it('meta.chunkSizes equals the real byte size of every persisted chunk after a shrink-in-place', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['sz-' + i] = LARGE_VALUE(i); });
        await SM.mutateChatPresetMap(m => { for (const k of Object.keys(m)) m[k] = 'x'; });
        const syncData = await chrome.storage.sync.get(null);
        const meta = syncData.chatPresetMapMeta;
        expect(meta.chunkSizes).toHaveLength(meta.chunkCount);
        for (let i = 0; i < meta.chunkCount; i++) {
            const chunk = syncData['chatPresetMap_' + i];
            expect(chunk).toBeDefined();
            expect(Object.keys(chunk).length).toBeGreaterThan(0);
            expect(meta.chunkSizes[i], `chunkSizes[${i}]`).toBe(byteLen(chunk));
        }
    }, 30000);
});

describe('chunk-content edges (no trust in meta, no duplicate survivors)', () => {
    let SM;
    beforeEach(async () => { SM = await loadWriter(); });

    it('unbinding a uuid present in two chunks removes it from both', async () => {
        const c0 = { dup: 'p-old', a: 'p1' };
        const c1 = { dup: 'p-new', b: 'p2' };
        await chrome.storage.sync.set({
            chatPresetMapMeta: { version: 3, chunkCount: 2, chunkSizes: [byteLen(c0), byteLen(c1)] },
            chatPresetMap_0: c0,
            chatPresetMap_1: c1,
        });

        await SM.unbindChat('dup');

        const after = await chrome.storage.sync.get(null);
        expect(after.chatPresetMap_0, 'chunk 0 still holds the duplicate').toEqual({ a: 'p1' });
        expect(after.chatPresetMap_1, 'chunk 1 still holds the duplicate').toEqual({ b: 'p2' });
        expect(await SM.getChatPresetMap()).toEqual({ a: 'p1', b: 'p2' });
    });

    it('placement measures the real chunk size, not a stale meta.chunkSizes that claims the chunk is empty', async () => {
        const limit = SM.CHUNK_SOFT_LIMIT_BYTES;
        const full = { full0: 'F'.repeat(limit - 200) };
        await chrome.storage.sync.set({
            chatPresetMapMeta: { version: 3, chunkCount: 1, chunkSizes: [0] },
            chatPresetMap_0: full,
        });

        const long = 'P'.repeat(500);
        await SM.bindChatToPreset('n', long);

        const after = await chrome.storage.sync.get(null);
        expect(after.chatPresetMap_0, 'new entry was packed into a full chunk').toEqual(full);
        expect(after.chatPresetMap_1).toEqual({ n: long });
        expect(after.chatPresetMapMeta.chunkCount).toBe(2);
        expect(after.chatPresetMapMeta.chunkSizes).toEqual([byteLen(full), byteLen({ n: long })]);
    });
});

describe('bindChatToPreset edge cases', () => {
    let SM;
    beforeEach(async () => { SM = await loadWriter(); });

    it('returns true for new bind', async () => {
        expect(await SM.bindChatToPreset('uuid-ret', 'a')).toBe(true);
    });

    it('returns true for re-bind', async () => {
        await SM.bindChatToPreset('uuid-ret', 'a');
        expect(await SM.bindChatToPreset('uuid-ret', 'b')).toBe(true);
    });

    it('skips write when re-binding same value', async () => {
        await SM.bindChatToPreset('uuid-noop', 'preset-a');
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');
        await SM.bindChatToPreset('uuid-noop', 'preset-a');
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('appends new chunk when all existing are full', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 35; i++) m['full-' + i] = LARGE_VALUE(i); });
        const countBefore = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta.chunkCount;
        await SM.mutateChatPresetMap(m => { for (let i = 35; i < 70; i++) m['full-' + i] = LARGE_VALUE(i); });
        const countAfter = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta.chunkCount;
        expect(countAfter).toBeGreaterThan(countBefore);
    }, 30000);

    it('in-place update persists new value', async () => {
        await SM.bindChatToPreset('uuid-upd', 'preset-a');
        await SM.bindChatToPreset('uuid-upd', 'preset-b');
        const map = await SM.getChatPresetMap();
        expect(map['uuid-upd']).toBe('preset-b');
    });

    it('finds first chunk with capacity (boundary)', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 33; i++) m['cap-' + i] = LARGE_VALUE(i); });
        await SM.bindChatToPreset('cap-boundary', LARGE_VALUE(99));
        const map = await SM.getChatPresetMap();
        expect(map['cap-boundary']).toBe(LARGE_VALUE(99));
    });
});

describe('unbindChat edge cases', () => {
    let SM;
    beforeEach(async () => { SM = await loadWriter(); });

    it('returns true when uuid does not exist', async () => {
        expect(await SM.unbindChat('nonexistent')).toBe(true);
    });

    it('returns true after successful unbind', async () => {
        await SM.bindChatToPreset('uuid-unb', 'a');
        expect(await SM.unbindChat('uuid-unb')).toBe(true);
    });

    it('returns true when uuid already deleted from chunk', async () => {
        await SM.bindChatToPreset('uuid-ghost', 'a');
        const syncData = await chrome.storage.sync.get(null);
        const meta = syncData.chatPresetMapMeta;
        for (let i = 0; i < meta.chunkCount; i++) {
            const key = 'chatPresetMap_' + i;
            const chunk = syncData[key];
            if (chunk && 'uuid-ghost' in chunk) {
                delete chunk['uuid-ghost'];
                await chrome.storage.sync.set({ [key]: chunk });
            }
        }
        expect(await SM.unbindChat('uuid-ghost')).toBe(true);
    });

    it('cascading trailing empty chunk removal', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['cas-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        expect(countBefore).toBeGreaterThanOrEqual(3);
        const lastChunk = syncBefore['chatPresetMap_' + (countBefore - 1)];
        const secondLast = syncBefore['chatPresetMap_' + (countBefore - 2)];
        for (const uuid of Object.keys(lastChunk)) await SM.unbindChat(uuid);
        for (const uuid of Object.keys(secondLast)) await SM.unbindChat(uuid);
        const syncAfter = await chrome.storage.sync.get(null);
        expect(syncAfter.chatPresetMapMeta.chunkCount).toBeLessThanOrEqual(countBefore - 2);
        for (let i = syncAfter.chatPresetMapMeta.chunkCount; i < countBefore; i++) {
            expect(syncAfter['chatPresetMap_' + i]).toBeUndefined();
        }
    }, 30000);

    it('chunkSizes length matches chunkCount after cascade', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['sl-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        const lastChunk = syncBefore['chatPresetMap_' + (countBefore - 1)];
        for (const uuid of Object.keys(lastChunk)) await SM.unbindChat(uuid);
        const metaAfter = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta;
        expect(metaAfter.chunkSizes).toHaveLength(metaAfter.chunkCount);
    }, 30000);

    it('emptying the trailing chunk removes its key from both sync and local', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 40; i++) m['orpc-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        expect(countBefore).toBeGreaterThan(1);
        const lastKey = 'chatPresetMap_' + (countBefore - 1);
        expect((await chrome.storage.local.get(lastKey))[lastKey], 'precondition: local mirror holds the trailing chunk').toBeDefined();
        for (const uuid of Object.keys(syncBefore[lastKey])) await SM.unbindChat(uuid);
        expect((await chrome.storage.sync.get(lastKey))[lastKey], 'sync orphan').toBeUndefined();
        expect((await chrome.storage.local.get(lastKey))[lastKey], 'local orphan').toBeUndefined();
    }, 30000);
});

describe('getChatPresetMap serialization', () => {
    let SM;
    beforeEach(async () => { SM = await loadWriter(); });

    it('returns empty object with no bindings', async () => {
        expect(await SM.getChatPresetMap()).toEqual({});
    });

    it('concurrent writes produce consistent final state', async () => {
        const p1 = SM.bindChatToPreset('c-1', 'v1');
        const p2 = SM.bindChatToPreset('c-2', 'v2');
        await Promise.all([p1, p2]);
        const map = await SM.getChatPresetMap();
        expect(map['c-1']).toBe('v1');
        expect(map['c-2']).toBe('v2');
    });
});
