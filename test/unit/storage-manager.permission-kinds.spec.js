/**
 * StorageManager.PERMISSION_KINDS and StorageManager.buildHasPermissionOfKind — the one table saying how each optional-permission kind is checked, built from the two permission wrappers and read by the popup's open-time cleanup (popup/popup.toggles.js) and the service worker's onAdded completion (background/permission-intent-routes.js).
 *
 * Contract under test:
 *   1. buildHasPermissionOfKind({ clipboardPermission, notificationPermission }) returns a table keyed by the values of PERMISSION_KINDS; the CLIPBOARD check resolves to clipboardPermission.hasClipboardPermission()'s answer and the NOTIFICATION check to notificationPermission.hasNotificationPermission()'s answer, asked at each call, not once at build time (the service worker builds the table once at install and checks it on every later grant).
 *   2. A missing (undefined or null) wrapper makes that kind's check resolve false without throwing, while the other kind still answers from its wrapper — the popup's tolerance of a missing wrapper.
 *   3. Every permission kind named in PERMISSION_INTENT_PERMISSIONS has a check in the built table, so an intent whose kind lacks a check cannot fail silently.
 *
 * Trust boundary: the permission wrappers are the boundary to chrome.permissions, so each test passes plain wrapper doubles whose answers it sets. StorageManager is the real module (static import of utils/storage-manager.js, keys bundle preloaded by test/setup/vitest.setup.js).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const INTENTS = { reply: 'autoCopyReply', code: 'autoCopyCode', notification: 'replyNotification' };

/** Wrapper doubles answering with fixed values. */
const clipboardAnswering = (isGranted) => ({ hasClipboardPermission: async () => isGranted });
const notificationAnswering = (isGranted) => ({ hasNotificationPermission: async () => isGranted });

/** Calls a check and returns its settled outcome; a synchronous throw and a rejection both land in `error`. */
async function outcomeOf(check) {
    try {
        return { value: await check() };
    } catch (error) {
        return { error };
    }
}

function requireApi() {
    expect(StorageManager.PERMISSION_KINDS, 'StorageManager.PERMISSION_KINDS is not defined (expected next to PERMISSION_INTENTS in utils/storage-manager.keys.js)').toEqual(expect.any(Object));
    expect(typeof StorageManager.buildHasPermissionOfKind, 'StorageManager.buildHasPermissionOfKind is not a function (expected next to PERMISSION_INTENTS in utils/storage-manager.keys.js)').toBe('function');
    return { KINDS: StorageManager.PERMISSION_KINDS, build: (modules) => StorageManager.buildHasPermissionOfKind(modules) };
}

beforeAll(() => {
    expect(Object.values(StorageManager.PERMISSION_INTENTS).sort(), 'intent names this spec expects').toEqual(Object.values(INTENTS).sort());
});

describe("1 - each kind resolves to its own wrapper's answer", () => {
    it.each([
        [true, false],
        [false, true],
        [true, true],
        [false, false],
    ])('clipboard wrapper answers %s, notification wrapper answers %s: CLIPBOARD and NOTIFICATION checks resolve to those answers', async (isClipboardGranted, isNotificationGranted) => {
        const { KINDS, build } = requireApi();
        const table = build({ clipboardPermission: clipboardAnswering(isClipboardGranted), notificationPermission: notificationAnswering(isNotificationGranted) });

        expect(await outcomeOf(table[KINDS.CLIPBOARD]), 'CLIPBOARD check').toEqual({ value: isClipboardGranted });
        expect(await outcomeOf(table[KINDS.NOTIFICATION]), 'NOTIFICATION check').toEqual({ value: isNotificationGranted });
    });

    it('asks the wrapper at each call: a permission granted after the table was built is reported by the next check', async () => {
        const { KINDS, build } = requireApi();
        let isClipboardGranted = false;
        let isNotificationGranted = false;
        const table = build({
            clipboardPermission: { hasClipboardPermission: async () => isClipboardGranted },
            notificationPermission: { hasNotificationPermission: async () => isNotificationGranted },
        });
        expect(await outcomeOf(table[KINDS.CLIPBOARD]), 'precondition: CLIPBOARD before the grant').toEqual({ value: false });
        expect(await outcomeOf(table[KINDS.NOTIFICATION]), 'precondition: NOTIFICATION before the grant').toEqual({ value: false });

        isClipboardGranted = true;
        expect(await outcomeOf(table[KINDS.CLIPBOARD]), 'CLIPBOARD after the clipboard grant').toEqual({ value: true });
        expect(await outcomeOf(table[KINDS.NOTIFICATION]), 'NOTIFICATION is unaffected by the clipboard grant').toEqual({ value: false });

        isNotificationGranted = true;
        expect(await outcomeOf(table[KINDS.NOTIFICATION]), 'NOTIFICATION after the notifications grant').toEqual({ value: true });
    });
});

describe('2 - a missing wrapper resolves false for its kind, without throwing', () => {
    it.each([
        ['undefined', undefined],
        ['null', null],
    ])('clipboardPermission is %s: building does not throw, CLIPBOARD resolves false, NOTIFICATION still answers from its wrapper', async (_label, missing) => {
        const { KINDS, build } = requireApi();
        let table;
        expect(() => { table = build({ clipboardPermission: missing, notificationPermission: notificationAnswering(true) }); }, 'building the table').not.toThrow();

        expect(await outcomeOf(table[KINDS.CLIPBOARD]), 'CLIPBOARD with no clipboard wrapper').toEqual({ value: false });
        expect(await outcomeOf(table[KINDS.NOTIFICATION]), 'NOTIFICATION from its wrapper').toEqual({ value: true });
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
    ])('notificationPermission is %s: building does not throw, NOTIFICATION resolves false, CLIPBOARD still answers from its wrapper', async (_label, missing) => {
        const { KINDS, build } = requireApi();
        let table;
        expect(() => { table = build({ clipboardPermission: clipboardAnswering(true), notificationPermission: missing }); }, 'building the table').not.toThrow();

        expect(await outcomeOf(table[KINDS.NOTIFICATION]), 'NOTIFICATION with no notification wrapper').toEqual({ value: false });
        expect(await outcomeOf(table[KINDS.CLIPBOARD]), 'CLIPBOARD from its wrapper').toEqual({ value: true });
    });

    it('neither wrapper is passed: both checks resolve false', async () => {
        const { KINDS, build } = requireApi();
        let table;
        expect(() => { table = build({}); }, 'building the table').not.toThrow();

        expect(await outcomeOf(table[KINDS.CLIPBOARD]), 'CLIPBOARD').toEqual({ value: false });
        expect(await outcomeOf(table[KINDS.NOTIFICATION]), 'NOTIFICATION').toEqual({ value: false });
    });
});

describe('3 - every kind PERMISSION_INTENT_PERMISSIONS names has a check', () => {
    it('PERMISSION_KINDS holds two distinct kinds, and every kind PERMISSION_INTENT_PERMISSIONS names is one of them', () => {
        const { KINDS } = requireApi();
        expect(new Set([KINDS.CLIPBOARD, KINDS.NOTIFICATION]).size, 'CLIPBOARD and NOTIFICATION are distinct values').toBe(2);
        for (const intentName of Object.values(StorageManager.PERMISSION_INTENTS)) {
            expect(Object.values(KINDS), 'kind of ' + intentName).toContain(StorageManager.PERMISSION_INTENT_PERMISSIONS[intentName]);
        }
    });

    it('the built table has a check for every value of PERMISSION_KINDS and for nothing else', () => {
        const { KINDS, build } = requireApi();
        const table = build({ clipboardPermission: clipboardAnswering(true), notificationPermission: notificationAnswering(true) });

        expect(Object.keys(table).sort(), 'table keys').toEqual(Object.values(KINDS).sort());
        for (const kind of Object.values(KINDS)) expect(typeof table[kind], 'check for kind ' + kind).toBe('function');
    });

    it.each([
        [true, false],
        [false, true],
    ])('clipboard granted %s, notifications granted %s: each intent check, looked up through PERMISSION_INTENT_PERMISSIONS, resolves to the answer of the wrapper that intent needs', async (isClipboardGranted, isNotificationGranted) => {
        const { build } = requireApi();
        const table = build({ clipboardPermission: clipboardAnswering(isClipboardGranted), notificationPermission: notificationAnswering(isNotificationGranted) });
        const expected = { [INTENTS.reply]: isClipboardGranted, [INTENTS.code]: isClipboardGranted, [INTENTS.notification]: isNotificationGranted };

        for (const [intentName, isGranted] of Object.entries(expected)) {
            const check = table[StorageManager.PERMISSION_INTENT_PERMISSIONS[intentName]];
            expect(typeof check, 'the table has a check for the kind of ' + intentName).toBe('function');
            expect(await outcomeOf(check), 'check for ' + intentName).toEqual({ value: isGranted });
        }
    });
});
