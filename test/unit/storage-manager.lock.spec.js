import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Method C — Scoped Storage-Based Advisory Lock primitive tests.
 *
 * All tests import a fresh StorageManager instance via vi.resetModules()
 * to guarantee clean module-level state (_metaCache, _chunkIndexCache,
 * _chatPresetMapChainTail).
 *
 * Tests that use fake timers (cases 5, 6, 7) perform storage setup BEFORE
 * calling vi.useFakeTimers() so that the InMemoryStorageMock's setTimeout-
 * based callbacks complete under real timers during setup.
 */

const LOCK_KEY = 'chatPresetMapLock';
const LOCK_ACQUIRE_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// 1. Acquire on free lock
// ---------------------------------------------------------------------------
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

    it('1. Acquire on free lock— returns a token and persists { owner, expiresAt }', async () => {
        const token = await SM._acquireChatPresetMapLock();

        expect(token).toBeDefined();
        expect(typeof token).toBe('string');

        const lock = await chrome.storage.local.get(LOCK_KEY);
        expect(lock[LOCK_KEY]).toBeDefined();
        expect(lock[LOCK_KEY].owner).toBe(token);
        expect(lock[LOCK_KEY].expiresAt).toBeGreaterThan(Date.now());
    });

    // ---------------------------------------------------------------------------
    // 2. Release with matching owner
    // ---------------------------------------------------------------------------
    it('2. Release with matching owner — key removed from local storage', async () => {
        const token = await SM._acquireChatPresetMapLock();
        await SM._releaseChatPresetMapLock(token);

        const lock = await chrome.storage.local.get(LOCK_KEY);
        expect(lock[LOCK_KEY]).toBeUndefined();
    });

    // ---------------------------------------------------------------------------
    // 3. Release with mismatched owner
    // ---------------------------------------------------------------------------
    it('3. Release with mismatched owner — key untouched, console.warn called', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Pre-seed lock with a different owner (simulates TTL takeover)
        await chrome.storage.local.set({
            [LOCK_KEY]: { owner: 'real-owner', expiresAt: Date.now() + 10000 },
        });

        await SM._releaseChatPresetMapLock('wrong-token');

        // Key NOT removed
        const lock = await chrome.storage.local.get(LOCK_KEY);
        expect(lock[LOCK_KEY]).toBeDefined();
        expect(lock[LOCK_KEY].owner).toBe('real-owner');

        // Warning emitted
        expect(warnSpy).toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    // ---------------------------------------------------------------------------
    // 4. TTL expiry takeover
    // ---------------------------------------------------------------------------
    it('4. TTL expiry takeover — expired lock ({owner, expiresAt: now - 1}) is overwritten', async () => {
        await chrome.storage.local.set({
            [LOCK_KEY]: { owner: 'stale-owner', expiresAt: Date.now() - 1 },
        });

        const token = await SM._acquireChatPresetMapLock();

        expect(token).toBeDefined();
        expect(token).not.toBe('stale-owner');

        const lock = await chrome.storage.local.get(LOCK_KEY);
        expect(lock[LOCK_KEY].owner).toBe(token);
        expect(lock[LOCK_KEY].expiresAt).toBeGreaterThan(Date.now());
    });

    // ---------------------------------------------------------------------------
    // 5. Contention — second acquirer waits
    // ---------------------------------------------------------------------------
    it('5. Contention — second acquirer waits until lock expires (~200 ms)',
        { timeout: 10000 },
        async () => {
            await chrome.storage.local.set({
                [LOCK_KEY]: { owner: 'holder', expiresAt: Date.now() + 200 },
            });

            const start = Date.now();
            const token = await SM._acquireChatPresetMapLock();
            const elapsed = Date.now() - start;

            // Must have waited at least until the lock expired
            expect(elapsed).toBeGreaterThanOrEqual(180);
            expect(token).toBeDefined();
            expect(token).not.toBe('holder');

            const lock = await chrome.storage.local.get(LOCK_KEY);
            expect(lock[LOCK_KEY].owner).toBe(token);
        });

    // ---------------------------------------------------------------------------
    // 6. Acquire timeout
    // ---------------------------------------------------------------------------
    it('6. Acquire timeout — rejects with LockAcquireTimeoutError after ~5000 ms',
        { timeout: 15000 },
        async () => {
            await chrome.storage.local.set({
                [LOCK_KEY]: {
                    owner: 'holder',
                    expiresAt: Date.now() + LOCK_ACQUIRE_TIMEOUT_MS + 1000,
                },
            });

            await expect(SM._acquireChatPresetMapLock()).rejects.toThrow();
        });

    // ---------------------------------------------------------------------------
    // 7. Post-write verification mismatch loops
    // ---------------------------------------------------------------------------
    it('7. Post-write verification mismatch — loops and retries until timeout', async () => {
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

        const acquirePromise = SM._acquireChatPresetMapLock();
        // Attach a no-op catch handler BEFORE advancing timers, so Node.js
        // does not detect the rejection as unhandled during the microtask
        // that fires within advanceTimersByTimeAsync. Without this, vitest's
        // unhandled rejection detector fires before the try/catch below can
        // handle the rejection.
        acquirePromise.catch(() => {});
        await vi.advanceTimersByTimeAsync(LOCK_ACQUIRE_TIMEOUT_MS + 100);

        // Use try/catch instead of expect().rejects to avoid the race where
        // the rejection fires between advanceTimersByTimeAsync resolving and
        // expect().rejects attaching a handler (causes unhandled rejection warning).
        let rejectionError;
        try {
            await acquirePromise;
        } catch (e) {
            rejectionError = e;
        }
        expect(rejectionError).toBeDefined();
        expect(rejectionError.name).toBe('LockAcquireTimeoutError');

        // Confirm the acquirer looped (more than just the initial read + one verify)
        expect(lockReadCount).toBeGreaterThanOrEqual(5);

        vi.useRealTimers();
    });

    // ---------------------------------------------------------------------------
    // 8. _withChatPresetMapLock releases on thrown error
    // ---------------------------------------------------------------------------
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
