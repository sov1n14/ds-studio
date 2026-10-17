// 273 lines: one mutant-kill spec for the chat-map single-writer path (routes, ops, engine, diff); the dispatch requires every kill test in this single file, and the four describe blocks share one install/dispatch/seed helper set.
/**
 * Mutant-kill spec for the chat-map single-writer path: background/chat-map-routes.js, utils/storage-manager.chatmap.ops.js, utils/storage-manager.chatmap.js and utils/storage-manager.chatmap.diff.js.
 *
 * Contracts asserted (observable only): load-order guards fail with an Error naming the missing dependency (not an incidental TypeError); the onMessage listener answers invalid ops synchronously and returns false; engine rejections become { ok: false, error: <meaningful string> }; the engine rejects invalid ops with ChatMapDispatchError and writer-only ops from a non-writer without writing; a delete writes only the chunk holding the uuid; the chunk soft limit is exclusive.
 *
 * Trust boundaries mocked: chrome.storage (setup fixture, structuredClones, cleared per test) and chrome.runtime.onMessage (listener captured off addListener). StorageManager instances are real and fresh per test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { byteLen, importFreshStorageManager, loadRoutes } from '../helpers/chat-map-writer-harness.js';

const MSG = globalThis.DSS_CHAT_MAP_MSG;
const OPS = globalThis.DSSChatMapOps;
const META = 'chatPresetMapMeta';
const LEGACY = 'chatPresetMap';
const chunkKey = (i) => `chatPresetMap_${i}`;

let SM;

/** Installs the routes on `sm`; returns the single captured onMessage listener. */
function installRoutes(sm) {
    const captured = [];
    const spy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { captured.push(fn); });
    try {
        loadRoutes().install({ storageManager: sm });
    } finally {
        spy.mockRestore();
    }
    expect(captured).toHaveLength(1);
    return captured[0];
}

/** Calls the listener like the runtime; `response` resolves with the first sendResponse value or rejects after 2 s. */
function dispatch(listener, message) {
    let resolve;
    const responded = new Promise((r) => { resolve = r; });
    const sendResponse = vi.fn((r) => resolve(r));
    const result = listener(message, { id: 'test-extension-id' }, sendResponse);
    const syncCalls = sendResponse.mock.calls.length;
    let timer;
    const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no sendResponse for ${message?.type}`)), 2000); });
    const response = () => Promise.race([responded, guard]).finally(() => clearTimeout(timer));
    return { result, syncCalls, sendResponse, response };
}

async function seed(area, items) {
    await chrome.storage[area].set(items);
}

async function seedChunks(chunks, metaOverride = {}) {
    const items = {};
    items[META] = { version: 1, chunkCount: chunks.length, chunkSizes: chunks.map(byteLen), ...metaOverride };
    chunks.forEach((c, i) => { items[chunkKey(i)] = c; });
    await seed('sync', items);
    await seed('local', items);
}

/** Captures an Error thrown synchronously by fn (fails the test if nothing is thrown). */
function thrownBy(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    throw new Error('expected a throw, got none');
}

/** A load-order / precondition error: a plain Error, not an incidental TypeError from dereferencing the missing value, whose message names `pattern`. */
function expectNamedError(err, pattern) {
    expect(err).toBeInstanceOf(Error);
    expect(err, `got incidental ${err?.name}: ${err?.message}`).not.toBeInstanceOf(TypeError);
    expect(err.message).toMatch(pattern);
}

beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    SM = await importFreshStorageManager();
});

afterEach(() => {
    globalThis.DSS_CHAT_MAP_MSG = MSG;
    globalThis.DSSChatMapOps = OPS;
    vi.restoreAllMocks();
});

describe('chat-map-routes: install and load-order guards', () => {
    it('install without a storageManager throws an Error naming storageManager', () => {
        const routes = loadRoutes();
        expectNamedError(thrownBy(() => routes.install({})), /storageManager/);
        expectNamedError(thrownBy(() => routes.install()), /storageManager/);
    });

    it('a chat-map message with DSS_CHAT_MAP_MSG missing fails loudly, naming message-constants.js', () => {
        const listener = installRoutes(SM);
        delete globalThis.DSS_CHAT_MAP_MSG;
        const err = thrownBy(() => listener({ type: MSG.BIND, uuid: 'u1', presetId: 'p1' }, {}, () => {}));
        expectNamedError(err, /message-constants\.js/);
    });

    it('a chat-map message with DSSChatMapOps missing fails loudly, naming storage-manager.chatmap.ops.js', () => {
        const listener = installRoutes(SM);
        delete globalThis.DSSChatMapOps;
        const err = thrownBy(() => listener({ type: MSG.BIND, uuid: 'u1', presetId: 'p1' }, {}, () => {}));
        expectNamedError(err, /storage-manager\.chatmap\.ops\.js/);
    });
});

describe('chat-map-routes: listener responses', () => {
    it('an undefined message is not handled: returns false, does not throw, never responds', () => {
        const listener = installRoutes(SM);
        const sendResponse = vi.fn();
        let result;
        expect(() => { result = listener(undefined, {}, sendResponse); }).not.toThrow();
        expect(result).toBe(false);
        expect(sendResponse).not.toHaveBeenCalled();
    });

    it('an invalid op is answered synchronously with { ok: false, error } and the listener returns false; storage untouched', async () => {
        const listener = installRoutes(SM);
        const d = dispatch(listener, { type: MSG.BIND, uuid: '', presetId: 'p1' });
        expect(d.result).toBe(false);
        expect(d.syncCalls).toBe(1);
        const [response] = d.sendResponse.mock.calls[0];
        expect(response.ok).toBe(false);
        expect(typeof response.error).toBe('string');
        expect(response.error.length).toBeGreaterThan(0);
        await new Promise((r) => setTimeout(r, 20));
        expect(d.sendResponse).toHaveBeenCalledTimes(1);
        expect(await chrome.storage.sync.get(null)).toEqual({});
    });

    it.each([
        ['an Error', new Error('quota blown'), 'quota blown'],
        ['a string', 'plain string failure', 'plain string failure'],
    ])('an engine rejection with %s answers { ok: false, error: <its text> }', async (_label, rejection, expected) => {
        const listener = installRoutes(SM);
        vi.spyOn(SM, 'applyChatMapOp').mockRejectedValue(rejection);
        const d = dispatch(listener, { type: MSG.BIND, uuid: 'u1', presetId: 'p1' });
        expect(d.result).toBe(true);
        expect(await d.response()).toEqual({ ok: false, error: expected });
    });

    it('an engine rejection with null answers { ok: false } with a non-empty fallback error string', async () => {
        const listener = installRoutes(SM);
        vi.spyOn(SM, 'applyChatMapOp').mockRejectedValue(null);
        const d = dispatch(listener, { type: MSG.BIND, uuid: 'u1', presetId: 'p1' });
        const response = await d.response();
        expect(response.ok).toBe(false);
        expect(typeof response.error).toBe('string');
        expect(response.error.length).toBeGreaterThan(0);
        expect(response.error).not.toBe('null');
    });
});

describe('DSSChatMapOps.validate / apply', () => {
    const ops = () => globalThis.DSSChatMapOps;

    it.each([
        ['null', null],
        ['a string', 'x'],
        ['a function carrying a valid BIND payload', Object.assign(() => {}, { type: MSG.BIND, uuid: 'u1', presetId: 'p1' })],
    ])('validate(%s) returns { ok: false, error: <non-empty> } without throwing', (_label, msg) => {
        let verdict;
        expect(() => { verdict = ops().validate(msg); }).not.toThrow();
        expect(verdict.ok).toBe(false);
        expect(typeof verdict.error).toBe('string');
        expect(verdict.error.length).toBeGreaterThan(0);
    });

    it('validate accepts MERGE entries created with Object.create(null)', () => {
        const entries = Object.create(null);
        entries.u1 = 'p1';
        expect(ops().validate({ type: MSG.MERGE, entries })).toEqual({ ok: true });
    });

    it('with DSS_CHAT_MAP_MSG missing, validate fails loudly naming the missing global', () => {
        delete globalThis.DSS_CHAT_MAP_MSG;
        expectNamedError(thrownBy(() => ops().validate({ type: 'DSS_CHAT_MAP_BIND', uuid: 'u1', presetId: 'p1' })), /DSS_CHAT_MAP_MSG/);
    });

    it.each([
        ['MIGRATE_LEGACY (no map transform)', { type: MSG.MIGRATE_LEGACY }],
        ['an undefined msg', undefined],
    ])('apply with %s throws a descriptive Error, not a TypeError, and leaves the map untouched', (_label, msg) => {
        const map = { u1: 'p1' };
        const err = thrownBy(() => ops().apply(map, msg));
        expect(err).toBeInstanceOf(Error);
        expect(err, `got incidental ${err?.name}: ${err?.message}`).not.toBeInstanceOf(TypeError);
        expect(err.message.length).toBeGreaterThan(0);
        expect(map).toEqual({ u1: 'p1' });
    });
});

describe('StorageManager chat-map engine', () => {
    it('reads a stored layout whose meta lacks chunkSizes', async () => {
        await seed('sync', { [META]: { version: 1, chunkCount: 1 }, [chunkKey(0)]: { u1: 'p1' } });
        await expect(SM.getChatPresetMap()).resolves.toEqual({ u1: 'p1' });
    });

    it('a writer rejects an invalid op with ChatMapDispatchError and writes nothing', async () => {
        SM.enableChatMapWriterMode();
        await seedChunks([{ u1: 'p1' }]);
        const before = await chrome.storage.sync.get(null);
        const err = await SM.applyChatMapOp({ type: 'DSS_CHAT_MAP_BOGUS' }).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(SM.errors.ChatMapDispatchError);
        expect(await chrome.storage.sync.get(null)).toEqual(before);
    });

    it('a non-writer applyChatMapOp(MIGRATE_LEGACY) rejects with a non-empty error and migrates nothing', async () => {
        await seed('sync', { [LEGACY]: { u1: 'p1' } });
        await seed('local', { [LEGACY]: { u1: 'p1' } });
        const sync = await chrome.storage.sync.get(null);
        const local = await chrome.storage.local.get(null);
        const err = await SM.applyChatMapOp({ type: MSG.MIGRATE_LEGACY }).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.message.length).toBeGreaterThan(0);
        expect(await chrome.storage.sync.get(null)).toEqual(sync);
        expect(await chrome.storage.local.get(null)).toEqual(local);
    });

    it('a non-writer applyChatMapOp(REPUBLISH_PARKED) rejects with a non-empty error and publishes nothing', async () => {
        await seedChunks([{ u1: 'p1' }]);
        await seed('local', { [chunkKey(0)]: { u1: 'p2' }, dsLocalAuth: [chunkKey(0)] });
        const sync = await chrome.storage.sync.get(null);
        const local = await chrome.storage.local.get(null);
        const err = await SM.applyChatMapOp({ type: MSG.REPUBLISH_PARKED, keys: [chunkKey(0)] }).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.message.length).toBeGreaterThan(0);
        expect(await chrome.storage.sync.get(null)).toEqual(sync);
        expect(await chrome.storage.local.get(null)).toEqual(local);
    });

    it('unbinding a uuid writes only the chunk that holds it (plus meta)', async () => {
        SM.enableChatMapWriterMode();
        await seedChunks([{ u1: 'p1' }, { u2: 'p2' }]);
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');
        await SM.applyChatMapOp({ type: MSG.UNBIND, uuid: 'u1' });
        const written = new Set(setSpy.mock.calls.flatMap(([items]) => Object.keys(items)));
        expect(written.has(chunkKey(0)), 'chunk 0 holds u1 and must be rewritten').toBe(true);
        expect(written.has(chunkKey(1)), 'chunk 1 does not hold u1 and must not be rewritten').toBe(false);
        const stored = await chrome.storage.sync.get(null);
        expect(stored[chunkKey(1)]).toEqual({ u2: 'p2' });
        expect(stored[chunkKey(0)]).toEqual({});
    });

    /** Chunk 0 filled so that byteLen(chunk0) + byteLen({ u: 'p' }) === CHUNK_SOFT_LIMIT_BYTES + offset. */
    async function bindAgainstFilledChunk(offset) {
        SM.enableChatMapWriterMode();
        const limit = SM.CHUNK_SOFT_LIMIT_BYTES;
        expect(typeof limit).toBe('number');
        const entrySize = byteLen({ u: 'p' });
        const chunk0 = { fill: '' };
        chunk0.fill = 'F'.repeat(limit + offset - entrySize - byteLen(chunk0));
        expect(byteLen(chunk0) + entrySize).toBe(limit + offset);
        await seedChunks([chunk0]);
        await SM.applyChatMapOp({ type: MSG.BIND, uuid: 'u', presetId: 'p' });
        return chrome.storage.sync.get(null);
    }

    it('an entry that would bring a chunk exactly to the soft limit opens a new chunk', async () => {
        const stored = await bindAgainstFilledChunk(0);
        expect(stored[chunkKey(1)]).toEqual({ u: 'p' });
        expect(Object.hasOwn(stored[chunkKey(0)], 'u')).toBe(false);
        expect(stored[META].chunkCount).toBe(2);
    });

    it('an entry one byte under the soft limit stays in the existing chunk', async () => {
        const stored = await bindAgainstFilledChunk(-1);
        expect(stored[chunkKey(0)].u).toBe('p');
        expect(stored[chunkKey(1)]).toBeUndefined();
        expect(stored[META].chunkCount).toBe(1);
    });
});
