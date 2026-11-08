/**
 * Permission intent - an optional-permission prompt closes the popup, so the service worker finishes turning the setting on (scenario: the intent the popup toggle manager records, background/permission-intent-routes.js completing it on chrome.permissions.onAdded, and the open-time cleanup of refused intents in popup/popup.toggles.js).
 *
 * Bug (4.39.0, user-observed): the first click on #autoCopyReplyToggle, #autoCopyCodeToggle or the replyNotificationToggle "on" radio shows the Chrome permission prompt; Chrome closes the popup when the prompt appears, so the popup code after `await chrome.permissions.request()` never runs and the setting stays off after the user presses Allow. popup-auto-copy-toggles.spec.js and popup-reply-notification-toggle.spec.js resolved request() with the popup still alive, so they never took this path.
 *
 * Approved fix (user): the popup records "you want this on" before the prompt; once the permission is granted the service worker completes it, whether or not the popup is still open; refusing, or unchecking later, clears the record. Decided design: the popup persists the pending intent in chrome.storage.local before chrome.permissions.request; background/permission-intent-routes.js publishes globalThis.DSSPermissionIntentRoutes.install(), which registers chrome.permissions.onAdded and, when the granted permissions cover a pending intent (clipboard: clipboardWrite + offscreen; notifications: notifications), saves the setting through StorageManager and clears that intent.
 *
 * Refusal with the popup closed (verifier finding): Chrome closes the popup when the prompt appears, so pressing Deny never reaches popup code; R3 models a popup that stays alive and resolves request() with false. Decided fix: when the popup opens, the toggle manager clears every pending intent whose permissions are not granted (the prompt was refused or dismissed while the popup was closed) and leaves intents whose permissions are granted for the service worker. R6 and R7 cover the refusal, R8 the reopen after Allow, R9 a click on the same control while that cleanup still awaits its permission query (verifier finding: no test made an intent while the cleanup was mid-flight).
 *
 * Scenario rules (CLAUDE.md "Scenario Unit Tests", cross-module mutable state): the real popup toggle manager, the real permission wrappers, the real StorageManager and the real routes module share the suite in-memory chrome.storage; only chrome.permissions is faked (test/helpers/permission-intent-harness.js). The routes module reads StorageManager from the global that the service worker importScripts call leaves behind. Assertions read the settings through StorageManager.getSettings(), never the intent record or a spy.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
    StorageManager, TARGETS, targetOf, CLIPBOARD, NOTIFICATIONS,
    createPermissionWorld, loadPopupModules, loadPermissionIntentRoutes, openPopup, reopenPopup, openPopupWithCleanupHeld, settle, readGatedSettings,
} from '../helpers/permission-intent-harness.js';

const ALL_OFF = Object.fromEntries(TARGETS.map(({ field }) => [field, false]));
const onlyOn = (field) => ({ ...ALL_OFF, [field]: true });
// A second gated setting whose prompt is pending proves the routes module is live in the tests that assert a setting stays off.
const CONTROL_OF = { autoCopyReply: 'autoCopyCode', autoCopyCode: 'autoCopyReply', replyNotification: 'autoCopyReply' };
const unrelatedTo = (target) => (target.permissions === CLIPBOARD ? NOTIFICATIONS : CLIPBOARD);
const union = (...sets) => [...new Set(sets.flat())];
const sorted = (list) => [...list].sort();
const CASES = TARGETS.map((t) => [t.control, t.field, t]);
const SETTER_OF = { autoCopyReply: 'saveAutoCopyReply', autoCopyCode: 'saveAutoCopyCode', replyNotification: 'saveReplyNotification' };

const world = createPermissionWorld();
const saved = {};
let routesLoadError = null;
let consoleErrorSpy;

beforeAll(() => {
    saved.hadPermissions = 'permissions' in chrome;
    saved.permissions = chrome.permissions;
    saved.StorageManager = globalThis.StorageManager;
    chrome.permissions = world.api;
    globalThis.StorageManager = StorageManager;
    loadPopupModules();
    try {
        loadPermissionIntentRoutes().install();
    } catch (err) {
        routesLoadError = err;
    }
});

afterAll(() => {
    if (saved.hadPermissions) chrome.permissions = saved.permissions;
    else delete chrome.permissions;
    globalThis.StorageManager = saved.StorageManager;
});

beforeEach(() => {
    world.reset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
});

/** The user turns `target` on in a popup that Chrome closes at the prompt; asserts the prompt asked for the target permissions and nothing is on yet. */
async function turnOnWithPromptPending(dom, target) {
    const before = world.api.request.mock.calls.length;
    await target.turnOn(dom);
    expect(world.api.request.mock.calls.length - before, 'precondition: the popup showed one permission prompt for ' + target.control).toBe(1);
    expect(sorted(world.api.request.mock.calls.at(-1)[0].permissions), 'precondition: the prompt asks for ' + target.permissions.join(' + ')).toEqual(sorted(target.permissions));
    expect((await readGatedSettings())[target.field], 'precondition: ' + target.field + ' stays off while the prompt is open').toBe(false);
}

describe('routes module', () => {
    it('background/permission-intent-routes.js loads, publishes DSSPermissionIntentRoutes.install() and install() registers a chrome.permissions.onAdded listener', () => {
        if (routesLoadError) throw routesLoadError;
        expect(world.onAddedListeners.length, 'install() registered no chrome.permissions.onAdded listener').toBeGreaterThan(0);
    });
});

describe('R1 - the popup closes at the prompt; Allow turns the setting on without the popup', () => {
    it.each(CASES)('%s: pressing Allow turns %s on, and only it', async (_control, field, target) => {
        const dom = openPopup();
        await turnOnWithPromptPending(dom, target);

        await settle(() => world.grant(target.permissions));

        expect(await readGatedSettings(), 'after Allow, StorageManager reports ' + field + ' on and the other gated settings off').toEqual(onlyOn(field));
    });

    it.each(CASES)('%s: a completed intent is used once; %s turned off elsewhere stays off when the permissions are granted again', async (_control, field, target) => {
        const dom = openPopup();
        await turnOnWithPromptPending(dom, target);
        await settle(() => world.grant(target.permissions));
        expect((await readGatedSettings())[field], 'precondition: Allow turned ' + field + ' on').toBe(true);

        await settle(() => { StorageManager[SETTER_OF[field]](false); });
        await settle(() => world.grant(target.permissions));

        expect(await readGatedSettings(), 'the intent was cleared when it was completed, so a later grant turns nothing on').toEqual(ALL_OFF);
    });
});

describe('R2 - a grant that does not cover the pending intent', () => {
    it.each(CASES)('%s: granting unrelated permissions leaves %s off, and the intent still completes on the matching grant', async (_control, field, target) => {
        const dom = openPopup();
        await turnOnWithPromptPending(dom, target);

        await settle(() => world.grant(unrelatedTo(target)));
        expect(await readGatedSettings(), 'granting ' + unrelatedTo(target).join(' + ') + ' turns nothing on').toEqual(ALL_OFF);

        await settle(() => world.grant(target.permissions));
        expect(await readGatedSettings(), 'the pending intent survived the unrelated grant').toEqual(onlyOn(field));
    });
});

describe('R3 - refusing the prompt clears the intent', () => {
    it.each(CASES)('%s: request resolves false, %s stays off when the permissions are granted later', async (_control, field, target) => {
        const control = targetOf(CONTROL_OF[field]);
        const dom = openPopup();
        world.answerRequestWith(false);
        await target.turnOn(dom);
        expect(world.api.request, 'precondition: the popup showed the permission prompt').toHaveBeenCalledTimes(1);
        expect((await readGatedSettings())[field], 'refused: ' + field + ' is off').toBe(false);

        world.closePopupOnPrompt();
        await turnOnWithPromptPending(dom, control);
        await settle(() => world.grant(union(target.permissions, control.permissions)));

        expect(await readGatedSettings(), 'the grant completes only the pending ' + control.field + ' intent; the refused ' + field + ' stays off').toEqual(onlyOn(control.field));
    });
});

describe('R4 - turning the setting off while its prompt is pending clears the intent', () => {
    it.each(CASES)('%s: on then off with the prompt pending, %s stays off when the permissions are granted', async (_control, field, target) => {
        const control = targetOf(CONTROL_OF[field]);
        const dom = openPopup();
        await turnOnWithPromptPending(dom, target);
        await target.turnOff(dom);
        expect((await readGatedSettings())[field], 'turned off: ' + field + ' is off').toBe(false);

        await turnOnWithPromptPending(dom, control);
        await settle(() => world.grant(union(target.permissions, control.permissions)));

        expect(await readGatedSettings(), 'the grant completes only the pending ' + control.field + ' intent; the withdrawn ' + field + ' stays off').toEqual(onlyOn(control.field));
    });
});

describe('R5 - permission already granted', () => {
    it.each(CASES)('%s: %s is saved on at once and no prompt is shown', async (_control, field, target) => {
        world.preGrant(target.permissions);
        const dom = openPopup();

        await target.turnOn(dom);

        expect(world.api.request, 'no prompt when the permission already exists').not.toHaveBeenCalled();
        expect(await readGatedSettings(), 'StorageManager reports ' + field + ' on and the other gated settings off').toEqual(onlyOn(field));
    });
});

describe('R6 - clipboard prompt refused while the popup is closed; reopening the popup clears the refused intent', () => {
    // Deny with the popup closed: Chrome closes the prompt, grants nothing and fires no onAdded; the closed popup never sees request() settle, so no popup code after the await runs.
    it.each([
        ['#autoCopyReplyToggle', 'autoCopyReply', 'autoCopyCode'],
        ['#autoCopyCodeToggle', 'autoCopyCode', 'autoCopyReply'],
    ])('%s: %s refused with the popup closed stays off when, after reopening, %s is turned on and the shared clipboard prompt is allowed', async (_control, refusedField, laterField) => {
        const refused = targetOf(refusedField);
        const later = targetOf(laterField);
        await turnOnWithPromptPending(openPopup(), refused);

        const reopened = await reopenPopup();
        expect((await readGatedSettings())[refusedField], 'precondition: the refused ' + refusedField + ' is off in the reopened popup').toBe(false);

        await turnOnWithPromptPending(reopened, later);
        await settle(() => world.grant(CLIPBOARD));

        expect(await readGatedSettings(), 'the clipboard grant completes only the ' + laterField + ' intent made after reopening; the ' + refusedField + ' the user refused stays off').toEqual(onlyOn(laterField));
    });
});

describe('R7 - notifications prompt refused while the popup is closed; reopening the popup clears the refused intent', () => {
    it('replyNotification "on" refused with the popup closed stays off when notifications are granted after reopening', async () => {
        const refused = targetOf('replyNotification');
        const live = targetOf('autoCopyReply');
        await turnOnWithPromptPending(openPopup(), refused);

        const reopened = await reopenPopup();
        expect((await readGatedSettings()).replyNotification, 'precondition: the refused replyNotification is off in the reopened popup').toBe(false);

        // Liveness: an intent made in the reopened popup completes on its grant, so the routes module is listening when the notifications grant arrives.
        await turnOnWithPromptPending(reopened, live);
        await settle(() => world.grant(CLIPBOARD));
        expect(await readGatedSettings(), 'precondition: the routes module completed the autoCopyReply intent made after reopening').toEqual(onlyOn('autoCopyReply'));

        await settle(() => world.grant(NOTIFICATIONS));

        expect(await readGatedSettings(), 'a later onAdded ["notifications"] turns nothing on; the replyNotification the user refused stays off').toEqual(onlyOn('autoCopyReply'));
    });
});

describe('R8 - reopening the popup leaves an allowed intent alone', () => {
    it.each(CASES)('%s: Allow with the popup closed turns %s on, and reopening the popup keeps it on', async (_control, field, target) => {
        await turnOnWithPromptPending(openPopup(), target);
        await settle(() => world.grant(target.permissions));

        await reopenPopup();

        expect(await readGatedSettings(), 'after Allow and reopening, StorageManager reports ' + field + ' on and the other gated settings off').toEqual(onlyOn(field));
    });

    it.each(CASES)('%s: permissions granted before onAdded is delivered; reopening the popup in between does not clear the %s intent', async (_control, field, target) => {
        await turnOnWithPromptPending(openPopup(), target);
        world.preGrant(target.permissions);

        await reopenPopup();
        await settle(() => world.grant(target.permissions));

        expect(await readGatedSettings(), 'the intent whose permissions are granted survives the reopen, so ' + field + ' ends on and only it').toEqual(onlyOn(field));
    });
});

describe('R9 - turning a setting on while the open-time cleanup is still running', () => {
    // The earlier popup left a refused intent (Deny with the popup closed). The reopened popup's cleanup is waiting on chrome.permissions.contains for it when the user turns the same setting on again; the permission is still not granted when the answer arrives, and the intent the user just recorded must survive the cleanup.
    it.each(CASES)('%s: a stale refused %s intent exists, the user turns it on again before the cleanup decides, and Allow turns it on', async (_control, field, target) => {
        await turnOnWithPromptPending(openPopup(), target);

        const { dom, finishCleanup } = await openPopupWithCleanupHeld(world);
        await turnOnWithPromptPending(dom, target);
        await finishCleanup();
        expect((await readGatedSettings())[field], 'precondition: ' + field + ' is still off after the cleanup finished').toBe(false);

        await settle(() => world.grant(target.permissions));
        expect(await readGatedSettings(), 'the intent recorded while the cleanup ran survives it, so Allow turns ' + field + ' on and only it').toEqual(onlyOn(field));

        await settle(() => { StorageManager[SETTER_OF[field]](false); });
        await settle(() => world.grant(target.permissions));
        expect(await readGatedSettings(), 'the completed intent was cleared, so a later grant turns nothing on').toEqual(ALL_OFF);
    });
});
