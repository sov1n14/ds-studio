/**
 * Documented setting defaults, observed through getSettings() on a StorageManager
 * whose keys bundle (utils/storage-manager.keys.js) is evaluated INSIDE each test.
 *
 * Why the fresh load: the setup file preloads storage-manager.keys.js once, so its
 * DEFAULTS object literal executes before any test runs. Stryker (ignoreStatic) treats
 * a literal executed only at load time as a static mutant, so every spec that reads the
 * preloaded copy leaves those literal mutants surviving. vi.resetModules() + a dynamic
 * import re-evaluates the literal within the test body, so a changed default fails here.
 *
 * Expected values come from the storage-structure table in
 * docs/spec/05-data-storage.md (mirrored in docs/architecture/STORAGE.md), never from
 * the implementation. Field names are the getSettings() public contract pinned in
 * storage-manager.settings-allowlist.spec.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** getSettings() field -> [storage key, default documented in docs/spec/05-data-storage.md]. */
const DOCUMENTED_DEFAULTS = {
    presetIndex: ['dsPresetIndex', []],
    activePresetId: ['activePresetId', ''],
    pinnedPresetId: ['pinnedPresetId', ''],
    isEnabled: ['isEnabled', false],
    globalPromptEnabled: ['globalPromptEnabled', true],
    includeThinking: ['includeThinking', true],
    includeReferences: ['includeReferences', true],
    globalDefaultPrompt: ['globalDefaultPrompt', ''],
    sidebarAutoHide: ['dsSidebarAutoHide', false],
    hideThinking: ['dsHideThinking', false],
    autoExpandMessages: ['dsAutoExpandMessages', false],
    autoRetry: ['isAutoRetryEnabled', false],
    autoContinue: ['isAutoContinueEnabled', false],
    autoOpenSidebar: ['isAutoOpenSidebarEnabled', false],
    autoCopyReply: ['isAutoCopyReplyEnabled', false],
    autoCopyCode: ['isAutoCopyCodeEnabled', false],
    replyNotification: ['isReplyNotificationEnabled', false],
    preventAutoScroll: ['dsPreventAutoScroll', false],
    websearchToggle: ['dsWebSearchToggle', 'on'],
    isShowSystemTime: ['dsShowSystemTime', false],
    chatWidth: ['dsChatWidth', 70],
    chatWidthEnabled: ['dsChatWidthEnabled', false],
    inputWidth: ['dsInputWidth', 70],
    inputWidthEnabled: ['dsInputWidthEnabled', false],
    syncInitialized: ['syncInitialized', false],
    syncConflictPending: ['syncConflictPending', false],
};

let preloadedKeysBundle;
let preloadedWindowStorageManager;

/**
 * Re-evaluates storage-manager.keys.js and the storage-manager.js entry inside the
 * calling test. Static specifiers keep Vite's resolver in charge (a runtime-computed
 * path fails to resolve files outside test/, see testing-pitfalls
 * red-for-the-right-reason).
 */
async function loadFreshStorageManager() {
    vi.resetModules();
    const keysBundle = (await import('../../utils/storage-manager.keys.js')).default;
    const StorageManager = (await import('../../utils/storage-manager.js')).default;
    return { keysBundle, StorageManager };
}

beforeEach(() => {
    preloadedKeysBundle = globalThis.__DS_StorageManager_keys;
    preloadedWindowStorageManager = globalThis.window?.StorageManager;
});

afterEach(() => {
    // The fresh load republishes both globals; put the preloaded copies back so no
    // later test in this file reads a bundle another test produced.
    globalThis.__DS_StorageManager_keys = preloadedKeysBundle;
    if (globalThis.window) globalThis.window.StorageManager = preloadedWindowStorageManager;
});

describe('StorageManager documented defaults (keys bundle evaluated at test time)', () => {
    it('re-evaluates the keys bundle inside the test instead of reusing the setup-time copy', async () => {
        const { keysBundle, StorageManager } = await loadFreshStorageManager();

        expect(keysBundle, 'dynamic import must yield the keys bundle').toBeTruthy();
        expect(keysBundle, 'keys bundle must be a fresh evaluation, not the setup preload').not.toBe(preloadedKeysBundle);
        expect(StorageManager.DEFAULTS, 'fresh StorageManager must carry the fresh DEFAULTS').toBe(keysBundle.DEFAULTS);
    });

    it.each(Object.entries(DOCUMENTED_DEFAULTS))(
        'getSettings().%s on empty storage returns the documented default',
        async (field, [storageKey, documented]) => {
            const { StorageManager } = await loadFreshStorageManager();

            const settings = await StorageManager.getSettings();

            expect(settings[field], `${field} (storage key ${storageKey}) must default to ${JSON.stringify(documented)} per docs/spec/05-data-storage.md`).toEqual(documented);
        },
    );

    it('returns every documented default in one read on empty storage', async () => {
        const { StorageManager } = await loadFreshStorageManager();

        const settings = await StorageManager.getSettings();

        const observed = Object.fromEntries(Object.keys(DOCUMENTED_DEFAULTS).map(field => [field, settings[field]]));
        const expected = Object.fromEntries(Object.entries(DOCUMENTED_DEFAULTS).map(([field, [, value]]) => [field, value]));
        expect(observed).toStrictEqual(expected);
    });
});
