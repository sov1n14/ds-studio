/**
 * background/service-worker.js - the worker loads utils/permission-request-errors.js beside the permission wrappers.
 *
 * Requirement: the service worker loads utils/clipboard-permission.js and utils/notification-permission.js through importScripts, and those wrappers treat Chromium's `Error: Could not find an active window.` rejection of chrome.permissions.request as granted only when globalThis.DSSPermissionRequestErrors is present in the same global. The worker therefore loads utils/permission-request-errors.js too, so the wrappers in the worker global answer that rejection the way the popup's do.
 *
 * Harness: the real background/service-worker.js is imported fresh inside the test, so its top-level importScripts call runs in this test. importScripts is the trust boundary: the fake resolves each argument against the worker script URL as Chrome does and runs the three real permission scripts when the worker asks for them; the route installers and StorageManager are stubbed as in test/helpers/service-worker-harness.js, because they are off this path. chrome.permissions is a double whose request rejects with the window error.
 *
 * Assertions read only what the worker global's wrappers resolve; never which URLs importScripts received.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { URL as NodeURL } from 'node:url';
import '../../utils/deepseek-api.js';
import '../../utils/temporary-chat-constants.js';
import '../../background/service-worker-constants.js';
import '../../background/pending-store.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';

const WORKER_URL = 'chrome-extension://test-extension-id/background/service-worker.js';
const WINDOW_UNAVAILABLE = 'Could not find an active window.';
// The scripts the fake runs for real when the worker requests them, as repo-relative paths.
const REAL_SCRIPTS = new Set(['utils/permission-request-errors.js', 'utils/clipboard-permission.js', 'utils/notification-permission.js']);
const PERMISSION_GLOBALS = ['DSSPermissionRequestErrors', 'DSSClipboardPermission', 'DSSNotificationPermission'];
const STUBBED_GLOBALS = ['StorageManager', 'DSSSettingsRoutes', 'DSSPendingStoreRoutes', 'DSSEditorWindowRoutes', 'DSSChatMapRoutes', 'DSSNotificationRoutes', 'DSSClipboardRoutes', 'DSSPermissionIntentRoutes', 'DSSUnloadGrace'];
const SAVED_GLOBALS = ['importScripts', 'fetch', ...STUBBED_GLOBALS, ...PERMISSION_GLOBALS];

/** Chrome's importScripts: each URL resolves against the worker script URL and runs in the worker global. Only REAL_SCRIPTS run; every other script's global is stubbed before boot. */
function fakeImportScripts(...urls) {
    for (const url of urls) {
        const rel = new NodeURL(String(url), WORKER_URL).pathname.replace(/^\//, '');
        if (REAL_SCRIPTS.has(rel)) evalPopupScript(rel);
    }
}

describe('service worker global: permission wrappers after boot', () => {
    const saved = {};

    beforeEach(() => {
        for (const k of SAVED_GLOBALS) saved[k] = { has: k in globalThis, value: globalThis[k] };
        saved.permissions = { has: 'permissions' in chrome, value: chrome.permissions };
        saved.onChangedAdd = chrome.storage.onChanged.addListener;
    });

    afterEach(() => {
        for (const k of SAVED_GLOBALS) {
            if (saved[k].has) globalThis[k] = saved[k].value;
            else delete globalThis[k];
        }
        if (saved.permissions.has) chrome.permissions = saved.permissions.value;
        else delete chrome.permissions;
        chrome.storage.onChanged.addListener = saved.onChangedAdd;
        vi.restoreAllMocks();
    });

    it('the worker wrappers resolve true when chrome.permissions.request rejects with "Could not find an active window."', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        for (const k of PERMISSION_GLOBALS) delete globalThis[k];
        globalThis.importScripts = fakeImportScripts;
        globalThis.StorageManager = { isSyncedWithCloud: vi.fn().mockResolvedValue(true), retrySync: vi.fn() };
        for (const k of STUBBED_GLOBALS.slice(1)) globalThis[k] = { install: vi.fn() };
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
        chrome.storage.onChanged.addListener = () => {}; // keep the worker's sweep listener off the shared storage

        vi.resetModules();
        await import('../../background/service-worker.js?permission-request-errors-wiring');

        chrome.permissions = {
            contains: vi.fn().mockResolvedValue(false),
            request: vi.fn().mockRejectedValue(new Error(WINDOW_UNAVAILABLE)),
        };
        expect(typeof globalThis.DSSClipboardPermission?.requestClipboardPermission, 'precondition: the worker loaded utils/clipboard-permission.js').toBe('function');
        expect(typeof globalThis.DSSNotificationPermission?.requestNotificationPermission, 'precondition: the worker loaded utils/notification-permission.js').toBe('function');
        await expect(globalThis.DSSClipboardPermission.requestClipboardPermission(), 'worker clipboard wrapper on the window-unavailable rejection').resolves.toBe(true);
        await expect(globalThis.DSSNotificationPermission.requestNotificationPermission(), 'worker notification wrapper on the window-unavailable rejection').resolves.toBe(true);
    });
});
