/**
 * Mutant-kill spec for temporary-chat storage, SW chat-map wiring and the temporary-chat-delete listener lifecycle.
 *
 * Requirements asserted (observable behavior only):
 *   - TemporaryChatPendingStore.getLocalDeviceId() returns null unless storage.local holds a non-empty string device id, and null (not undefined) when the read fails.
 *   - When persisting a newly generated device id fails, the tracked pending-delete entry is ownerless (ownerDeviceId === null).
 *   - background/service-worker.js wires the REAL chat-map routes to its StorageManager: a chat-map BIND message is answered {ok:true} and the binding is persisted.
 *   - After TemporaryChatDelete.detachListeners(), a dss-intentional-reload event has no effect: once listeners are re-attached, leaving the page still deletes the tracked chat.
 *
 * Mocked trust boundaries only: chrome.storage (shared in-memory fixture from vitest.setup.js), chrome.runtime.onMessage, fetch, window.navigation, importScripts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/deepseek-api.js';
import '../../background/service-worker-constants.js';
import TemporaryChatPendingStore from '../../background/pending-store.js';
import TemporaryChatDeleteApi from '../../content/temporary-chat-delete-api.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';
import { setPathname } from '../helpers/set-pathname.js';
import { importFreshStorageManager, loadRoutes } from '../helpers/chat-map-writer-harness.js';

const store = TemporaryChatPendingStore;
const DEVICE_ID_KEY = () => globalThis.DSS_TEMP_CHAT.DSS_DEVICE_ID_KEY;
const SYNC_KEY = () => globalThis.DSS_TEMP_CHAT.DSS_PENDING_DELETES_SYNC_KEY;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('pending-store getLocalDeviceId — only a non-empty string counts as a device id', () => {
    it('returns null when the stored device id is an empty string', async () => {
        await chrome.storage.local.set({ [DEVICE_ID_KEY()]: '' });
        expect(await store.getLocalDeviceId(), 'empty-string device id must read as "no device id"').toBeNull();
    });

    it('returns null when the stored device id is a non-string (number 42)', async () => {
        await chrome.storage.local.set({ [DEVICE_ID_KEY()]: 42 });
        expect(await store.getLocalDeviceId(), 'non-string device id must read as "no device id"').toBeNull();
    });

    it('returns the stored id when it is a non-empty string (control)', async () => {
        await chrome.storage.local.set({ [DEVICE_ID_KEY()]: 'dev-abc' });
        expect(await store.getLocalDeviceId()).toBe('dev-abc');
    });

    it('returns null (not undefined) when storage.local.get rejects', async () => {
        vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('storage unavailable'));
        expect(await store.getLocalDeviceId(), 'read failure must yield null').toBeNull();
    });

    it('returns null (not undefined) when storage.local.get throws synchronously', async () => {
        vi.spyOn(chrome.storage.local, 'get').mockImplementation(() => { throw new Error('context invalidated'); });
        expect(await store.getLocalDeviceId(), 'synchronous read failure must yield null').toBeNull();
    });
});

describe('pending-store addPendingDelete — device-id persist failure leaves the entry ownerless', () => {
    it('ownerDeviceId is null when writing the freshly generated device id fails', async () => {
        const realSet = chrome.storage.local.set.bind(chrome.storage.local);
        vi.spyOn(chrome.storage.local, 'set').mockImplementation((items, cb) => {
            if (items && DEVICE_ID_KEY() in items) return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
            return realSet(items, cb);
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await store.addPendingDelete('aaa-111');

        const queue = (await chrome.storage.sync.get(SYNC_KEY()))[SYNC_KEY()];
        expect(queue, 'entry must still be queued despite the device-id write failure').toHaveLength(1);
        expect(queue[0].chatUuid).toBe('aaa-111');
        expect(queue[0].ownerDeviceId, 'unpersisted device id must not be stamped; entry must be ownerless (null)').toBeNull();
        expect((await chrome.storage.local.get(DEVICE_ID_KEY()))[DEVICE_ID_KEY()]).toBeUndefined();
    });
});

describe('temporary-chat-delete — dss-intentional-reload is ignored once listeners are detached', () => {
    const TEMP_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';
    let fetchMock;
    let postMessageSpy;

    const deleteAttempts = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/chat_session/delete')).length
        + postMessageSpy.mock.calls.filter(([msg]) => msg?.type === globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE).length;
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

    beforeEach(() => {
        globalThis.TemporaryChatDeleteApi = TemporaryChatDeleteApi;
        TemporaryChatDelete.detachListeners();
        window.navigation = new EventTarget();
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
        globalThis.fetch = fetchMock;
        postMessageSpy = vi.spyOn(window, 'postMessage');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        setPathname(`/a/chat/s/${TEMP_UUID}`);
        sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, TEMP_UUID);
        Object.assign(TemporaryChatDelete.state, {
            capturedAuthToken: 'Bearer test-token',
            trackedTemporaryUuid: TEMP_UUID,
            createDetected: false,
            isCompletionDetected: false,
            isPendingCreate: false,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
        delete window.navigation;
        sessionStorage.clear();
        setPathname('/');
    });

    it('control: while attached, dss-intentional-reload suppresses the beforeunload delete', async () => {
        TemporaryChatDelete.attachListeners();
        window.dispatchEvent(new Event('dss-intentional-reload'));
        window.dispatchEvent(new Event('beforeunload'));
        await settle();
        expect(deleteAttempts(), 'intentional reload must suppress the unload delete').toBe(0);
    });

    it('after detach, a dss-intentional-reload event does not suppress the next unload delete', async () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.detachListeners();

        window.dispatchEvent(new Event('dss-intentional-reload'));

        TemporaryChatDelete.attachListeners();
        window.dispatchEvent(new Event('beforeunload'));
        await settle();
        expect(deleteAttempts(), 'event received while detached must not arm the reload suppression; leaving the page must delete the tracked chat').toBeGreaterThan(0);
    });
});

describe('service-worker — installs the real chat-map routes with its own StorageManager', () => {
    const saved = {};

    function freshMessageEvent() {
        const listeners = new Set();
        return {
            addListener: (fn) => listeners.add(fn),
            removeListener: (fn) => listeners.delete(fn),
            hasListener: (fn) => listeners.has(fn),
            listeners: () => [...listeners],
        };
    }

    /** Delivers a cloned message to every onMessage listener; resolves with the first sendResponse value. */
    function send(message) {
        return new Promise((resolve, reject) => {
            let isAnswered = false;
            let isAsync = false;
            const sendResponse = (r) => { if (!isAnswered) { isAnswered = true; resolve(structuredClone(r)); } };
            for (const l of chrome.runtime.onMessage.listeners()) {
                if (l(structuredClone(message), { id: 'test-extension-id' }, sendResponse) === true) isAsync = true;
            }
            if (!isAnswered && !isAsync) reject(new Error('no listener answered the message'));
        });
    }

    beforeEach(() => {
        for (const k of ['importScripts', 'StorageManager', 'DSSSettingsRoutes', 'DSSPendingStoreRoutes', 'DSSEditorWindowRoutes', 'DSSChatMapRoutes', 'fetch']) saved[k] = globalThis[k];
        saved.onMessage = chrome.runtime.onMessage;
        saved.onChangedAdd = chrome.storage.onChanged.addListener;
    });

    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (k === 'onMessage') chrome.runtime.onMessage = v;
            else if (k === 'onChangedAdd') chrome.storage.onChanged.addListener = v;
            else globalThis[k] = v;
        }
    });

    it('a DSS_CHAT_MAP BIND message is answered {ok:true} and the binding is persisted to storage', async () => {
        globalThis.importScripts = vi.fn();
        globalThis.DSSSettingsRoutes = { install: vi.fn() };
        globalThis.DSSPendingStoreRoutes = { install: vi.fn() };
        globalThis.DSSEditorWindowRoutes = { install: vi.fn() };
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
        globalThis.StorageManager = await importFreshStorageManager();
        loadRoutes(); // real background/chat-map-routes.js, publishes globalThis.DSSChatMapRoutes
        chrome.runtime.onMessage = freshMessageEvent();
        chrome.storage.onChanged.addListener = () => {}; // keep the SW sweep listener off the shared storage

        await import('../../background/service-worker.js?real-chat-map-routes');
        chrome.storage.onChanged.addListener = saved.onChangedAdd;

        const T = globalThis.DSS_CHAT_MAP_MSG;
        const response = await send({ type: T.BIND, uuid: 'chat-uuid-1', presetId: 'preset-1' });
        expect(response?.ok, `BIND must be answered ok by the SW's chat-map route, got ${JSON.stringify(response)}`).toBe(true);

        const reader = await importFreshStorageManager();
        expect(await reader.getChatPresetMap(), 'binding must be readable from storage by an independent StorageManager').toEqual({ 'chat-uuid-1': 'preset-1' });
    });
});
