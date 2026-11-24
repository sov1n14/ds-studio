// The script served in place of DeepSeek's proof-of-work worker chunk: the recording holds no body for it, and the real worker would fetch a wasm file that is not recorded either.
// Pressing Send makes the page post `{ type: 'pow-challenge' }` to the worker and wait for `{ type: 'pow-answer', answer }`; the stub answers at once, so the completion request is sent.
// The `WorkerGlobalScope` guard keeps the source inert should a page load it as an ordinary script.

export const POW_WORKER_STUB_SOURCE = `
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = (event) => {
        if (event.data && event.data.type === 'pow-challenge') self.postMessage({ type: 'pow-answer', answer: 1 });
    };
}
`;
