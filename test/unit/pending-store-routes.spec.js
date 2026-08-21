/**
 * background/pending-store-routes.js -- SW message routes for the
 * temporary-chat pending store.
 *
 * Contract under test (derived from the requirements; the implementation does
 * not exist yet and was NOT read):
 *  - install() registers exactly ONE chrome.runtime.onMessage listener.
 *  - It handles four message types by delegating to TemporaryChatPendingStore
 *    and answering {ok:true}; on a store rejection it answers
 *    {ok:false, error:<string containing the message>} and logs on the
 *    '[DSS]' console.error boundary.
 *  - It returns true (async sendResponse) for its own types and a non-true
 *    value for anything else, so the other onMessage routers keep working.
 *
 * Assertions go through OBSERVABLE STORE STATE (getPendingDeletes /
 * getOpenUuids / getLastAuthToken over the in-memory chrome.storage mock),
 * not through "was this collaborator called" -- the route is only correct if
 * the data actually landed. The rejection case is the one exception: it needs
 * a failure injected, so that single method is spied.
 *
 * Mechanics: the shared chrome mock callListeners() discards listener return
 * values, so the listener is captured off addListener at install time and
 * invoked directly wherever the return value is part of the contract.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import TemporaryChatPendingStore from '../../content/temporary-chat-pending-store.js';
import constants from '../../content/temporary-chat-constants.js';

/** Drain the setTimeout(0)-based storage mock and the route promise chains. */
const flush = async (ticks = 8) => {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
};

let listener;
let listenerCountAtInstall;

beforeAll(async () => {
    // The route file reads TemporaryChatPendingStore as a bare global (classic
    // service-worker script). Publish the REAL store before the module loads.
    globalThis.TemporaryChatPendingStore = TemporaryChatPendingStore;

    const captured = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener')
        .mockImplementation((fn) => { captured.push(fn); });

    // Dynamic import: a static import is hoisted above the global assignment.
    await import('../../background/pending-store-routes.js');
    globalThis.DSSPendingStoreRoutes.install();

    addSpy.mockRestore();
    listenerCountAtInstall = captured.length;
    listener = captured[0];
});

/** Invoke the route listener directly; returns its value and the response spy. */
async function send(message) {
    const sendResponse = vi.fn();
    const result = listener(message, { id: 'test-extension-id' }, sendResponse);
    await flush();
    return { result, sendResponse };
}

const firstResponse = (sendResponse) => sendResponse.mock.calls[0][0];

describe('background/pending-store-routes', () => {
    describe('message-type constants', () => {
        it('publishes the four route message types with their exact wire values', () => {
            expect(constants.DSS_MSG_TRACK_FOR_DELETION).toBe('DSS_TRACK_FOR_DELETION');
            expect(constants.DSS_MSG_REMOVE_PENDING_DELETE).toBe('DSS_REMOVE_PENDING_DELETE');
            expect(constants.DSS_MSG_REMOVE_OPEN_UUID).toBe('DSS_REMOVE_OPEN_UUID');
            expect(constants.DSS_MSG_SET_LAST_AUTH_TOKEN).toBe('DSS_SET_LAST_AUTH_TOKEN');
        });

        it('publishes them as bare globals too (Object.assign(globalThis, ...) pattern)', () => {
            expect(globalThis.DSS_MSG_TRACK_FOR_DELETION).toBe('DSS_TRACK_FOR_DELETION');
            expect(globalThis.DSS_MSG_REMOVE_PENDING_DELETE).toBe('DSS_REMOVE_PENDING_DELETE');
            expect(globalThis.DSS_MSG_REMOVE_OPEN_UUID).toBe('DSS_REMOVE_OPEN_UUID');
            expect(globalThis.DSS_MSG_SET_LAST_AUTH_TOKEN).toBe('DSS_SET_LAST_AUTH_TOKEN');
        });
    });

    describe('install()', () => {
        it('registers exactly one chrome.runtime.onMessage listener', () => {
            expect(listenerCountAtInstall).toBe(1);
            expect(typeof listener).toBe('function');
        });
    });

    describe('DSS_TRACK_FOR_DELETION', () => {
        it('puts the uuid in BOTH the pending queue and the open-set, and answers ok:true', async () => {
            const { result, sendResponse } = await send({
                type: constants.DSS_MSG_TRACK_FOR_DELETION,
                uuid: 'uuid-track',
            });

            expect(result).toBe(true);
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(firstResponse(sendResponse)).toEqual({ ok: true });

            const queue = await TemporaryChatPendingStore.getPendingDeletes();
            expect(queue.map((entry) => entry.chatUuid)).toContain('uuid-track');
            expect(await TemporaryChatPendingStore.getOpenUuids()).toContain('uuid-track');
        });
    });

    describe('DSS_REMOVE_PENDING_DELETE', () => {
        it('drops only the named uuid from the queue and answers ok:true', async () => {
            await TemporaryChatPendingStore.addPendingDelete('uuid-1');
            await TemporaryChatPendingStore.addPendingDelete('uuid-2');

            const { result, sendResponse } = await send({
                type: constants.DSS_MSG_REMOVE_PENDING_DELETE,
                uuid: 'uuid-1',
            });

            expect(result).toBe(true);
            expect(firstResponse(sendResponse)).toEqual({ ok: true });

            const uuids = (await TemporaryChatPendingStore.getPendingDeletes()).map((e) => e.chatUuid);
            expect(uuids).not.toContain('uuid-1');
            expect(uuids).toContain('uuid-2');
        });
    });

    describe('DSS_REMOVE_OPEN_UUID', () => {
        it('drops only the named uuid from the open-set and answers ok:true', async () => {
            await TemporaryChatPendingStore.addOpenUuid('uuid-a');
            await TemporaryChatPendingStore.addOpenUuid('uuid-b');

            const { result, sendResponse } = await send({
                type: constants.DSS_MSG_REMOVE_OPEN_UUID,
                uuid: 'uuid-a',
            });

            expect(result).toBe(true);
            expect(firstResponse(sendResponse)).toEqual({ ok: true });

            const openUuids = await TemporaryChatPendingStore.getOpenUuids();
            expect(openUuids).not.toContain('uuid-a');
            expect(openUuids).toContain('uuid-b');
        });
    });

    describe('DSS_SET_LAST_AUTH_TOKEN', () => {
        it('stores the token so getLastAuthToken resolves it, and answers ok:true', async () => {
            const { result, sendResponse } = await send({
                type: constants.DSS_MSG_SET_LAST_AUTH_TOKEN,
                token: 'Bearer route-tok',
            });

            expect(result).toBe(true);
            expect(firstResponse(sendResponse)).toEqual({ ok: true });
            expect(await TemporaryChatPendingStore.getLastAuthToken()).toBe('Bearer route-tok');
        });
    });
});

describe('background/pending-store-routes -- failure and non-consumption', () => {
    describe('store rejection', () => {
        let errorSpy;

        beforeEach(() => {
            errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('answers ok:false with the error message and logs on the [DSS] console.error boundary', async () => {
            vi.spyOn(TemporaryChatPendingStore, 'trackForDeletion')
                .mockRejectedValueOnce(new Error('store boom'));

            const { result, sendResponse } = await send({
                type: constants.DSS_MSG_TRACK_FOR_DELETION,
                uuid: 'uuid-boom',
            });

            expect(result).toBe(true);
            expect(sendResponse).toHaveBeenCalledTimes(1);
            const response = firstResponse(sendResponse);
            expect(response.ok).toBe(false);
            expect(String(response.error)).toContain('store boom');

            expect(errorSpy).toHaveBeenCalled();
            const logged = errorSpy.mock.calls.flat().map(String).join(' ');
            expect(logged).toContain('[DSS]');
            expect(logged).toContain('store boom');
        });

        it('catches a rejection on the token route too, never leaving it unhandled', async () => {
            vi.spyOn(TemporaryChatPendingStore, 'setLastAuthToken')
                .mockRejectedValueOnce(new Error('token boom'));

            const { sendResponse } = await send({
                type: constants.DSS_MSG_SET_LAST_AUTH_TOKEN,
                token: 'Bearer x',
            });

            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(firstResponse(sendResponse).ok).toBe(false);
            expect(String(firstResponse(sendResponse).error)).toContain('token boom');
        });
    });

    describe('foreign message types', () => {
        it.each([
            ['DSS_GET_SETTINGS'],
            ['DSS_SCHEDULE_DELETE_RETRY'],
        ])('does not consume %s: returns a non-true value and never responds', async (type) => {
            const { result, sendResponse } = await send({ type, keys: ['dsHideThinking'] });

            expect(result).not.toBe(true);
            expect(sendResponse).not.toHaveBeenCalled();
        });
    });
});
