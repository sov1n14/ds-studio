import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { resetStorageOnChangedListeners } from '../setup/vitest.setup.js';

/**
 * Kills mutant: storage-manager.init.js line 20
 * Mutator: ConditionalExpression — `if (this._chunkCacheInvalidator)` → `if (true)`
 *
 * When _chunkCacheInvalidator is null (first-ever initialize()),
 * removeListener MUST NOT be called — there is no prior listener to remove.
 * The mutant (`if (true)`) would call removeListener(null).
 */
describe('initialize() skips removeListener when _chunkCacheInvalidator is falsy', () => {
    beforeEach(() => {
        resetStorageOnChangedListeners();
        StorageManager._chunkCacheInvalidator = null;
    });

    it('does not call chrome.storage.onChanged.removeListener on first initialize()', async () => {
        const removeSpy = vi.spyOn(chrome.storage.onChanged, 'removeListener');

        await StorageManager.initialize();

        // First init: no prior invalidator exists, so removeListener must not be called
        expect(removeSpy).not.toHaveBeenCalled();

        // But the invalidator should now be installed for future calls
        expect(StorageManager._chunkCacheInvalidator).toBeTruthy();

        removeSpy.mockRestore();
    });
});
