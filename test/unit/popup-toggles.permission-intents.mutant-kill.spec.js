/**
 * popup/popup.toggles.js - permission-intent cleanup at popup open and permission-module resolution (Stryker mutant kills).
 *
 * Contract under test (createToggleManager JSDoc, docs on the permission-intent flow):
 *   1. On open (bindToggles), a pending permission intent whose permission is still not granted was refused while the popup was closed, so it is cleared; an intent whose permission is granted stays for background/permission-intent-routes.js to complete. Clipboard intents (autoCopyReply, autoCopyCode) follow the clipboard permission, replyNotification follows the notifications permission.
 *   2. The cleanup never removes an intent the user recorded since this popup opened, even when that intent was already pending from an earlier refused prompt.
 *   3. A permission wrapper passed in ctx is used even when no global wrapper exists (ctx first, global fallback).
 *   4. A failure inside the un-awaited open-time cleanup is logged on the [DSS] console.error boundary and never escapes as an unhandled rejection.
 *
 * Trust boundaries faked: chrome.permissions (absent from vitest.setup.js, installed per test) and chrome.storage (in-memory, vitest.setup.js). The real utils/clipboard-permission.js and utils/notification-permission.js wrappers and the real StorageManager sit between them and the popup code. A request() that never settles models Chrome closing the popup at the prompt.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';
import { mountPopupHtml } from '../helpers/popup-master-switch-harness.js';

const INTENTS = { reply: 'autoCopyReply', code: 'autoCopyCode', notification: 'replyNotification' };

beforeAll(() => {
    evalPopupScript('utils/clipboard-permission.js');
    evalPopupScript('utils/notification-permission.js');
    evalPopupScript('popup/popup.toggles.js');
    for (const [name, fn] of [['DSSClipboardPermission', 'hasClipboardPermission'], ['DSSNotificationPermission', 'hasNotificationPermission'], ['__DS_PopupToggles', 'createToggleManager']]) {
        if (typeof globalThis[name]?.[fn] !== 'function') throw new Error(`${fn} was not exposed on globalThis.${name}`);
    }
    expect(Object.values(StorageManager.PERMISSION_INTENTS).sort(), 'intent names this spec seeds').toEqual(Object.values(INTENTS).sort());
});

let hadPermissions;
let originalPermissions;
const restoreAfterTest = [];
beforeEach(() => {
    hadPermissions = 'permissions' in chrome;
    originalPermissions = chrome.permissions;
});
afterEach(() => {
    restoreAfterTest.splice(0).forEach((restore) => restore());
    if (hadPermissions) chrome.permissions = originalPermissions;
    else delete chrome.permissions;
    vi.useRealTimers();
});

const never = () => new Promise(() => {});

/** chrome.permissions double: grants by permission family; request() never settles unless given (popup closed at the prompt). */
function installPermissions({ clipboard = false, notifications = false, request = never } = {}) {
    const isNotificationSet = (set) => (set?.permissions ?? []).includes('notifications');
    chrome.permissions = {
        contains: async (set) => (isNotificationSet(set) ? notifications : clipboard),
        request,
    };
}

function buildPopupDom() {
    mountPopupHtml();
    const dom = {};
    document.querySelectorAll('[id]').forEach((el) => { dom[el.id] = el; });
    dom.websearchRadios = [...document.querySelectorAll('input[name="websearchToggle"]')];
    dom.replyNotificationRadios = [...document.querySelectorAll('input[name="replyNotificationToggle"]')];
    return dom;
}

function buildManager(overrides = {}) {
    const ctx = {
        StorageManager,
        DSSClipboardPermission: globalThis.DSSClipboardPermission,
        DSSNotificationPermission: globalThis.DSSNotificationPermission,
        refreshSyncStatus: vi.fn(async () => {}),
        showSaveStatus: vi.fn(),
        applyMasterSwitchUI: vi.fn(),
        getPresets: () => [],
        setPresets: () => {},
        getActivePresetId: () => '',
        setActivePresetId: () => {},
        ...overrides,
    };
    return window.__DS_PopupToggles.createToggleManager(ctx);
}

async function seedIntents(...intentNames) {
    for (const intentName of intentNames) await StorageManager.savePermissionIntent(intentName);
    expect((await StorageManager.getPendingPermissionIntents()).sort(), 'precondition: seeded intents pending').toEqual([...intentNames].sort());
}

/** Opens the popup (bindToggles starts the cleanup), runs `afterBind` synchronously right after, then drains storage turns in virtual time. */
async function openPopupAndSettle(manager, dom, afterBind = () => {}) {
    vi.useFakeTimers();
    manager.bindToggles(dom);
    afterBind();
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
}

const pendingIntents = async () => (await StorageManager.getPendingPermissionIntents()).sort();

describe('open-time cleanup of refused permission intents', () => {
    it('clears every pending intent whose permission is still not granted', async () => {
        installPermissions({ clipboard: false, notifications: false });
        await seedIntents(INTENTS.reply, INTENTS.code, INTENTS.notification);
        await openPopupAndSettle(buildManager(), buildPopupDom());
        expect(await pendingIntents()).toEqual([]);
    });

    it('keeps every pending intent whose permission is granted (left for the service worker)', async () => {
        installPermissions({ clipboard: true, notifications: true });
        await seedIntents(INTENTS.reply, INTENTS.code, INTENTS.notification);
        await openPopupAndSettle(buildManager(), buildPopupDom());
        expect(await pendingIntents()).toEqual([INTENTS.reply, INTENTS.code, INTENTS.notification].sort());
    });

    it.each([
        ['clipboard granted, notifications refused', { clipboard: true, notifications: false }, [INTENTS.reply, INTENTS.code]],
        ['clipboard refused, notifications granted', { clipboard: false, notifications: true }, [INTENTS.notification]],
    ])('%s: each intent follows its own permission', async (_label, grants, expectedKept) => {
        installPermissions(grants);
        await seedIntents(INTENTS.reply, INTENTS.code, INTENTS.notification);
        await openPopupAndSettle(buildManager(), buildPopupDom());
        expect(await pendingIntents()).toEqual([...expectedKept].sort());
    });

    it('never removes an intent the user records right after open, even when the same intent was already pending; other refused intents are still cleared', async () => {
        installPermissions({ clipboard: false, notifications: false });
        await seedIntents(INTENTS.reply, INTENTS.code);
        const dom = buildPopupDom();
        await openPopupAndSettle(buildManager(), dom, () => {
            dom.autoCopyReplyToggle.checked = true;
            dom.autoCopyReplyToggle.dispatchEvent(new Event('change'));
        });
        // autoCopyCode proves the cleanup ran to completion; autoCopyReply is the intent the user just recorded while the prompt is open.
        expect(await pendingIntents()).toEqual([INTENTS.reply]);
    });

    it('logs a failure of the cleanup on the [DSS] console.error boundary without an unhandled rejection', async () => {
        installPermissions();
        await seedIntents(INTENTS.reply);
        const failure = new Error('permission wrapper failed');
        let hasCalls = 0;
        const failingClipboard = {
            hasClipboardPermission: () => { hasCalls += 1; return Promise.reject(failure); },
            requestClipboardPermission: never,
        };
        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        restoreAfterTest.push(() => process.off('unhandledRejection', onUnhandled));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        restoreAfterTest.push(() => consoleError.mockRestore());

        await openPopupAndSettle(buildManager({ DSSClipboardPermission: failingClipboard }), buildPopupDom());
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(hasCalls, 'the failing wrapper was queried').toBeGreaterThan(0);
        expect(unhandled).toEqual([]);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[DSS]'), failure);
    });
});

describe('permission wrapper resolution', () => {
    it('uses the clipboard wrapper passed in ctx when no global wrapper exists', async () => {
        const globalWrapper = globalThis.DSSClipboardPermission;
        delete globalThis.DSSClipboardPermission;
        restoreAfterTest.push(() => { globalThis.DSSClipboardPermission = globalWrapper; });
        installPermissions({ clipboard: false, request: async () => true });
        const dom = buildPopupDom();
        const manager = buildManager({ DSSClipboardPermission: globalWrapper });

        await openPopupAndSettle(manager, dom, () => {
            dom.autoCopyReplyToggle.checked = true;
            dom.autoCopyReplyToggle.dispatchEvent(new Event('change'));
        });

        expect(dom.autoCopyReplyToggle.checked, 'checkbox stays on after Allow').toBe(true);
        expect((await StorageManager.getSettings()).autoCopyReply).toBe(true);
    });
});
