import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

/**
 * Populate both local and sync with all default key values, so that the default-fill step in initialize() sees nothing to do and falls through to the migration push branch.
 *
 * RESTORED_MESSAGES, IS_ENABLED, GLOBAL_PROMPT_ENABLED, and isReplyNotificationEnabled are only written to local — they are local-only keys (report.md §4.3 Step 3 made IS_ENABLED and GLOBAL_PROMPT_ENABLED local-only, joining the pre-existing RESTORED_MESSAGES pattern; the reply-notification toggle joined later) and should never be in sync.
 *
 * IMPORTANT: this list must stay in sync with StorageManager.DEFAULTS (utils/storage-manager.js). Any key present in DEFAULTS but missing here (and not explicitly excluded in storage-manager.init.js's fill/migration loops) leaves initialize()'s `updates` non-empty, which reroutes every caller away from the migration-push branch it exists to exercise, silently, since the tests still run but assert against the wrong branch. Cross-check against DEFAULTS whenever a key is added.
 */
export async function populateDefaults() {
    const localDefaults = {
        [K.PRESET_INDEX]: [],
        [K.ACTIVE_PRESET_ID]: '',
        [K.PINNED_PRESET_ID]: '',
        [K.IS_ENABLED]: false,
        [K.INCLUDE_THINKING]: true,
        [K.INCLUDE_REFERENCES]: true,
        [K.GLOBAL_DEFAULT_PROMPT]: '',
        [K.SIDEBAR_AUTO_HIDE]: false,
        [K.HIDE_THINKING]: false,
        [K.AUTO_EXPAND_MESSAGES]: false,
        [K.AUTO_RETRY]: false,
        [K.AUTO_CONTINUE]: false,
        [K.AUTO_OPEN_SIDEBAR]: false,
        // Literal keys: the KEYS constants for the auto-copy toggles may not exist yet (red phase).
        isAutoCopyReplyEnabled: false,
        isAutoCopyCodeEnabled: false,
        // Literal key: KEYS.REPLY_NOTIFICATION may not exist yet (red phase).
        isReplyNotificationEnabled: false,
        [K.PREVENT_AUTO_SCROLL]: false,
        [K.WEBSEARCH_TOGGLE]: 'default',
        [K.CHAT_WIDTH]: 70,
        [K.CHAT_WIDTH_ENABLED]: false,
        [K.INPUT_WIDTH]: 70,
        [K.INPUT_WIDTH_ENABLED]: false,
        [K.GLOBAL_PROMPT_ENABLED]: true,
        [K.SYNC_INITIALIZED]: true,
        [K.SYNC_CONFLICT_PENDING]: false,
        [K.SHOW_SYSTEM_TIME]: false,
        [K.PRESET_ORDER_META]: { order: [], orderUpdatedAt: 0 },
        [K.RESTORED_MESSAGES]: {},
        [K.PRESET_TOMBSTONES]: {},
    };
    // Sync gets the same values except the local-only keys.
    const syncDefaults = { ...localDefaults };
    delete syncDefaults[K.RESTORED_MESSAGES];
    delete syncDefaults[K.IS_ENABLED];
    delete syncDefaults[K.GLOBAL_PROMPT_ENABLED];
    delete syncDefaults.isReplyNotificationEnabled;

    await chrome.storage.local.set(localDefaults);
    await chrome.storage.sync.set(syncDefaults);
}
