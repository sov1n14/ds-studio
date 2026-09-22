/**
 * Targeted mutant-killer tests for the temporary-chat-delete module family.
 * Files covered: temporary-chat-delete.js, temporary-chat-delete.coordinator.js,
 * temporary-chat-delete.tracking.js, temporary-chat-delete.handlers.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';

global.TemporaryChatDeleteApi = {
    deleteChatSession: vi.fn().mockResolvedValue(true),
    deleteChatSessionWithRetry: vi.fn().mockResolvedValue(false),
    showDeleteFailedToast: vi.fn(),
};
global.TemporaryChatPendingStore = makePendingStoreMock();

import '../../utils/temporary-chat-constants.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

const UUID_A = 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0001';
const UUID_B = 'bbbb2222-cccc-dddd-eeee-ffffffffffff';
const UUID_KEY = globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY;
const MSG = () => globalThis.DSS_SETTINGS_MSG;
let settingsStore = {};

function installSettingsRoute() {
    chrome.runtime.sendMessage = vi.fn(async (message) => {
        if (message?.type === MSG().GET_SETTINGS) {
            const values = {};
            (message.keys || []).forEach((key) => {
                if (key in settingsStore) values[key] = settingsStore[key];
            });
            return { ok: true, values };
        }
        if (message?.type === MSG().SET_SETTINGS) {
            Object.assign(settingsStore, message.values);
            return { ok: true };
        }
        return { ok: true, values: {} };
    });
}

function resetState() {
    Object.assign(TemporaryChatDelete.state, {
        capturedAuthToken: null,
        trackedTemporaryUuid: null,
        createDetected: false,
        isCompletionDetected: false,
        isPendingCreate: false,
        coOccurrenceTimer: null,
        suppressNextUnloadDelete: false,
        isKeyboardRefresh: false,
        isListening: false,
    });
    globalThis.TemporaryChatEnabledFlag.__setCache(false);
}

function makeNav(destinationUrl, navigationType = 'push') {
    return { destination: { url: destinationUrl }, navigationType };
}

function chatUrl(uuid) {
    return 'https://chat.deepseek.com/a/chat/s/' + uuid;
}

beforeEach(() => {
    resetState();
    sessionStorage.clear();
    settingsStore = {};
    installSettingsRoute();
    setPathname('/');
    global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
    global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValue(true);
    global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
    global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockResolvedValue(false);
});

afterEach(() => {
    TemporaryChatDelete.detachListeners();
    vi.restoreAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
    setPathname('/');
});

// ═══════════════════════════════════════════════════════════════════════════
// TRACKING.JS MUTANT KILLERS
// ═══════════════════════════════════════════════════════════════════════════

describe('tracking — createState default values', () => {
    it('every field returns its documented default', () => {
        const state = globalThis.__DSS_TempChatDelete_tracking.createState();
        expect(state.capturedAuthToken).toBeNull();
        expect(state.trackedTemporaryUuid).toBeNull();
        expect(state.createDetected).toBe(false);
        expect(state.isCompletionDetected).toBe(false);
        expect(state.isPendingCreate).toBe(false);
        expect(state.coOccurrenceTimer).toBeNull();
        expect(state.suppressNextUnloadDelete).toBe(false);
        expect(state.isKeyboardRefresh).toBe(false);
        expect(state.isListening).toBe(false);
    });
});

describe('tracking — create() validation', () => {
    it('throws when state is null', () => {
        expect(() => globalThis.__DSS_TempChatDelete_tracking.create(null))
            .toThrow('requires the shared state object');
    });

    it('throws when state is undefined', () => {
        expect(() => globalThis.__DSS_TempChatDelete_tracking.create(undefined))
            .toThrow('requires the shared state object');
    });
});

describe('tracking — loadTrackedUuid edge cases', () => {
    afterEach(() => sessionStorage.clear());

    it('returns null for empty string in sessionStorage', () => {
        sessionStorage.setItem(UUID_KEY, '');
        expect(TemporaryChatDelete.loadTrackedUuid()).toBeNull();
    });

    it('returns stored value for real uuid', () => {
        sessionStorage.setItem(UUID_KEY, UUID_A);
        expect(TemporaryChatDelete.loadTrackedUuid()).toBe(UUID_A);
    });

    it('returns null when sessionStorage throws', () => {
        const orig = sessionStorage.getItem;
        sessionStorage.getItem = () => { throw new Error('SecurityError'); };
        expect(TemporaryChatDelete.loadTrackedUuid()).toBeNull();
        sessionStorage.getItem = orig;
    });
});

describe('tracking — saveTrackedUuid set vs remove', () => {
    afterEach(() => sessionStorage.clear());

    it('calls setItem for truthy uuid', () => {
        const setSpy = vi.spyOn(sessionStorage, 'setItem');
        const rmSpy = vi.spyOn(sessionStorage, 'removeItem');
        TemporaryChatDelete.saveTrackedUuid(UUID_A);
        expect(setSpy).toHaveBeenCalledWith(UUID_KEY, UUID_A);
        expect(rmSpy).not.toHaveBeenCalled();
    });

    it('calls removeItem for null uuid', () => {
        sessionStorage.setItem(UUID_KEY, UUID_A);
        const setSpy = vi.spyOn(sessionStorage, 'setItem');
        const rmSpy = vi.spyOn(sessionStorage, 'removeItem');
        TemporaryChatDelete.saveTrackedUuid(null);
        expect(rmSpy).toHaveBeenCalledWith(UUID_KEY);
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('calls removeItem for empty string (falsy)', () => {
        const rmSpy = vi.spyOn(sessionStorage, 'removeItem');
        TemporaryChatDelete.saveTrackedUuid('');
        expect(rmSpy).toHaveBeenCalledWith(UUID_KEY);
    });

    it('does not throw when setItem throws', () => {
        const orig = sessionStorage.setItem;
        sessionStorage.setItem = () => { throw new Error('QuotaExceeded'); };
        expect(() => TemporaryChatDelete.saveTrackedUuid(UUID_A)).not.toThrow();
        sessionStorage.setItem = orig;
    });
});

describe('tracking — checkCoOccurrence timer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('second single-signal reuses existing timer', () => {
        TemporaryChatDelete.state.createDetected = true;
        TemporaryChatDelete.checkCoOccurrence();
        const t1 = TemporaryChatDelete.state.coOccurrenceTimer;
        expect(t1).not.toBeNull();
        TemporaryChatDelete.state.createDetected = true;
        TemporaryChatDelete.checkCoOccurrence();
        expect(TemporaryChatDelete.state.coOccurrenceTimer).toBe(t1);
    });

    it('co-occurrence clears timer to null', () => {
        TemporaryChatDelete.state.createDetected = true;
        TemporaryChatDelete.checkCoOccurrence();
        expect(TemporaryChatDelete.state.coOccurrenceTimer).not.toBeNull();
        TemporaryChatDelete.state.createDetected = true;
        TemporaryChatDelete.state.isCompletionDetected = true;
        TemporaryChatDelete.checkCoOccurrence();
        expect(TemporaryChatDelete.state.coOccurrenceTimer).toBeNull();
    });

    it('timer expiry resets coOccurrenceTimer to null', () => {
        TemporaryChatDelete.state.isCompletionDetected = true;
        TemporaryChatDelete.checkCoOccurrence();
        expect(TemporaryChatDelete.state.coOccurrenceTimer).not.toBeNull();
        vi.advanceTimersByTime(1000);
        expect(TemporaryChatDelete.state.coOccurrenceTimer).toBeNull();
    });
});

describe('tracking — trackUuid clears isPendingCreate', () => {
    it('after co-occurrence on chat page, isPendingCreate is false', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, { createDetected: true, isCompletionDetected: true });
        TemporaryChatDelete.checkCoOccurrence();
        expect(TemporaryChatDelete.state.isPendingCreate).toBe(false);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
    });
});

// COORDINATOR.JS MUTANT KILLERS

describe('coordinator — create() validation', () => {
    it('throws when state is null', () => {
        expect(() => globalThis.__DSS_TempChatDelete_coordinator.create(null))
            .toThrow('requires the shared state object');
    });

    it('throws when deps are missing', () => {
        const state = globalThis.__DSS_TempChatDelete_tracking.createState();
        expect(() => globalThis.__DSS_TempChatDelete_coordinator.create(state, {}))
            .toThrow('deps require');
    });
});

describe('coordinator — handOffToServiceWorker', () => {
    it('no-op when uuid is null', () => {
        chrome.runtime.sendMessage.mockClear();
        TemporaryChatDelete.handOffToServiceWorker(null);
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('no-op when uuid is empty string', () => {
        chrome.runtime.sendMessage.mockClear();
        TemporaryChatDelete.handOffToServiceWorker('');
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('clears trackedTemporaryUuid', () => {
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });

    it('clears sessionStorage', () => {
        sessionStorage.setItem(UUID_KEY, UUID_A);
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        expect(sessionStorage.getItem(UUID_KEY)).toBeNull();
    });

    it('sends REMOVE_OPEN_UUID', () => {
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: globalThis.DSS_TEMP_CHAT.DSS_MSG_REMOVE_OPEN_UUID, uuid: UUID_A,
        });
    });

    it('sends SCHEDULE_DELETE_RETRY', () => {
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: globalThis.DSS_TEMP_CHAT.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE, chatUuid: UUID_A,
        });
    });

    it('sends RELEASE_LEASE', () => {
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: globalThis.DSS_TEMP_CHAT.DSS_MSG_RELEASE_LEASE, uuid: UUID_A,
        });
    });

    it('detaches when flag false', () => {
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        TemporaryChatDelete.attachListeners();
        globalThis.TemporaryChatEnabledFlag.__setCache(false);
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });

    it('keeps listeners when flag true', () => {
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        TemporaryChatDelete.attachListeners();
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });
});

describe('coordinator — deleteTrackedAndClear detach logic', () => {
    it('detaches when flag false after keepalive', () => {
        TemporaryChatDelete.attachListeners();
        globalThis.TemporaryChatEnabledFlag.__setCache(false);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });

    it('keeps listeners when flag true after keepalive', () => {
        TemporaryChatDelete.attachListeners();
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });
});

describe('coordinator — keepalive defaults to false', () => {
    it('no-arg call posts fiber delete', () => {
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        const postSpy = vi.spyOn(window, 'postMessage');
        TemporaryChatDelete.deleteTrackedAndClear();
        expect(postSpy).toHaveBeenCalledWith({
            type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE, sessionId: UUID_A,
        }, '*');
        postSpy.mockRestore();
    });
});

describe('coordinator — fiber result listener filters', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    it('ignores result from non-window source', () => {
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_RESULT_TYPE, sessionId: UUID_A, success: true },
            source: null,
        }));
        vi.advanceTimersByTime(3000);
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).toHaveBeenCalled();
    });

    it('ignores result with wrong sessionId', () => {
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_RESULT_TYPE, sessionId: UUID_B, success: true },
            source: window,
        }));
        vi.advanceTimersByTime(3000);
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).toHaveBeenCalled();
    });

    it('ignores result with wrong type', () => {
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'WRONG_TYPE', sessionId: UUID_A, success: true },
            source: window,
        }));
        vi.advanceTimersByTime(3000);
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).toHaveBeenCalled();
    });

    it('hasFallbackTriggered prevents double API call — timeout after failure does not re-trigger', () => {
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        // Simulate failure result — triggers fallbackToApi
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_RESULT_TYPE, sessionId: UUID_A, success: false },
            source: window,
        }));
        const countAfterFailure = global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mock.calls.length;
        // Timeout fires after failure — hasFallbackTriggered should prevent second API call
        vi.advanceTimersByTime(3000);
        const countAfterTimeout = global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mock.calls.length;
        expect(countAfterTimeout).toBe(countAfterFailure);
    });
});

describe('coordinator — API fallback result handling', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    it('removes pending when API fallback succeeds', async () => {
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockResolvedValue(true);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_RESULT_TYPE, sessionId: UUID_A, success: false },
            source: window,
        }));
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: globalThis.DSS_TEMP_CHAT.DSS_MSG_REMOVE_PENDING_DELETE, uuid: UUID_A,
        });
    });

    it('schedules retry + releases lease when API fallback fails', async () => {
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockResolvedValue(false);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_RESULT_TYPE, sessionId: UUID_A, success: false },
            source: window,
        }));
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: globalThis.DSS_TEMP_CHAT.DSS_MSG_REMOVE_PENDING_DELETE }));
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: globalThis.DSS_TEMP_CHAT.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE }));
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: globalThis.DSS_TEMP_CHAT.DSS_MSG_RELEASE_LEASE }));
    });
});

describe('coordinator — sendPendingStoreRoute error handling', () => {
    it('catches sync throw from sendMessage', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        chrome.runtime.sendMessage = vi.fn(() => { throw new Error('Extension context invalidated.'); });
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        expect(() => TemporaryChatDelete.handOffToServiceWorker(UUID_A)).not.toThrow();
        spy.mockRestore();
    });

    it('logs error when sendMessage resolves ok:false', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false, error: 'test' });
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

// HANDLERS.JS MUTANT KILLERS

describe('handlers — create() validation', () => {
    it('throws when state is null', () => {
        expect(() => globalThis.__DSS_TempChatDelete_handlers.create(null))
            .toThrow('requires the shared state object');
    });

    it('throws when deps are empty', () => {
        const state = globalThis.__DSS_TempChatDelete_tracking.createState();
        expect(() => globalThis.__DSS_TempChatDelete_handlers.create(state, {}))
            .toThrow('deps require');
    });
});

describe('handlers — handleAuthMessage null token', () => {
    it('sets capturedAuthToken to null when authorization is null', () => {
        TemporaryChatDelete.state.capturedAuthToken = 'Bearer old';
        const event = new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_AUTH_CAPTURED_TYPE, authorization: null },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.state.capturedAuthToken).toBeNull();
    });

    it('sets capturedAuthToken to null when authorization is undefined', () => {
        TemporaryChatDelete.state.capturedAuthToken = 'Bearer old';
        const event = new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_AUTH_CAPTURED_TYPE },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.state.capturedAuthToken).toBeNull();
    });
});


describe('handlers — download guard', () => {
    it('downloadRequest empty string is treated as download', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        const postSpy = vi.spyOn(window, 'postMessage');
        TemporaryChatDelete.handleNavigationEvent({
            destination: { url: 'https://example.com/file.pdf' },
            navigationType: 'push',
            downloadRequest: '',
        });
        expect(postSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE }), '*');
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
        postSpy.mockRestore();
    });

    it('downloadRequest undefined is NOT download', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        const postSpy = vi.spyOn(window, 'postMessage');
        TemporaryChatDelete.handleNavigationEvent({
            destination: { url: chatUrl(UUID_B) },
            navigationType: 'push',
        });
        expect(postSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE }), '*');
        postSpy.mockRestore();
    });
});

describe('handlers — suppressNextUnloadDelete', () => {
    it('reload arms suppressNextUnloadDelete', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.handleNavigationEvent(makeNav(chatUrl(UUID_A), 'reload'));
        expect(TemporaryChatDelete.state.suppressNextUnloadDelete).toBe(true);
    });

    it('same-URL push does NOT arm suppressNextUnloadDelete', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.handleNavigationEvent(makeNav(window.location.href, 'push'));
        expect(TemporaryChatDelete.state.suppressNextUnloadDelete).toBe(false);
    });
});

describe('handlers — empty destination.url', () => {
    it('handles missing destination.url gracefully', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        expect(() => TemporaryChatDelete.handleNavigationEvent({
            destination: {},
            navigationType: 'push',
        })).not.toThrow();
    });
});

describe('handlers — handleToggleChanged strict boolean', () => {
    it('isEnabled === true enables and attaches', () => {
        const evt = new CustomEvent('x', { detail: { isEnabled: true } });
        TemporaryChatDelete.handleToggleChanged(evt);
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });

    it('isEnabled = 1 (truthy non-boolean) does NOT enable', () => {
        const evt = new CustomEvent('x', { detail: { isEnabled: 1 } });
        TemporaryChatDelete.handleToggleChanged(evt);
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('missing detail detaches when no tracked uuid', () => {
        TemporaryChatDelete.attachListeners();
        const evt = new CustomEvent('x', {});
        TemporaryChatDelete.handleToggleChanged(evt);
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });
});

describe('handlers — handleBeforeUnload guards', () => {
    it('does nothing when trackedTemporaryUuid is null', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: null, capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false, isKeyboardRefresh: false,
        });
        TemporaryChatDelete.handleBeforeUnload();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does nothing when not on chat page', () => {
        setPathname('/');
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false, isKeyboardRefresh: false,
        });
        TemporaryChatDelete.handleBeforeUnload();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });
});

describe('handlers — handleWindowMessage dispatches all', () => {
    it('auth capture', () => {
        const event = new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_AUTH_CAPTURED_TYPE, authorization: 'Bearer wm' },
            source: window,
        });
        TemporaryChatDelete.handleWindowMessage(event);
        expect(TemporaryChatDelete.state.capturedAuthToken).toBe('Bearer wm');
    });

    it('create detection', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        const event = new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_CHAT_CREATE_MESSAGE_TYPE },
            source: window,
        });
        TemporaryChatDelete.handleWindowMessage(event);
        expect(TemporaryChatDelete.state.createDetected).toBe(true);
    });

    it('completion detection', () => {
        vi.useFakeTimers();
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        const event = new MessageEvent('message', {
            data: { type: globalThis.DSS_TEMP_CHAT.DSS_CHAT_COMPLETION_MESSAGE_TYPE },
            source: window,
        });
        TemporaryChatDelete.handleWindowMessage(event);
        expect(TemporaryChatDelete.state.isCompletionDetected).toBe(true);
        vi.useRealTimers();
    });
});


// ENTRY FILE (temporary-chat-delete.js) MUTANT KILLERS

describe('entry — attach/detach cycling', () => {
    it('attach-detach-attach cycles correctly', () => {
        TemporaryChatDelete.attachListeners();
        expect(TemporaryChatDelete.state.isListening).toBe(true);
        TemporaryChatDelete.detachListeners();
        expect(TemporaryChatDelete.state.isListening).toBe(false);
        TemporaryChatDelete.attachListeners();
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });

    it('detach when already detached stays false', () => {
        TemporaryChatDelete.state.isListening = false;
        TemporaryChatDelete.detachListeners();
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });
});

describe('entry — init scenarios', () => {
    it('tracked uuid in sessionStorage sets state even when flag disabled', async () => {
        sessionStorage.setItem(UUID_KEY, UUID_A);
        settingsStore = {};
        resetState();
        await TemporaryChatDelete.init();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
        sessionStorage.clear();
    });

    it('no tracked uuid + flag enabled attaches listeners', async () => {
        sessionStorage.clear();
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = true;
        resetState();
        await TemporaryChatDelete.init();
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });

    it('no tracked uuid + flag disabled does NOT attach', async () => {
        sessionStorage.clear();
        settingsStore = {};
        resetState();
        await TemporaryChatDelete.init();
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });
});

describe('entry — handleRefreshKeydown precise matching', () => {
    it('R without ctrl/meta does NOT set isKeyboardRefresh', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'R', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(false);
    });

    it('Ctrl+t does NOT set isKeyboardRefresh', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 't', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(false);
    });
});

describe('handlers — marking requires both isPendingCreate AND enabledFlag', () => {
    it('isPendingCreate true + flag false does NOT mark', () => {
        TemporaryChatDelete.state.isPendingCreate = true;
        globalThis.TemporaryChatEnabledFlag.__setCache(false);
        TemporaryChatDelete.handleNavigationEvent(makeNav(chatUrl(UUID_A)));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });

    it('flag true + isPendingCreate false does NOT mark', () => {
        TemporaryChatDelete.state.isPendingCreate = false;
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        TemporaryChatDelete.handleNavigationEvent(makeNav(chatUrl(UUID_A)));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });
});

describe('handlers — context invalidated guard', () => {
    it('returns early when chrome.runtime.id is undefined', () => {
        const originalId = chrome.runtime.id;
        chrome.runtime.id = undefined;
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok', isPendingCreate: true,
        });
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        TemporaryChatDelete.handleNavigationEvent(makeNav(chatUrl(UUID_B)));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
        expect(TemporaryChatDelete.state.isPendingCreate).toBe(true);
        chrome.runtime.id = originalId;
    });
});

describe('handlers — isSameConversation via destUuid', () => {
    it('same uuid with different query does NOT delete', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        const postSpy = vi.spyOn(window, 'postMessage');
        TemporaryChatDelete.handleNavigationEvent(makeNav(chatUrl(UUID_A) + '?foo=bar'));
        expect(postSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE }), '*');
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
        postSpy.mockRestore();
    });

    it('different uuid DOES delete', () => {
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        const postSpy = vi.spyOn(window, 'postMessage');
        TemporaryChatDelete.handleNavigationEvent(makeNav(chatUrl(UUID_B)));
        expect(postSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE }), '*');
        postSpy.mockRestore();
    });
});
