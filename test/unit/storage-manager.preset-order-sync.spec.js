import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

const preset = (id, ts = 1) => ({ id, name: id, content: id, createdAt: ts, updatedAt: ts });

describe('Preset order sync — _pickPresetOrderByRecency & savePromptPresets order meta', () => {
    describe('_pickPresetOrderByRecency()', () => {
        it('returns sync meta when sync orderUpdatedAt is larger', () => {
            const local = { order: ['a', 'b'], orderUpdatedAt: 100 };
            const sync  = { order: ['b', 'a'], orderUpdatedAt: 200 };
            const result = StorageManager._pickPresetOrderByRecency(local, sync);
            expect(result).toEqual({ order: ['b', 'a'], meta: sync });
        });

        it('returns local meta when local orderUpdatedAt is larger', () => {
            const local = { order: ['b', 'a'], orderUpdatedAt: 300 };
            const sync  = { order: ['a', 'b'], orderUpdatedAt: 100 };
            const result = StorageManager._pickPresetOrderByRecency(local, sync);
            expect(result).toEqual({ order: ['b', 'a'], meta: local });
        });

        it('returns null when timestamps are equal', () => {
            const local = { order: ['a', 'b'], orderUpdatedAt: 100 };
            const sync  = { order: ['b', 'a'], orderUpdatedAt: 100 };
            const result = StorageManager._pickPresetOrderByRecency(local, sync);
            expect(result).toBeNull();
        });

        it('handles null/undefined inputs gracefully', () => {
            expect(StorageManager._pickPresetOrderByRecency(null, null)).toBeNull();
            expect(StorageManager._pickPresetOrderByRecency(undefined, { order: ['a'], orderUpdatedAt: 100 }))
                .toEqual({ order: ['a'], meta: { order: ['a'], orderUpdatedAt: 100 } });
        });
    });

    describe('savePromptPresets() writes PRESET_ORDER_META on order change', () => {
        beforeEach(async () => {
            await chrome.storage.local.clear();
            await chrome.storage.sync.clear();
        });

        it('writes dsPresetOrderMeta when saving presets for the first time', async () => {
            await StorageManager.savePromptPresets([preset('a'), preset('b')]);
            const data = await chrome.storage.local.get([K.PRESET_ORDER_META]);
            const meta = data[K.PRESET_ORDER_META];
            expect(meta).toBeDefined();
            expect(meta.order).toEqual(['a', 'b']);
            expect(typeof meta.orderUpdatedAt).toBe('number');
            expect(meta.orderUpdatedAt).toBeGreaterThan(0);
        });

        it('writes dsPresetOrderMeta when order changes', async () => {
            await StorageManager.savePromptPresets([preset('a'), preset('b')]);
            const before = (await chrome.storage.local.get([K.PRESET_ORDER_META]))[K.PRESET_ORDER_META];

            await StorageManager.savePromptPresets([preset('b'), preset('a')]);
            const after = (await chrome.storage.local.get([K.PRESET_ORDER_META]))[K.PRESET_ORDER_META];

            expect(after.order).toEqual(['b', 'a']);
            expect(after.orderUpdatedAt).toBeGreaterThanOrEqual(before.orderUpdatedAt);
        });

        it('uses provided orderMeta when given', async () => {
            const custom = { order: ['b', 'a'], orderUpdatedAt: 999999 };
            await StorageManager.savePromptPresets([preset('a'), preset('b')], custom);
            const data = await chrome.storage.local.get([K.PRESET_ORDER_META]);
            expect(data[K.PRESET_ORDER_META]).toEqual(custom);
        });

        it('_get returns sync order when sync PRESET_ORDER_META is newer', async () => {
            const localTs = 1000;
            const syncTs  = 2000;
            await chrome.storage.local.set({
                [K.PRESET_INDEX]: ['a', 'b'],
                [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: localTs },
            });
            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['b', 'a'],
                [K.PRESET_ORDER_META]: { order: ['b', 'a'], orderUpdatedAt: syncTs },
            });

            const result = await StorageManager._get([K.PRESET_INDEX]);
            expect(result[K.PRESET_INDEX]).toEqual(['b', 'a']);
        });
    });
});
