// @vitest-environment jsdom
/**
 * content/reply-notification.js — desktop notification when a reply completes while the tab is not in the foreground (red phase: the module does not exist yet).
 *
 * Requirement (user request, verbatim): "(a) When a new quick status bar appears, the browser sends a notification indicating that the reply is complete." Decisions: D-06 notify only when the tab is not in the foreground; D-07 a stopped or aborted reply gets no notification; U6-10 "not in the foreground" means document.visibilityState !== 'visible' || !document.hasFocus(), and the toggle key is isReplyNotificationEnabled.
 *
 * Contract under test:
 *   - Gate (content/feature-toggle.js): master "isEnabled" ON && "isReplyNotificationEnabled" true; initial values via DSS_GET_SETTINGS, changes via DSS_SETTINGS_CHANGED.
 *   - A completed reply is a toolbar returned by DSstudio.ReplyCompletion.newToolbarsFromRecords for a mutation batch; a toolbar for which isStoppedReply is true does not count.
 *   - For each completed reply while the tab is not in the foreground (judged when the reply completes, not when the module loads): chrome.runtime.sendMessage receives exactly { type: DSS_SHOW_NOTIFICATION, title: dsI18n.t('replyNotificationTitle'), body: dsI18n.t('replyNotificationBody') }.
 *   - A failing sendMessage (promise rejection, callback lastError, synchronous throw) never escapes as an uncaught error, is logged with a "[DSS]" prefix, and the feature keeps working.
 *   - Loading the file starts the module (manifest entry point) and publishes it through module.exports and window.DSstudio.ReplyNotification; a missing dependency makes loading throw an Error naming the missing file.
 *
 * Mocked: only the trust boundaries (chrome.runtime, document.visibilityState / hidden, document.hasFocus); feature-toggle, reply-completion, ds-selectors and dsI18n are the real modules sharing real state (test/helpers/reply-notification-harness.js). Every negative scenario carries a positive control in the same test, so "no message" cannot pass because the module never ran.
 */
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { broadcast, changes } from '../helpers/auto-click-harness.js';
import {
    MASTER_KEY, OWN_KEY, MODULE_FILE, settings, notifications, setNotificationMode, installBoundary,
    setForeground, resetForeground, HIDDEN, VISIBLE_UNFOCUSED, FOREGROUND, expectedNotification,
    captureUncaught, captureDssLogs, loadReplyNotification, loadDependencies, dependencyGlobals, loadModuleSource,
    requestedKeys, mountPage, awaitingItem, completeItem, makeStopped, flush, completeNewReply,
} from '../helpers/reply-notification-harness.js';

const MISSING = {
    featureToggle: 'content/reply-notification.js 需要 content/feature-toggle.js 先行載入',
    replyCompletion: 'content/reply-notification.js 需要 content/reply-completion.js 先行載入',
    keys: 'content/reply-notification.js 需要 utils/storage-manager.keys.js 先行載入',
};

beforeEach(() => {
    document.body.innerHTML = '';
    installBoundary();
    setForeground(FOREGROUND);
});

afterEach(async () => {
    // Close the gate so this test's observer cannot act on the next test's page.
    broadcast(changes([MASTER_KEY, false, true]));
    await flush();
    vi.restoreAllMocks();
    resetForeground();
    document.body.innerHTML = '';
});

describe('fixture self-checks', () => {
    it('setForeground drives document.visibilityState, document.hidden and document.hasFocus()', () => {
        setForeground(HIDDEN);
        expect([document.visibilityState, document.hidden, document.hasFocus()]).toEqual(['hidden', true, false]);
        setForeground(VISIBLE_UNFOCUSED);
        expect([document.visibilityState, document.hidden, document.hasFocus()]).toEqual(['visible', false, false]);
        setForeground(FOREGROUND);
        expect([document.visibilityState, document.hidden, document.hasFocus()]).toEqual(['visible', false, true]);
    });
});

describe('locale strings', () => {
    it.each(['zh_TW', 'en'])('%s defines replyNotificationTitle and replyNotificationBody as non-empty strings (the notification never shows a raw key)', (locale) => {
        const data = globalThis.__DS_I18N_Locales[locale];
        expect(data.replyNotificationTitle, locale + ' replyNotificationTitle').toEqual(expect.any(String));
        expect(data.replyNotificationTitle.length).toBeGreaterThan(0);
        expect(data.replyNotificationBody, locale + ' replyNotificationBody').toEqual(expect.any(String));
        expect(data.replyNotificationBody.length).toBeGreaterThan(0);
    });
});

describe('initial settings request', () => {
    it('requests the master key and the own key through GET_SETTINGS', async () => {
        mountPage();
        await loadReplyNotification(settings());

        expect(requestedKeys()).toEqual(expect.arrayContaining([MASTER_KEY, OWN_KEY]));
    });
});

describe('a new reply completes: notify only when the tab is not in the foreground (D-06, U6-10)', () => {
    it('tab hidden when the reply completes (foreground at load): exactly one DSS_SHOW_NOTIFICATION with the i18n title and body', async () => {
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);

        await completeNewReply(list, awaitingItem(4, 'new'));

        expect(notifications()).toEqual([expectedNotification()]);
    });

    it('tab visible but the window not focused (hasFocus() false): exactly one notification', async () => {
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(VISIBLE_UNFOCUSED);

        await completeNewReply(list, awaitingItem(4, 'new'));

        expect(notifications()).toEqual([expectedNotification()]);
    });

    it('tab visible and focused when the reply completes (hidden at load): no notification; a later reply after the tab is hidden notifies', async () => {
        setForeground(HIDDEN);
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(FOREGROUND);

        await completeNewReply(list, awaitingItem(4, 'seen'));
        expect(notifications(), 'reply completed in the foreground').toEqual([]);

        setForeground(HIDDEN);
        await completeNewReply(list, awaitingItem(6, 'control'));
        expect(notifications(), 'positive control: a later reply in the background').toEqual([expectedNotification()]);
    });

    it('two replies completing in separate batches: two notifications', async () => {
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);

        await completeNewReply(list, awaitingItem(4, 'first'));
        await completeNewReply(list, awaitingItem(6, 'second'));

        expect(notifications()).toEqual([expectedNotification(), expectedNotification()]);
    });

    it('a reply notifies once: later mutations inside the completed reply send nothing more', async () => {
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);
        const fresh = awaitingItem(4, 'new');
        await completeNewReply(list, fresh);
        expect(notifications(), 'precondition: the completed reply notified').toEqual([expectedNotification()]);

        const paragraph = document.createElement('p');
        paragraph.textContent = 'late text';
        fresh.item.querySelector('.ds-markdown').appendChild(paragraph);
        await flush();

        expect(notifications()).toEqual([expectedNotification()]);
    });
});

describe('toolbars that are not a newly completed reply never notify', () => {
    it('old messages already on the page when the module loads in a hidden tab: no notification', async () => {
        setForeground(HIDDEN);
        const { list, old } = mountPage();
        expect(old.item.contains(old.toolbar), 'precondition: the old item holds its toolbar').toBe(true);

        await loadReplyNotification(settings());
        expect(notifications(), 'after load').toEqual([]);

        await completeNewReply(list, awaitingItem(4, 'control'));
        expect(notifications(), 'positive control: a later new reply').toEqual([expectedNotification()]);
    });

    it('stopped reply (D-07: toolbar arrives with the continue button in its own row): no notification', async () => {
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);
        const stopped = awaitingItem(4, 'stopped');
        makeStopped(stopped.row, 'stopped');

        await completeNewReply(list, stopped);
        expect(notifications(), 'stopped reply').toEqual([]);

        await completeNewReply(list, awaitingItem(6, 'control'));
        expect(notifications(), 'positive control: a later normal reply').toEqual([expectedNotification()]);
    });

    it('scroll re-mount: an item scrolled out and back in with its toolbar inside does not notify', async () => {
        const { list, old } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);

        old.item.remove();
        await flush();
        list.appendChild(completeItem(2, 'remounted').item);
        await flush();
        expect(notifications(), 'scroll re-mount').toEqual([]);

        await completeNewReply(list, awaitingItem(4, 'control'));
        expect(notifications(), 'positive control: a later new reply').toEqual([expectedNotification()]);
    });

    it('re-mount in one batch: an item added and its toolbar row appended into it before the observer runs does not notify', async () => {
        const { list, old } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);

        old.item.remove();
        await flush();
        const remounted = awaitingItem(2, 'remounted');
        list.appendChild(remounted.item);
        remounted.item.appendChild(remounted.row);
        await flush();
        expect(notifications(), 'same-batch re-mount').toEqual([]);

        await completeNewReply(list, awaitingItem(4, 'control'));
        expect(notifications(), 'positive control: a later new reply').toEqual([expectedNotification()]);
    });
});

describe('gating (master switch && isReplyNotificationEnabled)', () => {
    it('own toggle off: no notification; turning it on afterwards notifies the next new reply', async () => {
        const { list } = mountPage();
        await loadReplyNotification(settings({ own: false }));
        setForeground(HIDDEN);

        await completeNewReply(list, awaitingItem(4, 'first'));
        expect(notifications(), 'own toggle off').toEqual([]);

        broadcast(changes([OWN_KEY, true, false]));
        await flush();
        await completeNewReply(list, awaitingItem(6, 'control'));
        expect(notifications(), 'positive control: own toggle turned on').toEqual([expectedNotification()]);
    });

    it('master switch off with the own toggle on: no notification; master on afterwards notifies the next new reply', async () => {
        const { list } = mountPage();
        await loadReplyNotification(settings({ master: false }));
        setForeground(HIDDEN);

        await completeNewReply(list, awaitingItem(4, 'first'));
        expect(notifications(), 'master off').toEqual([]);

        broadcast(changes([MASTER_KEY, true, false]));
        await flush();
        await completeNewReply(list, awaitingItem(6, 'control'));
        expect(notifications(), 'positive control: master on').toEqual([expectedNotification()]);
    });

    it.each([
        ['own toggle turned off', [OWN_KEY, false, true]],
        ['master switch turned off', [MASTER_KEY, false, true]],
    ])('%s after being on: the next new reply does not notify', async (_name, change) => {
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);
        await completeNewReply(list, awaitingItem(4, 'first'));
        expect(notifications(), 'precondition: the first reply notified while on').toEqual([expectedNotification()]);

        broadcast(changes(change));
        await flush();
        await completeNewReply(list, awaitingItem(6, 'later'));

        expect(notifications(), 'after turning off').toEqual([expectedNotification()]);
    });
});

describe('a failing sendMessage does not break the feature', () => {
    it.each([
        ['rejects (promise form) / reports lastError (callback form)', 'reject'],
        ['throws synchronously', 'throw'],
    ])('sendMessage %s: nothing escapes uncaught, a [DSS] log is written, and the next reply still notifies', async (_name, mode) => {
        const dssLogs = captureDssLogs();
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);
        setNotificationMode(mode);

        const uncaught = await captureUncaught(() => completeNewReply(list, awaitingItem(4, 'failing')));
        expect(notifications(), 'the failing attempt reached the boundary').toEqual([expectedNotification()]);
        expect(uncaught, 'uncaught rejections / errors').toEqual([]);
        expect(dssLogs().length, 'console.error / console.warn calls starting with [DSS]').toBeGreaterThan(0);

        setNotificationMode('ok');
        await completeNewReply(list, awaitingItem(6, 'control'));
        expect(notifications(), 'the feature keeps working after the failure').toEqual([expectedNotification(), expectedNotification()]);
    });
});

describe('loading content/reply-notification.js', () => {
    it('starts the module: with no module system and the toggle on, a new reply after load notifies without calling start()', async () => {
        const { list } = mountPage();
        await loadDependencies(settings());
        loadModuleSource();
        await flush();
        setForeground(HIDDEN);

        await completeNewReply(list, awaitingItem(4, 'new'));

        expect(notifications()).toEqual([expectedNotification()]);
    });

    describe('exports', () => {
        beforeEach(async () => {
            mountPage();
            await loadDependencies(settings({ own: false }));
        });

        it('CommonJS without window: module.exports is the module object (has start)', () => {
            const module = { exports: {} };

            loadModuleSource({ window: undefined, module, require: createRequire(MODULE_FILE) });

            expect(module.exports.start).toBeTypeOf('function');
        });

        it('window with an existing DSstudio: DSstudio.ReplyNotification is the exported object and the existing members survive', () => {
            const module = { exports: {} };
            const existing = { marker: true };
            const globals = dependencyGlobals();
            globals.DSstudio.Existing = existing;

            loadModuleSource({ globals, module });

            expect(globals.DSstudio.ReplyNotification).toBe(module.exports);
            expect(globals.DSstudio.ReplyNotification.start).toBeTypeOf('function');
            expect(globals.DSstudio.Existing).toBe(existing);
        });
    });

    describe('a missing dependency fails loading with an Error naming it', () => {
        beforeEach(async () => {
            mountPage();
            await loadDependencies(settings({ own: false }));
        });

        it.each([
            ['DSSFeatureToggle absent, no require', (g) => { g.DSSFeatureToggle = undefined; }, MISSING.featureToggle],
            ['DSstudio.ReplyCompletion absent', (g) => { delete g.DSstudio.ReplyCompletion; }, MISSING.replyCompletion],
            ['DSstudio absent entirely, no require', (g) => { g.DSstudio = undefined; }, MISSING.replyCompletion],
            ['__DS_StorageManager_keys absent', (g) => { g.__DS_StorageManager_keys = undefined; }, MISSING.keys],
        ])('%s', (_name, remove, message) => {
            const globals = dependencyGlobals();
            remove(globals);

            let error = null;
            try {
                loadModuleSource({ globals });
            } catch (e) {
                error = e;
            }

            expect(error, 'loading must fail').toBeInstanceOf(Error);
            expect(error, 'not a TypeError: ' + error?.message).not.toBeInstanceOf(TypeError);
            expect(error.message).toBe(message);
        });
    });
});
