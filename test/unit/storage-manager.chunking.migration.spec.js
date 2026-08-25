import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { resetStorageOnChangedListeners, getStorageOnChangedListenerCount } from '../setup/vitest.setup.js';

/**
 * NOTE on module-level cache bleed:
 * Because _metaCache and _chunkIndexCache are module-level (not reset between tests),
 * later tests in this file may operate with stale caches from prior tests.
 * The assertions are designed to be robust against this: they inspect raw storage
 * directly and check relative properties (e.g., "at least one chunk exists") rather
 * than assuming absolute chunk indices.
 */

describe('StorageManager legacy chatPresetMap migration', () => {
    beforeEach(() => {
        // Storage is cleared by vitest.setup.js beforeEach
    });

    describe('1. Happy path migration', () => {
        it('migrates a populated legacy chatPresetMap to chunked layout via initialize()', async () => {
            const legacyData = {
                'uuid-1': 'preset-a',
                'uuid-2': 'preset-b',
                'uuid-3': 'preset-c',
            };
            await chrome.storage.sync.set({ chatPresetMap: legacyData });

            await StorageManager.initialize();

            // chatPresetMapMeta must exist
            const syncData = await chrome.storage.sync.get(null);
            expect(syncData.chatPresetMapMeta).toBeDefined();
            expect(typeof syncData.chatPresetMapMeta.version).toBe('number');
            expect(syncData.chatPresetMapMeta.chunkCount).toBeGreaterThanOrEqual(1);

            // At least one chunk key exists
            const chunkKeys = Object.keys(syncData).filter(
                k => k.startsWith('chatPresetMap_') && k !== 'chatPresetMapMeta'
            );
            expect(chunkKeys.length).toBeGreaterThanOrEqual(1);

            // Legacy chatPresetMap key must NOT exist in sync or local
            expect(syncData.chatPresetMap).toBeUndefined();
            const localData = await chrome.storage.local.get('chatPresetMap');
            expect(localData.chatPresetMap).toBeUndefined();

            // getChatPresetMap returns the same bindings
            const map = await StorageManager.getChatPresetMap();
            expect(map).toEqual(legacyData);
        });
    });

    describe('2. Idempotent retry (partial migration crashed mid-way)', () => {
        it('handles the case where both legacy chatPresetMap and chatPresetMapMeta exist', async () => {
            const legacyData = { 'uuid-1': 'preset-a', 'uuid-2': 'preset-b' };
            const meta = { version: 0, chunkCount: 1, chunkSizes: [100] };
            const chunkData = { 'uuid-1': 'preset-a', 'uuid-2': 'preset-b' };

            await chrome.storage.sync.set({
                chatPresetMap: legacyData,
                chatPresetMapMeta: meta,
                chatPresetMap_0: chunkData,
            });

            await StorageManager.initialize();

            // Legacy key should be removed (idempotent cleanup)
            const syncData = await chrome.storage.sync.get(null);
            expect(syncData.chatPresetMap).toBeUndefined();

            // Map is intact
            const map = await StorageManager.getChatPresetMap();
            expect(map).toEqual(legacyData);

            // No duplicate entries across chunks
            const totalEntries = [];
            const newMeta = syncData.chatPresetMapMeta;
            if (newMeta) {
                for (let i = 0; i < newMeta.chunkCount; i++) {
                    const chunk = syncData[`chatPresetMap_${i}`] || {};
                    totalEntries.push(...Object.keys(chunk));
                }
            }
            const uniqueUuids = new Set(totalEntries);
            expect(uniqueUuids.size).toBe(totalEntries.length);
        });
    });

    describe('3. Empty legacy migration', () => {
        it('migrates an empty legacy chatPresetMap to chunked layout with no chunks', async () => {
            await chrome.storage.sync.set({ chatPresetMap: {} });

            await StorageManager.initialize();

            // getChatPresetMap returns empty object
            const map = await StorageManager.getChatPresetMap();
            expect(map).toEqual({});

            // Legacy key removed
            const syncData = await chrome.storage.sync.get(null);
            expect(syncData.chatPresetMap).toBeUndefined();
            const localData = await chrome.storage.local.get('chatPresetMap');
            expect(localData.chatPresetMap).toBeUndefined();

            // No chunk keys exist
            for (let i = 0; i < 10; i++) {
                expect(syncData[`chatPresetMap_${i}`]).toBeUndefined();
            }
        });
    });

    describe('4. Legacy in local-only storage', () => {
        it('migrates legacy chatPresetMap from chrome.storage.local when sync has no legacy key', async () => {
            const legacyData = { 'uuid-local': 'preset-local' };
            await chrome.storage.local.set({ chatPresetMap: legacyData });

            await StorageManager.initialize();

            // Data migrated into chunked format
            const map = await StorageManager.getChatPresetMap();
            expect(map).toEqual(legacyData);

            // Legacy key removed from local
            const localData = await chrome.storage.local.get('chatPresetMap');
            expect(localData.chatPresetMap).toBeUndefined();

            // Meta and at least one chunk key exist in sync
            const syncData = await chrome.storage.sync.get(null);
            expect(syncData.chatPresetMapMeta).toBeDefined();
            expect(syncData.chatPresetMapMeta.chunkCount).toBeGreaterThanOrEqual(1);

            const chunkKeys = Object.keys(syncData).filter(
                k => k.startsWith('chatPresetMap_') && k !== 'chatPresetMapMeta'
            );
            expect(chunkKeys.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('5. Fresh install (no legacy data, no meta)', () => {
        it('does not run chatPresetMap migration and returns empty map', async () => {
            await StorageManager.initialize();

            // getChatPresetMap returns empty
            const map = await StorageManager.getChatPresetMap();
            expect(map).toEqual({});

            // No meta or chunk keys created
            const syncData = await chrome.storage.sync.get(null);
            expect(syncData.chatPresetMapMeta).toBeUndefined();
            for (let i = 0; i < 10; i++) {
                expect(syncData[`chatPresetMap_${i}`]).toBeUndefined();
            }

            // No legacy key exists
            expect(syncData.chatPresetMap).toBeUndefined();
            const localData = await chrome.storage.local.get('chatPresetMap');
            expect(localData.chatPresetMap).toBeUndefined();
        });
    });
});

/**
 * U8 — initialize() is re-entrant (the popup, the content script and the service
 * worker each call it, and the promptPresets migration branch re-enters it
 * recursively), so the chunk-cache invalidator it installs must be registered
 * exactly once per context no matter how many times initialize() runs.
 * Otherwise every extra call leaves another live chrome.storage.onChanged
 * listener behind, and each subsequent storage write fans out to all of them.
 */
describe('U8 — initialize() installs the chunk-cache invalidator exactly once', () => {
    beforeEach(() => {
        resetStorageOnChangedListeners();
    });

    it('registers exactly one chrome.storage.onChanged listener across 3 initialize() calls', async () => {
        expect(getStorageOnChangedListenerCount()).toBe(0);

        await StorageManager.initialize();
        expect(getStorageOnChangedListenerCount()).toBe(1);

        await StorageManager.initialize();
        await StorageManager.initialize();

        expect(getStorageOnChangedListenerCount()).toBe(1);
    });

    it('still invalidates the chunk caches after repeated initialize() calls', async () => {
        await StorageManager.initialize();
        await StorageManager.initialize();

        StorageManager._chunkIndexCache = new Map();
        StorageManager._metaCache = { version: 1, chunkCount: 0, chunkSizes: [] };

        await chrome.storage.sync.set({ chatPresetMapMeta: { version: 2, chunkCount: 0, chunkSizes: [] } });

        expect(StorageManager._chunkIndexCache).toBeNull();
        expect(StorageManager._metaCache).toBeNull();
    });
});
