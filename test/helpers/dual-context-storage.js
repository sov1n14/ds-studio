/**
 * Dual-Context Storage Helper
 *
 * Simulates two JS contexts sharing the same chrome.storage.{sync,local} backing
 * store.  Each context gets an isolated StorageManager instance (separate
 * module-level state for _metaCache, _chunkIndexCache, _chatPresetMapChainTail)
 * but both point to the same in-memory backing store.
 *
 * onChanged events from either context fan out to ALL registered listeners from
 * both contexts via the shared storage mock instance.
 *
 * Usage:
 *   const { ctxA, ctxB } = await createDualContext();
 *   // Pre-populate storage BEFORE calling initialize() so both contexts
 *   // share the same baseline state.
 *   await ctxA.initialize();
 *   await ctxB.initialize();
 *   // Use ctxA and ctxB as independent StorageManager instances sharing storage.
 *
 * Lifecycle:
 *   beforeEach(async () => {
 *     const ctx = await createDualContext();
 *     ctxA = ctx.ctxA;
 *     ctxB = ctx.ctxB;
 *     // Optional: pre-populate storage here
 *     await ctxA.initialize();
 *     await ctxB.initialize();
 *   });
 *   afterEach(() => { clearSharedStorage(); });
 */

import InMemoryStorageMock from '../fixtures/chrome-storage-mock.js';

/** @type {InMemoryStorageMock|null} */
let _sharedSync = null;
/** @type {InMemoryStorageMock|null} */
let _sharedLocal = null;

/**
 * Create two StorageManager instances sharing the same chrome.storage backing
 * store.  Must be called inside a beforeEach or test body.
 *
 * @returns {Promise<{ctxA: typeof import('../../utils/storage-manager.js').default, ctxB: typeof import('../../utils/storage-manager.js').default}>}
 */
export async function createDualContext() {
    _sharedSync = new InMemoryStorageMock();
    _sharedLocal = new InMemoryStorageMock();

    // Point the global chrome.storage to our shared mock instances.
    // Both contexts will read/write to the same _data object.
    globalThis.chrome.storage.sync = _sharedSync;
    globalThis.chrome.storage.local = _sharedLocal;
    globalThis.chrome.storage.onChanged = _sharedLocal.onChanged;

    // --- Context A: first module load ---
    const modA = await import('../../utils/storage-manager.js');
    const ctxA = modA.default ?? modA;

    // Reset the module registry so the next import() gets fresh module-level
    // state (_metaCache, _chunkIndexCache, _chatPresetMapChainTail).
    vi.resetModules();

    // --- Context B: second module load (shared chrome.storage, independent state) ---
    const modB = await import('../../utils/storage-manager.js');
    const ctxB = modB.default ?? modB;

    return { ctxA, ctxB };
}

/**
 * Clear shared storage data.  Call in afterEach to reset state between tests.
 * Does NOT remove onChanged listeners — they are discarded when the mock
 * instances are replaced on the next createDualContext() call.
 */
export function clearSharedStorage() {
    if (_sharedSync) _sharedSync.clear();
    if (_sharedLocal) _sharedLocal.clear();
}
