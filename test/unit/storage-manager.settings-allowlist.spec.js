/**
 * U7 — getSettings() must return an explicit allowlist of user-facing settings.
 *
 * Requirement (refactor backlog U7):
 *   The object returned by getSettings() contains EXACTLY the user-facing settings
 *   keys. Internal bookkeeping keys (sync retry queues, chunk-layout metadata,
 *   key-name prefix constants) MUST NOT appear in it, even when their underlying
 *   storage keys are populated.
 *
 * Two-sided pin:
 *   1. Fence (must stay green through the refactor): every user-facing settings key
 *      keeps appearing, so replacing the KEYS-minus-exclusions loop with an explicit
 *      allowlist cannot silently drop one.
 *   2. Red (fails on the pre-refactor code): internal keys must be absent.
 *
 * All KEYS entries are seeded before the read so absence can never be an artifact
 * of the key simply having no stored value.
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

/** Every user-facing settings key getSettings() is contracted to expose. */
const EXPECTED_SETTINGS_KEYS = [
    'promptPresets',
    'presetIndex',
    'activePresetId',
    'pinnedPresetId',
    'isEnabled',
    'globalPromptEnabled',
    'includeThinking',
    'includeReferences',
    'globalDefaultPrompt',
    'chatPresetMap',
    'sidebarAutoHide',
    'hideThinking',
    'preventAutoScroll',
    'websearchToggle',
    'isShowSystemTime',
    'chatWidth',
    'chatWidthEnabled',
    'inputWidth',
    'inputWidthEnabled',
    'syncInitialized',
    'syncConflictPending',
];

/**
 * Internal bookkeeping — never part of the user-facing settings contract.
 * localAuthoritative / oversizedKeys are sync-retry bookkeeping;
 * chatPresetMapMeta / chatPresetMapChunkPrefix are chunk-layout internals
 * (the latter is not even a storage key, it is a key-name prefix constant);
 * presetOrderMeta / presetTombstones / restoredMessages are already excluded
 * today and act as the fence proving the exclusion mechanism still works.
 */
const INTERNAL_KEYS = [
    'localAuthoritative',
    'oversizedKeys',
    'chatPresetMapMeta',
    'chatPresetMapChunkPrefix',
    'presetOrderMeta',
    'presetTombstones',
    'restoredMessages',
];

/** Seed every KEYS entry so nothing is absent merely for lack of a stored value. */
async function seedEveryKey() {
    const payload = {
        [K.PRESET_INDEX]: [],
        [K.LOCAL_AUTHORITATIVE]: { someKey: 123 },
        [K.OVERSIZED_KEYS]: ['dsPreset_huge'],
        [K.ACTIVE_PRESET_ID]: '',
        [K.PINNED_PRESET_ID]: '',
        [K.INCLUDE_THINKING]: true,
        [K.INCLUDE_REFERENCES]: true,
        [K.GLOBAL_DEFAULT_PROMPT]: 'seeded prompt',
        [K.CHAT_PRESET_MAP_META]: { version: 1, chunkCount: 0, chunkSizes: [] },
        [K.CHAT_PRESET_MAP_CHUNK_PREFIX]: 'not-a-real-value',
        [K.SIDEBAR_AUTO_HIDE]: false,
        [K.HIDE_THINKING]: false,
        [K.PREVENT_AUTO_SCROLL]: false,
        [K.WEBSEARCH_TOGGLE]: 'on',
        [K.SHOW_SYSTEM_TIME]: false,
        [K.CHAT_WIDTH]: 70,
        [K.CHAT_WIDTH_ENABLED]: false,
        [K.INPUT_WIDTH]: 70,
        [K.INPUT_WIDTH_ENABLED]: false,
        [K.SYNC_INITIALIZED]: true,
        [K.SYNC_CONFLICT_PENDING]: false,
        [K.PRESET_ORDER_META]: { order: [], orderUpdatedAt: 0 },
        [K.PRESET_TOMBSTONES]: { 'gone-id': 1 },
    };
    await chrome.storage.sync.set(payload);
    await chrome.storage.local.set({
        ...payload,
        [K.IS_ENABLED]: true,
        [K.GLOBAL_PROMPT_ENABLED]: true,
        [K.RESTORED_MESSAGES]: { 'msg-1': 'restored' },
    });
}

describe('U7 — getSettings() returns exactly the user-facing settings allowlist', () => {
    it('exposes every user-facing settings key (regression fence for the allowlist refactor)', async () => {
        await seedEveryKey();

        const settings = await StorageManager.getSettings();

        for (const key of EXPECTED_SETTINGS_KEYS) {
            expect(settings, `missing user-facing settings key: ${key}`).toHaveProperty(key);
        }
    });

    it.each(INTERNAL_KEYS)('never exposes the internal bookkeeping key "%s"', async (internalKey) => {
        await seedEveryKey();

        const settings = await StorageManager.getSettings();

        expect(settings).not.toHaveProperty(internalKey);
    });

    it('returns no key outside the user-facing allowlist', async () => {
        await seedEveryKey();

        const settings = await StorageManager.getSettings();

        const unexpected = Object.keys(settings).filter(k => !EXPECTED_SETTINGS_KEYS.includes(k));
        expect(unexpected).toEqual([]);
    });
});
