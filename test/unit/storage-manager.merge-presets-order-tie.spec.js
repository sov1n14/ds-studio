import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

// Preset object shape learned from test/unit/storage-manager.merge.spec.js (lines 5-12):
// { id, name, content, createdAt, updatedAt }
const preset = (id, ts = 1) => ({ id, name: `preset-${id}`, content: `content-${id}`, createdAt: ts, updatedAt: ts });

describe('StorageManager.mergePresets() — order tie must honor stored order, not local-cache membership', () => {
    it('REQUIREMENT 1: on an orderUpdatedAt tie, stored order wins over which presets happen to be cached locally', () => {
        // Canonical order both sides agree on: a, b, c, d.
        // 'c' is deliberately picked as the only locally-cached preset because it is NOT
        // at the front of the canonical order — if the bug rebuilds order from local-cache
        // membership, 'c' floats to the front (['c','a','b','d']), which this test catches.
        // An id already sitting first (e.g. 'a') would mask the bug entirely.
        const basePresets = [preset('c')]; // local cache only has 'c'
        const incomingPresets = [preset('a'), preset('b'), preset('c'), preset('d')]; // cloud has all four

        const baseOrderMeta = { order: ['a', 'b', 'c', 'd'], orderUpdatedAt: 5000 };
        const incOrderMeta = { order: ['a', 'b', 'c', 'd'], orderUpdatedAt: 5000 }; // tie

        const result = StorageManager.mergePresets(basePresets, incomingPresets, baseOrderMeta, incOrderMeta);

        expect(result.map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('REQUIREMENT 2: strictly newer cloud (incoming) order wins over stale local order', () => {
        const basePresets = [preset('c')];
        const incomingPresets = [preset('a'), preset('b'), preset('c'), preset('d')];

        const baseOrderMeta = { order: ['d', 'c', 'b', 'a'], orderUpdatedAt: 1000 };
        const incOrderMeta = { order: ['a', 'b', 'c', 'd'], orderUpdatedAt: 9000 };

        const result = StorageManager.mergePresets(basePresets, incomingPresets, baseOrderMeta, incOrderMeta);

        expect(result.map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('REQUIREMENT 3: strictly newer local (base) order wins over stale cloud order', () => {
        const basePresets = [preset('c')];
        const incomingPresets = [preset('a'), preset('b'), preset('c'), preset('d')];

        const baseOrderMeta = { order: ['d', 'c', 'b', 'a'], orderUpdatedAt: 9000 };
        const incOrderMeta = { order: ['a', 'b', 'c', 'd'], orderUpdatedAt: 1000 };

        const result = StorageManager.mergePresets(basePresets, incomingPresets, baseOrderMeta, incOrderMeta);

        expect(result.map(p => p.id)).toEqual(['d', 'c', 'b', 'a']);
    });

    it('REQUIREMENT 4: an id present in neither order array is still included, without disturbing the relative order of ids that ARE in the order array', () => {
        const basePresets = [preset('a')];
        const incomingPresets = [preset('a'), preset('b'), preset('z')]; // 'z' is in neither meta's order array

        const baseOrderMeta = { order: ['a', 'b'], orderUpdatedAt: 5000 };
        const incOrderMeta = { order: ['a', 'b'], orderUpdatedAt: 5000 }; // tie

        const result = StorageManager.mergePresets(basePresets, incomingPresets, baseOrderMeta, incOrderMeta);
        const ids = result.map(p => p.id);

        // 'z' has no justified position from the requirement text (it appears in neither
        // order array), so we assert only its presence, not a specific index.
        expect(ids).toContain('z');
        expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
    });
});
