/**
 * Round-2 mutant-killer tests for the temporary-chat-delete module family.
 * Files covered: temporary-chat-delete.js, temporary-chat-delete.tracking.js, temporary-chat-delete.coordinator.js, temporary-chat-delete.handlers.js, temporary-chat-delete-api.js
 * Trust boundaries mocked: chrome.runtime.sendMessage, fetch, window.navigation, timers. The real TemporaryChatDeleteApi, deepseek-api and heartbeat modules are used.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import '../../utils/deepseek-api.js';
import RealDeleteApi from '../../content/temporary-chat-delete-api.js';
import '../../content/temporary-chat-heartbeat.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

globalThis.TemporaryChatDeleteApi = RealDeleteApi;

const UUID_A = 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0001';
const UUID_B = 'bbbb2222-cccc-dddd-eeee-ffffffffffff';
const T = () => globalThis.DSS_TEMP_CHAT;
const TRACKING = () => globalThis.__DSS_TempChatDelete_tracking;
const COORDINATOR = () => globalThis.__DSS_TempChatDelete_coordinator;
const HANDLERS = () => globalThis.__DSS_TempChatDelete_handlers;

let routeResponse = () => ({ ok: true, values: {} });

function installSendMessage() {
    chrome.runtime.sendMessage = vi.fn(async (message) => routeResponse(message));
}

function sentOfType(type) {
    return chrome.runtime.sendMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === type);
}

function deleteFetches() {
    return global.fetch.mock.calls.filter(([url]) => String(url).includes('chat_session/delete'));
}

async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

function chatUrl(uuid) {
    return 'https://chat.deepseek.com/a/chat/s/' + uuid;
}

function windowMessage(data) {
    return new MessageEvent('message', { data, source: window });
}

function trackOnChatPage(uuid = UUID_A, token = 'Bearer tok') {
    setPathname('/a/chat/s/' + uuid);
    Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: uuid, capturedAuthToken: token });
}

function withHeartbeat(stub, fn) {
    const original = globalThis.TemporaryChatHeartbeat;
    globalThis.TemporaryChatHeartbeat = stub;
    try {
        return fn();
    } finally {
        globalThis.TemporaryChatHeartbeat = original;
    }
}

beforeEach(() => {
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
    sessionStorage.clear();
    routeResponse = () => ({ ok: true, values: {} });
    installSendMessage();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    setPathname('/');
});

afterEach(() => {
    TemporaryChatDelete.detachListeners();
    globalThis.TemporaryChatHeartbeat.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.getElementById('dss-delete-failed-toast')?.remove();
    sessionStorage.clear();
    setPathname('/');
});

// ═══════════════════════════════════════════════════════════════════════════
// PART FACTORIES — dependency validation
// ═══════════════════════════════════════════════════════════════════════════

function fullHandlerDeps(state) {
    return {
        tracking: TRACKING().create(state),
        deleteTrackedAndClear: vi.fn(),
        handOffToServiceWorker: vi.fn(),
        readEnabledFlag: vi.fn(() => true),
        setEnabledFlagCache: vi.fn(),
        attachListeners: vi.fn(),
        detachListeners: vi.fn(),
    };
}

describe('tracking.create — valid state', () => {
    it('returns the tracking API instead of throwing when a state object is given', () => {
        const api = TRACKING().create(TRACKING().createState());
        expect(typeof api.trackUuid).toBe('function');
        expect(typeof api.checkCoOccurrence).toBe('function');
    });
});

describe('handlers.create — every dependency is required', () => {
    const NAMES = ['tracking', 'deleteTrackedAndClear', 'handOffToServiceWorker', 'readEnabledFlag', 'setEnabledFlagCache', 'attachListeners', 'detachListeners'];

    it('accepts a complete deps object', () => {
        const state = TRACKING().createState();
        const handlers = HANDLERS().create(state, fullHandlerDeps(state));
        expect(typeof handlers.handleBeforeUnload).toBe('function');
    });

    it.each(NAMES)('throws when only %s is missing', (name) => {
        const state = TRACKING().createState();
        const deps = fullHandlerDeps(state);
        deps[name] = undefined;
        expect(() => HANDLERS().create(state, deps)).toThrow('deps require');
    });
});

describe('coordinator.create — every dependency is required', () => {
    const NAMES = ['tracking', 'readEnabledFlag', 'detachListeners'];
    const fullDeps = (state) => ({ tracking: TRACKING().create(state), readEnabledFlag: () => true, detachListeners: () => {} });

    it('accepts a complete deps object', () => {
        const state = TRACKING().createState();
        const coordinator = COORDINATOR().create(state, fullDeps(state));
        expect(typeof coordinator.deleteTrackedAndClear).toBe('function');
    });

    it.each(NAMES)('throws when only %s is missing', (name) => {
        const state = TRACKING().createState();
        const deps = fullDeps(state);
        deps[name] = undefined;
        expect(() => COORDINATOR().create(state, deps)).toThrow('deps require');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

describe('handlers.handleBeforeUnload — requests deletion only for the tracked page with a token', () => {
    it('requests a keepalive deletion when leaving the tracked chat with a token', () => {
        const state = TRACKING().createState();
        const deps = fullHandlerDeps(state);
        const handlers = HANDLERS().create(state, deps);
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: 'Bearer tok' });
        handlers.handleBeforeUnload();
        expect(deps.deleteTrackedAndClear).toHaveBeenCalledWith({ keepalive: true });
    });

    it('requests nothing on a non-chat page even when nothing is tracked and a token exists', () => {
        const state = TRACKING().createState();
        const deps = fullHandlerDeps(state);
        const handlers = HANDLERS().create(state, deps);
        setPathname('/');
        Object.assign(state, { trackedTemporaryUuid: null, capturedAuthToken: 'Bearer tok' });
        handlers.handleBeforeUnload();
        expect(deps.deleteTrackedAndClear).not.toHaveBeenCalled();
    });

    it('requests nothing on the tracked chat page when no token was captured', () => {
        const state = TRACKING().createState();
        const deps = fullHandlerDeps(state);
        const handlers = HANDLERS().create(state, deps);
        setPathname('/a/chat/s/' + UUID_A);
        Object.assign(state, { trackedTemporaryUuid: UUID_A, capturedAuthToken: null });
        handlers.handleBeforeUnload();
        expect(deps.deleteTrackedAndClear).not.toHaveBeenCalled();
    });
});

describe('handlers — window messages without data are ignored safely', () => {
    it.each([
        'handleAuthMessage',
        'handleCreateMessage',
        'handleCompletionMessage',
        'handleHistoryNavMessage',
        'handleWindowMessage',
    ])('%s does not throw for a same-window message whose data is null', (name) => {
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        expect(() => TemporaryChatDelete[name]({ source: window, data: null })).not.toThrow();
        expect(TemporaryChatDelete.state.capturedAuthToken).toBeNull();
        expect(TemporaryChatDelete.state.createDetected).toBe(false);
        expect(TemporaryChatDelete.state.isCompletionDetected).toBe(false);
    });
});

describe('handlers.handleAuthMessage — SW response handling', () => {
    function authMessage(token) {
        return windowMessage({ type: T().DSS_AUTH_CAPTURED_TYPE, authorization: token });
    }

    it('logs a [DSS] error carrying the SW error when the route answers ok:false', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        routeResponse = () => ({ ok: false, error: 'quota exceeded' });
        TemporaryChatDelete.handleAuthMessage(authMessage('Bearer tok'));
        await flush();
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const [label, err] = errorSpy.mock.calls[0];
        expect(label).toEqual(expect.stringContaining('[DSS]'));
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('quota exceeded');
    });

    it('logs nothing when the route answers ok:true', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        TemporaryChatDelete.handleAuthMessage(authMessage('Bearer tok'));
        await flush();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(sentOfType(T().DSS_MSG_SET_LAST_AUTH_TOKEN)).toEqual([{ type: T().DSS_MSG_SET_LAST_AUTH_TOKEN, token: 'Bearer tok' }]);
    });

    it('logs nothing when the route answers with no response at all', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        routeResponse = () => undefined;
        TemporaryChatDelete.handleAuthMessage(authMessage('Bearer tok'));
        await flush();
        expect(errorSpy).not.toHaveBeenCalled();
    });
});

describe('handlers.handleCreateMessage — completes a co-occurrence that started with completion', () => {
    it('completion first, then create, marks the current chat as temporary', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        setPathname('/a/chat/s/' + UUID_A);
        TemporaryChatDelete.handleCompletionMessage(windowMessage({ type: T().DSS_CHAT_COMPLETION_MESSAGE_TYPE }));
        TemporaryChatDelete.handleCreateMessage(windowMessage({ type: T().DSS_CHAT_CREATE_MESSAGE_TYPE }));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
    });
});

describe('handlers.handleNavigationEvent — guards', () => {
    it('does nothing and does not throw when chrome.runtime is gone (context invalidated)', () => {
        trackOnChatPage();
        const runtime = chrome.runtime;
        chrome.runtime = undefined;
        try {
            expect(() => TemporaryChatDelete.handleNavigationEvent({ destination: { url: chatUrl(UUID_B) }, navigationType: 'push' })).not.toThrow();
        } finally {
            chrome.runtime = runtime;
        }
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
    });

    it('does not throw for an event with no destination', () => {
        setPathname('/');
        expect(() => TemporaryChatDelete.handleNavigationEvent({ navigationType: 'push' })).not.toThrow();
    });

    it('a reload is a refresh even when its destination differs — tracked chat is kept', () => {
        trackOnChatPage();
        const postSpy = vi.spyOn(window, 'postMessage');
        TemporaryChatDelete.handleNavigationEvent({ destination: { url: chatUrl(UUID_B) }, navigationType: 'reload' });
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
        expect(postSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: T().DSS_FIBER_DELETE_MESSAGE_TYPE }), '*');
    });
});

describe('handlers.handleRefreshKeydown — Cmd needs R', () => {
    it('Cmd+T does not count as a keyboard refresh', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 't', metaKey: true, ctrlKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(false);
    });

    it('Cmd+R counts as a keyboard refresh', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'R', metaKey: true, ctrlKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// COORDINATOR
// ═══════════════════════════════════════════════════════════════════════════

describe('coordinator — pending-store route responses', () => {
    it('logs nothing when every route answers ok:true', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        await flush();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs nothing when routes answer with no response at all', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        routeResponse = () => undefined;
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        await flush();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('each failed hand-off route logs a [DSS] error that names the failed operation', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        routeResponse = (m) => ({ ok: false, error: 'fail:' + m.type });
        TemporaryChatDelete.handOffToServiceWorker(UUID_A);
        await flush();
        const labelFor = (type) => errorSpy.mock.calls.find(([, err]) => err?.message === 'fail:' + type)?.[0];
        expect(labelFor(T().DSS_MSG_REMOVE_OPEN_UUID)).toMatch(/^\[DSS\].*open.?uuid/i);
        expect(labelFor(T().DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE)).toMatch(/^\[DSS\].*retry/i);
        expect(labelFor(T().DSS_MSG_RELEASE_LEASE)).toMatch(/^\[DSS\].*lease/i);
    });

    it('failed routes after a confirmed keepalive delete name the failed operation', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        routeResponse = (m) => ({ ok: false, error: 'fail:' + m.type });
        trackOnChatPage();
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });
        await flush();
        const labelFor = (type) => errorSpy.mock.calls.find(([, err]) => err?.message === 'fail:' + type)?.[0];
        expect(labelFor(T().DSS_MSG_REMOVE_OPEN_UUID)).toMatch(/^\[DSS\].*open.?uuid/i);
        expect(labelFor(T().DSS_MSG_REMOVE_PENDING_DELETE)).toMatch(/^\[DSS\].*pending/i);
    });
});

describe('coordinator — heartbeat module without stop()', () => {
    it('handOffToServiceWorker still clears tracking', () => {
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        withHeartbeat({}, () => {
            expect(() => TemporaryChatDelete.handOffToServiceWorker(UUID_A)).not.toThrow();
        });
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });

    it('deleteTrackedAndClear still deletes via keepalive fetch', async () => {
        trackOnChatPage();
        withHeartbeat({}, () => {
            expect(() => TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true })).not.toThrow();
        });
        await flush();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(deleteFetches()).toHaveLength(1);
    });
});

describe('coordinator — fiber result listener lifecycle', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    // Drain every pending fiber timeout so no result listener outlives its test.
    afterEach(async () => { await vi.advanceTimersByTimeAsync(70000); await flush(); });

    function fiberResult(success, sessionId = UUID_A) {
        return windowMessage({ type: T().DSS_FIBER_DELETE_RESULT_TYPE, sessionId, success });
    }

    it('a same-window message with null data does not break the pending listener', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const windowErrors = [];
        const onError = (e) => windowErrors.push(e);
        window.addEventListener('error', onError);
        trackOnChatPage();
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        let thrown = null;
        try {
            window.dispatchEvent(windowMessage(null));
        } catch (err) {
            thrown = err;
        }
        window.removeEventListener('error', onError);
        expect(thrown).toBeNull();
        expect(windowErrors).toHaveLength(0);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('a late fiber success after the timeout fallback does not confirm the deletion twice', async () => {
        trackOnChatPage();
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        await vi.advanceTimersByTimeAsync(3000);
        await flush();
        expect(sentOfType(T().DSS_MSG_REMOVE_PENDING_DELETE)).toHaveLength(1);
        window.dispatchEvent(fiberResult(true));
        await flush();
        expect(sentOfType(T().DSS_MSG_REMOVE_PENDING_DELETE)).toHaveLength(1);
    });

    it('a fiber failure arriving after a fiber success does not start an API delete', async () => {
        trackOnChatPage();
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        window.dispatchEvent(fiberResult(true));
        await flush();
        expect(sentOfType(T().DSS_MSG_REMOVE_PENDING_DELETE)).toEqual([{ type: T().DSS_MSG_REMOVE_PENDING_DELETE, uuid: UUID_A }]);
        window.dispatchEvent(fiberResult(false));
        await vi.advanceTimersByTimeAsync(3000);
        await flush();
        expect(deleteFetches()).toHaveLength(0);
    });

    it('exhausted API retries schedule an SW retry for the deleted chat and release its lease', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });
        trackOnChatPage();
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        await vi.advanceTimersByTimeAsync(3000 + 30000 + 30000 + 100);
        await flush();
        expect(deleteFetches()).toHaveLength(3);
        expect(sentOfType(T().DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE)).toEqual([{ type: T().DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE, chatUuid: UUID_A }]);
        expect(sentOfType(T().DSS_MSG_RELEASE_LEASE)).toEqual([{ type: T().DSS_MSG_RELEASE_LEASE, uuid: UUID_A }]);
        expect(sentOfType(T().DSS_MSG_REMOVE_PENDING_DELETE)).toHaveLength(0);
    });

    it('failed routes after exhausted retries name the failed operation', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch = vi.fn().mockResolvedValue({ ok: false });
        trackOnChatPage();
        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        routeResponse = (m) => ({ ok: false, error: 'fail:' + m.type });
        await vi.advanceTimersByTimeAsync(3000 + 30000 + 30000 + 100);
        await flush();
        const labelFor = (type) => errorSpy.mock.calls.find(([, err]) => err?.message === 'fail:' + type)?.[0];
        expect(labelFor(T().DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE)).toMatch(/^\[DSS\].*retry/i);
        expect(labelFor(T().DSS_MSG_RELEASE_LEASE)).toMatch(/^\[DSS\].*lease/i);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY — listener lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('entry — beforeunload listener', () => {
    it('attached: unloading the tracked chat sends a keepalive delete fetch', async () => {
        trackOnChatPage();
        TemporaryChatDelete.attachListeners();
        window.dispatchEvent(new Event('beforeunload'));
        await flush();
        const fetches = deleteFetches();
        expect(fetches).toHaveLength(1);
        expect(fetches[0][1].keepalive).toBe(true);
    });

    it('detached: unloading sends no delete and keeps the chat tracked', async () => {
        trackOnChatPage();
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.detachListeners();
        window.dispatchEvent(new Event('beforeunload'));
        await flush();
        expect(deleteFetches()).toHaveLength(0);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
    });
});

describe('entry — message listener', () => {
    it('detached: an auth message is no longer captured', () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.detachListeners();
        window.dispatchEvent(windowMessage({ type: T().DSS_AUTH_CAPTURED_TYPE, authorization: 'Bearer late' }));
        expect(TemporaryChatDelete.state.capturedAuthToken).toBeNull();
    });
});

describe('entry — keydown listener', () => {
    it('attached: F5 is seen in the capture phase even if the target stops propagation', () => {
        TemporaryChatDelete.attachListeners();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.addEventListener('keydown', (e) => e.stopPropagation());
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
        input.remove();
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(true);
    });

    it('detached: F5 no longer marks a keyboard refresh', () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.detachListeners();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(false);
    });
});

describe('entry — Navigation API listener', () => {
    let navigation;

    beforeEach(() => {
        navigation = new EventTarget();
        Object.defineProperty(window, 'navigation', { value: navigation, configurable: true, writable: true });
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
        delete window.navigation;
    });

    function navigateTo(url) {
        const ev = new Event('navigate');
        ev.destination = { url };
        ev.navigationType = 'push';
        navigation.dispatchEvent(ev);
    }

    it('attached: navigating away from the tracked chat starts its deletion', () => {
        trackOnChatPage();
        const postSpy = vi.spyOn(window, 'postMessage');
        TemporaryChatDelete.attachListeners();
        navigateTo(chatUrl(UUID_B));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(postSpy).toHaveBeenCalledWith({ type: T().DSS_FIBER_DELETE_MESSAGE_TYPE, sessionId: UUID_A }, '*');
    });

    it('detached: navigating away leaves the tracked chat alone', () => {
        trackOnChatPage();
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.detachListeners();
        navigateTo(chatUrl(UUID_B));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID_A);
    });
});

describe('entry — detachListeners and the heartbeat', () => {
    it('detaching when nothing is attached leaves a running heartbeat alone', () => {
        globalThis.TemporaryChatHeartbeat.start(UUID_A);
        chrome.runtime.sendMessage.mockClear();
        TemporaryChatDelete.detachListeners();
        globalThis.TemporaryChatHeartbeat.sendNow();
        expect(sentOfType(T().DSS_MSG_HEARTBEAT)).toEqual([{ type: T().DSS_MSG_HEARTBEAT, uuid: UUID_A }]);
    });

    it('detaching attached listeners stops the heartbeat', () => {
        TemporaryChatDelete.attachListeners();
        globalThis.TemporaryChatHeartbeat.start(UUID_A);
        chrome.runtime.sendMessage.mockClear();
        TemporaryChatDelete.detachListeners();
        globalThis.TemporaryChatHeartbeat.sendNow();
        expect(sentOfType(T().DSS_MSG_HEARTBEAT)).toHaveLength(0);
    });

    it('detaching with a heartbeat module lacking stop() does not throw', () => {
        TemporaryChatDelete.attachListeners();
        withHeartbeat({}, () => {
            expect(() => TemporaryChatDelete.detachListeners()).not.toThrow();
        });
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });
});

describe('entry — init wiring', () => {
    function settingsBroadcast(isEnabled) {
        const changes = {};
        changes[T().DSS_TEMP_CHAT_STORAGE_KEY] = { newValue: isEnabled };
        chrome.runtime.onMessage.callListeners({ type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area: 'local', changes });
    }

    it('restoring a tracked chat resumes its heartbeat', async () => {
        sessionStorage.setItem(T().DSS_TEMP_CHAT_UUID_KEY, UUID_A);
        await TemporaryChatDelete.init();
        expect(sentOfType(T().DSS_MSG_HEARTBEAT)).toContainEqual({ type: T().DSS_MSG_HEARTBEAT, uuid: UUID_A });
    });

    it('restoring a tracked chat with a heartbeat module lacking start() still attaches', async () => {
        sessionStorage.setItem(T().DSS_TEMP_CHAT_UUID_KEY, UUID_A);
        const original = globalThis.TemporaryChatHeartbeat;
        globalThis.TemporaryChatHeartbeat = { stop: original.stop };
        try {
            await expect(TemporaryChatDelete.init()).resolves.toBeUndefined();
        } finally {
            globalThis.TemporaryChatHeartbeat = original;
        }
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });

    it('after init, the toggle-changed CustomEvent attaches listeners', async () => {
        await TemporaryChatDelete.init();
        expect(TemporaryChatDelete.state.isListening).toBe(false);
        window.dispatchEvent(new CustomEvent(T().DSS_TEMP_CHAT_CHANGED_EVENT, { detail: { isEnabled: true } }));
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });

    it('after init, a settings broadcast enabling the toggle attaches listeners', async () => {
        await TemporaryChatDelete.init();
        expect(TemporaryChatDelete.state.isListening).toBe(false);
        settingsBroadcast(true);
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });

    it('after init, a settings broadcast disabling the toggle detaches when nothing is tracked', async () => {
        await TemporaryChatDelete.init();
        TemporaryChatDelete.attachListeners();
        settingsBroadcast(false);
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });

    it('a settings broadcast disabling the toggle does not attach detached listeners while a chat is tracked', () => {
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        settingsBroadcast(false);
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });

    it('after init, a settings broadcast disabling the toggle keeps listeners while a chat is tracked', async () => {
        await TemporaryChatDelete.init();
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID_A;
        settingsBroadcast(false);
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });
});

describe('entry — load-order errors', () => {
    it('reading the flag without TemporaryChatEnabledFlag loaded throws a load-order error naming it', () => {
        const flag = globalThis.TemporaryChatEnabledFlag;
        delete globalThis.TemporaryChatEnabledFlag;
        try {
            expect(() => TemporaryChatDelete.readEnabledFlag()).toThrow(/TemporaryChatEnabledFlag/);
        } finally {
            globalThis.TemporaryChatEnabledFlag = flag;
        }
    });

    it('loading the entry without the handlers part throws a load-order error naming it', async () => {
        const part = globalThis.__DSS_TempChatDelete_handlers;
        delete globalThis.__DSS_TempChatDelete_handlers;
        vi.resetModules();
        try {
            await expect(import('../../content/temporary-chat-delete.js')).rejects.toThrow(/__DSS_TempChatDelete_handlers/);
        } finally {
            globalThis.__DSS_TempChatDelete_handlers = part;
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TRACKING
// ═══════════════════════════════════════════════════════════════════════════

describe('tracking.loadTrackedUuid — storage failure', () => {
    it('returns null when sessionStorage.getItem throws, even though a uuid is stored', () => {
        sessionStorage.setItem(T().DSS_TEMP_CHAT_UUID_KEY, UUID_A);
        expect(TRACKING().loadTrackedUuid()).toBe(UUID_A);
        const realStorage = globalThis.sessionStorage;
        Object.defineProperty(globalThis, 'sessionStorage', {
            value: { getItem: () => { throw new Error('SecurityError'); } },
            configurable: true,
            writable: true,
        });
        try {
            expect(TRACKING().loadTrackedUuid()).toBeNull();
        } finally {
            Object.defineProperty(globalThis, 'sessionStorage', { value: realStorage, configurable: true, writable: true });
        }
    });
});

describe('tracking.trackUuid — SW route handling', () => {
    function freshTracking() {
        const state = TRACKING().createState();
        return { state, tracking: TRACKING().create(state) };
    }

    it('logs a [DSS] error carrying the SW error when the route answers ok:false', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        routeResponse = () => ({ ok: false, error: 'full' });
        freshTracking().tracking.trackUuid(UUID_A);
        await flush();
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const [label, err] = errorSpy.mock.calls[0];
        expect(label).toEqual(expect.stringContaining('[DSS]'));
        expect(err.message).toBe('full');
    });

    it('logs nothing when the route answers ok:true, and registers the uuid for deletion', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        freshTracking().tracking.trackUuid(UUID_A);
        await flush();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(sentOfType(T().DSS_MSG_TRACK_FOR_DELETION)).toEqual([{ type: T().DSS_MSG_TRACK_FOR_DELETION, uuid: UUID_A }]);
    });

    it('logs nothing when the route answers with no response at all', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        routeResponse = () => undefined;
        freshTracking().tracking.trackUuid(UUID_A);
        await flush();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('a synchronous sendMessage throw is logged as a [DSS] error and tracking still completes', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = new Error('sendMessage failed');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        chrome.runtime.sendMessage = vi.fn(() => { throw boom; });
        const { state, tracking } = freshTracking();
        expect(() => tracking.trackUuid(UUID_A)).not.toThrow();
        expect(state.trackedTemporaryUuid).toBe(UUID_A);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[DSS]'), boom);
    });

    it('a heartbeat module lacking start() does not break tracking', () => {
        const { state, tracking } = freshTracking();
        withHeartbeat({}, () => {
            expect(() => tracking.trackUuid(UUID_A)).not.toThrow();
        });
        expect(state.trackedTemporaryUuid).toBe(UUID_A);
    });
});

describe('tracking.checkCoOccurrence — a completed window cancels its timer', () => {
    it('the first window timer does not wipe a second, still-open window', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const state = TRACKING().createState();
        const tracking = TRACKING().create(state);
        setPathname('/a/chat/s/' + UUID_A);
        state.createDetected = true;
        tracking.checkCoOccurrence();
        vi.advanceTimersByTime(100);
        state.isCompletionDetected = true;
        tracking.checkCoOccurrence();
        expect(state.trackedTemporaryUuid).toBe(UUID_A);

        vi.advanceTimersByTime(400);
        setPathname('/a/chat/s/' + UUID_B);
        state.createDetected = true;
        tracking.checkCoOccurrence();
        vi.advanceTimersByTime(600);
        state.isCompletionDetected = true;
        tracking.checkCoOccurrence();
        expect(state.trackedTemporaryUuid).toBe(UUID_B);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEMPORARY-CHAT-DELETE-API
// ═══════════════════════════════════════════════════════════════════════════

describe('api.deleteChatSessionWithRetry — navigation deletes are not keepalive', () => {
    it('sends the delete fetch with keepalive false', async () => {
        await expect(RealDeleteApi.deleteChatSessionWithRetry(UUID_A, 'Bearer tok')).resolves.toBe(true);
        const fetches = deleteFetches();
        expect(fetches).toHaveLength(1);
        expect(fetches[0][1].keepalive).toBe(false);
    });
});

describe('api.showDeleteFailedToast — auto-dismiss', () => {
    it('removes the toast after 6 seconds', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        RealDeleteApi.showDeleteFailedToast();
        expect(document.getElementById('dss-delete-failed-toast')).not.toBeNull();
        vi.advanceTimersByTime(5999);
        expect(document.getElementById('dss-delete-failed-toast')).not.toBeNull();
        vi.advanceTimersByTime(1);
        expect(document.getElementById('dss-delete-failed-toast')).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY — fresh module load (kept last: each test leaves an orphan instance behind)
// ═══════════════════════════════════════════════════════════════════════════

describe('entry — wiring performed at module load', () => {
    let savedFlag;
    let fresh;

    async function loadFresh() {
        savedFlag = globalThis.TemporaryChatEnabledFlag;
        vi.resetModules();
        await import('../../content/temporary-chat-enabled-flag.js');
        fresh = (await import('../../content/temporary-chat-delete.js')).default;
        await flush();
    }

    function settingsBroadcast(isEnabled) {
        const changes = {};
        changes[T().DSS_TEMP_CHAT_STORAGE_KEY] = { newValue: isEnabled };
        chrome.runtime.onMessage.callListeners({ type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area: 'local', changes });
    }

    afterEach(() => {
        fresh?.detachListeners();
        fresh = null;
        if (savedFlag) globalThis.TemporaryChatEnabledFlag = savedFlag;
    });

    it('the toggle-changed CustomEvent attaches listeners and updates the enabled flag', async () => {
        await loadFresh();
        expect(fresh.state.isListening).toBe(false);
        window.dispatchEvent(new CustomEvent(T().DSS_TEMP_CHAT_CHANGED_EVENT, { detail: { isEnabled: true } }));
        expect(fresh.state.isListening).toBe(true);
        expect(fresh.readEnabledFlag()).toBe(true);
    });

    it('a settings broadcast enabling the toggle attaches listeners', async () => {
        await loadFresh();
        expect(fresh.state.isListening).toBe(false);
        settingsBroadcast(true);
        expect(fresh.state.isListening).toBe(true);
    });

    it('handleToggleChanged on this instance writes the enabled flag cache', async () => {
        await loadFresh();
        fresh.handleToggleChanged(new CustomEvent('x', { detail: { isEnabled: true } }));
        expect(fresh.readEnabledFlag()).toBe(true);
    });

    it('handleToggleChanged turning off with nothing tracked detaches this instance', async () => {
        await loadFresh();
        fresh.attachListeners();
        fresh.handleToggleChanged(new CustomEvent('x', { detail: { isEnabled: false } }));
        expect(fresh.state.isListening).toBe(false);
    });

    it('a hand-off while the toggle is off detaches this instance', async () => {
        await loadFresh();
        fresh.attachListeners();
        fresh.state.trackedTemporaryUuid = UUID_A;
        fresh.handOffToServiceWorker(UUID_A);
        expect(fresh.state.isListening).toBe(false);
    });

    it('initEnabledFlagFromStorage reads the enabled flag through the settings route', async () => {
        await loadFresh();
        expect(fresh.readEnabledFlag()).toBe(false);
        routeResponse = (m) => {
            if (m?.type !== globalThis.DSS_SETTINGS_MSG.GET_SETTINGS) return { ok: true, values: {} };
            const values = {};
            values[T().DSS_TEMP_CHAT_STORAGE_KEY] = true;
            return { ok: true, values };
        };
        await fresh.initEnabledFlagFromStorage();
        expect(fresh.readEnabledFlag()).toBe(true);
    });
});
