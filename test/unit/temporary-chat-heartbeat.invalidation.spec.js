/**
 * content/temporary-chat-heartbeat.js — synchronous catch-block branching.
 *
 * Contract (from requirements):
 *   A synchronous chrome.runtime.sendMessage throw is handled the same as an async rejection:
 *   - If err.message includes 'Extension context invalidated': the heartbeat stops completely (no further sends) and DSSInvalidationToast.show() is called once; console.warn is NOT called.
 *   - Any other error: console.warn is called and the heartbeat keeps running with its uuid, because a transient failure must not let the temporary-chat lease lapse (the background sweep would then delete the chat); DSSInvalidationToast.show() is NOT called.
 *
 * Interval lifecycle after a synchronous throw inside start() is covered in the
 * "sync throw during start() — interval lifecycle" block below.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/temporary-chat-constants.js';

let heartbeat;
let sendMessage;
let showSpy;
let warnSpy;

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });

    showSpy = vi.fn();
    globalThis.DSSInvalidationToast = { show: showSpy };

    vi.resetModules();
    await import('../../utils/temporary-chat-constants.js');
    await import('../../content/temporary-chat-heartbeat.js');
    heartbeat = globalThis.TemporaryChatHeartbeat;

    sendMessage = globalThis.chrome.runtime.sendMessage;
    sendMessage.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    heartbeat.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.DSSInvalidationToast;
});

describe('heartbeat catch-block — Extension context invalidated', () => {
    it('calls DSSInvalidationToast.show() and not console.warn', () => {
        sendMessage.mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });

        heartbeat.start('uuid-inv');

        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe('heartbeat catch-block — other synchronous error', () => {
    it('calls console.warn and not DSSInvalidationToast.show()', () => {
        sendMessage.mockImplementation(() => {
            throw new Error('Some other runtime error');
        });

        heartbeat.start('uuid-other');

        expect(warnSpy).toHaveBeenCalled();
        expect(showSpy).not.toHaveBeenCalled();
    });
});

/*
 * Async rejection path. Contract: when chrome.runtime.sendMessage returns a
 * promise that REJECTS with an error whose message contains
 * 'Extension context invalidated', DSSInvalidationToast.show() is called —
 * same observable as the synchronous-throw branch. Any other rejection
 * (e.g. 'Could not establish connection') must NOT show the toast.
 */
async function flushMicrotasks() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('heartbeat async rejection — Extension context invalidated', () => {
    it('calls DSSInvalidationToast.show() when sendMessage rejects with invalidation', async () => {
        sendMessage.mockImplementation(() =>
            Promise.reject(new Error('Extension context invalidated.')));

        heartbeat.start('uuid-async-inv');
        await flushMicrotasks();

        expect(showSpy).toHaveBeenCalledTimes(1);
    });
});

describe('heartbeat async rejection — unrelated error', () => {
    it('does not call DSSInvalidationToast.show() for "Could not establish connection"', async () => {
        sendMessage.mockImplementation(() =>
            Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')));

        heartbeat.start('uuid-async-other');
        await flushMicrotasks();

        expect(showSpy).not.toHaveBeenCalled();
    });
});

/*
 * Async invalidation must STOP the heartbeat. Contract: once sendMessage
 * rejects with 'Extension context invalidated.', later interval ticks send
 * nothing more (observable at the chrome.runtime trust boundary), and the
 * page shows exactly one toast (real toast module, counted in the DOM).
 * An unrelated rejection keeps the heartbeat alive.
 */
describe('heartbeat async rejection — lifecycle after rejection', () => {
    const intervalMs = globalThis.DSS_TEMP_CHAT.HEARTBEAT_INTERVAL_MS;

    async function loadRealToast() {
        delete globalThis.DSSInvalidationToast;
        document.body.innerHTML = '';
        await import('../../content/invalidation-toast.js');
    }

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('stops sending heartbeats and shows one toast after invalidation rejection', async () => {
        await loadRealToast();
        sendMessage.mockImplementation(() =>
            Promise.reject(new Error('Extension context invalidated.')));

        heartbeat.start('uuid-async-stop');
        await flushMicrotasks();
        const callsAfterRejection = sendMessage.mock.calls.length;

        for (let i = 0; i < 3; i++) {
            vi.advanceTimersByTime(intervalMs);
            await flushMicrotasks();
        }

        expect(sendMessage.mock.calls.length,
            'heartbeat must not send again after async invalidation').toBe(callsAfterRejection);
        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(1);
    });

    it('keeps sending heartbeats after an unrelated rejection', async () => {
        await loadRealToast();
        sendMessage.mockImplementation(() =>
            Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')));

        heartbeat.start('uuid-async-alive');
        await flushMicrotasks();
        const callsAfterRejection = sendMessage.mock.calls.length;

        vi.advanceTimersByTime(intervalMs);
        await flushMicrotasks();

        expect(sendMessage.mock.calls.length,
            'heartbeat must keep running after a non-invalidation rejection').toBeGreaterThan(callsAfterRejection);
        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(0);
    });
});

/*
 * Sync throw during start(). Contract: if the very first send inside start(uuid) throws 'Extension context invalidated', the heartbeat is dead — no interval tick may send again (observable at the chrome.runtime trust boundary, and in particular no send carrying uuid null), and the page shows exactly one toast (real toast module, counted in the DOM). An unrelated sync throw ('boom') on the first send keeps the heartbeat running with the original uuid.
 */
describe('heartbeat sync throw during start() — interval lifecycle', () => {
    const intervalMs = globalThis.DSS_TEMP_CHAT.HEARTBEAT_INTERVAL_MS;

    async function loadRealToast() {
        delete globalThis.DSSInvalidationToast;
        document.body.innerHTML = '';
        await import('../../content/invalidation-toast.js');
    }

    function throwOnFirstCall(err) {
        sendMessage.mockImplementationOnce(() => { throw err; });
        sendMessage.mockImplementation(() => Promise.resolve({ ok: true }));
    }

    const sentUuids = () => sendMessage.mock.calls.map((c) => c[0]?.uuid);

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('sends exactly once and shows one toast when the first send throws invalidation', async () => {
        await loadRealToast();
        throwOnFirstCall(new Error('Extension context invalidated'));

        heartbeat.start('uuid-1');
        for (let i = 0; i < 3; i++) {
            vi.advanceTimersByTime(intervalMs);
            await flushMicrotasks();
        }

        expect(sentUuids(), 'no heartbeat may be sent with uuid null after invalidation').not.toContain(null);
        expect(sendMessage.mock.calls.length,
            'heartbeat interval must not keep sending after sync invalidation in start()').toBe(1);
        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(1);
    });

    it('keeps sending with the original uuid when the first send throws an unrelated error', async () => {
        await loadRealToast();
        throwOnFirstCall(new Error('boom'));

        heartbeat.start('uuid-1');
        for (let i = 0; i < 3; i++) {
            vi.advanceTimersByTime(intervalMs);
            await flushMicrotasks();
        }

        const uuids = sentUuids();
        expect(uuids.length, 'heartbeat must keep running after a non-invalidation sync throw').toBeGreaterThan(1);
        expect(uuids.slice(1), 'later sends must carry uuid-1, never null').toEqual(uuids.slice(1).map(() => 'uuid-1'));
        expect(document.querySelectorAll('.ds-invalidation-toast').length).toBe(0);
    });
});

/*
 * Malformed errors and a missing toast module. Contract: the heartbeat is fire-and-forget and must never let an error escape into the caller or the timer, whatever shape the thrown/rejected value has (no `message`, a bare string, undefined, null). A non-invalidation rejection is logged via console.warn (the observable channel for recoverable degradation) and the heartbeat keeps running. An invalidation error with no DSSInvalidationToast loaded must still stop the heartbeat without surfacing an error.
 */
describe('heartbeat — malformed errors and missing toast', () => {
    const intervalMs = globalThis.DSS_TEMP_CHAT.HEARTBEAT_INTERVAL_MS;
    let unhandled;
    const onUnhandled = (reason) => { unhandled.push(reason); };

    beforeEach(() => {
        unhandled = [];
        process.on('unhandledRejection', onUnhandled);
    });
    afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
    });

    /** Drain microtasks, then one real macrotask so Node emits 'unhandledRejection'. */
    async function settle() {
        await flushMicrotasks();
        await new Promise((resolve) => setImmediate(resolve));
    }

    it.each([
        ['an object without message', {}],
        ['undefined', undefined],
        ['null', null],
    ])('async rejection with %s: warns, no toast, heartbeat keeps sending', async (_label, reason) => {
        sendMessage.mockImplementation(() => Promise.reject(reason));

        heartbeat.start('uuid-malformed');
        await settle();
        const callsAfterRejection = sendMessage.mock.calls.length;
        vi.advanceTimersByTime(intervalMs);
        await settle();

        expect(unhandled, 'catch handler must not itself reject').toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(expect.any(String), reason);
        expect(showSpy).not.toHaveBeenCalled();
        expect(sendMessage.mock.calls.length).toBeGreaterThan(callsAfterRejection);
    });

    it.each([
        ['a string', 'boom'],
        ['undefined', undefined],
        ['null', null],
    ])('sync throw of %s: nothing escapes start(), warns, no toast', (_label, thrown) => {
        sendMessage.mockImplementation(() => { throw thrown; });

        expect(() => heartbeat.start('uuid-sync-malformed')).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(expect.any(String), thrown);
        expect(showSpy).not.toHaveBeenCalled();
    });

    it('unrelated async rejection logs a warning containing the error', async () => {
        const err = new Error('Could not establish connection. Receiving end does not exist.');
        sendMessage.mockImplementation(() => Promise.reject(err));

        heartbeat.start('uuid-warn');
        await settle();

        expect(warnSpy).toHaveBeenCalledWith(expect.any(String), err);
    });

    it('async invalidation with no toast module: no error surfaces and heartbeat stops', async () => {
        delete globalThis.DSSInvalidationToast;
        sendMessage.mockImplementation(() => Promise.reject(new Error('Extension context invalidated.')));

        heartbeat.start('uuid-no-toast');
        await settle();
        const callsAfterRejection = sendMessage.mock.calls.length;
        vi.advanceTimersByTime(intervalMs * 3);
        await settle();

        expect(unhandled, 'missing toast must not produce an unhandled rejection').toEqual([]);
        expect(sendMessage.mock.calls.length).toBe(callsAfterRejection);
    });

    it('sync invalidation throw with no toast module: nothing escapes start() or the timer', () => {
        delete globalThis.DSSInvalidationToast;
        sendMessage.mockImplementation(() => { throw new Error('Extension context invalidated'); });

        expect(() => heartbeat.start('uuid-sync-no-toast')).not.toThrow();
        expect(() => vi.advanceTimersByTime(intervalMs)).not.toThrow();
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
