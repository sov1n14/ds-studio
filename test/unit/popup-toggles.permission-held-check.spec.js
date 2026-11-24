/**
 * popup/popup.toggles.js - which has-permission answer counts as "already held" when the user turns on a permission-gated setting.
 *
 * Contract under test (StorageManager.buildHasPermissionOfKind, the one held check shared by the popup and the service worker; PR #45 round-1 BLOCKER):
 *   1. Only a has-permission answer that is exactly `true` means the permission is held. A truthy non-boolean answer ('yes', 1) means not held, so turning on autoCopyReply (clipboard) or replyNotification (notifications) goes on to the permission prompt: the pending intent is recorded before the prompt, a refusal reverts the control and saves nothing, and a prompt that closes the popup leaves the intent pending and the setting off.
 *   2. An answer of exactly `true` still counts as held: the setting is saved on with no prompt (control case).
 *   3. With no clipboard wrapper reachable (neither ctx nor globalThis), turning on autoCopyReply counts as not held: the checkbox reverts, nothing is saved, and the change handler raises no error. The notification counterpart lives in popup-reply-notification-toggle.spec.js.
 *
 * Trust boundary: the permission wrappers are given to createToggleManager through ctx (its public interface), standing in for a wrapper whose has-check answers a non-boolean. chrome.storage is the in-memory double of vitest.setup.js; StorageManager, the toggle manager and the real popup.html DOM are the real files. A request answer that never settles models Chrome closing the popup at the prompt.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { StorageManager, loadPopupModules, settle, TARGETS, readGatedSettings } from '../helpers/permission-intent-harness.js';
import { mountPopupHtml } from '../helpers/popup-master-switch-harness.js';

beforeAll(() => {
    loadPopupModules();
});

const restoreAfterTest = [];
afterEach(() => {
    restoreAfterTest.splice(0).forEach((restore) => restore());
    vi.useRealTimers();
});

const never = () => new Promise(() => {});
const targetOf = (field) => {
    const target = TARGETS.find((t) => t.field === field);
    if (!target) throw new Error('permission-intent-harness TARGETS has no field ' + field);
    return target;
};

/** Wrappers whose has-check resolves `heldAnswer` for both permission kinds and whose request resolves through `requestAnswer` (default: never settles, the popup closed at the prompt). */
function buildWrappers({ heldAnswer, requestAnswer = never }) {
    return {
        DSSClipboardPermission: { hasClipboardPermission: async () => heldAnswer, requestClipboardPermission: () => requestAnswer() },
        DSSNotificationPermission: { hasNotificationPermission: async () => heldAnswer, requestNotificationPermission: () => requestAnswer() },
    };
}

/** Mounts the real popup.html, binds a real toggle manager with the given ctx wrappers and drains the open-time initialisation before the user acts. */
async function openPopup(wrappers) {
    let dom;
    await settle(() => {
        mountPopupHtml();
        dom = {};
        document.querySelectorAll('[id]').forEach((el) => { dom[el.id] = el; });
        dom.websearchRadios = [...document.querySelectorAll('input[name="websearchToggle"]')];
        dom.replyNotificationRadios = [...document.querySelectorAll('input[type="radio"][name="replyNotificationToggle"]')];
        globalThis.__DS_PopupToggles.createToggleManager({
            StorageManager,
            ...wrappers,
            refreshSyncStatus: vi.fn(async () => {}),
            showSaveStatus: vi.fn(),
            applyMasterSwitchUI: vi.fn(),
            getPresets: () => [],
            setPresets: () => {},
            getActivePresetId: () => '',
            setActivePresetId: () => {},
        }).bindToggles(dom);
    });
    return dom;
}

/** The on/off state the popup control shows for a gated setting. */
function controlShowsOn(dom, field) {
    if (field === 'replyNotification') {
        const on = dom.replyNotificationRadios.find((r) => r.value === 'on');
        const off = dom.replyNotificationRadios.find((r) => r.value === 'off');
        expect(on && off, 'popup.html has replyNotificationToggle radios on and off').toBeTruthy();
        expect(on.checked !== off.checked, 'exactly one replyNotification radio is checked').toBe(true);
        return on.checked;
    }
    const box = dom[field + 'Toggle'];
    expect(box, '#' + field + 'Toggle missing from popup.html').toBeTruthy();
    return box.checked;
}

const GATED = [['autoCopyReply (clipboard)', 'autoCopyReply'], ['replyNotification (notifications)', 'replyNotification']];
const TRUTHY_NON_BOOLEAN = [['the string "yes"', 'yes'], ['the number 1', 1]];
const CASES = GATED.flatMap(([label, field]) => TRUTHY_NON_BOOLEAN.map(([answerLabel, answer]) => [label, answerLabel, field, answer]));

describe('turning on a gated setting while the has-permission check answers a truthy non-boolean', () => {
    it.each(CASES)('%s, has-check answers %s, user refuses the prompt: counts as not held, so the control reverts and the setting stays off', async (_label, _answerLabel, field, answer) => {
        const dom = await openPopup(buildWrappers({ heldAnswer: answer, requestAnswer: async () => false }));

        await targetOf(field).turnOn(dom);

        expect(controlShowsOn(dom, field), 'a truthy non-boolean is not "held": the refused prompt reverts the control to off').toBe(false);
        expect((await readGatedSettings())[field], 'the setting is never saved on without a granted prompt').not.toBe(true);
        expect(await StorageManager.getPendingPermissionIntents(), 'the refused intent is cleared').not.toContain(field);
    });

    it.each(CASES)('%s, has-check answers %s, prompt closes the popup: counts as not held, so the intent is left pending and the setting stays off', async (_label, _answerLabel, field, answer) => {
        const dom = await openPopup(buildWrappers({ heldAnswer: answer }));

        await targetOf(field).turnOn(dom);

        expect(await StorageManager.getPendingPermissionIntents(), 'a truthy non-boolean is not "held": the intent is recorded before the prompt for the service worker to finish').toContain(field);
        expect((await readGatedSettings())[field], 'the popup does not save the setting on before the user answers the prompt').not.toBe(true);
    });
});

describe('control: an answer of exactly true still counts as held', () => {
    it.each(GATED)('%s: saved on with no prompt and no pending intent', async (_label, field) => {
        const dom = await openPopup(buildWrappers({ heldAnswer: true }));

        await targetOf(field).turnOn(dom);

        expect(controlShowsOn(dom, field), 'the control stays on').toBe(true);
        expect((await readGatedSettings())[field], 'the setting is saved on').toBe(true);
        expect(await StorageManager.getPendingPermissionIntents(), 'no intent is left pending').not.toContain(field);
    });
});

describe('turning on autoCopyReply with no clipboard wrapper reachable', () => {
    it('counts as not held: the checkbox reverts, nothing is saved and the change handler raises no error', async () => {
        const globalWrapper = globalThis.DSSClipboardPermission;
        expect(globalWrapper?.hasClipboardPermission, 'precondition: the real clipboard wrapper was loaded onto globalThis').toBeTypeOf('function');
        Reflect.deleteProperty(globalThis, 'DSSClipboardPermission');
        restoreAfterTest.push(() => { globalThis.DSSClipboardPermission = globalWrapper; });
        const rejections = [];
        const onRejection = (reason) => rejections.push(reason);
        process.on('unhandledRejection', onRejection);
        restoreAfterTest.push(() => process.off('unhandledRejection', onRejection));
        const { DSSNotificationPermission } = buildWrappers({ heldAnswer: true });
        const dom = await openPopup({ DSSNotificationPermission });

        await targetOf('autoCopyReply').turnOn(dom);
        await new Promise((resolve) => setImmediate(resolve));

        expect(controlShowsOn(dom, 'autoCopyReply'), 'a missing wrapper counts as no permission: the checkbox reverts').toBe(false);
        expect((await readGatedSettings()).autoCopyReply, 'the setting is never saved on').not.toBe(true);
        expect(rejections, 'the change handler does not reject').toEqual([]);
    });
});
