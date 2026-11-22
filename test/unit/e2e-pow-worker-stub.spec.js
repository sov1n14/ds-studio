/**
 * test/e2e/helpers/pow-worker-stub.js — the script the offline lane serves in place of DeepSeek's proof-of-work worker chunk.
 *
 * Requirement (lead decision, offline harness stage 2): the recording holds no body for the worker chunk, and the real worker would fetch a wasm file that is not recorded either.
 * Pressing Send makes the page post `{ type: 'pow-challenge' }` to the worker and wait for `{ type: 'pow-answer', answer }`; the stub answers so the completion request is sent.
 * Loaded as an ordinary page script, the same source does nothing.
 */
import { describe, expect, it } from 'vitest';
import { POW_WORKER_STUB_SOURCE } from '../e2e/helpers/pow-worker-stub.js';

class FakeWorkerGlobalScope {
    constructor() {
        this.posted = [];
    }

    postMessage(message) {
        this.posted.push(message);
    }
}

function runInWorkerScope() {
    const scope = new FakeWorkerGlobalScope();
    new Function('self', 'WorkerGlobalScope', POW_WORKER_STUB_SOURCE)(scope, FakeWorkerGlobalScope);
    return scope;
}

describe('POW_WORKER_STUB_SOURCE', () => {
    it('answers a pow-challenge message with a pow-answer message', () => {
        const scope = runInWorkerScope();
        scope.onmessage({ data: { type: 'pow-challenge', challenge: { salt: 'x' } } });
        expect(scope.posted).toHaveLength(1);
        expect(scope.posted[0].type).toBe('pow-answer');
        expect(scope.posted[0]).toHaveProperty('answer');
    });

    it('stays silent for any other message', () => {
        const scope = runInWorkerScope();
        scope.onmessage({ data: { type: 'something-else' } });
        scope.onmessage({ data: null });
        expect(scope.posted).toEqual([]);
    });

    it('does nothing when it runs as an ordinary page script', () => {
        const page = { postMessage() { throw new Error('a page script must not post'); } };
        expect(() => new Function('self', 'WorkerGlobalScope', POW_WORKER_STUB_SOURCE)(page, undefined)).not.toThrow();
        expect(page.onmessage).toBeUndefined();
    });
});
