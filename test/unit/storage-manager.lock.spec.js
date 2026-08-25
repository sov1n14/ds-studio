import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Method C — Scoped Storage-Based Advisory Lock primitive tests.
 *
 * All tests import a fresh StorageManager instance via vi.resetModules()
 * to guarantee clean module-level state (_metaCache, _chunkIndexCache,
 * _chatPresetMapChainTail).
 *
 * The lock is exercised exclusively through the public wrapper
 * _withChatPresetMapLock(fn): the callback observes the lock state while it is
 * held, and storage is inspected after the wrapper settles to observe release
 * behaviour.
 *
 * Case 7 performs storage setup BEFORE calling vi.useFakeTimers() so that the
 * InMemoryStorageMock's setTimeout-based callbacks complete under real timers
 * during setup.
 */

const LOCK_KEY = 'chatPresetMapLock';
const LOCK_ACQUIRE_TIMEOUT_MS = 5000;

describe('StorageManager advisory lock (Method C)', () => {
    let SM;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        await chrome.storage.local.remove(LOCK_KEY);
    });

    // -------------------------------------------------------------------------
    // 1. Lock held on a free lock
    // -------------------------------------------------------------------------
    it('1. Free lock — { owner, expiresAt } is persisted while fn runs, and fn result is returned', async () => {
        const before = Date.now();
        let heldDuringFn;

        const result = await SM._withChatPresetMapLock(async () => {
            heldDuringFn = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY];
            return 'fn-result';
        });

        expect(result).toBe('fn-result');
        expect(heldDuringFn).toBeDefined();
        expect(typeof heldDuringFn.owner).toBe('string');
        expect(heldDuringFn.owner.length).toBeGreaterThan(0);
        expect(heldDuringFn.expiresAt).toBeGreaterThan(before);
    });

    // -------------------------------------------------------------------------
    // 2. Release with matching owner
    // -------------------------------------------------------------------------
    it('2. Successful completion — the lock the wrapper acquired is removed from local storage', async () => {
        let ownerDuringFn;
        await SM._withChatPresetMapLock(async () => {
            ownerDuringFn = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY].owner;
        });

        expect(ownerDuringFn).toBeDefined();
        const lock = await chrome.storage.local.get(LOCK_KEY);
        expect(lock[LOCK_KEY]).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // 3. Release with mismatched owner
    // -------------------------------------------------------------------------
    it('3. Mismatched owner at release time — foreign lock left untouched, console.warn called', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // While the wrapper holds the lock, a TTL takeover by another context is
        // simulated by replacing the record with a different owner. The
        // wrapper's release must not remove a lock it no longer owns.
        await SM._withChatPresetMapLock(async () => {
            await chrome.storage.local.set({
                [LOCK_KEY]: { owner: 'real-owner', expiresAt: Date.now() + 10000 },
            });
        });

        const lock = await chrome.storage.local.get(LOCK_KEY);
        expect(lock[LOCK_KEY]).toBeDefined();
        expect(lock[LOCK_KEY].owner).toBe('real-owner');

        expect(warnSpy).toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    // -------------------------------------------------------------------------
    // 4. TTL expiry takeover
    // -------------------------------------------------------------------------
    it('4. TTL expiry takeover — expired lock ({owner, expiresAt: now - 1}) is overwritten', async () => {
        await chrome.storage.local.set({
            [LOCK_KEY]: { owner: 'stale-owner', expiresAt: Date.now() - 1 },
        });

        const before = Date.now();
        let heldDuringFn;
        await SM._withChatPresetMapLock(async () => {
            heldDuringFn = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY];
        });

        expect(heldDuringFn.owner).toBeDefined();
        expect(heldDuringFn.owner).not.toBe('stale-owner');
        expect(heldDuringFn.expiresAt).toBeGreaterThan(before);

        const lock = await chrome.storage.local.get(LOCK_KEY);
        expect(lock[LOCK_KEY]).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // 5. Contention — second acquirer waits
    // -------------------------------------------------------------------------
    it('5. Contention — fn does not run until the held lock expires (~200 ms)',
        { timeout: 10000 },
        async () => {
            await chrome.storage.local.set({
                [LOCK_KEY]: { owner: 'holder', expiresAt: Date.now() + 200 },
            });

            const start = Date.now();
            let elapsedWhenFnRan;
            let ownerDuringFn;

            await SM._withChatPresetMapLock(async () => {
                elapsedWhenFnRan = Date.now() - start;
                ownerDuringFn = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY].owner;
            });

            // fn must not have run before the previous holder's lock expired.
            expect(elapsedWhenFnRan).toBeGreaterThanOrEqual(180);
            expect(ownerDuringFn).toBeDefined();
            expect(ownerDuringFn).not.toBe('holder');
        });

    // -------------------------------------------------------------------------
    // 6. Acquire timeout
    // -------------------------------------------------------------------------
    it('6. Acquire timeout — rejects after ~5000 ms and fn never runs',
        { timeout: 15000 },
        async () => {
            await chrome.storage.local.set({
                [LOCK_KEY]: {
                    owner: 'holder',
                    expiresAt: Date.now() + LOCK_ACQUIRE_TIMEOUT_MS + 1000,
                },
            });

            const fn = vi.fn();
            await expect(SM._withChatPresetMapLock(fn)).rejects.toThrow();
            expect(fn).not.toHaveBeenCalled();

            // The other context's lock must survive the failed attempt.
            const lock = await chrome.storage.local.get(LOCK_KEY);
            expect(lock[LOCK_KEY].owner).toBe('holder');
        });

    // -------------------------------------------------------------------------
    // 7. Post-write verification mismatch loops
    // -------------------------------------------------------------------------
    it('7. Post-write verification mismatch — loops and retries until timeout, fn never runs', async () => {
        vi.useFakeTimers();

        // Capture the original implementation before spying
        const origSafeGet = SM._safeGet;
        let lockReadCount = 0;

        vi.spyOn(SM, '_safeGet').mockImplementation(async (area, keys) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];

            // Pass through to the original for non-lock reads
            if (!(area === 'local' && keyArr.includes(LOCK_KEY))) {
                return origSafeGet.call(SM, area, keys);
            }

            lockReadCount++;

            if (lockReadCount === 1) {
                // First read: lock is free — return whatever storage has
                return origSafeGet.call(SM, area, keys);
            }

            // Verification and subsequent reads: a thief holds the lock
            return {
                [LOCK_KEY]: { owner: 'thief', expiresAt: Date.now() + 100000 },
            };
        });

        const fn = vi.fn();
        const lockedPromise = SM._withChatPresetMapLock(fn);
        // Attach a no-op catch handler BEFORE advancing timers, so Node.js
        // does not detect the rejection as unhandled during the microtask
        // that fires within advanceTimersByTimeAsync. Without this, vitest's
        // unhandled rejection detector fires before the try/catch below can
        // handle the rejection.
        lockedPromise.catch(() => {});
        await vi.advanceTimersByTimeAsync(LOCK_ACQUIRE_TIMEOUT_MS + 100);

        // Use try/catch instead of expect().rejects to avoid the race where
        // the rejection fires between advanceTimersByTimeAsync resolving and
        // expect().rejects attaching a handler (causes unhandled rejection warning).
        let rejectionError;
        try {
            await lockedPromise;
        } catch (e) {
            rejectionError = e;
        }
        expect(rejectionError).toBeDefined();
        expect(rejectionError.name).toBe('LockAcquireTimeoutError');
        expect(fn).not.toHaveBeenCalled();

        // Confirm the acquirer looped (more than just the initial read + one verify)
        expect(lockReadCount).toBeGreaterThanOrEqual(5);

        vi.useRealTimers();
    });

    // -------------------------------------------------------------------------
    // 8. _withChatPresetMapLock releases on thrown error
    // -------------------------------------------------------------------------
    it('8. _withChatPresetMapLock releases lock on thrown error and re-propagates', async () => {
        const testError = new Error('fn exploded');

        await expect(
            SM._withChatPresetMapLock(() => {
                throw testError;
            }),
        ).rejects.toThrow('fn exploded');

        // Lock must be released
        const lock = await chrome.storage.local.get(LOCK_KEY);
        expect(lock[LOCK_KEY]).toBeUndefined();
    });
});

// =============================================================================
// Generalized keyed lock API: _acquireLock(lockKey) / _releaseLock(lockKey, token)
// / _withLock(lockKey, fn)
//
// Requirement under test: the lock mechanism must be generalized to protect
// an arbitrary lockKey, while _acquireLock() with and without an explicit key
// must target the same record when the default key is used.
// =============================================================================
describe('StorageManager generalized keyed lock (_acquireLock / _releaseLock / _withLock)', () => {
    let SM;
    const KEY_A = 'lockA';
    const KEY_B = 'lockB';

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        await chrome.storage.local.remove([LOCK_KEY, KEY_A, KEY_B]);
    });

    it('independent keys — holding lockA does not block acquiring lockB', async () => {
        const tokenA = await SM._acquireLock(KEY_A);

        const start = Date.now();
        const tokenB = await SM._acquireLock(KEY_B);
        const elapsed = Date.now() - start;

        expect(tokenA).toBeDefined();
        expect(tokenB).toBeDefined();
        expect(tokenA).not.toBe(tokenB);
        // Must resolve promptly — no contention with a different key.
        expect(elapsed).toBeLessThan(200);

        const stored = await chrome.storage.local.get([KEY_A, KEY_B]);
        expect(stored[KEY_A].owner).toBe(tokenA);
        expect(stored[KEY_B].owner).toBe(tokenB);
    });

    it('same key is mutually exclusive — second acquirer waits and gets a different token',
        { timeout: 10000 },
        async () => {
            await chrome.storage.local.set({
                [KEY_A]: { owner: 'holder', expiresAt: Date.now() + 200 },
            });

            const start = Date.now();
            const token = await SM._acquireLock(KEY_A);
            const elapsed = Date.now() - start;

            expect(elapsed).toBeGreaterThanOrEqual(180);
            expect(token).toBeDefined();
            expect(token).not.toBe('holder');

            const lock = await chrome.storage.local.get(KEY_A);
            expect(lock[KEY_A].owner).toBe(token);
        });

    it('default-key compatibility — _acquireLock() with no arg targets the chatPresetMap lock key',
        { timeout: 10000 },
        async () => {
            await chrome.storage.local.set({
                [LOCK_KEY]: { owner: 'holder', expiresAt: Date.now() + 200 },
            });

            const start = Date.now();
            const token = await SM._acquireLock();
            const elapsed = Date.now() - start;

            // Must have waited for the default-key lock (held under LOCK_KEY) to expire,
            // proving _acquireLock() with no argument targets the same 'chatPresetMapLock' key.
            expect(elapsed).toBeGreaterThanOrEqual(180);
            expect(token).not.toBe('holder');

            const lock = await chrome.storage.local.get(LOCK_KEY);
            expect(lock[LOCK_KEY].owner).toBe(token);
        });

    it('release is owner-scoped — wrong token does not release another holder\'s lock', async () => {
        await chrome.storage.local.set({
            [KEY_A]: { owner: 'real-owner', expiresAt: Date.now() + 10000 },
        });

        await SM._releaseLock(KEY_A, 'wrong-token');

        const lock = await chrome.storage.local.get(KEY_A);
        expect(lock[KEY_A]).toBeDefined();
        expect(lock[KEY_A].owner).toBe('real-owner');
    });

    it('release is idempotent — releasing an already-released lock does not throw', async () => {
        const token = await SM._acquireLock(KEY_A);
        await SM._releaseLock(KEY_A, token);

        await expect(SM._releaseLock(KEY_A, token)).resolves.not.toThrow();

        const lock = await chrome.storage.local.get(KEY_A);
        expect(lock[KEY_A]).toBeUndefined();
    });

    it('_withLock releases the keyed lock on thrown error, re-propagates, and returns fn\'s result on success', async () => {
        const testError = new Error('boom');

        await expect(
            SM._withLock(KEY_A, () => {
                throw testError;
            }),
        ).rejects.toThrow('boom');

        const lockAfterThrow = await chrome.storage.local.get(KEY_A);
        expect(lockAfterThrow[KEY_A]).toBeUndefined();

        // Lock must be free — a subsequent acquire on the same key resolves promptly.
        const start = Date.now();
        await SM._acquireLock(KEY_A);
        expect(Date.now() - start).toBeLessThan(200);

        await SM._releaseLock(KEY_A, (await chrome.storage.local.get(KEY_A))[KEY_A].owner);

        const result = await SM._withLock(KEY_A, async () => 'the-result');
        expect(result).toBe('the-result');

        const lockAfterSuccess = await chrome.storage.local.get(KEY_A);
        expect(lockAfterSuccess[KEY_A]).toBeUndefined();
    });
});
