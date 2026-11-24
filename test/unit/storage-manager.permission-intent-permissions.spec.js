/**
 * StorageManager.PERMISSION_INTENT_PERMISSIONS — the one table saying which optional-permission wrapper each pending permission intent needs, read by the popup's open-time cleanup and by the service worker's onAdded completion.
 *
 * Contract: the table has an entry for every intent name in PERMISSION_INTENTS and for nothing else, and each entry names one of the two permission wrappers ('clipboard' or 'notification'), so a new intent that one reader knows about cannot be unknown to the other.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const preloadedKeysBundle = globalThis.__DS_StorageManager_keys;

afterEach(() => {
    globalThis.__DS_StorageManager_keys = preloadedKeysBundle;
});

describe('StorageManager.PERMISSION_INTENT_PERMISSIONS', () => {
    it('has an entry for exactly the intent names of PERMISSION_INTENTS', () => {
        expect(Object.keys(StorageManager.PERMISSION_INTENT_PERMISSIONS).sort()).toEqual(Object.values(StorageManager.PERMISSION_INTENTS).sort());
    });

    it('maps every intent to a permission wrapper that exists', () => {
        for (const intentName of Object.values(StorageManager.PERMISSION_INTENTS)) {
            expect(['clipboard', 'notification'], `wrapper for ${intentName}`).toContain(StorageManager.PERMISSION_INTENT_PERMISSIONS[intentName]);
        }
    });

    // The setup file preloads the keys bundle, and Stryker (ignoreStatic) runs a mutant of a load-time literal only against tests that evaluate the file inside the test, so this test re-evaluates the bundle.
    it('on a freshly evaluated keys bundle, maps both auto-copy intents to the clipboard wrapper and the reply notification intent to the notification wrapper', async () => {
        vi.resetModules();
        const keysBundle = (await import('../../utils/storage-manager.keys.js')).default;
        const { PERMISSION_INTENTS, PERMISSION_INTENT_PERMISSIONS } = keysBundle;
        expect(PERMISSION_INTENT_PERMISSIONS[PERMISSION_INTENTS.AUTO_COPY_REPLY]).toBe('clipboard');
        expect(PERMISSION_INTENT_PERMISSIONS[PERMISSION_INTENTS.AUTO_COPY_CODE]).toBe('clipboard');
        expect(PERMISSION_INTENT_PERMISSIONS[PERMISSION_INTENTS.REPLY_NOTIFICATION]).toBe('notification');
    });
});
