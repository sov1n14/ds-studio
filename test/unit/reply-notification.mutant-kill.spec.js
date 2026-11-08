// @vitest-environment jsdom
/**
 * content/reply-notification.js — targeted tests for behaviors test/unit/reply-notification.scenario.spec.js leaves unpinned (surviving Stryker mutants).
 *
 * Requirements asserted:
 *   A. "Not in the foreground" is visibilityState !== 'visible' || !hasFocus(): a hidden tab notifies even when document.hasFocus() answers true.
 *   B. Only a synchronous throw or a promise rejection of sendMessage is a failure: a sendMessage that returns undefined (callback-only form) or a truthy non-promise value is not an error, logs nothing, and later replies still notify.
 *   C. One reply, one notification, however the gate has moved: after on -> off -> on, and with a duplicate start() registration, each reply sends exactly one message, none while off, and nothing is logged as an error.
 *   D. A failure while processing a mutation batch (a host-page API that throws) is logged with a "[DSS] reply-notification" prefix and the error, escapes nowhere, and the next reply still notifies.
 *   E. Node fallback: with DSSFeatureToggle absent from the globals and a module system present, content/feature-toggle.js is taken from require() and the feature works.
 *
 * Mocked: only the trust boundaries (chrome.runtime, document.visibilityState / hidden, document.hasFocus) through test/helpers/reply-notification-harness.js; every module is loaded inside the test body so each test runs its own evaluation.
 */
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { broadcast, changes } from '../helpers/auto-click-harness.js';
import {
    MASTER_KEY, OWN_KEY, MODULE_FILE, settings, notifications, setNotificationMode, installBoundary,
    setForeground, resetForeground, HIDDEN, VISIBLE_UNFOCUSED, FOREGROUND, expectedNotification,
    captureUncaught, captureDssLogs, loadReplyNotification, loadDependencies, dependencyGlobals, loadModuleSource,
    requestedKeys, mountPage, awaitingItem, flush, completeNewReply,
} from '../helpers/reply-notification-harness.js';

const HIDDEN_BUT_FOCUSED = { visibility: 'hidden', focused: true };

beforeEach(() => {
    document.body.innerHTML = '';
    installBoundary();
    setForeground(FOREGROUND);
});

afterEach(async () => {
    // Close the gate so this test's observers cannot act on the next test's page.
    broadcast(changes([MASTER_KEY, false, true]));
    await flush();
    vi.restoreAllMocks();
    resetForeground();
    document.body.innerHTML = '';
});

describe('A. foreground judgement', () => {
    it('tab hidden while document.hasFocus() answers true: the completed reply notifies', async () => {
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN_BUT_FOCUSED);

        await completeNewReply(list, awaitingItem(4, 'new'));

        expect(notifications()).toEqual([expectedNotification()]);
    });
});

describe('B. a sendMessage that returns no promise is not a failure', () => {
    it.each([
        ['returns undefined (callback-only form)', 'undefined'],
        ['returns a truthy non-promise value', 'non-thenable'],
    ])('sendMessage %s: nothing is logged, nothing escapes, and the next reply still notifies', async (_name, mode) => {
        const dssLogs = captureDssLogs();
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);
        setNotificationMode(mode);

        const uncaught = await captureUncaught(async () => {
            await completeNewReply(list, awaitingItem(4, 'first'));
            await completeNewReply(list, awaitingItem(6, 'second'));
        });

        expect(notifications(), 'both replies reached the boundary').toEqual([expectedNotification(), expectedNotification()]);
        expect(uncaught, 'uncaught rejections / errors').toEqual([]);
        expect(dssLogs(), 'console.error / console.warn calls starting with [DSS]').toEqual([]);
    });
});

/** GET_SETTINGS requests that asked for the own key (one per registerFeatureToggle registration). */
const ownKeyRegistrations = () => chrome.runtime.sendMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message?.type === globalThis.DSS_SETTINGS_MSG.GET_SETTINGS && (message.keys || []).includes(OWN_KEY))
    .length;

/** Complete one reply while the own toggle is off, then turn it on and complete another, asserting the message list after each step. */
async function offThenOn(list, before) {
    broadcast(changes([OWN_KEY, false, true]));
    await flush();
    await completeNewReply(list, awaitingItem(6, 'while-off'));
    expect(notifications(), 'turned off: the reply sends nothing').toEqual(before);

    broadcast(changes([OWN_KEY, true, false]));
    await flush();
    await completeNewReply(list, awaitingItem(8, 'after'));
    expect(notifications(), 'turned on again: exactly one more message').toEqual([...before, expectedNotification()]);
}

describe('C. one reply, one notification, however the gate has moved', () => {
    it('on -> off -> on: nothing while off, exactly one message for the reply after turning back on, nothing logged', async () => {
        const dssLogs = captureDssLogs();
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(HIDDEN);
        await completeNewReply(list, awaitingItem(4, 'first'));
        expect(notifications(), 'on').toEqual([expectedNotification()]);

        await offThenOn(list, [expectedNotification()]);

        expect(dssLogs(), '[DSS] logs').toEqual([]);
    });

    it('a duplicate start() registration while on: exactly one message per reply, nothing while off, one after turning back on, nothing logged', async () => {
        const dssLogs = captureDssLogs();
        const { list } = mountPage();
        await loadReplyNotification(settings());
        globalThis.DSstudio.ReplyNotification.start();
        await flush();
        expect(ownKeyRegistrations(), 'precondition: the module registered its toggle twice').toBe(2);
        setForeground(HIDDEN);

        await completeNewReply(list, awaitingItem(4, 'first'));
        expect(notifications(), 'on, registered twice').toEqual([expectedNotification()]);

        await offThenOn(list, [expectedNotification()]);

        expect(dssLogs(), '[DSS] logs').toEqual([]);
    });
});

describe('D. a failure while processing a mutation batch', () => {
    it('document.hasFocus() throws while a completed reply is judged: one [DSS] reply-notification log carrying the error, nothing escapes, and the next reply notifies', async () => {
        const dssLogs = captureDssLogs();
        const { list } = mountPage();
        await loadReplyNotification(settings());
        setForeground(VISIBLE_UNFOCUSED);
        const failing = awaitingItem(4, 'failing');
        list.appendChild(failing.item);
        await flush();
        // Break hasFocus only for the batch in which the reply completes, so the test holds whichever order the module checks count and foreground in.
        const failure = new Error('hasFocus failed');
        document.hasFocus.mockImplementationOnce(() => { throw failure; });

        const uncaught = await captureUncaught(async () => {
            failing.item.appendChild(failing.row);
            await flush();
        });
        expect(uncaught, 'uncaught rejections / errors').toEqual([]);
        expect(notifications(), 'the failing batch sent nothing').toEqual([]);
        const logs = dssLogs();
        expect(logs, '[DSS] logs').toHaveLength(1);
        expect(logs[0][0].startsWith('[DSS] reply-notification'), `log prefix: ${logs[0][0]}`).toBe(true);
        expect(logs[0][1]).toBe(failure);

        await completeNewReply(list, awaitingItem(6, 'control'));
        expect(notifications(), 'the feature keeps working after the failure').toEqual([expectedNotification()]);
    });
});

describe('E. Node require fallback', () => {
    const require = createRequire(MODULE_FILE);
    let savedFeatureToggle;

    beforeEach(() => {
        savedFeatureToggle = globalThis.DSSFeatureToggle;
    });

    afterEach(() => {
        // The natively required feature-toggle.js publishes itself on the real global; restore the fresh copy and drop the require cache.
        globalThis.DSSFeatureToggle = savedFeatureToggle;
        delete require.cache[require.resolve('./feature-toggle.js')];
    });

    it('DSSFeatureToggle absent from the globals, require available: feature-toggle.js is required, the own key is requested and a new reply notifies', async () => {
        const { list } = mountPage();
        await loadDependencies(settings());
        const globals = dependencyGlobals();
        globals.DSSFeatureToggle = undefined;
        delete require.cache[require.resolve('./feature-toggle.js')];

        loadModuleSource({ globals, require });
        await flush();
        expect(requestedKeys(), 'own key requested through GET_SETTINGS').toEqual(expect.arrayContaining([OWN_KEY]));
        setForeground(HIDDEN);
        await completeNewReply(list, awaitingItem(4, 'new'));

        expect(notifications()).toEqual([expectedNotification()]);
    });
});
