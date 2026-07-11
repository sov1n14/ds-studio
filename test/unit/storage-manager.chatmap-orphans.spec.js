/**
 * utils/storage-manager.chatmap.js — orphaned-chunk-key cleanup (Array.from).
 * Both unbindChat()'s tail-trim branch and mutateChatPresetMap()'s
 * multi-chunk/rebalance branch build their "keys to delete" list via
 * Array.from({ length: N }, (_, i) => PREFIX + (start + i)) (replacing an
 * earlier manual loop). No prior spec exercised the orphaned-key removal
 * directly — this file closes that gap.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;
const PREFIX = K.CHAT_PRESET_MAP_CHUNK_PREFIX;

describe('unbindChat() — tail-chunk orphaned-key cleanup', () => {
    beforeEach(() => {
        StorageManager._metaCache = null;
        StorageManager._chunkIndexCache = null;
    });

    it('removes the emptied tail chunk key from storage and shrinks chunkCount', async () => {
        await chrome.storage.sync.set({
            [K.CHAT_PRESET_MAP_META]: { version: 1, chunkCount: 2, chunkSizes: [10, 10] },
        });
        await chrome.storage.local.set({
            [`${PREFIX}0`]: { uuidX: 'p1' },
            [`${PREFIX}1`]: { uuidY: 'p2' },
        });

        await StorageManager.unbindChat('uuidY');

        const localAfter = await chrome.storage.local.get([`${PREFIX}1`]);
        expect(localAfter[`${PREFIX}1`]).toBeUndefined();

        const syncMeta = await chrome.storage.sync.get([K.CHAT_PRESET_MAP_META]);
        expect(syncMeta[K.CHAT_PRESET_MAP_META].chunkCount).toBe(1);
    });

    it('leaves earlier chunks untouched after trimming a trailing empty chunk', async () => {
        await chrome.storage.sync.set({
            [K.CHAT_PRESET_MAP_META]: { version: 1, chunkCount: 2, chunkSizes: [10, 10] },
        });
        await chrome.storage.local.set({
            [`${PREFIX}0`]: { uuidX: 'p1' },
            [`${PREFIX}1`]: { uuidY: 'p2' },
        });

        await StorageManager.unbindChat('uuidY');

        const map = await StorageManager.getChatPresetMap();
        expect(map).toEqual({ uuidX: 'p1' });
    });
});
