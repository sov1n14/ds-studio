/**
 * Scenario: extension context invalidated while a temporary chat is tracked.
 *
 * Requirements (user-approved):
 *   1. Clicking the invalidation toast's reload link must NOT delete the tracked temporary chat,
 *      even when no `navigate` event precedes `beforeunload`.
 *   2. A browser reload (navigate event, navigationType 'reload', same URL) after invalidation
 *      must NOT delete the tracked temporary chat.
 *   3. Guards: after invalidation, navigating to another chat / homepage must not run the
 *      in-navigate delete; F5 does not delete.
 *   4. Closing the tab after invalidation deletes nothing from the page and keeps the tracking:
 *      unload never deletes from the page (the service worker decides after a grace period), and
 *      the queued conversation stays for the service worker's own sweep. No exception escapes.
 *
 * Real module instances: temporary-chat-delete family (preloaded in vitest.setup.js),
 * content/temporary-chat-delete-api.js, utils/deepseek-api.js, content/invalidation-toast.js.
 * Trust boundaries mocked: fetch, chrome.runtime, window.navigation, location.reload.
 * Events are dispatched on window/document/navigation so the real listener wiring is exercised.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import '../../utils/deepseek-api.js';
import TemporaryChatDeleteApi from '../../content/temporary-chat-delete-api.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

globalThis.TemporaryChatDeleteApi = TemporaryChatDeleteApi;

const TEMP_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER_UUID = 'bbbbbbbb-1111-2222-3333-444444444444';
const ORIGIN = 'https://chat.deepseek.com';
const chatUrl = (uuid) => `${ORIGIN}/a/chat/s/${uuid}`;
const UUID_KEY = () => globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY;
const FIBER_TYPE = () => globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE;

let fetchMock;
let postMessageSpy;
let reloadSpy;

function deleteFetchCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('/chat_session/delete'));
}

function fiberDeleteMessages() {
    return postMessageSpy.mock.calls.filter(([msg]) => msg?.type === FIBER_TYPE());
}

function dispatchNavigate(destinationUrl, navigationType) {
    const event = Object.assign(new Event('navigate'), {
        destination: { url: destinationUrl },
        navigationType,
    });
    window.navigation.dispatchEvent(event);
}

function dispatchBeforeUnload() {
    window.dispatchEvent(new Event('beforeunload'));
}

function invalidateContext() {
    chrome.runtime.id = undefined;
    chrome.runtime.sendMessage = vi.fn(() => {
        throw new Error('Extension context invalidated.');
    });
}

/** Tracked temporary chat open at /a/chat/s/<TEMP_UUID>, auth token captured, listeners live. */
function arrangeTrackedTempChat() {
    setPathname(`/a/chat/s/${TEMP_UUID}`);
    sessionStorage.setItem(UUID_KEY(), TEMP_UUID);
    Object.assign(TemporaryChatDelete.state, {
        capturedAuthToken: 'Bearer test-token',
        trackedTemporaryUuid: TEMP_UUID,
        createdSessionIds: new Set(),
        sentSessionIds: new Set(),
        enabledFirstSendIds: new Set(),
        pendingTemporaryUuid: null,
        suppressNextUnloadDelete: false,
        isKeyboardRefresh: false,
    });
    globalThis.TemporaryChatEnabledFlag.__setCache(true);
    TemporaryChatDelete.attachListeners();
}

describe('temporary-chat-delete — reload after extension-context invalidation', () => {
    beforeEach(() => {
        TemporaryChatDelete.detachListeners();
        sessionStorage.clear();
        document.body.innerHTML = '';
        chrome.runtime.id = 'test-extension-id';
        window.navigation = new EventTarget();
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
        globalThis.fetch = fetchMock;
        postMessageSpy = vi.spyOn(window, 'postMessage');
        reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        arrangeTrackedTempChat();
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
        vi.restoreAllMocks();
        delete window.navigation;
        sessionStorage.clear();
        document.body.innerHTML = '';
        setPathname('/');
        chrome.runtime.id = 'test-extension-id';
        chrome.runtime.sendMessage = vi.fn();
    });

    it('B1: clicking the invalidation toast reload link, then beforeunload (no navigate event) → no delete fetch, UUID stays tracked', async () => {
        vi.resetModules();
        await import('../../content/invalidation-toast.js');
        invalidateContext();

        globalThis.DSSInvalidationToast.show();
        const link = document.querySelector('.ds-invalidation-toast a');
        expect(link, 'invalidation toast must render a reload link').not.toBeNull();
        link.click();
        expect(reloadSpy, 'toast link must trigger location.reload()').toHaveBeenCalledTimes(1);

        dispatchBeforeUnload();

        expect(deleteFetchCalls(), 'toast-initiated reload must not send a delete request').toHaveLength(0);
        expect(fiberDeleteMessages()).toHaveLength(0);
        expect(sessionStorage.getItem(UUID_KEY())).toBe(TEMP_UUID);
    });

    it('B2: browser reload (navigate reload, same URL) after invalidation, then beforeunload → no delete fetch, UUID stays tracked', () => {
        invalidateContext();

        dispatchNavigate(chatUrl(TEMP_UUID), 'reload');
        dispatchBeforeUnload();

        expect(deleteFetchCalls(), 'browser reload must not send a delete request').toHaveLength(0);
        expect(fiberDeleteMessages()).toHaveLength(0);
        expect(sessionStorage.getItem(UUID_KEY())).toBe(TEMP_UUID);
    });

    it.each([
        ['another chat', chatUrl(OTHER_UUID)],
        ['homepage', `${ORIGIN}/`],
    ])('G1: navigate push to %s after invalidation → in-navigate delete path does not run', (_label, dest) => {
        invalidateContext();

        dispatchNavigate(dest, 'push');

        expect(deleteFetchCalls()).toHaveLength(0);
        expect(fiberDeleteMessages()).toHaveLength(0);
        expect(sessionStorage.getItem(UUID_KEY())).toBe(TEMP_UUID);
    });

    it('G1-control: with a VALID context the same navigate push to another chat does run a delete (proves G1 observes the navigate wiring)', () => {
        dispatchNavigate(chatUrl(OTHER_UUID), 'push');

        const deleteSignals = deleteFetchCalls().length + fiberDeleteMessages().length;
        expect(deleteSignals, 'valid-context departure must dispatch a delete').toBeGreaterThan(0);
        expect(sessionStorage.getItem(UUID_KEY())).toBeNull();
    });

    it('G2: closing the tab after invalidation (beforeunload, no reload signal) deletes nothing from the page, keeps the UUID tracked and throws nothing', () => {
        invalidateContext();
        const listenerErrors = [];
        const onError = (event) => { listenerErrors.push(event.error ?? event.message); };
        window.addEventListener('error', onError);

        try {
            dispatchBeforeUnload();
        } finally {
            window.removeEventListener('error', onError);
        }

        expect(deleteFetchCalls(), 'unload must never delete from the page, also after invalidation').toHaveLength(0);
        expect(fiberDeleteMessages()).toHaveLength(0);
        expect(sessionStorage.getItem(UUID_KEY()), 'the tracking must survive the unload').toBe(TEMP_UUID);
        expect(listenerErrors, 'the invalidated runtime must not make the beforeunload listener throw').toEqual([]);
    });

    it('G3: F5 after invalidation (keydown F5, navigate reload, beforeunload) → no delete fetch, UUID stays tracked', () => {
        invalidateContext();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
        dispatchNavigate(chatUrl(TEMP_UUID), 'reload');
        dispatchBeforeUnload();

        expect(deleteFetchCalls()).toHaveLength(0);
        expect(fiberDeleteMessages()).toHaveLength(0);
        expect(sessionStorage.getItem(UUID_KEY())).toBe(TEMP_UUID);
    });
});
