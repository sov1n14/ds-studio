import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import TemporaryChatPendingStore from '../../content/temporary-chat-pending-store.js';

// Load the constants module as CommonJS so we can inspect its module.exports
// object (requirement 1) AND trigger its Object.assign(globalThis, ...) that
// publishes the flat top-level consts as globals. require() runs the file's
// CJS export branch; import '...' alone would skip it.
const require = createRequire(import.meta.url);
const constantsExport = require('../../utils/temporary-chat-constants.js');

const SYNC_KEY = 'dss-pending-deletes-sync';
const LEASE_TTL_MS = 600000;

// fake-timer storage helpers. The in-memory chrome.storage mock resolves
// get/set via setTimeout(0). Under vi.useFakeTimers() those macrotasks never
// fire on their own, so every awaited storage call must be pumped with
// runAllTimersAsync(). These helpers keep the timestamp-exact tests readable.
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
async function readQueueReal() {
    const data = await chrome.storage.sync.get(SYNC_KEY);
    return data[SYNC_KEY] || [];
}

describe('TemporaryChatPendingStore lease support', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('1 lease constants', () => {
        it('L-const-1: LEASE_TTL_MS is 600000 as a flat global', () => {
            expect(globalThis.LEASE_TTL_MS).toBe(600000);
        });

        it('L-const-2: HEARTBEAT_INTERVAL_MS is 60000 as a flat global', () => {
            expect(globalThis.HEARTBEAT_INTERVAL_MS).toBe(60000);
        });

        it('L-const-3: both constants appear in the CommonJS export object', () => {
            expect(constantsExport).toHaveProperty('LEASE_TTL_MS', 600000);
            expect(constantsExport).toHaveProperty('HEARTBEAT_INTERVAL_MS', 60000);
        });
    });

    describe('2 addPendingDelete stamps lastActiveAt', () => {
        it('L-add-1: writes numeric lastActiveAt equal to now, beside chatUuid and attemptCount:0', async () => {
            vi.useFakeTimers();
            const T = 1700000000000;
            vi.setSystemTime(T);

            await flushOp(TemporaryChatPendingStore.addPendingDelete('uuid-1'));
            const queue = await readQueueFake();

            expect(queue).toEqual([{ chatUuid: 'uuid-1', attemptCount: 0, lastActiveAt: T }]);
            expect(typeof queue[0].lastActiveAt).toBe('number');
        });
    });

    describe('3 refreshLease', () => {
        it('L-refresh-1: updates ONLY the target lastActiveAt; other entry and both attemptCounts unchanged', async () => {
            vi.useFakeTimers();
            const T0 = 1700000000000;
            vi.setSystemTime(T0);
            await flushOp(TemporaryChatPendingStore.addPendingDelete('a'));
            await flushOp(TemporaryChatPendingStore.addPendingDelete('b'));

            const T1 = T0 + 5000;
            vi.setSystemTime(T1);
            await flushOp(TemporaryChatPendingStore.refreshLease('a'));

            const queue = await readQueueFake();
            const a = queue.find(e => e.chatUuid === 'a');
            const b = queue.find(e => e.chatUuid === 'b');
            expect(a.lastActiveAt).toBe(T1);
            expect(b.lastActiveAt).toBe(T0);
            expect(a.attemptCount).toBe(0);
            expect(b.attemptCount).toBe(0);
        });

        it('L-refresh-2: unknown uuid leaves the stored queue byte-identical', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(1700000000000);
            await flushOp(TemporaryChatPendingStore.addPendingDelete('a'));
            await flushOp(TemporaryChatPendingStore.addPendingDelete('b'));
            const before = JSON.stringify(await readQueueFake());

            vi.setSystemTime(1700000009999);
            await flushOp(TemporaryChatPendingStore.refreshLease('not-in-queue'));
            const after = JSON.stringify(await readQueueFake());

            expect(after).toBe(before);
        });
    });

    describe('4 releaseLease', () => {
        it('L-release-1: sets target lastActiveAt to 0, entry stays in queue, other entry untouched', async () => {
            vi.useFakeTimers();
            const T0 = 1700000000000;
            vi.setSystemTime(T0);
            await flushOp(TemporaryChatPendingStore.addPendingDelete('a'));
            await flushOp(TemporaryChatPendingStore.addPendingDelete('b'));

            await flushOp(TemporaryChatPendingStore.releaseLease('a'));

            const queue = await readQueueFake();
            const a = queue.find(e => e.chatUuid === 'a');
            const b = queue.find(e => e.chatUuid === 'b');
            expect(a).toBeDefined();
            expect(a.lastActiveAt).toBe(0);
            expect(a.attemptCount).toBe(0);
            expect(b.lastActiveAt).toBe(T0);
            expect(b.attemptCount).toBe(0);
        });

        it('L-release-2: unknown uuid leaves the stored queue byte-identical', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(1700000000000);
            await flushOp(TemporaryChatPendingStore.addPendingDelete('a'));
            const before = JSON.stringify(await readQueueFake());

            await flushOp(TemporaryChatPendingStore.releaseLease('nope'));
            const after = JSON.stringify(await readQueueFake());

            expect(after).toBe(before);
        });
    });

    describe('5 isLeaseExpired predicate', () => {
        const BASE = 1000;

        it('L-exp-1: now-lastActiveAt == TTL-1 -> false (not expired)', () => {
            expect(TemporaryChatPendingStore.isLeaseExpired({ lastActiveAt: BASE }, BASE + LEASE_TTL_MS - 1)).toBe(false);
        });

        it('L-exp-2: now-lastActiveAt == TTL exactly -> false (not expired)', () => {
            expect(TemporaryChatPendingStore.isLeaseExpired({ lastActiveAt: BASE }, BASE + LEASE_TTL_MS)).toBe(false);
        });

        it('L-exp-3: now-lastActiveAt == TTL+1 -> true (expired)', () => {
            expect(TemporaryChatPendingStore.isLeaseExpired({ lastActiveAt: BASE }, BASE + LEASE_TTL_MS + 1)).toBe(true);
        });

        it('L-exp-4: missing/undefined/null/non-number lastActiveAt -> true (expired)', () => {
            const now = 10000000;
            expect(TemporaryChatPendingStore.isLeaseExpired({}, now)).toBe(true);
            expect(TemporaryChatPendingStore.isLeaseExpired({ lastActiveAt: undefined }, now)).toBe(true);
            expect(TemporaryChatPendingStore.isLeaseExpired({ lastActiveAt: null }, now)).toBe(true);
            expect(TemporaryChatPendingStore.isLeaseExpired({ lastActiveAt: 'nope' }, now)).toBe(true);
        });

        it('L-exp-5: lastActiveAt == 0 -> true (expired)', () => {
            expect(TemporaryChatPendingStore.isLeaseExpired({ lastActiveAt: 0 }, 10000000)).toBe(true);
        });
    });

    // Real timers. chrome.storage.sync.get is wrapped so its snapshot is
    // delivered a full macrotask AFTER the caller could otherwise set(),
    // forcing overlapping read-modify-write cycles to actually race. We assert
    // ONLY on the final queue read back from storage: observable state, never
    // call counts or ordering.
    describe('6 concurrent mutations must not lose updates', () => {
        function delayGet(ms = 20) {
            const origGet = chrome.storage.sync.get.bind(chrome.storage.sync);
            return vi.spyOn(chrome.storage.sync, 'get').mockImplementation((keys) =>
                new Promise((resolve) => {
                    origGet(keys).then((snapshot) => setTimeout(() => resolve(snapshot), ms));
                }));
        }

        it('L-race-1: concurrent addPendingDelete("a") + addPendingDelete("b") keeps BOTH', async () => {
            const spy = delayGet();
            await Promise.all([
                TemporaryChatPendingStore.addPendingDelete('a'),
                TemporaryChatPendingStore.addPendingDelete('b'),
            ]);
            spy.mockRestore();

            const uuids = (await readQueueReal()).map(e => e.chatUuid);
            expect(new Set(uuids)).toEqual(new Set(['a', 'b']));
        });

        it('L-race-2: concurrent addPendingDelete("a") + refreshLease("pre") new entry exists AND lease landed', async () => {
            await TemporaryChatPendingStore.addPendingDelete('pre');
            await new Promise((r) => setTimeout(r, 5));
            const tBeforeRefresh = Date.now();

            const spy = delayGet();
            await Promise.all([
                TemporaryChatPendingStore.addPendingDelete('a'),
                TemporaryChatPendingStore.refreshLease('pre'),
            ]);
            spy.mockRestore();

            const queue = await readQueueReal();
            const uuids = queue.map(e => e.chatUuid);
            expect(uuids).toContain('a');
            const pre = queue.find(e => e.chatUuid === 'pre');
            expect(pre).toBeDefined();
            expect(typeof pre.lastActiveAt).toBe('number');
            expect(pre.lastActiveAt).toBeGreaterThanOrEqual(tBeforeRefresh);
        });
    });
});
