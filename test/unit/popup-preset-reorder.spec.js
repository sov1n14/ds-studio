import { describe, it, expect, vi } from 'vitest';
import { reorderPresets } from '../../popup/popup-utils.js';
import StorageManager from '../../utils/storage-manager.js';

const A = { id: 'a', name: 'Alpha' };
const B = { id: 'b', name: 'Beta' };
const C = { id: 'c', name: 'Gamma' };

describe('reorderPresets()', () => {
    it('將第一個項目移至最後', () => {
        const result = reorderPresets([A, B, C], A.id, C.id, false);
        expect(result.map(p => p.id)).toEqual(['b', 'c', 'a']);
    });

    it('將最後一個項目移至最前', () => {
        const result = reorderPresets([A, B, C], C.id, A.id, true);
        expect(result.map(p => p.id)).toEqual(['c', 'a', 'b']);
    });

    it('移至相鄰項目下方', () => {
        const result = reorderPresets([A, B, C], A.id, B.id, false);
        expect(result.map(p => p.id)).toEqual(['b', 'a', 'c']);
    });

    it('移至相鄰項目上方（結果等同不動）', () => {
        const result = reorderPresets([A, B, C], B.id, A.id, true);
        expect(result.map(p => p.id)).toEqual(['b', 'a', 'c']);
    });

    it('拖曳至自身位置上方，不改變順序', () => {
        const result = reorderPresets([A, B, C], B.id, B.id, true);
        expect(result.map(p => p.id)).toEqual(['a', 'b', 'c']);
    });

    it('單項目陣列不崩潰', () => {
        const result = reorderPresets([A], A.id, A.id, true);
        expect(result.map(p => p.id)).toEqual(['a']);
    });

    it('不改變原始陣列（immutable）', () => {
        const original = [A, B, C];
        const snapshot = original.map(p => p.id);
        reorderPresets(original, A.id, C.id, false);
        expect(original.map(p => p.id)).toEqual(snapshot);
    });

    it('不存在的 srcId 時回傳原陣列（防衛）', () => {
        const result = reorderPresets([A, B], 'invalid', B.id, true);
        expect(result.map(p => p.id)).toEqual(['a', 'b']);
    });
});

describe('savePromptPresets orderMeta integration', () => {
    it('receives orderMeta as second argument when order changes', async () => {
        const spy = vi.spyOn(StorageManager, 'savePromptPresets').mockResolvedValue(undefined);
        const presets = [
            { id: 'b', name: 'B', content: '', createdAt: 1, updatedAt: 1 },
            { id: 'a', name: 'A', content: '', createdAt: 2, updatedAt: 2 },
        ];
        const orderMeta = { order: ['b', 'a'], orderUpdatedAt: Date.now() };
        await StorageManager.savePromptPresets(presets, orderMeta);
        expect(spy).toHaveBeenCalledWith(presets, orderMeta);
        spy.mockRestore();
    });
});
