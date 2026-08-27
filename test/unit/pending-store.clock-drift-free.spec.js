import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import TemporaryChatPendingStore from '../../background/pending-store.js';

const require = createRequire(import.meta.url);
require('../../utils/temporary-chat-constants.js');

const LEASE_TTL_MS = globalThis.LEASE_TTL_MS;

async function flushOp(promise) {
    await vi.runAllTimersAsync();
    return promise;
}

describe('clock-drift-free expiry', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('isLeaseExpired uses lastSeenChange instead of lastActiveAt', () => {
        it('CD-exp-1: with missing lastActiveAt but valid lastSeenChange within TTL, returns false (new param governs)', () => {
            const now = 1700000600000;
            const entry = {};
            const lastSeenChange = now - 5 * 60_000;
            expect(TemporaryChatPendingStore.isLeaseExpired(entry, now, lastSeenChange)).toBe(false);
        });

        it('CD-exp-2: returns true when lastSeenChange is undefined (backward compat)', () => {
            const now = 1700000600000;
            const entry = { lastActiveAt: now - 1000 };
            expect(TemporaryChatPendingStore.isLeaseExpired(entry, now, undefined)).toBe(true);
        });

        it('CD-exp-3: returns true when lastSeenChange is null', () => {
            const now = 1700000600000;
            const entry = { lastActiveAt: now - 1000 };
            expect(TemporaryChatPendingStore.isLeaseExpired(entry, now, null)).toBe(true);
        });

        it('CD-exp-4: returns true when lastSeenChange is NaN (non-finite)', () => {
            const now = 1700000600000;
            const entry = { lastActiveAt: now - 1000 };
            expect(TemporaryChatPendingStore.isLeaseExpired(entry, now, NaN)).toBe(true);
        });

        it('CD-exp-5: returns true when lastSeenChange exceeds TTL', () => {
            const now = 1700000600000;
            const entry = { lastActiveAt: now - 1000 };
            const lastSeenChange = now - LEASE_TTL_MS - 1;
            expect(TemporaryChatPendingStore.isLeaseExpired(entry, now, lastSeenChange)).toBe(true);
        });

        it('CD-exp-6: lastSeenChange exactly at TTL boundary returns false (> not >=)', () => {
            const now = 1700000600000;
            const entry = {};
            const lastSeenChange = now - LEASE_TTL_MS;
            expect(TemporaryChatPendingStore.isLeaseExpired(entry, now, lastSeenChange)).toBe(false);
        });
    });

    describe('recordLeaseObservation', () => {
        it('CD-obs-1: writes local timestamp to storage when lastActiveAt changes', async () => {
            vi.useFakeTimers();
            const T = 1700000000000;
            vi.setSystemTime(T);
            const uuid = 'test-uuid-1';
            const storageKey = 'dss-last-seen-change:' + uuid;
            await flushOp(TemporaryChatPendingStore.recordLeaseObservation(uuid, 5000));
            const rp = chrome.storage.local.get(storageKey);
            await vi.runAllTimersAsync();
            const result = await rp;
            expect(result[storageKey]).toBe(T);
        });

        it('CD-obs-2: does NOT write when lastActiveAt is unchanged from previous observation', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(1700000000000);
            const uuid = 'test-uuid-2';
            const storageKey = 'dss-last-seen-change:' + uuid;
            await flushOp(TemporaryChatPendingStore.recordLeaseObservation(uuid, 5000));
            const setSpy = vi.spyOn(chrome.storage.local, 'set');
            vi.setSystemTime(1700000010000);
            await flushOp(TemporaryChatPendingStore.recordLeaseObservation(uuid, 5000));
            const relevantCalls = setSpy.mock.calls.filter(([obj]) => obj && storageKey in obj);
            expect(relevantCalls).toHaveLength(0);
        });

        it('CD-obs-3: writes new timestamp when lastActiveAt changes to a different value', async () => {
            vi.useFakeTimers();
            const T0 = 1700000000000;
            vi.setSystemTime(T0);
            const uuid = 'test-uuid-3';
            const storageKey = 'dss-last-seen-change:' + uuid;
            await flushOp(TemporaryChatPendingStore.recordLeaseObservation(uuid, 5000));
            const T1 = T0 + 60000;
            vi.setSystemTime(T1);
            await flushOp(TemporaryChatPendingStore.recordLeaseObservation(uuid, 6000));
            const rp = chrome.storage.local.get(storageKey);
            await vi.runAllTimersAsync();
            const result = await rp;
            expect(result[storageKey]).toBe(T1);
        });
    });

    describe('cleanup of last-seen-change keys', () => {
        it('CD-clean-1: after successful delete, removePendingDelete also removes dss-last-seen-change:<uuid> from local storage', async () => {
            vi.useFakeTimers();
            const T = 1700000000000;
            vi.setSystemTime(T);
            const uuid = 'cleanup-uuid';
            const storageKey = 'dss-last-seen-change:' + uuid;
            await flushOp(globalThis.chrome.storage.local.set({ [storageKey]: T }));
            await flushOp(TemporaryChatPendingStore.addPendingDelete(uuid));
            const removeSpy = vi.spyOn(globalThis.chrome.storage.local, 'remove');
            vi.setSystemTime(T + LEASE_TTL_MS + 1);
            await flushOp(TemporaryChatPendingStore.removePendingDelete(uuid));
            const cleanupCalls = removeSpy.mock.calls.flat().filter(k => typeof k === 'string' && k === storageKey);
            expect(cleanupCalls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
