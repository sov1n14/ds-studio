// 275 lines: one cohesive shared test harness - the sendMessage transport double, the chrome.* boundary install/restore (module-level saved state) and the per-harness fixture methods closing over the same sync/local areas form a single boundary setup that every chat-map scenario spec consumes as a unit; splitting would only spread that shared state across files.
/**
 * Single-writer chat-map harness: one real service-worker StorageManager (writer mode via the real background/chat-map-routes.js) and N real client StorageManagers that never call initialize(), mirroring content scripts. All instances share one in-memory sync area and one local area (test/fixtures/chrome-storage-mock.js, which structuredClones on get/set).
 *
 * Mocked trust boundaries only: chrome.storage (in-memory areas), chrome.runtime.onMessage (fresh event per harness) and chrome.runtime.sendMessage (message-boundary double below). Nothing between modules is mocked.
 *
 * sendMessage double (promise form, `chrome.runtime.sendMessage(message)`): the message is structuredCloned and delivered on a later macrotask to every onMessage listener as `(message, sender, sendResponse)`. The returned promise resolves with a clone of the first sendResponse value. With no listener registered it rejects with NO_RECEIVER; when listeners exist but none called sendResponse synchronously or returned `true`, it rejects with PORT_CLOSED. Failure knobs (see `transport`) take precedence over delivery.
 *
 * Every StorageManager is a fresh module graph: vi.resetModules(), then every utils/storage-manager.* part in the order test/setup/vitest.setup.js preloads them (so parts added to the loader contract are picked up automatically), then the entry file.
 */
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';
import InMemoryStorageMock from '../fixtures/chrome-storage-mock.js';

export const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';
export const PORT_CLOSED = 'The message port closed before a response was received.';
export const CONTEXT_INVALIDATED = 'Extension context invalidated.';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PART_LOADERS = import.meta.glob('../../utils/storage-manager*.js');
const PART_ORDER = [...fs.readFileSync(path.join(HERE, '../setup/vitest.setup.js'), 'utf-8')
    .matchAll(/import '\.\.\/\.\.\/utils\/(storage-manager\.[^']+\.js)';/g)].map((m) => m[1]);

export async function importFreshStorageManager() {
    vi.resetModules();
    for (const part of PART_ORDER) await PART_LOADERS[`../../utils/${part}`]();
    const mod = await PART_LOADERS['../../utils/storage-manager.js']();
    return mod.default ?? mod;
}

const ROUTES_PATH = path.join(HERE, '../../background/chat-map-routes.js');

// Node's require, not a runtime import(): under this Vite root (test/) a runtime import() of any file outside test/ fails with "Cannot find module" even when the file exists. This require() path was proven by loading background/pending-store-routes.js (testing-pitfalls: red-for-the-right-reason).
const nodeRequire = createRequire(import.meta.url);

/** Loads a fresh copy of the routes module per call (restartServiceWorker needs a fresh install). A missing file and a failed load are distinct errors, so a broken loader cannot pass for "not implemented yet". */
export function loadRoutes() {
    if (!fs.existsSync(ROUTES_PATH)) throw new Error('[chat-map harness] background/chat-map-routes.js does not exist');
    let routes;
    try {
        delete nodeRequire.cache[ROUTES_PATH];
        routes = nodeRequire(ROUTES_PATH);
    } catch (err) {
        throw new Error(`[chat-map harness] background/chat-map-routes.js exists but failed to load: ${err.message}`);
    }
    if (typeof routes?.install === 'function') return routes;
    if (typeof globalThis.DSSChatMapRoutes?.install === 'function') return globalThis.DSSChatMapRoutes;
    throw new Error('[chat-map harness] background/chat-map-routes.js loaded but exposes no install() on module.exports or globalThis.DSSChatMapRoutes');
}

function createMessageEvent() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        listenerCount: () => listeners.size,
        listeners: () => [...listeners],
    };
}

/**
 * Message-boundary double. Knobs: failNext(mode, message) queues a one-shot failure for the next call; failAlways(mode, message) applies to every call until reset(). Modes: 'reject' (async rejection with `message`), 'throw' (sendMessage itself throws synchronously), 'hang' (promise never settles). `responses` records every cloned response delivered to a sender, newest last.
 */
function createTransport() {
    const oneShot = [];
    let persistent = null;
    const responses = [];
    const sender = { id: 'test-extension-id' };

    function deliver(message) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                const listeners = chrome.runtime.onMessage.listeners();
                if (listeners.length === 0) return reject(new Error(NO_RECEIVER));
                let hasResponded = false;
                let isAsync = false;
                const sendResponse = (response) => {
                    if (hasResponded) return;
                    hasResponded = true;
                    const copy = response === undefined ? undefined : structuredClone(response);
                    responses.push(copy);
                    resolve(copy);
                };
                for (const listener of listeners) {
                    try {
                        if (listener(structuredClone(message), sender, sendResponse) === true) isAsync = true;
                    } catch (err) {
                        console.error('[chat-map harness] onMessage listener threw:', err);
                    }
                }
                if (!hasResponded && !isAsync) reject(new Error(PORT_CLOSED));
            }, 0);
        });
    }

    function sendMessage(message) {
        const failure = oneShot.shift() ?? persistent;
        if (failure?.mode === 'throw') throw new Error(failure.message);
        if (failure?.mode === 'hang') return new Promise(() => {});
        if (failure?.mode === 'reject') return new Promise((_, reject) => setTimeout(() => reject(new Error(failure.message)), 0));
        return deliver(structuredClone(message));
    }

    return {
        sendMessage,
        responses,
        failNext: (mode, message) => { oneShot.push({ mode, message }); },
        failAlways: (mode, message) => { persistent = { mode, message }; },
        reset: () => { oneShot.length = 0; persistent = null; },
    };
}

/** UTF-8 byte length of the JSON form, the measure the chat-map chunk soft limit is defined against. */
export function byteLen(obj) {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
}

/**
 * Writes a chat-map chunk layout (null = chunk key absent) plus meta into each given storage area, as another context's committed writes would leave it. Meta defaults to version 1, chunkCount = chunks.length, real byte sizes. For specs that keep the global chrome.storage (e.g. content-script specs whose load-time listeners must survive) and so cannot use createChatMapWriterHarness.
 */
export async function writeChatMapLayout(areas, keys, chunks, metaOverride = {}) {
    const items = {
        [keys.CHAT_PRESET_MAP_META]: { version: 1, chunkCount: chunks.length, chunkSizes: chunks.map((c) => (c ? byteLen(c) : 0)), ...metaOverride },
    };
    chunks.forEach((c, i) => { if (c) items[`${keys.CHAT_PRESET_MAP_CHUNK_PREFIX}${i}`] = c; });
    for (const area of areas) await area.set(items);
}

let saved = null;

function installBoundaries(sync, local, transport) {
    saved = { storage: chrome.storage, onMessage: chrome.runtime.onMessage, sendMessage: chrome.runtime.sendMessage };
    const onChanged = {
        addListener: (fn) => { sync.onChanged.addListener(fn); local.onChanged.addListener(fn); },
        removeListener: (fn) => { sync.onChanged.removeListener(fn); local.onChanged.removeListener(fn); },
    };
    chrome.storage = { ...saved.storage, sync, local, onChanged };
    chrome.runtime.onMessage = createMessageEvent();
    chrome.runtime.sendMessage = transport.sendMessage;
}

/** Restores the chrome.* boundaries replaced by createChatMapWriterHarness. Idempotent; call from afterEach. */
export function restoreChromeBoundaries() {
    if (!saved) return;
    chrome.storage = saved.storage;
    chrome.runtime.onMessage = saved.onMessage;
    chrome.runtime.sendMessage = saved.sendMessage;
    saved = null;
}

async function startServiceWorker() {
    const sw = await importFreshStorageManager();
    const routes = loadRoutes();
    routes.install({ storageManager: sw });
    return sw;
}

/**
 * Builds the shared storage, the SW writer and `clientCount` never-initialized clients. Rejects with a "[chat-map harness]" error when the routes module is missing, after restoring the boundaries.
 */
export async function createChatMapWriterHarness({ clientCount = 2 } = {}) {
    restoreChromeBoundaries();
    const sync = new InMemoryStorageMock('sync');
    const local = new InMemoryStorageMock('local');
    const transport = createTransport();
    installBoundaries(sync, local, transport);
    const h = { sync, local, transport, sw: null, clients: [] };
    try {
        h.sw = await startServiceWorker();
        for (let i = 0; i < clientCount; i++) h.clients.push(await importFreshStorageManager());
    } catch (err) {
        restoreChromeBoundaries();
        throw err;
    }
    const keys = h.sw.KEYS;
    h.metaKey = keys.CHAT_PRESET_MAP_META;
    h.chunkKey = (i) => `${keys.CHAT_PRESET_MAP_CHUNK_PREFIX}${i}`;
    h.chunkLimit = h.sw.CHUNK_SOFT_LIMIT_BYTES;
    if (typeof h.chunkLimit !== 'number') throw new Error('[chat-map harness] StorageManager.CHUNK_SOFT_LIMIT_BYTES is not exposed');

    /** Simulates SW termination + restart: a fresh onMessage event, a fresh StorageManager import and a fresh routes install on the same storage. */
    h.restartServiceWorker = async () => {
        chrome.runtime.onMessage = createMessageEvent();
        h.sw = await startServiceWorker();
    };

    /** Writes chunks (null = chunk key absent) plus meta to sync and local. Meta defaults to version 1, chunkCount = chunks.length, real byte sizes. */
    h.seedChatMap = (chunks, metaOverride = {}) => writeChatMapLayout([sync, local], keys, chunks, metaOverride);

    h.seedPresetIndex = async (ids) => {
        await sync.set({ [keys.PRESET_INDEX]: ids });
        await local.set({ [keys.PRESET_INDEX]: ids });
    };

    /** A chunk whose byte size sits `headroom` bytes under the soft limit, so no short binding fits into it. */
    h.fullChunk = (headroom = 3) => {
        const chunk = { '@fill': '' };
        chunk['@fill'] = 'F'.repeat(h.chunkLimit - headroom - byteLen(chunk));
        return chunk;
    };

    /** Durable sync state: meta, every chunk key present (by index), and the merged map of chunks 0..chunkCount-1. */
    h.readStored = async () => {
        const all = await sync.get(null);
        const meta = all[h.metaKey] ?? null;
        const prefix = keys.CHAT_PRESET_MAP_CHUNK_PREFIX;
        const chunks = {};
        for (const [k, v] of Object.entries(all)) {
            if (k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length))) chunks[Number(k.slice(prefix.length))] = v;
        }
        const map = {};
        for (let i = 0; i < (meta?.chunkCount ?? 0); i++) Object.assign(map, chunks[i] ?? {});
        return { meta, chunks, map };
    };

    /** Layout invariants as human-readable violations; [] means consistent. */
    h.layoutProblems = (stored) => {
        const problems = [];
        const count = stored.meta?.chunkCount;
        if (typeof count !== 'number') return ['meta.chunkCount missing'];
        const indices = Object.keys(stored.chunks).map(Number).sort((a, b) => a - b);
        const expected = Array.from({ length: count }, (_, i) => i);
        if (JSON.stringify(indices) !== JSON.stringify(expected)) problems.push(`chunk keys [${indices}] != [${expected}]`);
        if (count > 0 && Object.keys(stored.chunks[count - 1] ?? {}).length === 0) problems.push(`trailing chunk ${count - 1} is empty`);
        const seen = {};
        for (const i of indices) {
            for (const uuid of Object.keys(stored.chunks[i])) {
                if (uuid in seen) problems.push(`uuid ${uuid} in chunks ${seen[uuid]} and ${i}`);
                seen[uuid] = i;
            }
        }
        return problems;
    };

    /**
     * One-shot concurrent-writer interleave: the next set()/remove() on either area (from any context) is held until `action` has run, then applied with the items it was called with (cloned at call time, as real chrome.storage does). This models another context's write landing between a caller's snapshot read and its write-back. Writes issued by `action` itself pass through. If `action` has not settled within `ms` (it may be queued behind the held write) the held write proceeds and `action` keeps running. Returns hasTripped() and done() (the promise of `action`, null until tripped).
     */
    h.interleaveBeforeNextWrite = (action, ms = 1000) => {
        let isArmed = true;
        let hasTripped = false;
        let done = null;
        const restorers = [];
        for (const area of [sync, local]) {
            for (const method of ['set', 'remove']) {
                const original = area[method];
                restorers.push(() => { area[method] = original; });
                area[method] = function held(arg, callback) {
                    if (!isArmed) return original.call(area, arg, callback);
                    isArmed = false;
                    hasTripped = true;
                    restorers.forEach((restore) => restore());
                    const copy = structuredClone(arg);
                    done = Promise.resolve().then(action);
                    const gate = new Promise((r) => { setTimeout(r, ms); });
                    const apply = Promise.race([done.catch(() => {}), gate]).then(() => original.call(area, copy, callback));
                    return callback ? undefined : apply;
                };
            }
        }
        return { done: () => done, hasTripped: () => hasTripped };
    };

    return h;
}

/** Rejects with `label` if `promise` does not settle within `ms` real milliseconds, so a blocked client chain fails fast with a clear reason. */
export function within(promise, ms, label) {
    let timer;
    const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`[chat-map harness] ${label}: did not settle within ${ms} ms`)), ms); });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}
