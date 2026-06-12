import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

describe('StorageManager.mergePresets() (11.x merge scenarios)', () => {
    const older = (id, ts) => ({
        id, name: `Old-${id}`, content: 'old content',
        createdAt: ts, updatedAt: ts,
    });
    const newer = (id, ts) => ({
        id, name: `New-${id}`, content: 'new content',
        createdAt: ts, updatedAt: ts,
    });

    it('merges two non-overlapping arrays', () => {
        const base = [older('a', 100), older('b', 200)];
        const added = [older('c', 300)];
        const result = StorageManager.mergePresets(base, added);
        expect(result).toHaveLength(3);
        expect(result.map(r => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('keeps the preset with newer updatedAt when IDs overlap', () => {
        const base = [older('x', 100)];   // updatedAt = 100
        const incoming = [newer('x', 200)]; // updatedAt = 200
        const result = StorageManager.mergePresets(base, incoming);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('New-x');
        expect(result[0].content).toBe('new content');
    });

    it('keeps the older preset when base has newer updatedAt', () => {
        const base = [newer('x', 300)];
        const incoming = [older('x', 100)];
        const result = StorageManager.mergePresets(base, incoming);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('New-x');
    });

    it('handles identical presets gracefully', () => {
        const preset = { id: 'p', name: 'P', content: 'c', createdAt: 100, updatedAt: 100 };
        const result = StorageManager.mergePresets([preset], [{ ...preset }]);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('P');
    });

    it('returns empty array when both inputs are empty', () => {
        const result = StorageManager.mergePresets([], []);
        expect(result).toEqual([]);
    });

    it('handles undefined / null inputs', () => {
        expect(StorageManager.mergePresets(undefined, undefined)).toEqual([]);
        expect(StorageManager.mergePresets(null, null)).toEqual([]);
        expect(StorageManager.mergePresets(undefined, [older('a', 1)])).toHaveLength(1);
        expect(StorageManager.mergePresets([older('a', 1)], null)).toHaveLength(1);
    });

    it('does not mutate the original arrays', () => {
        const base = [older('a', 100)];
        const incoming = [older('b', 200)];
        const baseCopy = [...base];
        const incomingCopy = [...incoming];
        StorageManager.mergePresets(base, incoming);
        expect(base).toEqual(baseCopy);
        expect(incoming).toEqual(incomingCopy);
    });

    it('returns a new array reference', () => {
        const base = [older('a', 100)];
        const result = StorageManager.mergePresets(base, []);
        expect(result).not.toBe(base);
    });

    it('uses updatedAt as number (not string)', () => {
        const base = [older('p', 1000)];
        const incoming = [newer('p', 2000)];
        const result = StorageManager.mergePresets(base, incoming);
        expect(result[0].updatedAt).toBe(2000);
    });

    it('favours newer when multiple overlapping IDs exist', () => {
        const base = [
            { id: 'a', name: 'Old-A', content: '', createdAt: 1, updatedAt: 1 },
            { id: 'b', name: 'Old-B', content: '', createdAt: 1, updatedAt: 100 },
        ];
        const incoming = [
            { id: 'a', name: 'New-A', content: '', createdAt: 1, updatedAt: 200 },
            { id: 'b', name: 'New-B', content: '', createdAt: 1, updatedAt: 50 },
        ];
        const result = StorageManager.mergePresets(base, incoming);
        expect(result.find(p => p.id === 'a').name).toBe('New-A');  // 200 > 1
        expect(result.find(p => p.id === 'b').name).toBe('Old-B');  // 100 > 50
    });

    it('preserves order: base first, then newly appended', () => {
        const base = [older('a', 1), older('b', 2)];
        const incoming = [older('c', 3)];
        const result = StorageManager.mergePresets(base, incoming);
        expect(result[0].id).toBe('a');
        expect(result[1].id).toBe('b');
        expect(result[2].id).toBe('c');
    });

    it('handles presets with no updatedAt field', () => {
        const base = [{ id: 'x', name: 'X', content: 'x', createdAt: 1 }];
        const incoming = [{ id: 'x', name: 'Y', content: 'y', createdAt: 1 }];
        const result = StorageManager.mergePresets(base, incoming);
        // Both have undefined updatedAt → (undefined||0) > (undefined||0) → false
        // Base stays because incoming does not have strictly greater updatedAt
        expect(result[0].name).toBe('X');
    });
});
