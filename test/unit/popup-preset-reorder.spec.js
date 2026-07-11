import { describe, it, expect, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

// NOTE: reorderPresets() itself used to live in popup/popup-utils.js (deleted).
// The logic now lives as a private `_reorderPresets` inside popup/custom-select.js
// and is exercised indirectly via drag-and-drop in
// test/unit/popup-custom-select.spec.js ("拖曳排序" describe block) — see that
// file for reorder-behavior coverage. This file keeps only the StorageManager
// integration assertion, which is independent of where reorderPresets lives.

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
