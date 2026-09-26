/**
 * background/chat-map-routes.js — service-worker single writer of the chat→preset binding map.
 *
 * Contract (from the step directive; the routes file did not exist when this was written): install({ storageManager }) puts the injected manager into writer mode and registers ONE chrome.runtime.onMessage listener. Known DSS_CHAT_MAP_MSG types return true and answer once, asynchronously, with { ok: true, map } (the full new map); invalid payloads and engine failures answer { ok: false, error }. Unknown types return false and never answer. MIGRATE_LEGACY and REPUBLISH_PARKED are out of scope here.
 *
 * Mocked trust boundaries only: chrome.storage (the in-memory fixture from vitest.setup.js, which structuredClones on get/set) and chrome.runtime.onMessage (listener captured off addListener so its return value is observable). The StorageManager is a real, fresh instance per test. Assertions are on responses and on storage.sync end-state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { byteLen, importFreshStorageManager as loadFreshManager, loadRoutes as loadRoutesModule } from '../helpers/chat-map-writer-harness.js';

const MSG = globalThis.DSS_CHAT_MAP_MSG;
const META = 'chatPresetMapMeta';
const chunkKey = (i) => `chatPresetMap_${i}`;
const SENDER = { id: 'test-extension-id' };

/** Fresh routes module per call (shared harness loader), plus this spec's own contract that install is also published on globalThis.DSSChatMapRoutes. */
function loadRoutes() {
    const routes = loadRoutesModule();
    expect(globalThis.DSSChatMapRoutes?.install, 'install must also be published on globalThis.DSSChatMapRoutes').toBeTypeOf('function');
    return routes;
}

/** Installs the routes on `sm` and returns the captured listeners. */
function install(sm, routes = loadRoutes()) {
    const captured = [];
    const spy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { captured.push(fn); });
    try {
        routes.install({ storageManager: sm });
    } finally {
        spy.mockRestore();
    }
    return captured;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

function withTimeout(promise, ms, label) {
    let timer;
    const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: no sendResponse within ${ms} ms`)), ms); });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

let SM;
let listener;

/** Calls the listener like the runtime would (cloned message). `response` is a lazy getter: it resolves with the first sendResponse value, and its 2 s no-response timer only arms when a test reads it, so a case asserting "never responds" leaves no pending rejection behind. */
function dispatch(message) {
    let resolve;
    const responded = new Promise((r) => { resolve = r; });
    const sendResponse = vi.fn((r) => resolve(r));
    const result = listener(structuredClone(message), SENDER, sendResponse);
    const syncCalls = sendResponse.mock.calls.length;
    return { result, syncCalls, sendResponse, get response() { return withTimeout(responded, 2000, message?.type); } };
}

async function seedMap(chunks, version = 3) {
    const items = { [META]: { version, chunkCount: chunks.length, chunkSizes: chunks.map(byteLen) } };
    chunks.forEach((c, i) => { items[chunkKey(i)] = c; });
    await chrome.storage.sync.set(items);
    await chrome.storage.local.set(items);
}

async function seedPresetIndex(ids) {
    await chrome.storage.sync.set({ dsPresetIndex: ids });
    await chrome.storage.local.set({ dsPresetIndex: ids });
}

/** The map a reader sees in storage.sync: chunks 0..meta.chunkCount-1 merged. */
async function storedMap() {
    const all = await chrome.storage.sync.get(null);
    const out = {};
    for (let i = 0; i < (all[META]?.chunkCount ?? 0); i++) Object.assign(out, all[chunkKey(i)] || {});
    return out;
}

let savedGlobalSM;

beforeEach(async () => {
    savedGlobalSM = Object.getOwnPropertyDescriptor(globalThis, 'StorageManager');
    SM = await loadFreshManager();
    listener = undefined;
});

afterEach(() => {
    chrome.storage.sync.setQuotaError(false);
    if (savedGlobalSM) Object.defineProperty(globalThis, 'StorageManager', savedGlobalSM);
    else delete globalThis.StorageManager;
    vi.restoreAllMocks();
});

describe('install({ storageManager })', () => {
    it('registers exactly one onMessage listener', () => {
        const captured = install(SM);
        expect(captured).toHaveLength(1);
        expect(captured[0]).toBeTypeOf('function');
    });

    it('puts the injected manager into writer mode', async () => {
        const routes = loadRoutes();
        await expect((async () => SM.mutateChatPresetMap((m) => { m.pre = 'p0'; }))(), 'precondition: a fresh manager must reject as non-writer').rejects.toThrow(/writer/i);
        install(SM, routes);
        await expect(SM.mutateChatPresetMap((m) => { m.x = 'p1'; })).resolves.toEqual({ x: 'p1' });
        expect(await storedMap()).toEqual({ x: 'p1' });
    });

    it('writes through the injected manager, not globalThis.StorageManager', async () => {
        const routes = loadRoutes();
        // Never put in writer mode, so any write routed through it rejects.
        globalThis.StorageManager = await loadFreshManager();
        [listener] = install(SM, routes);
        const { response } = dispatch({ type: MSG.BIND, uuid: 'u1', presetId: 'p1' });
        expect(await response).toEqual({ ok: true, map: { u1: 'p1' } });
        expect(await storedMap()).toEqual({ u1: 'p1' });
    });
});

describe('message routing', () => {
    beforeEach(() => { [listener] = install(SM); });

    it.each([
        ['an unknown chat-map-like type', { type: 'DSS_CHAT_MAP_NOPE', uuid: 'u1', presetId: 'p1' }],
        ['DSS_SETTINGS_MSG.GET_SETTINGS', { type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS, keys: ['x'] }],
        ['DSS_SETTINGS_MSG.SET_SETTINGS', { type: globalThis.DSS_SETTINGS_MSG.SET_SETTINGS, settings: {} }],
        ['a message without type', { uuid: 'u1', presetId: 'p1' }],
    ])('%s: returns false and never responds', async (_label, message) => {
        const { result, sendResponse } = dispatch(message);
        expect(result).toBe(false);
        await flush();
        expect(sendResponse).not.toHaveBeenCalled();
    });

    it('BIND: returns true, answers once and asynchronously with the full new map, persists it', async () => {
        await seedMap([{ a: 'p1' }]);
        const { result, syncCalls, sendResponse, response } = dispatch({ type: MSG.BIND, uuid: 'b', presetId: 'p2' });
        expect(result).toBe(true);
        expect(syncCalls, 'sendResponse must not be called synchronously').toBe(0);
        expect(await response).toEqual({ ok: true, map: { a: 'p1', b: 'p2' } });
        await flush();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(await storedMap()).toEqual({ a: 'p1', b: 'p2' });
    });

    it.each([
        ['UNBIND', { type: MSG.UNBIND, uuid: 'a' }, { b: 'p2', c: 'p1' }],
        ['UNBIND_PRESETS', { type: MSG.UNBIND_PRESETS, presetIds: ['p1'] }, { b: 'p2' }],
        ['MERGE', { type: MSG.MERGE, entries: { b: 'p9', d: 'p3' } }, { a: 'p1', b: 'p9', c: 'p1', d: 'p3' }],
    ])('%s: returns true, answers { ok: true, map } and persists the effect', async (_label, message, expected) => {
        await seedMap([{ a: 'p1', b: 'p2' }, { c: 'p1' }]);
        const { result, response } = dispatch(message);
        expect(result).toBe(true);
        expect(await response).toEqual({ ok: true, map: expected });
        expect(await storedMap()).toEqual(expected);
    });

    it('PRUNE_ORPHANS with a stored preset index drops bindings to unknown presets', async () => {
        await seedMap([{ a: 'p1', b: 'gone', c: 'p2' }]);
        await seedPresetIndex(['p1', 'p2']);
        const { result, response } = dispatch({ type: MSG.PRUNE_ORPHANS });
        expect(result).toBe(true);
        expect(await response).toEqual({ ok: true, map: { a: 'p1', c: 'p2' } });
        expect(await storedMap()).toEqual({ a: 'p1', c: 'p2' });
    });

    it('PRUNE_ORPHANS with an empty preset index is a no-op', async () => {
        await seedMap([{ a: 'p1', b: 'gone' }]);
        await seedPresetIndex([]);
        const before = await chrome.storage.sync.get(null);
        const { result, response } = dispatch({ type: MSG.PRUNE_ORPHANS });
        expect(result).toBe(true);
        expect(await response).toEqual({ ok: true, map: { a: 'p1', b: 'gone' } });
        expect(await chrome.storage.sync.get(null)).toEqual(before);
    });
});

describe('failures', () => {
    beforeEach(() => { [listener] = install(SM); });

    it.each([
        ['BIND with empty uuid', { type: MSG.BIND, uuid: '', presetId: 'p1' }],
        ['UNBIND_PRESETS with a non-array', { type: MSG.UNBIND_PRESETS, presetIds: 'p1' }],
        ['MERGE with null entries', { type: MSG.MERGE, entries: null }],
    ])('%s: answers { ok: false, error } once and leaves storage unchanged', async (_label, message) => {
        await seedMap([{ a: 'p1' }]);
        const before = await chrome.storage.sync.get(null);
        const { sendResponse, response } = dispatch(message);
        const res = await response;
        expect(res.ok).toBe(false);
        expect(typeof res.error).toBe('string');
        expect(res.error.length).toBeGreaterThan(0);
        await flush();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(await chrome.storage.sync.get(null)).toEqual(before);
    });

    it('an engine failure at the storage boundary answers { ok: false, error } and does not poison the queue', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await seedMap([{ a: 'p1' }]);
        chrome.storage.sync.setQuotaError(true);
        const failed = await dispatch({ type: MSG.BIND, uuid: 'b', presetId: 'p2' }).response;
        expect(failed.ok).toBe(false);
        expect(typeof failed.error).toBe('string');
        expect(failed.error.length).toBeGreaterThan(0);

        chrome.storage.sync.setQuotaError(false);
        const next = await dispatch({ type: MSG.BIND, uuid: 'c', presetId: 'p3' }).response;
        expect(next).toEqual({ ok: true, map: { a: 'p1', c: 'p3' } });
        expect(await storedMap()).toEqual({ a: 'p1', c: 'p3' });
    });
});

describe('ordering', () => {
    beforeEach(() => { [listener] = install(SM); });

    it('back-to-back BINDs of the same uuid persist in arrival order (last wins)', async () => {
        const first = dispatch({ type: MSG.BIND, uuid: 'u', presetId: 'p1' });
        const second = dispatch({ type: MSG.BIND, uuid: 'u', presetId: 'p2' });
        const [r1, r2] = await Promise.all([first.response, second.response]);
        expect(r1).toEqual({ ok: true, map: { u: 'p1' } });
        expect(r2).toEqual({ ok: true, map: { u: 'p2' } });
        expect(await storedMap()).toEqual({ u: 'p2' });
    });

    it('back-to-back BINDs of different uuids both persist', async () => {
        const first = dispatch({ type: MSG.BIND, uuid: 'a', presetId: 'p1' });
        const second = dispatch({ type: MSG.BIND, uuid: 'b', presetId: 'p2' });
        await Promise.all([first.response, second.response]);
        expect(await storedMap()).toEqual({ a: 'p1', b: 'p2' });
    });
});
