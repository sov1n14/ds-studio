/**
 * background/permission-intent-routes.js - targeted tests for behaviors the existing permission-intent specs leave unpinned.
 *
 * Requirements (docs/ARCHITECTURE.md "Permission Intent Route"):
 *   A. install() throws a named load-order error when StorageManager.PERMISSION_INTENTS, DSSClipboardPermission or DSSNotificationPermission is absent, so a service worker that forgot an importScripts entry fails with a message naming the file to load first, never with a bare TypeError or ReferenceError. With all three present, install() registers one chrome.permissions.onAdded listener.
 *   B. For every pending intent (autoCopyReply, autoCopyCode, replyNotification) whose permissions are all held when chrome.permissions.onAdded fires, the service worker saves the setting true through StorageManager and clears the intent; this holds for the listener of a worker that called install() at any time, not only for one installed before the suite started.
 *
 * A runs the routes file as a classic script in a fresh vm context that plays the service-worker global, so each test decides exactly which dependency exists; StorageManager is resolved there by identifier, as in the worker. Only chrome.permissions.onAdded and console are faked; the dependency objects exist only to be present.
 * B uses test/helpers/permission-intent-harness.js: the real StorageManager, the real permission wrappers and the real routes module share the suite in-memory chrome.storage; only chrome.permissions is faked. install() runs inside each test body.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { StorageManager, TARGETS, createPermissionWorld, loadPermissionIntentRoutes, settle, readGatedSettings } from '../helpers/permission-intent-harness.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';

// repo 相對路徑字面值：限定範圍突變測試靠它選取本 spec
const ROUTES_FILE = 'background/permission-intent-routes.js';
const REPO_ROOT = path.resolve(__dirname, '../..');
// @stryker-mutator/api INSTRUMENTER_CONSTANTS.NAMESPACE
const STRYKER_NAMESPACE = '__stryker__';

const STORAGE_MANAGER = { PERMISSION_INTENTS: { AUTO_COPY_REPLY: 'autoCopyReply', AUTO_COPY_CODE: 'autoCopyCode', REPLY_NOTIFICATION: 'replyNotification' } };
const CLIPBOARD_PERMISSION = { hasClipboardPermission: async () => true };
const NOTIFICATION_PERMISSION = { hasNotificationPermission: async () => true };
const ALL = { StorageManager: STORAGE_MANAGER, DSSClipboardPermission: CLIPBOARD_PERMISSION, DSSNotificationPermission: NOTIFICATION_PERMISSION };
const without = (name) => Object.fromEntries(Object.entries(ALL).filter(([key]) => key !== name));

/** 在全新 worker 全域載入 routes 檔，只放入 deps 指定的相依；回傳 install 與 onAdded 監聽器清單。 */
function loadRoutesInWorker(deps) {
    const onAddedListeners = [];
    const ctx = {
        chrome: { permissions: { onAdded: { addListener: (fn) => { onAddedListeners.push(fn); } } } },
        console: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        ...deps,
    };
    // vm context 有自己的 globalThis：Stryker 執行中時轉交同一個命名空間物件，worker 內才看得到啟用中的變異體
    if (globalThis[STRYKER_NAMESPACE]) ctx[STRYKER_NAMESPACE] = globalThis[STRYKER_NAMESPACE];
    vm.createContext(ctx);
    const file = path.join(REPO_ROOT, ROUTES_FILE);
    vm.runInContext(fs.readFileSync(file, 'utf-8'), ctx, { filename: file });
    return { install: () => ctx.DSSPermissionIntentRoutes.install(), onAddedListeners };
}

/** 執行 install 並回傳拋出的錯誤（未拋出時為 null）。 */
function installError(deps) {
    const { install } = loadRoutesInWorker(deps);
    try {
        install();
        return null;
    } catch (err) {
        return err;
    }
}

describe('A - install() names the missing dependency', () => {
    it('all three dependencies present: install() does not throw and registers one chrome.permissions.onAdded listener', () => {
        const { install, onAddedListeners } = loadRoutesInWorker(ALL);
        expect(() => install()).not.toThrow();
        expect(onAddedListeners).toHaveLength(1);
    });

    it.each([
        ['StorageManager is not declared in the worker', without('StorageManager')],
        ['StorageManager exists without PERMISSION_INTENTS', { ...ALL, StorageManager: {} }],
    ])('%s: install() throws a [DSS] load-order error naming utils/storage-manager*.js', (_label, deps) => {
        const err = installError(deps);
        expect(err, 'install() must throw').not.toBeNull();
        expect(err.message, 'the error names the routes module and the storage-manager files to load first').toMatch(/^\[DSS\] permission-intent-routes .*utils\/storage-manager/);
    });

    it.each([
        ['DSSClipboardPermission is absent, DSSNotificationPermission present', 'DSSClipboardPermission'],
        ['DSSNotificationPermission is absent, DSSClipboardPermission present', 'DSSNotificationPermission'],
    ])('%s: install() throws a [DSS] load-order error naming both permission wrapper files', (_label, missing) => {
        const err = installError(without(missing));
        expect(err, 'install() must throw when only ' + missing + ' is absent').not.toBeNull();
        expect(err.message).toMatch(/^\[DSS\] permission-intent-routes /);
        expect(err.message).toContain('utils/clipboard-permission.js');
        expect(err.message).toContain('utils/notification-permission.js');
    });
});

describe('B - a listener installed during the test completes each intent once its permissions are held', () => {
    const world = createPermissionWorld();
    const saved = {};
    let consoleErrorSpy;

    beforeAll(() => {
        saved.hadPermissions = 'permissions' in chrome;
        saved.permissions = chrome.permissions;
        saved.StorageManager = globalThis.StorageManager;
        chrome.permissions = world.api;
        globalThis.StorageManager = StorageManager;
        evalPopupScript('utils/clipboard-permission.js');
        evalPopupScript('utils/notification-permission.js');
    });
    afterAll(() => {
        if (saved.hadPermissions) chrome.permissions = saved.permissions;
        else delete chrome.permissions;
        globalThis.StorageManager = saved.StorageManager;
    });
    beforeEach(() => {
        world.reset();
        world.onAddedListeners.splice(0);
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        consoleErrorSpy.mockRestore();
        vi.useRealTimers();
    });

    it.each(TARGETS.map((t) => [t.field, t]))('%s: after the grant, StorageManager reports only that setting on and no intent stays pending', async (field, target) => {
        await StorageManager.savePermissionIntent(field);
        loadPermissionIntentRoutes().install();
        expect(world.onAddedListeners, 'precondition: install() registered one onAdded listener').toHaveLength(1);

        await settle(() => world.grant(target.permissions));

        const expected = Object.fromEntries(TARGETS.map((t) => [t.field, t.field === field]));
        expect(await readGatedSettings(), 'gated settings after Allow; console.error calls: ' + JSON.stringify(consoleErrorSpy.mock.calls.map(([first]) => first))).toEqual(expected);
        expect(await StorageManager.getPendingPermissionIntents(), 'the completed intent is cleared').toEqual([]);
    });
});
