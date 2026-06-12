import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

/**
 * Populate both local and sync with all default key values, so that the
 * default-fill step in initialize() sees nothing to do and falls through
 * to the migration push branch.
 *
 * RESTORED_MESSAGES is only written to local (it is a local-only key and
 * should never be in sync).
 */
async function populateDefaults() {
    const localDefaults = {
        [K.PRESET_INDEX]: [],
        [K.ACTIVE_PRESET_ID]: '',
        [K.IS_ENABLED]: false,
        [K.INCLUDE_THINKING]: true,
        [K.INCLUDE_REFERENCES]: true,
        [K.GLOBAL_DEFAULT_PROMPT]: '',
        [K.SIDEBAR_AUTO_HIDE]: false,
        [K.HIDE_THINKING]: false,
        [K.CHAT_WIDTH]: 70,
        [K.CHAT_WIDTH_ENABLED]: false,
        [K.INPUT_WIDTH]: 70,
        [K.INPUT_WIDTH_ENABLED]: false,
        [K.GLOBAL_PROMPT_ENABLED]: true,
        [K.SYNC_INITIALIZED]: true,
        [K.SYNC_CONFLICT_PENDING]: false,
        [K.SHOW_SYSTEM_TIME]: false,
        [K.RESTORED_MESSAGES]: {},
    };
    // Sync gets the same values except RESTORED_MESSAGES (local-only).
    const syncDefaults = { ...localDefaults };
    delete syncDefaults[K.RESTORED_MESSAGES];

    await chrome.storage.local.set(localDefaults);
    await chrome.storage.sync.set(syncDefaults);
}

describe('StorageManager migration push regression', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    // ----------------------------------------------------------------
    // Fix 1: RESTORED_MESSAGES must be skipped during the migration
    // push, even when it exists in local and is missing from sync.
    // ----------------------------------------------------------------
    describe('Fix 1: RESTORED_MESSAGES excluded from migration push', () => {
        it('does not push restored_messages to sync (local-only key)', async () => {
            await populateDefaults();

            // Arrange: local has isEnabled=true and a large restored_messages.
            // Sync is missing both isEnabled and restored_messages.
            await chrome.storage.local.set({
                [K.IS_ENABLED]: true,
                [K.RESTORED_MESSAGES]: 'x'.repeat(10240), // >8KB simulation
            });
            await chrome.storage.sync.remove(K.IS_ENABLED);

            // Act: must NOT reject (regression guard)
            await expect(StorageManager.initialize()).resolves.toBeUndefined();

            // Assert
            const syncAfter = await chrome.storage.sync.get(null);
            const localAfter = await chrome.storage.local.get(null);

            // restored_messages must NOT appear in sync
            expect(syncAfter).not.toHaveProperty(K.RESTORED_MESSAGES);

            // isEnabled should have been pushed to sync normally
            expect(syncAfter[K.IS_ENABLED]).toBe(true);

            // restored_messages stays intact in local
            expect(localAfter[K.RESTORED_MESSAGES]).toBe('x'.repeat(10240));
        });
    });

    // ----------------------------------------------------------------
    // Fix 2: _set() fallback on quota error.  The old code used
    // _safeSet('sync', …) which rejects on quota error and crashes
    // initialize().  _set() catches the error, falls back to local,
    // and marks the key as LOCAL_AUTHORITATIVE.
    // ----------------------------------------------------------------
    describe('Fix 2: quota error fallback in migration push', () => {
        it('does not reject when sync quota is exceeded during migration push', async () => {
            await populateDefaults();

            await chrome.storage.local.set({ [K.IS_ENABLED]: true });
            await chrome.storage.sync.remove(K.IS_ENABLED);
            chrome.storage.sync.setQuotaError(true);

            await expect(StorageManager.initialize()).resolves.toBeUndefined();
        });

        it('writes isEnabled to local and marks it as LOCAL_AUTHORITATIVE on quota error', async () => {
            await populateDefaults();

            await chrome.storage.local.set({ [K.IS_ENABLED]: true });
            await chrome.storage.sync.remove(K.IS_ENABLED);
            chrome.storage.sync.setQuotaError(true);

            await StorageManager.initialize();

            // Assert
            const localAfter = await chrome.storage.local.get(null);
            const syncAfter = await chrome.storage.sync.get(null);

            // Warning must mention "quota"
            expect(console.warn).toHaveBeenCalled();
            const warnMsg = console.warn.mock.calls[0][0];
            expect(warnMsg).toContain('quota');

            // Key value is preserved in local
            expect(localAfter[K.IS_ENABLED]).toBe(true);

            // Key is registered as local-authoritative
            const authList = localAfter[K.LOCAL_AUTHORITATIVE] || [];
            expect(authList).toContain(K.IS_ENABLED);

            // Key is NOT in sync (quota error prevented the write)
            expect(syncAfter).not.toHaveProperty(K.IS_ENABLED);
        });
    });

    // ----------------------------------------------------------------
    // Happy path: migration push succeeds without quota error.
    // ----------------------------------------------------------------
    describe('Normal migration push (no quota error)', () => {
        it('pushes missing keys to sync and does not mark them as LOCAL_AUTHORITATIVE', async () => {
            await populateDefaults();

            await chrome.storage.local.set({ [K.IS_ENABLED]: true });
            await chrome.storage.sync.remove(K.IS_ENABLED);

            await expect(StorageManager.initialize()).resolves.toBeUndefined();

            // Assert
            const syncAfter = await chrome.storage.sync.get(null);
            const localAfter = await chrome.storage.local.get(null);

            // isEnabled appears in sync
            expect(syncAfter[K.IS_ENABLED]).toBe(true);

            // dsLocalAuth either does not exist or does not include isEnabled
            const authList = localAfter[K.LOCAL_AUTHORITATIVE] || [];
            expect(authList).not.toContain(K.IS_ENABLED);
        });
    });
});
