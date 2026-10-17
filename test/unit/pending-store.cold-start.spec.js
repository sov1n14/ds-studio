/**
 * Cold-start resilience tests for background/pending-store.js
 *
 * MV3 service workers terminate after ~30s idle. Every alarm wake-up is a cold
 * start with a fresh module scope (empty _lastActiveAtCache Map). These tests
 * simulate that by using vi.resetModules() + dynamic re-import while leaving
 * chrome.storage.local intact between imports.
 *
 * Bug 1 (R1): recordLeaseObservation rewrites the persisted timestamp on cold
 *   start even when lastActiveAt has not changed, because the in-memory cache
 *   is empty and the comparison falls through to the "changed" branch.
 * Bug 2 (R3): releaseLease sets lastActiveAt to 0 meaning "immediately
 *   deletable", but isLeaseExpired ignores that sentinel and still waits for
 *   the full TTL on lastSeenChange.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// First static import — "instance A" for warm-start setup.
// Constants are already on globalThis from vitest.setup.js preload.
import TemporaryChatPendingStore from '../../background/pending-store.js';

const LEASE_TTL_MS = globalThis.DSS_TEMP_CHAT.LEASE_TTL_MS; // 600000

// Helpers for fake-timer storage pump (same pattern as pending-store.lease.spec.js)
async function flushOp(promise) {
    await vi.runAllTimersAsync();
    return promise;
}

describe('pending-store cold-start resilience', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    // R1: Observation survives cold start
    // Instance A records observation at T0. After resetModules (cold start),
    // instance B calls recordLeaseObservation with the SAME lastActiveAt.
    // Expected: returns T0 (the original observation time), not Date.now().
    // Current bug: empty _lastActiveAtCache causes it to treat unchanged
    // lastActiveAt as a change, overwriting with Date.now().
    it('R1: recordLeaseObservation returns the original timestamp after cold start when lastActiveAt is unchanged', async () => {
        vi.useFakeTimers();
        const T0 = 1_700_000_000_000;
        vi.setSystemTime(T0);

        // Instance A: record observation for u1 with lastActiveAt=1000
        const firstResult = await flushOp(
            TemporaryChatPendingStore.recordLeaseObservation('u1', 1000)
        );
        expect(firstResult).toBe(T0);

        // Simulate cold start: reset modules but keep chrome.storage.local intact
        vi.resetModules();

        const T1 = T0 + 11 * 60 * 1000; // T0 + 11 minutes
        vi.setSystemTime(T1);

        // Re-import (instance B with empty _lastActiveAtCache)
        const { default: StoreB } = await import('../../background/pending-store.js');

        // Same lastActiveAt=1000 — observation should NOT be overwritten
        const secondResult = await flushOp(
            StoreB.recordLeaseObservation('u1', 1000)
        );

        // Expected: T0 (original observation preserved), NOT T1
        expect(secondResult).toBe(T0);

        // With T0 as lastSeenChange and 11 minutes elapsed, lease should be expired
        const expired = StoreB.isLeaseExpired(
            { chatUuid: 'u1', attemptCount: 0, lastActiveAt: 1000 },
            T1,
            secondResult
        );
        expect(expired).toBe(true);
    });

    // R2: Changed lastActiveAt across cold start IS a new observation
    it('R2: recordLeaseObservation returns new timestamp when lastActiveAt actually changed after cold start', async () => {
        vi.useFakeTimers();
        const T0 = 1_700_000_000_000;
        vi.setSystemTime(T0);

        // Instance A: record observation for u1 with lastActiveAt=1000
        await flushOp(
            TemporaryChatPendingStore.recordLeaseObservation('u1', 1000)
        );

        // Simulate cold start
        vi.resetModules();

        const T1 = T0 + 11 * 60 * 1000;
        vi.setSystemTime(T1);

        const { default: StoreB } = await import('../../background/pending-store.js');

        // Different lastActiveAt=2000 — this IS a genuine change
        const result = await flushOp(
            StoreB.recordLeaseObservation('u1', 2000)
        );

        // Expected: T1 (new observation timestamp)
        expect(result).toBe(T1);

        // With T1 as lastSeenChange and current time = T1, lease is NOT expired
        const expired = StoreB.isLeaseExpired(
            { chatUuid: 'u1', attemptCount: 0, lastActiveAt: 2000 },
            T1,
            result
        );
        expect(expired).toBe(false);
    });

    // R3: Released lease (lastActiveAt === 0) should be expired immediately
    // Bug: isLeaseExpired only checks (now - lastSeenChange > TTL), ignoring
    // the lastActiveAt === 0 sentinel that releaseLease sets.
    it('R3: isLeaseExpired returns true for released lease (lastActiveAt === 0) even when lastSeenChange is fresh', () => {
        const now = 1_700_000_000_000;

        // lastActiveAt=0 means "released, delete immediately"
        // lastSeenChange=now means the observation is fresh
        // Expected: true (the lease was explicitly released)
        const result = TemporaryChatPendingStore.isLeaseExpired(
            { chatUuid: 'u1', attemptCount: 0, lastActiveAt: 0 },
            now,
            now
        );
        expect(result).toBe(true);
    });
});
