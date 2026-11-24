/**
 * background/service-worker.js - the message routes the worker installs at top level are live, and its own onMessage listener never holds a sender's channel it does not answer.
 *
 * Requirements (docs/ARCHITECTURE.md "Settings Message Route", "Editor Window Message Route", "Reply Notification Message Route", "Clipboard Write Message Route"; docs/spec/04-features.md §21):
 *   A. A freshly booted worker answers each route it installs at top level: DSS_SET_SETTINGS / DSS_GET_SETTINGS round-trip a local value and reply { ok: true }; DSS_CLOSE_EDITOR_WINDOWS replies { ok: true }; DSS_SHOW_NOTIFICATION with string title and body shows one notification through chrome.notifications.create and replies { ok: true }; DSS_COPY_TO_CLIPBOARD without the optional offscreen permission (chrome.offscreen absent) replies { ok: false, error }.
 *   B. Chrome keeps a sender waiting for a reply only while some onMessage listener returned true. A message type no route handles, and DSS_SCHEDULE_DELETE_RETRY (which only arms the retry alarm and sends no reply), must leave no listener holding the channel, so the sender settles at once.
 *
 * Harness: test/helpers/unload-grace-harness.js boots the REAL service worker in a fresh vm context (classic script, its own importScripts runs every requested file in the same context) inside each test body; only trust boundaries are faked (chrome.*, fetch, console, worker timers).
 */
import { describe, it, expect, vi } from 'vitest';
import { createWorld, sendToWorker, settle, temp, ORIGIN, chatUrl, retryAlarm } from '../helpers/unload-grace-harness.js';

const EXTENSION_ID = 'test-extension-id';
const U = '5c2e8a1f-3b7d-4c9e-8f1a-2d3c4b5a6e7f'; // 交接給 worker 的臨時對話

/** 依 Chrome 的方式派送訊息給 worker 的每個 onMessage 監聽器，回傳送達寄件端的回應，以及是否有監聽器回傳 true（Chrome 因此讓寄件端繼續等候回應）。 */
async function dispatchAndInspectChannel(world, message, senderUrl) {
    const responses = [];
    let isDispatching = true;
    let isChannelHeld = false;
    const sendResponse = (payload) => { if (isDispatching || isChannelHeld) responses.push(structuredClone(payload)); };
    const sender = { id: EXTENSION_ID, frameId: 0, url: senderUrl, tab: { id: 7, windowId: 1, url: senderUrl } };
    for (const listener of [...world.events.onMessage.listeners]) {
        if (listener(structuredClone(message), sender, sendResponse) === true) isChannelHeld = true;
    }
    isDispatching = false;
    await settle(world, 10);
    return { responses, isChannelHeld };
}

describe('A - the routes installed at top level answer their messages', () => {
    it('settings route: DSS_SET_SETTINGS then DSS_GET_SETTINGS round-trips a local value, both replying ok', async () => {
        const world = createWorld();
        const { SET_SETTINGS, GET_SETTINGS } = world.worker.DSS_SETTINGS_MSG;
        const key = 'dss-temporary-chat-enabled';

        const setReplies = await sendToWorker(world, { type: SET_SETTINGS, values: { [key]: true } }, ORIGIN + '/');
        const getReplies = await sendToWorker(world, { type: GET_SETTINGS, keys: [key] }, ORIGIN + '/');

        expect(setReplies, 'replies to DSS_SET_SETTINGS').toEqual([expect.objectContaining({ ok: true })]);
        expect(getReplies, 'replies to DSS_GET_SETTINGS').toEqual([{ ok: true, values: { [key]: true } }]);
        expect((await world.chrome.storage.local.get(key))[key], 'the value reached chrome.storage.local').toBe(true);
    });

    it('editor-window route: DSS_CLOSE_EDITOR_WINDOWS with no tracked window replies { ok: true }', async () => {
        const world = createWorld();
        const replies = await sendToWorker(world, { type: world.worker.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE }, ORIGIN + '/');
        expect(replies).toEqual([{ ok: true }]);
    });

    it('notification route: DSS_SHOW_NOTIFICATION shows one notification and replies { ok: true }', async () => {
        const world = createWorld();
        world.chrome.notifications = { create: vi.fn(async () => 'notification-1') };
        const replies = await sendToWorker(world, { type: world.worker.DSS_SHOW_NOTIFICATION, title: 'Reply ready', body: 'DeepSeek finished replying' }, ORIGIN + '/');
        expect(replies).toEqual([{ ok: true }]);
        expect(world.chrome.notifications.create, 'notifications shown').toHaveBeenCalledTimes(1);
    });

    it('clipboard route: DSS_COPY_TO_CLIPBOARD without chrome.offscreen replies { ok: false, error }', async () => {
        const world = createWorld();
        const replies = await sendToWorker(world, { type: world.worker.DSS_COPY_TO_CLIPBOARD, text: 'copied text' }, ORIGIN + '/');
        expect(replies).toEqual([{ ok: false, error: expect.any(String) }]);
    });
});

describe('B - the worker never holds a channel it does not answer', () => {
    it('a message type no route handles: no listener holds the channel and nothing replies', async () => {
        const world = createWorld();
        const { responses, isChannelHeld } = await dispatchAndInspectChannel(world, { type: 'DSS_TYPE_NO_ROUTE_HANDLES' }, ORIGIN + '/');
        expect(isChannelHeld, 'some onMessage listener returned true for a type nobody answers, so Chrome would keep the sender waiting').toBe(false);
        expect(responses).toEqual([]);
    });

    it('DSS_SCHEDULE_DELETE_RETRY arms the retry alarm for a queued entry and leaves no listener holding the channel', async () => {
        const world = createWorld();
        const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
        await world.chrome.storage.sync.set({ [key]: [{ chatUuid: U, attemptCount: 0, lastActiveAt: world.clock.now() }] });
        await settle(world);
        await world.chrome.alarms.clear(world.worker.RETRY_ALARM_NAME);
        expect(retryAlarm(world), 'precondition: no retry alarm before the message').toBeUndefined();

        const { isChannelHeld } = await dispatchAndInspectChannel(world, { type: temp(world).DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE }, chatUrl(U));

        expect(retryAlarm(world), 'the retry alarm is armed after DSS_SCHEDULE_DELETE_RETRY').toBeDefined();
        expect(isChannelHeld, 'DSS_SCHEDULE_DELETE_RETRY sends no reply, so no listener may keep the sender waiting').toBe(false);
    });
});
