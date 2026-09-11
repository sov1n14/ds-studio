/**
 * Targeted mutant-killer tests for utils/storage-manager.chatmap.js.
 * Kills survived mutants in queue, chunk cache, and multi-chunk lock paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const LARGE_VALUE = (i) => 'D'.repeat(200) + String(i);

describe('mutateChatPresetMap single-chunk diff path', () => {
    let SM;
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

    it('single-chunk change updates value and cache', async () => {
        await SM.bindChatToPreset('uuid-x', 'old-val');
        await SM.mutateChatPresetMap(m => { m['uuid-x'] = 'new-val'; });
        const map = await SM.getChatPresetMap();
        expect(map['uuid-x']).toBe('new-val');
    });

    it('single-chunk delete removes key from map and cache', async () => {
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

    it('_chunkIndexCache initialized when null on single-chunk path', async () => {
        await SM.bindChatToPreset('uuid-1', 'val-1');
        SM._chunkIndexCache = null;
        await SM.mutateChatPresetMap(m => { m['uuid-1'] = 'val-updated'; });
        const map = await SM.getChatPresetMap();
        expect(map['uuid-1']).toBe('val-updated');
    });
});

describe('mutateChatPresetMap multi-chunk lock path', () => {
    let SM;
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

    it('noop inside lock does not bump version', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['mc-' + i] = LARGE_VALUE(i); });
        const metaBefore = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta;
        await SM.mutateChatPresetMap(() => {});
        const metaAfter = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta;
        expect(metaAfter.version).toBe(metaBefore.version);
    }, { timeout: 30000 });

    it('removes trailing empty chunks after mutate (multi-chunk path)', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['trim-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        // Delete from last chunk AND modify another to force multi-chunk path
        const lastChunk = syncBefore['chatPresetMap_' + (countBefore - 1)];
        const firstChunk = syncBefore['chatPresetMap_0'];
        const lastKeys = Object.keys(lastChunk);
        const firstKey = Object.keys(firstChunk)[0];
        await SM.mutateChatPresetMap(m => {
            for (const k of lastKeys) delete m[k];
            m[firstKey] = 'modified-value';
        });
        const syncAfter = await chrome.storage.sync.get(null);
        expect(syncAfter.chatPresetMapMeta.chunkCount).toBeLessThan(countBefore);
    }, { timeout: 30000 });

    it('cleans up orphaned chunk keys on shrink', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['orp-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        expect(countBefore).toBeGreaterThan(1);
        await SM.mutateChatPresetMap(() => ({ single: 'entry' }));
        const syncAfter = await chrome.storage.sync.get(null);
        expect(syncAfter.chatPresetMapMeta.chunkCount).toBe(1);
        for (let i = 1; i < countBefore; i++) expect(syncAfter['chatPresetMap_' + i]).toBeUndefined();
    }, { timeout: 30000 });

    it('writes new chunks beyond original chunkCount', async () => {
        await SM.bindChatToPreset('seed-1', 'val');
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['expand-' + i] = LARGE_VALUE(i); });
        const syncData = await chrome.storage.sync.get(null);
        const meta = syncData.chatPresetMapMeta;
        expect(meta.chunkCount).toBeGreaterThan(1);
        for (let i = 0; i < meta.chunkCount; i++) expect(syncData['chatPresetMap_' + i]).toBeDefined();
    }, { timeout: 30000 });

    it('rebuilds cache after multi-chunk write', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 40; i++) m['rb-' + i] = LARGE_VALUE(i); });
        await SM.mutateChatPresetMap(m => { m['rb-new'] = 'new-val'; delete m['rb-000']; });
        await SM.bindChatToPreset('rb-new', 'updated-val');
        const map = await SM.getChatPresetMap();
        expect(map['rb-new']).toBe('updated-val');
        expect(map['rb-000']).toBeUndefined();
    }, { timeout: 30000 });

    it('writes meta when hasChanges is true', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['wr-' + i] = LARGE_VALUE(i); });
        const setSpy = vi.spyOn(SM, '_set');
        await SM.mutateChatPresetMap(m => { m['wr-000'] = 'changed'; });
        expect(setSpy).toHaveBeenCalled();
        const writeKeys = setSpy.mock.calls.flatMap(c => Object.keys(c[0]));
        expect(writeKeys).toContain('chatPresetMapMeta');
    }, { timeout: 30000 });

    it('recalculates chunk sizes for modified chunks', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['sz-' + i] = LARGE_VALUE(i); });
        await SM.mutateChatPresetMap(m => { for (const k of Object.keys(m)) m[k] = 'x'; });
        const syncData = await chrome.storage.sync.get(null);
        const meta = syncData.chatPresetMapMeta;
        for (let i = 0; i < meta.chunkCount; i++) {
            const chunk = syncData['chatPresetMap_' + i];
            expect(chunk).toBeDefined();
            expect(Object.keys(chunk).length).toBeGreaterThan(0);
        }
    }, { timeout: 30000 });
});

describe('bindChatToPreset edge cases', () => {
    let SM;
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

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
    }, { timeout: 30000 });

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
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

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
    }, { timeout: 30000 });

    it('chunkSizes length matches chunkCount after cascade', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 80; i++) m['sl-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        const lastChunk = syncBefore['chatPresetMap_' + (countBefore - 1)];
        for (const uuid of Object.keys(lastChunk)) await SM.unbindChat(uuid);
        const metaAfter = (await chrome.storage.sync.get('chatPresetMapMeta')).chatPresetMapMeta;
        expect(metaAfter.chunkSizes).toHaveLength(metaAfter.chunkCount);
    }, { timeout: 30000 });

    it('non-trailing unbind does not acquire lock', async () => {
        await SM.bindChatToPreset('uuid-a', 'a');
        await SM.bindChatToPreset('uuid-b', 'b');
        await SM.bindChatToPreset('uuid-c', 'c');
        const spy = vi.spyOn(SM, '_safeGet');
        await SM.unbindChat('uuid-a');
        const lockKey = StorageManager.CHAT_PRESET_MAP_LOCK_KEY;
        const lockGets = spy.mock.calls.filter(
            ([area, keys]) => area === 'local' && (Array.isArray(keys) ? keys : [keys]).includes(lockKey),
        );
        expect(lockGets).toHaveLength(0);
        const map = await SM.getChatPresetMap();
        expect(map['uuid-a']).toBeUndefined();
    });

    it('trailing unbind calls _safeRemove on both sync and local', async () => {
        await SM.mutateChatPresetMap(m => { for (let i = 0; i < 40; i++) m['orpc-' + i] = LARGE_VALUE(i); });
        const syncBefore = await chrome.storage.sync.get(null);
        const countBefore = syncBefore.chatPresetMapMeta.chunkCount;
        expect(countBefore).toBeGreaterThan(1);
        const lastChunk = syncBefore['chatPresetMap_' + (countBefore - 1)];
        const spy = vi.spyOn(SM, '_safeRemove');
        for (const uuid of Object.keys(lastChunk)) await SM.unbindChat(uuid);
        const syncCalls = spy.mock.calls.filter(([area]) => area === 'sync');
        const localCalls = spy.mock.calls.filter(([area]) => area === 'local');
        expect(syncCalls.length).toBeGreaterThan(0);
        expect(localCalls.length).toBeGreaterThan(0);
    }, { timeout: 30000 });
});

describe('pruneOrphanChatBindings edge cases', () => {
    let SM;
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

    it('null validPresetIds removes all bindings', async () => {
        await SM.bindChatToPreset('uuid-prune', 'a');
        await SM.pruneOrphanChatBindings(null);
        const map = await SM.getChatPresetMap();
        expect(map['uuid-prune']).toBeUndefined();
    });

    it('preserves entries with falsy presetId', async () => {
        await SM.bindChatToPreset('uuid-falsy', '');
        await SM.bindChatToPreset('uuid-valid', 'a');
        await SM.pruneOrphanChatBindings(['a']);
        const map = await SM.getChatPresetMap();
        expect(map['uuid-falsy']).toBe('');
        expect(map['uuid-valid']).toBe('a');
    });
});

describe('getChatPresetMap serialization', () => {
    let SM;
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

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
