/**
 * Unit: the editor auto-save controller and settleWithin (popup/editor/editor.autosave.js).
 *
 * Requirements under test:
 * - a save that rejects leaves the work pending, and the next flush() retries it until it persists;
 * - flush() during an in-flight save waits for that save and never runs a second save concurrently;
 * - flush() cancels the pending debounced save, and markDirty() saves once debounceMs after the last call;
 * - settleWithin(promise, ms) reports fulfilled (with the value), rejected (with the reason), or timeout once ms elapse.
 *
 * The controller's save option is its injected trust boundary (the real editor passes a chrome.storage write), so it is the only double here; DSSDebounce is the real utils/debounce.js on fake timers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/debounce.js';
import '../../popup/editor/editor.autosave.js';

const { createAutosaveController, settleWithin } = globalThis.__DS_Editor_autosave;
const DEBOUNCE_MS = 500;

/** A save double backed by an in-memory store; each call returns a promise the test settles, and concurrency is recorded. */
function createDeferredSave(readEdit) {
    const calls = [];
    const store = { value: undefined };
    let running = 0;
    let maxConcurrent = 0;
    function save() {
        const edit = readEdit();
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        const call = {
            edit,
            succeed() { store.value = edit; running -= 1; resolve(); },
            fail(err) { running -= 1; reject(err); },
        };
        calls.push(call);
        return promise;
    }
    return { save, calls, store, get maxConcurrent() { return maxConcurrent; } };
}

/** Let queued microtasks run without moving fake time. */
async function drainMicrotasks() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Track whether a promise has settled, without consuming its outcome. */
function track(promise) {
    const state = { settled: false, value: undefined, error: undefined };
    promise.then((v) => { state.settled = true; state.value = v; }, (e) => { state.settled = true; state.error = e; });
    return state;
}

describe('createAutosaveController', () => {
    let edit;
    let fake;
    let controller;

    beforeEach(() => {
        vi.useFakeTimers();
        edit = 'first edit';
        fake = createDeferredSave(() => edit);
        controller = createAutosaveController({ save: fake.save, debounceMs: DEBOUNCE_MS });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('save rejects: the work stays pending, and the next flush() retries and persists the edit', async () => {
        controller.markDirty();
        const first = track(controller.flush());
        await drainMicrotasks();
        expect(fake.calls.length, 'save calls after the first flush').toBe(1);
        fake.calls[0].fail(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'));
        await drainMicrotasks();

        expect(first.error?.message, 'first flush rejects with the save error').toBe('QUOTA_BYTES_PER_ITEM quota exceeded');
        expect(controller.hasPendingWork(), 'pending work after the failed save').toBe(true);
        expect(fake.store.value, 'store after the failed save').toBeUndefined();

        const second = track(controller.flush());
        await drainMicrotasks();
        expect(fake.calls.length, 'save calls after the retry flush').toBe(2);
        fake.calls[1].succeed();
        await drainMicrotasks();

        expect(second.settled && second.error === undefined, 'retry flush fulfils').toBe(true);
        expect(fake.store.value, 'store after the retry').toBe('first edit');
        expect(controller.hasPendingWork(), 'pending work after the retry persisted').toBe(false);
    });

    it('flush() during an in-flight save with no new edit waits for that save and does not save again', async () => {
        controller.markDirty();
        controller.flush().catch(() => {});
        await drainMicrotasks();
        expect(fake.calls.length, 'save calls after the first flush').toBe(1);

        const second = track(controller.flush());
        await drainMicrotasks();
        expect(second.settled, 'second flush settled while the first save is still in flight').toBe(false);

        fake.calls[0].succeed();
        await drainMicrotasks();
        expect(second.settled, 'second flush settled after the in-flight save finished').toBe(true);
        expect(fake.calls.length, 'save calls in total').toBe(1);
    });

    it('flush() during an in-flight save with a newer edit saves the newer edit only after the in-flight save finishes, never concurrently', async () => {
        controller.markDirty();
        controller.flush().catch(() => {});
        await drainMicrotasks();

        edit = 'second edit';
        controller.markDirty();
        const second = track(controller.flush());
        await drainMicrotasks();
        expect(fake.calls.length, 'save calls while the first save is in flight').toBe(1);

        fake.calls[0].succeed();
        await drainMicrotasks();
        expect(fake.calls.length, 'save calls after the first save finished').toBe(2);
        fake.calls[1].succeed();
        await drainMicrotasks();

        expect(fake.maxConcurrent, 'saves running at the same time (maximum)').toBe(1);
        expect(second.settled, 'second flush settled').toBe(true);
        expect(fake.store.value, 'store holds the newer edit').toBe('second edit');
    });

    it('markDirty(): the save runs once, debounceMs after the last call, not before', async () => {
        controller.markDirty();
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
        controller.markDirty();
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
        expect(fake.calls.length, `save calls ${DEBOUNCE_MS - 1} ms after the last markDirty`).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(fake.calls.length, `save calls ${DEBOUNCE_MS} ms after the last markDirty`).toBe(1);
    });

    it('flush() cancels the pending debounced save: the edit is saved once, and a failed flush waits for the next flush instead of a stale debounce retry', async () => {
        controller.markDirty();
        controller.flush().catch(() => {});
        await drainMicrotasks();
        fake.calls[0].fail(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'));

        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
        expect(fake.calls.length, 'save calls after the failed flush and the cancelled debounce window').toBe(1);
        expect(controller.hasPendingWork(), 'pending work kept for the next flush').toBe(true);
    });
});

describe('settleWithin', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('reports fulfilled with the value when the promise resolves in time', async () => {
        const outcome = track(settleWithin(Promise.resolve('saved'), 1500));
        await drainMicrotasks();
        expect(outcome.value, 'outcome of a resolved promise').toEqual({ status: 'fulfilled', value: 'saved' });
    });

    it('reports rejected with the reason when the promise rejects in time', async () => {
        const reason = new Error('duplicate preset name');
        const outcome = track(settleWithin(Promise.reject(reason), 1500));
        await drainMicrotasks();
        expect(outcome.value, 'outcome of a rejected promise').toEqual({ status: 'rejected', reason });
        expect(outcome.error, 'settleWithin itself does not reject').toBeUndefined();
    });

    it('reports timeout once timeoutMs elapse for a promise that never settles, and not a moment before', async () => {
        const outcome = track(settleWithin(new Promise(() => {}), 1500));
        await vi.advanceTimersByTimeAsync(1499);
        expect(outcome.settled, 'settled 1499 ms after the call').toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(outcome.value, 'outcome at 1500 ms').toEqual({ status: 'timeout' });
    });

    it('keeps the fulfilled outcome when the promise resolves just before the timeout', async () => {
        let resolve;
        const outcome = track(settleWithin(new Promise((res) => { resolve = res; }), 1500));
        await vi.advanceTimersByTimeAsync(1499);
        resolve('late but in time');
        await vi.advanceTimersByTimeAsync(10);
        expect(outcome.value, 'outcome of a promise resolved at 1499 ms').toEqual({ status: 'fulfilled', value: 'late but in time' });
    });
});
