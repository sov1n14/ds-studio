/**
 * pending-store.js — dirty-check for lease renewal (RED-phase spec).
 *
 * refreshLease should skip the chrome.storage.sync.set write when the entry's
 * lastActiveAt is already recent (within HEARTBEAT_INTERVAL_MS = 60000ms).
 * This prevents double-writes when both the content heartbeat and the service
 * worker proxy try to refresh within the same minute.
 *
 * Assertions derived from requirements only; implementation NOT read.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/temporary-chat-constants.js';
import TemporaryChatPendingStore from '../../background/pending-store.js';

const SYNC_KEY = 'dss-pending-deletes-sync';
const HEARTBEAT_INTERVAL_MS = globalThis.HEARTBEAT_INTERVAL_MS; // 60000

async function flushOp(promise) {
    await vi.runAllTimersAsync();
    return promise;
}
async function readQueueFake() {
    const rp = chrome.storage.sync.get(SYNC_KEY);
    await vi.runAllTimersAsync();
    const data = await rp;
    return data[SYNC_KEY] || [];
}

describe('refreshLease dirty-check: skip write when lastActiveAt is recent', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('DC-1: skips write when lastActiveAt is within HEARTBEAT_INTERVAL_MS (30s ago)', async () => {
        vi.useFakeTimers();
        const T0 = 1700000000000;
        vi.setSystemTime(T0);

        // Seed an entry
        await flushOp(TemporaryChatPendingStore.addPendingDelete('dirty-check-1'));
        const queueBefore = await readQueueFake();
        expect(queueBefore).toHaveLength(1);
        expect(queueBefore[0].lastActiveAt).toBe(T0);

        // Advance 30s (within 60s threshold)
        const T1 = T0 + 30000;
        vi.setSystemTime(T1);

        // Spy on set to detect whether a write happens
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        await flushOp(TemporaryChatPendingStore.refreshLease('dirty-check-1'));

        // The dirty-check should skip the write since lastActiveAt is recent
        expect(setSpy).not.toHaveBeenCalled();

        // Queue should be unchanged
        const queueAfter = await readQueueFake();
        expect(queueAfter[0].lastActiveAt).toBe(T0); // unchanged
    });

    it('DC-2: writes when lastActiveAt is stale (90s ago, beyond 60s threshold)', async () => {
        vi.useFakeTimers();
        const T0 = 1700000000000;
        vi.setSystemTime(T0);

        await flushOp(TemporaryChatPendingStore.addPendingDelete('dirty-check-2'));

        // Advance 90s (beyond 60s threshold)
        const T1 = T0 + 90000;
        vi.setSystemTime(T1);

        const setSpy = vi.spyOn(chrome.storage.sync, 'set');
        await flushOp(TemporaryChatPendingStore.refreshLease('dirty-check-2'));

        // The write SHOULD happen since lastActiveAt is stale
        expect(setSpy).toHaveBeenCalled();

        const queueAfter = await readQueueFake();
        expect(queueAfter[0].lastActiveAt).toBe(T1); // updated to now
    });

    it('DC-3: writes when lastActiveAt is 0 (released lease)', async () => {
        vi.useFakeTimers();
        const T0 = 1700000000000;
        vi.setSystemTime(T0);

        await flushOp(TemporaryChatPendingStore.addPendingDelete('dirty-check-3'));

        // Release the lease (sets lastActiveAt to 0)
        await flushOp(TemporaryChatPendingStore.releaseLease('dirty-check-3'));
        const queueReleased = await readQueueFake();
        expect(queueReleased[0].lastActiveAt).toBe(0);

        const setSpy = vi.spyOn(chrome.storage.sync, 'set');
        await flushOp(TemporaryChatPendingStore.refreshLease('dirty-check-3'));

        // lastActiveAt=0 means Date.now() - 0 > 60000, so write SHOULD happen
        expect(setSpy).toHaveBeenCalled();

        const queueAfter = await readQueueFake();
        expect(queueAfter[0].lastActiveAt).toBe(T0); // updated to now
    });
});
