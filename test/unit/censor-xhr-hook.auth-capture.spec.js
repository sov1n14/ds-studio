import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unit tests for the auth capture logic added to censor-xhr-hook.js.
 *
 * The hook runs in MAIN world and cannot be imported in Node.js (depends on
 * the SseParser global and a real XMLHttpRequest). We replicate the exact
 * setRequestHeader override logic inline — same pattern used by the existing
 * censor-xhr-hook.spec.js for SSE parsing.
 */

describe('censor-xhr-hook: setRequestHeader auth capture', () => {
    let mockWindow;
    let lastCapturedAuth;

    /**
     * Replicates the setRequestHeader override from censor-xhr-hook.js.
     * Returns the handler function so tests can call it directly.
     */
    function createSetRequestHeaderOverride() {
        lastCapturedAuth = null;

        return function setRequestHeaderOverride(name, value) {
            if (name.toLowerCase() === 'authorization' && value !== lastCapturedAuth) {
                lastCapturedAuth = value;
                mockWindow.postMessage({ type: 'DSS_AUTH_CAPTURED', authorization: value }, '*');
            }
            // (original call omitted — we are testing logic, not the real XHR method)
        };
    }

    beforeEach(() => {
        mockWindow = {
            postMessage: vi.fn(),
        };
    });

    it('fires postMessage with DSS_AUTH_CAPTURED when authorization header is set', () => {
        const override = createSetRequestHeaderOverride();
        override('authorization', 'Bearer token-abc');

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer token-abc' },
            '*'
        );
    });

    it('is case-insensitive — fires for Authorization (mixed case)', () => {
        const override = createSetRequestHeaderOverride();
        override('Authorization', 'Bearer token-xyz');

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer token-xyz' },
            '*'
        );
    });

    it('does NOT fire postMessage when the same authorization value is set again (deduplication)', () => {
        const override = createSetRequestHeaderOverride();
        override('authorization', 'Bearer same-token');
        override('authorization', 'Bearer same-token'); // duplicate

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire postMessage for non-authorization headers', () => {
        const override = createSetRequestHeaderOverride();
        override('content-type', 'application/json');
        override('x-custom-header', 'some-value');
        override('accept', 'text/event-stream');

        expect(mockWindow.postMessage).not.toHaveBeenCalled();
    });

    it('fires postMessage again when the authorization value changes to a different value', () => {
        const override = createSetRequestHeaderOverride();
        override('authorization', 'Bearer first-token');
        override('authorization', 'Bearer second-token');

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(2);
        expect(mockWindow.postMessage).toHaveBeenNthCalledWith(
            1,
            { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer first-token' },
            '*'
        );
        expect(mockWindow.postMessage).toHaveBeenNthCalledWith(
            2,
            { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer second-token' },
            '*'
        );
    });

    it('does NOT fire when same value appears after multiple different values', () => {
        const override = createSetRequestHeaderOverride();
        override('authorization', 'Bearer token-A');
        override('authorization', 'Bearer token-B');
        override('authorization', 'Bearer token-B'); // duplicate of second

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(2);
    });

    it('carries the exact authorization string value in the postMessage payload', () => {
        const override = createSetRequestHeaderOverride();
        const tokenValue = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
        override('authorization', tokenValue);

        const [payload] = mockWindow.postMessage.mock.calls[0];
        expect(payload.authorization).toBe(tokenValue);
    });
});
