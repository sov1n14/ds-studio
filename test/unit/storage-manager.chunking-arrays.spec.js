/**
 * utils/storage-manager.chunking.js — Array.from-based chunk-key generation.
 * _ensureChunkCachesLoaded() and _readAllChunks() both build their chunk-key
 * lists via Array.from({ length: meta.chunkCount }, (_, i) => PREFIX + i)
 * (replacing an earlier manual loop). No prior spec exercised these directly
 * for chunkCount 0 / 1 / 3 — this file closes that gap.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('_ensureChunkCachesLoaded() / _readAllChunks() — chunk-key array generation', () => {
    beforeEach(() => {
        // Reset in-memory caches so each test starts from a clean read.
        StorageManager._metaCache = null;
        StorageManager._chunkIndexCache = null;
    });

    it('chunkCount=0: reads zero chunk keys, produces an empty merged map', async () => {
        await chrome.storage.sync.set({
            [K.CHAT_PRESET_MAP_META]: { version: 1, chunkCount: 0, chunkSizes: [] },
        });

        const { map, chunksByIdx } = await StorageManager._readAllChunks();

        expect(chunksByIdx).toEqual([]);
        expect(map).toEqual({});
    });

    it('chunkCount=1: reads exactly one chunk key and merges its entries', async () => {
        await chrome.storage.sync.set({
            [K.CHAT_PRESET_MAP_META]: { version: 1, chunkCount: 1, chunkSizes: [10] },
        });
        await chrome.storage.local.set({
            [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}0`]: { uuidA: 'p1' },
        });

        const { map, chunksByIdx } = await StorageManager._readAllChunks();

        expect(chunksByIdx).toHaveLength(1);
        expect(map).toEqual({ uuidA: 'p1' });
    });

    it('chunkCount=3: reads exactly three chunk keys in order and merges all entries', async () => {
        await chrome.storage.sync.set({
            [K.CHAT_PRESET_MAP_META]: { version: 1, chunkCount: 3, chunkSizes: [5, 5, 5] },
        });
        await chrome.storage.local.set({
            [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}0`]: { uuidA: 'p1' },
            [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}1`]: { uuidB: 'p2' },
            [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}2`]: { uuidC: 'p3' },
        });

        const { map, chunksByIdx } = await StorageManager._readAllChunks();

        expect(chunksByIdx).toHaveLength(3);
        expect(map).toEqual({ uuidA: 'p1', uuidB: 'p2', uuidC: 'p3' });
    });

    it('_ensureChunkCachesLoaded builds a chunk-index map covering every chunk for chunkCount=3', async () => {
        await chrome.storage.sync.set({
            [K.CHAT_PRESET_MAP_META]: { version: 1, chunkCount: 3, chunkSizes: [5, 5, 5] },
        });
        await chrome.storage.local.set({
            [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}0`]: { uuidA: 'p1' },
            [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}1`]: { uuidB: 'p2' },
            [`${K.CHAT_PRESET_MAP_CHUNK_PREFIX}2`]: { uuidC: 'p3' },
        });

        await StorageManager._ensureChunkCachesLoaded();

        expect(StorageManager._chunkIndexCache.get('uuidA')).toBe(0);
        expect(StorageManager._chunkIndexCache.get('uuidB')).toBe(1);
        expect(StorageManager._chunkIndexCache.get('uuidC')).toBe(2);
    });
});
