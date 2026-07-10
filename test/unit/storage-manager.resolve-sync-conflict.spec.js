/**
 * StorageManager — resolveSyncConflict regression tests
 *
 * Covers:
 *   - Fix: restored_messages (a local-only data set that can exceed 8KB)
 *     excluded from the updates passed to _set(), preventing
 *     chrome.storage.sync.set() per-item quota failure.
 *   - Happy path with merge of UI settings
 *   - Quota error fallback safety
 *   - Normal merge when restored_messages is absent
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

/**
 * Populate both local and sync with default key values so that
 * resolveSyncConflict() has a clean baseline to merge.
 *
 * All non-preset UI keys are written to both storages.
 * RESTORED_MESSAGES is local-only (never in sync) — its default value is
 * the empty object {} which is negligible in size.
 *
 * SYNC_CONFLICT_PENDING starts as false so each test can set it to true
 * as needed.
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
        [K.SYNC_INITIALIZED]: true,
        [K.SYNC_CONFLICT_PENDING]: false,
        [K.RESTORED_MESSAGES]: {},
    };
    // Sync gets the same values except RESTORED_MESSAGES (local-only key).
    const syncDefaults = { ...localDefaults };
    delete syncDefaults[K.RESTORED_MESSAGES];

    await chrome.storage.local.set(localDefaults);
    await chrome.storage.sync.set(syncDefaults);
}

describe('StorageManager.resolveSyncConflict() — restored_messages exclusion', () => {
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
    // Happy path: restored_messages must be excluded from sync writes
    // while other UI settings merge correctly.
    // ----------------------------------------------------------------
    describe('Happy path — restored_messages excluded from sync when present', () => {
        it('does not write restored_messages to sync, keeps it in local, merges UI settings', async () => {
            await populateDefaults();

            // Arrange: local has SYNC_CONFLICT_PENDING=true and a large
            // restored_messages.  Sync has a different IS_ENABLED value
            // so we can verify the merge works for non-preset settings.
            await chrome.storage.local.set({
                [K.RESTORED_MESSAGES]: 'x'.repeat(10240), // >8KB simulation
                [K.SYNC_CONFLICT_PENDING]: true,
            });
            await chrome.storage.sync.set({
                [K.IS_ENABLED]: true,        // sync says enabled
                [K.INCLUDE_THINKING]: false,  // sync says no thinking
            });

            // Act
            await StorageManager.resolveSyncConflict();

            // Assert
            const syncAfter = await chrome.storage.sync.get(null);
            const localAfter = await chrome.storage.local.get(null);

            // restored_messages must NOT appear in sync
            expect(syncAfter).not.toHaveProperty(K.RESTORED_MESSAGES);

            // restored_messages stays intact in local
            expect(localAfter[K.RESTORED_MESSAGES]).toBe('x'.repeat(10240));

            // UI settings merged correctly: sync values survive the merge
            // (sync overrides local per { ...localRaw, ...syncRaw })
            expect(syncAfter[K.IS_ENABLED]).toBe(true);
            expect(syncAfter[K.INCLUDE_THINKING]).toBe(false);

            // Conflict resolved: SYNC_CONFLICT_PENDING is false in both storages
            expect(localAfter[K.SYNC_CONFLICT_PENDING]).toBe(false);
            expect(syncAfter[K.SYNC_CONFLICT_PENDING]).toBe(false);
        });
    });

    // ----------------------------------------------------------------
    // Quota safety: when sync.set() fails, the presence of large
    // restored_messages must NOT prevent the fallback from working.
    // The fix excludes restored_messages from the updates payload,
    // so it never reaches _set() at all.
    // ----------------------------------------------------------------
    describe('Quota safety — large restored_messages and sync quota exceeded', () => {
        it('resolves without rejection when sync quota is exceeded', async () => {
            await populateDefaults();

            await chrome.storage.local.set({
                [K.RESTORED_MESSAGES]: 'x'.repeat(10240),
                [K.SYNC_CONFLICT_PENDING]: true,
            });
            await chrome.storage.sync.set({ [K.IS_ENABLED]: true });
            chrome.storage.sync.setQuotaError(true);

            // Act — must NOT reject
            await expect(
                StorageManager.resolveSyncConflict()
            ).resolves.toBeUndefined();

            // Assert: restored_messages stays in local
            const localAfter = await chrome.storage.local.get(null);
            expect(localAfter[K.RESTORED_MESSAGES]).toBe('x'.repeat(10240));
        });

        it('writes UI settings to local and marks them LOCAL_AUTHORITATIVE on quota error', async () => {
            await populateDefaults();

            await chrome.storage.local.set({
                [K.RESTORED_MESSAGES]: 'x'.repeat(10240),
                [K.SYNC_CONFLICT_PENDING]: true,
                [K.INCLUDE_THINKING]: true,
            });
            await chrome.storage.sync.set({ [K.INCLUDE_THINKING]: true });
            chrome.storage.sync.setQuotaError(true);

            // Act
            await StorageManager.resolveSyncConflict();

            // Assert: fallback wrote user-facing settings to local
            const localAfter = await chrome.storage.local.get(null);
            const syncAfter = await chrome.storage.sync.get(null);

            // UI setting preserved in local despite sync failure
            expect(localAfter[K.INCLUDE_THINKING]).toBe(true);

            // Keys that failed to sync are registered as LOCAL_AUTHORITATIVE
            const authList = localAfter[K.LOCAL_AUTHORITATIVE] || [];
            expect(authList).toContain(K.INCLUDE_THINKING);

            // restored_messages is NOT in LOCAL_AUTHORITATIVE (it was
            // excluded from updates and never reached _set)
            expect(authList).not.toContain(K.RESTORED_MESSAGES);

            // Regression guard (report.md §4.3 Step 3): isEnabled/globalPromptEnabled
            // are deleted from resolveSyncConflict's updates payload before it ever
            // reaches _set(), so a sync quota error can never mark them
            // LOCAL_AUTHORITATIVE via this path.
            expect(authList).not.toContain(K.IS_ENABLED);
            expect(authList).not.toContain(K.GLOBAL_PROMPT_ENABLED);

            // Sync was NOT updated (quota error prevented the write)
            expect(syncAfter[K.INCLUDE_THINKING]).toBe(true);  // unchanged from initial

            // restored_messages is still NOT in sync
            expect(syncAfter).not.toHaveProperty(K.RESTORED_MESSAGES);
        });
    });

    // ----------------------------------------------------------------
    // Order meta propagation
    // ----------------------------------------------------------------
    describe('order meta propagation in resolveSyncConflict()', () => {
        it('applies newer sync order after resolve', async () => {
            await populateDefaults();

            // Local has order [a, b], sync has order [b, a] with newer timestamp
            const tsNow = Date.now();
            await chrome.storage.local.set({
                [K.SYNC_CONFLICT_PENDING]: true,
                [K.PRESET_INDEX]: ['a', 'b'],
                dsPreset_a: { id: 'a', name: 'A', content: 'a', createdAt: 1, updatedAt: 100 },
                dsPreset_b: { id: 'b', name: 'B', content: 'b', createdAt: 2, updatedAt: 100 },
                [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: tsNow - 1000 },
            });
            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['b', 'a'],
                dsPreset_a: { id: 'a', name: 'A', content: 'a', createdAt: 1, updatedAt: 100 },
                dsPreset_b: { id: 'b', name: 'B', content: 'b', createdAt: 2, updatedAt: 100 },
                [K.PRESET_ORDER_META]: { order: ['b', 'a'], orderUpdatedAt: tsNow },
            });

            await StorageManager.resolveSyncConflict();

            const settings = await StorageManager.getSettings();
            expect(settings.promptPresets.map(p => p.id)).toEqual(['b', 'a']);
        });

        it('PRESET_ORDER_META is NOT overwritten by the raw updates spread', async () => {
            await populateDefaults();
            // Local starts with empty index so that savePromptPresets will detect
            // a change ([] → ['a']) and write PRESET_ORDER_META
            await chrome.storage.local.set({
                [K.SYNC_CONFLICT_PENDING]: true,
                [K.PRESET_INDEX]: [],
                dsPreset_a: { id: 'a', name: 'A', content: 'a', createdAt: 1, updatedAt: 100 },
            });
            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['a'],
                dsPreset_a: { id: 'a', name: 'A', content: 'a', createdAt: 1, updatedAt: 100 },
            });

            await StorageManager.resolveSyncConflict();

            const syncAfter = await chrome.storage.sync.get(null);
            // PRESET_ORDER_META should be written by savePromptPresets, NOT by the raw spread
            // Verify it is present and has a valid structure
            expect(syncAfter[K.PRESET_ORDER_META]).toBeDefined();
            expect(Array.isArray(syncAfter[K.PRESET_ORDER_META].order)).toBe(true);
            expect(typeof syncAfter[K.PRESET_ORDER_META].orderUpdatedAt).toBe('number');
        });
    });

    // ----------------------------------------------------------------
    // No restored_messages: the delete line is a harmless no-op when
    // the key does not exist in the merged updates.  Normal merge
    // proceeds without issues.
    // ----------------------------------------------------------------
    describe('No restored_messages — normal merge unaffected', () => {
        it('merges UI settings correctly when restored_messages is absent', async () => {
            await populateDefaults();

            // Remove the default empty restored_messages so it truly is
            // absent from local storage (tests that the deletion line
            // handles a missing key gracefully).
            await chrome.storage.local.remove(K.RESTORED_MESSAGES);

            // Set different values in local vs sync to verify the merge
            await chrome.storage.local.set({
                [K.SYNC_CONFLICT_PENDING]: true,
                [K.IS_ENABLED]: false,
                [K.INCLUDE_THINKING]: true,
            });
            await chrome.storage.sync.set({
                [K.IS_ENABLED]: true,
                [K.INCLUDE_THINKING]: false,
            });

            // Act
            await StorageManager.resolveSyncConflict();

            // Assert
            const syncAfter = await chrome.storage.sync.get(null);
            const localAfter = await chrome.storage.local.get(null);

            // Merge works: sync values override local
            expect(syncAfter[K.IS_ENABLED]).toBe(true);
            expect(syncAfter[K.INCLUDE_THINKING]).toBe(false);

            // Conflict resolved
            expect(syncAfter[K.SYNC_CONFLICT_PENDING]).toBe(false);
            expect(localAfter[K.SYNC_CONFLICT_PENDING]).toBe(false);

            // restored_messages was never present — no harm
            expect(syncAfter).not.toHaveProperty(K.RESTORED_MESSAGES);
            expect(localAfter).not.toHaveProperty(K.RESTORED_MESSAGES);

            // Other defaults are preserved (verify a couple)
            expect(syncAfter[K.INCLUDE_REFERENCES]).toBe(true);
            expect(syncAfter[K.ACTIVE_PRESET_ID]).toBe('');
        });
    });
});
