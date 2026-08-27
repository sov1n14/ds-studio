/**
 * pending-store.js -- write-failure logging.
 * Asserts savePendingDeletes() and refreshLease() call console.error when storage fails.
 * These tests should FAIL against current implementation (silently swallows errors).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TemporaryChatPendingStore from '../../background/pending-store.js';

describe('pending-store write-failure logging', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('savePendingDeletes calls console.error (not just warn) when sync.set rejects', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const writeError = new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(writeError);

        await expect(
            TemporaryChatPendingStore.savePendingDeletes([{ chatUuid: 'x', attemptCount: 0 }])
        ).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalled();
        const allArgs = errorSpy.mock.calls.flat();
        expect(allArgs).toContain(writeError);
        errorSpy.mockRestore();
    });

    it('refreshLease calls console.error when sync.set rejects', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(Date, 'now').mockReturnValueOnce(Date.now() - 120000);
        await TemporaryChatPendingStore.addPendingDelete('uuid-lease');

        const writeError = new Error('storage write failed');
        vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(writeError);

        await expect(
            TemporaryChatPendingStore.refreshLease('uuid-lease')
        ).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalled();
        const allArgs = errorSpy.mock.calls.flat();
        expect(allArgs).toContain(writeError);
        errorSpy.mockRestore();
    });
});
