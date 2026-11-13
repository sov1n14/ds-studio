/**
 * Permission prompt with no window to host it (Kiwi Browser on Android) - scenario: the real popup toggle manager, the real permission wrappers, the real StorageManager and the real background/permission-intent-routes.js share the suite in-memory chrome.storage; only chrome.permissions is faked (test/helpers/permission-intent-harness.js).
 *
 * Bug (user-observed on Kiwi Browser): chrome.permissions.request rejects with `Error: Could not find an active window.` (Chromium's own error when no native window exists to host the prompt). The auto-copy checkboxes and the reply-complete notification "on" radio treat that rejection like a refusal: the control reverts and the setting is never saved, so neither feature can ever be turned on there.
 *
 * Approved fix (user ruling, verbatim): "Only save it as enabled when request throws an error, and only in the case of Could not find an active window." Scope: "通知也比照處理" (the notification radio gets the same treatment). Notice: "不顯示" (no popup notice).
 *
 * Contract this spec fixes, for each of #autoCopyReplyToggle, #autoCopyCodeToggle and the replyNotificationToggle "on" radio, with the permission not granted (chrome.permissions.contains answers false):
 *   W1. request rejects with new Error('Could not find an active window.') -> the control stays checked / on, and the setting is stored enabled under the same key and areas a granted request stores today (auto-copy: local + sync; reply notification: local), as StorageManager.getSettings() reports it.
 *   W2. request rejects with any other error -> the control reverts and true is never stored (unchanged behavior; regression guard).
 *   W3. request resolves false (the user refused) -> the control reverts and true is never stored (unchanged behavior; regression guard).
 *
 * Assertions read the control's checked state, the raw stored key and StorageManager.getSettings(); never a call sequence, a console.error call, or which internal function returned what.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
    StorageManager, TARGETS, createPermissionWorld, loadPopupModules, loadPermissionIntentRoutes, openPopup, readGatedSettings,
} from '../helpers/permission-intent-harness.js';

const WINDOW_UNAVAILABLE = 'Could not find an active window.';

// The raw key each control's setting lives under, and the storage areas a granted request writes it to (popup-auto-copy-toggles.spec.js and popup-reply-notification-toggle.spec.js fix these).
const STORAGE = {
    autoCopyReply: { key: 'isAutoCopyReplyEnabled', areas: ['local', 'sync'] },
    autoCopyCode: { key: 'isAutoCopyCodeEnabled', areas: ['local', 'sync'] },
    replyNotification: { key: 'isReplyNotificationEnabled', areas: ['local'] },
};
const ALL_OFF = Object.fromEntries(TARGETS.map(({ field }) => [field, false]));
const onlyOn = (field) => ({ ...ALL_OFF, [field]: true });
const CASES = TARGETS.map((t) => [t.control, t.field, t]);

const world = createPermissionWorld();
const defaultRequest = world.api.request.getMockImplementation();
const saved = {};
const removeAfterTest = [];
let consoleSpies = [];

beforeAll(() => {
    saved.hadPermissions = 'permissions' in chrome;
    saved.permissions = chrome.permissions;
    saved.StorageManager = globalThis.StorageManager;
    chrome.permissions = world.api;
    globalThis.StorageManager = StorageManager;
    loadPopupModules();
    loadPermissionIntentRoutes().install();
});

afterAll(() => {
    if (saved.hadPermissions) chrome.permissions = saved.permissions;
    else delete chrome.permissions;
    globalThis.StorageManager = saved.StorageManager;
});

beforeEach(() => {
    world.reset();
    consoleSpies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
});

afterEach(() => {
    removeAfterTest.splice(0).forEach((remove) => remove());
    world.api.request.mockImplementation(defaultRequest);
    consoleSpies.forEach((spy) => spy.mockRestore());
    vi.useRealTimers();
});

/** The prompt's answer while the popup is still open: chrome.permissions.request rejects with `error`. */
function requestRejectsWith(error) {
    world.api.request.mockImplementation(async () => { throw error; });
}

/** The prompt's answer while the popup is still open: chrome.permissions.request resolves `value`. */
function requestResolves(value) {
    world.api.request.mockImplementation(async () => value);
}

/** The control's visible state: 'on' (checkbox checked, or radio "on" checked and "off" not), 'off' (the reverse) or 'mixed' for a radio pair in neither state. */
function controlState(dom, field) {
    if (field !== 'replyNotification') return dom[field === 'autoCopyReply' ? 'autoCopyReplyToggle' : 'autoCopyCodeToggle'].checked ? 'on' : 'off';
    const on = dom.replyNotificationRadios.find((r) => r.value === 'on');
    const off = dom.replyNotificationRadios.find((r) => r.value === 'off');
    if (on.checked && !off.checked) return 'on';
    if (!on.checked && off.checked) return 'off';
    return 'mixed';
}

async function readRaw(area, key) {
    return (await chrome.storage[area].get(key))[key];
}

/** Records every value of `key` written to chrome.storage (any area) from now on, so a transient true is visible even when a later write hides it. */
function recordWritesOf(key) {
    const writes = [];
    const listener = (changes, area) => { if (key in changes) writes.push(area + ':' + changes[key].newValue); };
    chrome.storage.onChanged.addListener(listener);
    removeAfterTest.push(() => chrome.storage.onChanged.removeListener(listener));
    return writes;
}

/** Opens the popup with the setting off and the permission not granted, then the user turns `target` on; asserts the popup did show a prompt. */
async function turnOnWithPermissionAbsent(target) {
    const dom = openPopup();
    dom.replyNotificationRadios.find((r) => r.value === 'off').checked = true;
    expect(controlState(dom, target.field), 'precondition: ' + target.control + ' starts off').toBe('off');
    const writes = recordWritesOf(STORAGE[target.field].key);
    await target.turnOn(dom);
    expect(world.api.request, 'precondition: the popup asked chrome.permissions.request for ' + target.control).toHaveBeenCalledTimes(1);
    return { dom, writes };
}

/** Asserts the control reverted to off and true was never stored for the target's setting, in any area, at any moment. */
async function expectRevertedAndNeverStored(dom, target, writes) {
    const { field, control } = target;
    const { key, areas } = STORAGE[field];
    expect(controlState(dom, field), control + ' reverts to off').toBe('off');
    for (const area of areas) {
        expect([undefined, false], area + ' ' + key + ' stays absent or false').toContain(await readRaw(area, key));
    }
    expect(writes.filter((w) => w.endsWith(':true')), 'true is never written to ' + key + ', not even transiently').toEqual([]);
    expect(await readGatedSettings(), 'StorageManager reports every gated setting off').toEqual(ALL_OFF);
}

describe('W1 - request rejects with "Could not find an active window." (no window to host the prompt)', () => {
    it.each(CASES)('%s: the control stays on and %s is stored enabled, as a granted request stores it', async (control, field, target) => {
        requestRejectsWith(new Error(WINDOW_UNAVAILABLE));

        const { dom } = await turnOnWithPermissionAbsent(target);

        expect(controlState(dom, field), control + ' stays on after the window-unavailable rejection').toBe('on');
        const { key, areas } = STORAGE[field];
        for (const area of areas) {
            expect(await readRaw(area, key), area + ' ' + key + ' is stored true').toBe(true);
        }
        expect(await readGatedSettings(), 'StorageManager reports ' + field + ' on and the other gated settings off').toEqual(onlyOn(field));
    });
});

describe('W2 - request rejects with any other error (regression guard: counts as refusal)', () => {
    it.each(CASES)('%s: the control reverts and %s is never stored true', async (_control, _field, target) => {
        requestRejectsWith(new Error('Some other failure'));

        const { dom, writes } = await turnOnWithPermissionAbsent(target);

        await expectRevertedAndNeverStored(dom, target, writes);
    });
});

describe('W3 - request resolves false: the user refused (regression guard)', () => {
    it.each(CASES)('%s: the control reverts and %s is never stored true', async (_control, _field, target) => {
        requestResolves(false);

        const { dom, writes } = await turnOnWithPermissionAbsent(target);

        await expectRevertedAndNeverStored(dom, target, writes);
    });
});
