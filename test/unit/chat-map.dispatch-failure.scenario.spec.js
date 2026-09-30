/**
 * Trust-boundary failure modes of client-mode chat-map dispatch: one real never-initialized client StorageManager sends to one real SW StorageManager through the real background/chat-map-routes.js router; chrome.runtime.sendMessage is the only failure-injecting double (test/helpers/chat-map-writer-harness.js). Assertions cover the returned promise outcome and durable storage end-state; a follow-up getChatPresetMap proves the client chain is not blocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createChatMapWriterHarness,
    restoreChromeBoundaries,
    within,
    NO_RECEIVER,
    PORT_CLOSED,
    CONTEXT_INVALIDATED,
} from '../helpers/chat-map-writer-harness.js';

const SEED = { '@seed': 'seed' };

describe('chat map client dispatch — failure policy at the messaging boundary', () => {
    let h;
    let client;

    beforeEach(async () => {
        h = await createChatMapWriterHarness({ clientCount: 1 });
        [client] = h.clients;
        await h.seedChatMap([SEED]);
    });

    afterEach(() => {
        vi.useRealTimers();
        restoreChromeBoundaries();
    });

    async function expectChainUnblocked() {
        await expect(within(client.getChatPresetMap(), 1000, 'getChatPresetMap after a rejected op')).resolves.toEqual(SEED);
    }

    async function expectStorageUntouched() {
        const stored = await h.readStored();
        expect(stored.map).toEqual(SEED);
        expect(stored.meta.version).toBe(1);
    }

    it('success: the op resolves true, is persisted by the SW and is visible to the same client', async () => {
        await expect(client.bindChatToPreset('u1', 'p1')).resolves.toBe(true);

        expect((await h.readStored()).map).toEqual({ ...SEED, u1: 'p1' });
        expect(await client.getChatPresetMap()).toEqual({ ...SEED, u1: 'p1' });
    });

    it('undelivered once ("Receiving end does not exist"): retried once and applied exactly once', async () => {
        h.transport.failNext('reject', NO_RECEIVER);

        await expect(within(client.bindChatToPreset('u1', 'p1'), 2000, 'bind after one undelivered attempt')).resolves.toBe(true);

        const stored = await h.readStored();
        expect(stored.map).toEqual({ ...SEED, u1: 'p1' });
        expect(stored.meta.version, 'exactly one committed op bumps version 1 -> 2').toBe(2);
    });

    it('undelivered on every attempt: rejects after the single retry instead of retrying forever', async () => {
        h.transport.failAlways('reject', NO_RECEIVER);

        const outcome = await within(client.bindChatToPreset('u1', 'p1'), 2000, 'bind with no receiver').then(() => 'resolved', (err) => err);

        expect(outcome).toBeInstanceOf(Error);
        expect(outcome.message).not.toContain('[chat-map harness]');
        h.transport.reset();
        await expectStorageUntouched();
        await expectChainUnblocked();
    });

    it('port closed before a response: rejects without retrying and the chain is not blocked', async () => {
        h.transport.failNext('reject', PORT_CLOSED);

        const outcome = await within(client.bindChatToPreset('u1', 'p1'), 2000, 'bind with closed port').then(() => 'resolved', (err) => err);

        expect(outcome).toBeInstanceOf(Error);
        expect(outcome.message).not.toContain('[chat-map harness]');

        await expectStorageUntouched();
        await expectChainUnblocked();
    });

    it('sendMessage throws synchronously (context invalidated): the op returns a rejected promise and the chain is not blocked', async () => {
        h.transport.failNext('throw', CONTEXT_INVALIDATED);

        let pending;
        expect(() => { pending = client.bindChatToPreset('u1', 'p1'); }).not.toThrow();
        const outcome = await within(pending, 2000, 'bind with invalidated context').then(() => 'resolved', (err) => err);
        expect(outcome).toBeInstanceOf(Error);
        expect(outcome.message).not.toContain('[chat-map harness]');

        await expectStorageUntouched();
        await expectChainUnblocked();
    });

    it('no response within 10 s: rejects on the timeout and the chain is not blocked', async () => {
        h.transport.failNext('hang');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        let settled = null;
        client.bindChatToPreset('u1', 'p1').then(() => { settled = 'resolved'; }, (err) => { settled = err; });

        await vi.advanceTimersByTimeAsync(9000);
        expect(settled, 'still pending before the 10 s timeout').toBeNull();

        await vi.advanceTimersByTimeAsync(1500);
        expect(settled).toBeInstanceOf(Error);

        vi.useRealTimers();
        await expectStorageUntouched();
        await expectChainUnblocked();
    });

    it('{ok:false} for an invalid payload (empty uuid): rejects with ChatMapDispatchError carrying the SW error message', async () => {
        const outcome = await within(client.bindChatToPreset('', 'p1'), 2000, 'bind with empty uuid').then(() => 'resolved', (err) => err);

        const response = h.transport.responses.at(-1);
        expect(response, 'the SW answered the invalid op').toMatchObject({ ok: false, error: expect.stringMatching(/\S/) });
        expect(outcome).toBeInstanceOf(Error);
        expect(outcome.name).toBe('ChatMapDispatchError');
        expect(outcome.message).toContain(response.error);
        await expectStorageUntouched();
        await expectChainUnblocked();
    });
});
