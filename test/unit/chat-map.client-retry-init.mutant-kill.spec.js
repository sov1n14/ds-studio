/**
 * Mutant-kill spec for the chat-map client dispatch (utils/storage-manager.chatmap.client.js), the writer's park/unpark and legacy-migration tasks (utils/storage-manager.chatmap.js), initialize()'s chat-map failure tolerance (utils/storage-manager.init.js) and retrySync()'s chat-map hand-off (utils/storage-manager.sync.retry.js).
 *
 * Contracts asserted (observable only): a "Receiving end does not exist" rejection (Error or plain string) is retried exactly once after ~100 ms; any other rejection, including `undefined`, and a synchronous sendMessage throw propagate unchanged without retry; a send that never answers rejects after 10 s with a descriptive Error; a settled send leaves no pending timer; a missing or unsuccessful response rejects with ChatMapDispatchError carrying a reason; a missing DSS_CHAT_MAP_MSG fails loudly naming the missing global; a commit/republish unparks only chat-map keys it handled; a legacy map that is not an object with entries is removed without writing chunks; initialize() and retrySync() tolerate an `undefined` dispatch rejection with or without __DS_Logger; retrySync sends only parked chat-map keys to the SW, and only when there is at least one.
 *
 * Trust boundaries mocked: chrome.storage (setup fixture, structuredClones, cleared per test) and chrome.runtime.sendMessage (spied per test; observing its calls is a boundary observation). StorageManager instances are real and fresh per test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { importFreshStorageManager, NO_RECEIVER } from '../helpers/chat-map-writer-harness.js';

const MSG = globalThis.DSS_CHAT_MAP_MSG;
const LOGGER = globalThis.__DS_Logger;
const META = 'chatPresetMapMeta';
const LEGACY = 'chatPresetMap';
const AUTH = 'dsLocalAuth';
const PRESET_KEY = 'dsPreset_p1';
const chunkKey = (i) => `chatPresetMap_${i}`;
const OK = { ok: true, map: {} };

let SM;
let send;

/** Settles `promise` into { status, value | reason } so an `undefined` rejection stays distinguishable. */
const settle = (promise) => promise.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));

/** sendMessage calls whose message has the given type. */
const sentOfType = (type) => send.mock.calls.map(([m]) => m).filter((m) => m?.type === type);

beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    SM = await importFreshStorageManager();
    send = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(OK);
});

afterEach(() => {
    vi.useRealTimers();
    globalThis.DSS_CHAT_MAP_MSG = MSG;
    globalThis.__DS_Logger = LOGGER;
    vi.restoreAllMocks();
});

describe('client dispatch: retry policy at the sendMessage boundary', () => {
    it('a "Receiving end does not exist" rejection is retried once, ~100 ms later, not immediately', async () => {
        vi.useFakeTimers();
        send.mockRejectedValueOnce(new Error(NO_RECEIVER));
        const pending = settle(SM.bindChatToPreset('u1', 'p1'));
        await vi.advanceTimersByTimeAsync(50);
        expect(send, 'no retry before the retry delay has elapsed').toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(100);
        expect(send).toHaveBeenCalledTimes(2);
        expect(await pending).toEqual({ status: 'fulfilled', value: true });
    });

    it('a plain-string "Receiving end does not exist" rejection is retried once', async () => {
        send.mockRejectedValueOnce(NO_RECEIVER);
        expect(await settle(SM.bindChatToPreset('u1', 'p1'))).toEqual({ status: 'fulfilled', value: true });
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('an undefined rejection propagates as-is, without retry and without a TypeError', async () => {
        send.mockRejectedValueOnce(undefined);
        expect(await settle(SM.bindChatToPreset('u1', 'p1'))).toEqual({ status: 'rejected', reason: undefined });
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('a synchronous sendMessage throw rejects the dispatch with the original error', async () => {
        const boom = new Error('sendMessage exploded');
        send.mockImplementationOnce(() => { throw boom; });
        const result = await settle(SM.bindChatToPreset('u1', 'p1'));
        expect(result.status).toBe('rejected');
        expect(result.reason).toBe(boom);
        expect(send).toHaveBeenCalledTimes(1);
    });
});

describe('client dispatch: timeout and response handling', () => {
    it('a send that never answers rejects after 10 s with a descriptive Error naming the message type', async () => {
        vi.useFakeTimers();
        send.mockImplementation(() => new Promise(() => {}));
        const pending = settle(SM.bindChatToPreset('u1', 'p1'));
        let isSettled = false;
        pending.then(() => { isSettled = true; });
        await vi.advanceTimersByTimeAsync(9999);
        expect(isSettled, 'must not give up before 10 s').toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const result = await pending;
        expect(result.status).toBe('rejected');
        expect(result.reason).toBeInstanceOf(Error);
        expect(result.reason.message.length).toBeGreaterThan(0);
        expect(result.reason.message).toContain(MSG.BIND);
    });

    it('a successful response leaves no pending response-timeout timer behind', async () => {
        vi.useFakeTimers();
        const baseline = vi.getTimerCount();
        expect(await settle(SM.bindChatToPreset('u1', 'p1'))).toEqual({ status: 'fulfilled', value: true });
        expect(vi.getTimerCount(), 'the response timeout must be cleared once the send settles').toBe(baseline);
        await vi.advanceTimersByTimeAsync(10_001);
        expect(vi.getTimerCount()).toBe(baseline);
    });

    it.each([
        ['an undefined response', undefined],
        ['{ ok: false } without error', { ok: false }],
    ])('%s rejects with ChatMapDispatchError whose message carries a reason', async (_label, response) => {
        send.mockResolvedValueOnce(response);
        const result = await settle(SM.bindChatToPreset('u1', 'p1'));
        expect(result.status).toBe('rejected');
        expect(result.reason).toBeInstanceOf(SM.errors.ChatMapDispatchError);
        const text = result.reason.message.trim();
        expect(text.length).toBeGreaterThan(0);
        expect(text, 'the reason after the separator must not be empty').not.toMatch(/[:：]$/);
    });

    it('with DSS_CHAT_MAP_MSG missing, a dispatch fails loudly naming the missing global, not with a TypeError', async () => {
        delete globalThis.DSS_CHAT_MAP_MSG;
        const result = await settle(SM.bindChatToPreset('u1', 'p1'));
        expect(result.status).toBe('rejected');
        expect(result.reason).toBeInstanceOf(Error);
        expect(result.reason, `got ${result.reason?.name}: ${result.reason?.message}`).not.toBeInstanceOf(TypeError);
        expect(result.reason.message).toMatch(/DSS_CHAT_MAP_MSG|message-constants\.js/);
        expect(send).not.toHaveBeenCalled();
    });
});

describe('writer engine: park bookkeeping and legacy migration', () => {
    beforeEach(() => SM.enableChatMapWriterMode());

    it('a chat-map commit unparks only the keys it committed; an unrelated parked key stays', async () => {
        await chrome.storage.local.set({ [AUTH]: [PRESET_KEY, chunkKey(0)] });
        await SM.applyChatMapOp({ type: MSG.BIND, uuid: 'u1', presetId: 'p1' });
        expect((await chrome.storage.local.get(AUTH))[AUTH]).toEqual([PRESET_KEY]);
    });

    it('REPUBLISH_PARKED with mixed keys republishes and unparks only the chat-map keys', async () => {
        await chrome.storage.local.set({ [chunkKey(0)]: { u1: 'p1' }, [PRESET_KEY]: { id: 'p1' }, [AUTH]: [chunkKey(0), PRESET_KEY] });
        await SM.applyChatMapOp({ type: MSG.REPUBLISH_PARKED, keys: [chunkKey(0), PRESET_KEY] });
        const sync = await chrome.storage.sync.get(null);
        expect(sync[chunkKey(0)]).toEqual({ u1: 'p1' });
        expect(Object.hasOwn(sync, PRESET_KEY), 'a non-chat-map key must not be published by the chat-map writer').toBe(false);
        expect((await chrome.storage.local.get(AUTH))[AUTH]).toEqual([PRESET_KEY]);
    });

    it.each([
        ['null', null],
        ['a non-empty string', 'abc'],
    ])('MIGRATE_LEGACY with a legacy map of %s resolves, removes the legacy key and writes no chunks', async (_label, legacy) => {
        await chrome.storage.sync.set({ [LEGACY]: legacy });
        await chrome.storage.local.set({ [LEGACY]: legacy });
        await expect(SM.applyChatMapOp({ type: MSG.MIGRATE_LEGACY })).resolves.toEqual({});
        for (const area of ['sync', 'local']) {
            const keys = Object.keys(await chrome.storage[area].get(null));
            expect(keys.filter((k) => k === LEGACY || k === META || k.startsWith('chatPresetMap_')), `${area} chat-map keys`).toEqual([]);
        }
    });
});

/** Two logger situations for the undefined-rejection catch paths: the logger absent, and present (so its arguments are evaluated). */
const LOGGER_CASES = [
    ['__DS_Logger undefined', () => { delete globalThis.__DS_Logger; }],
    ['__DS_Logger present', () => {}],
];

describe('initialize(): chat-map dispatch failures do not abort initialization', () => {
    it.each(LOGGER_CASES)('with %s, migrate and prune rejecting with undefined, initialize() resolves', async (_label, arrange) => {
        await chrome.storage.sync.set({ [LEGACY]: { u1: 'p1' }, dsPresetIndex: ['p1'] });
        await chrome.storage.local.set({ [LEGACY]: { u1: 'p1' }, dsPresetIndex: ['p1'] });
        send.mockRejectedValue(undefined);
        arrange();
        expect(await settle(SM.initialize())).toEqual({ status: 'fulfilled', value: undefined });
        expect(sentOfType(MSG.MIGRATE_LEGACY), 'the migrate dispatch must have been attempted').toHaveLength(1);
        expect(sentOfType(MSG.PRUNE_ORPHANS), 'the prune dispatch must have been attempted').toHaveLength(1);
    });
});

describe('retrySync(): chat-map hand-off to the service worker', () => {
    it('sends only the parked chat-map keys in REPUBLISH_PARKED, never a parked non-chat-map key', async () => {
        await chrome.storage.local.set({ [PRESET_KEY]: { id: 'p1' }, [chunkKey(0)]: { u1: 'p1' }, [AUTH]: [chunkKey(0), PRESET_KEY] });
        await SM.retrySync();
        const sent = sentOfType(MSG.REPUBLISH_PARKED);
        expect(sent).toHaveLength(1);
        expect(sent[0].keys).toEqual([chunkKey(0)]);
    });

    it('an unresolved parked chat-map key survives the cleanup of a resolved (locally deleted) key', async () => {
        await chrome.storage.local.set({ [AUTH]: [chunkKey(0), 'dsPreset_gone'] });
        send.mockRejectedValue(new Error('The message port closed before a response was received.'));
        const result = await SM.retrySync();
        expect((await chrome.storage.local.get(AUTH))[AUTH]).toEqual([chunkKey(0)]);
        expect(result).toEqual({ success: false, remainingUnsyncedCount: 1 });
    });

    it('does not dispatch REPUBLISH_PARKED when no chat-map key is parked', async () => {
        await chrome.storage.local.set({ [AUTH]: ['dsPreset_gone'] });
        await SM.retrySync();
        expect(sentOfType(MSG.REPUBLISH_PARKED)).toEqual([]);
    });

    it.each(LOGGER_CASES)('with %s and REPUBLISH_PARKED rejecting with undefined, retrySync() resolves and keeps the key parked', async (_label, arrange) => {
        await chrome.storage.local.set({ [AUTH]: [chunkKey(0)] });
        send.mockRejectedValue(undefined);
        arrange();
        const result = await settle(SM.retrySync());
        expect(result).toEqual({ status: 'fulfilled', value: { success: false, remainingUnsyncedCount: 1 } });
        expect(sentOfType(MSG.REPUBLISH_PARKED)).toHaveLength(1);
    });
});
