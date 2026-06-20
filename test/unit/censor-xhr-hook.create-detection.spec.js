import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unit tests for the chat_session/create detection logic in censor-xhr-hook.js.
 *
 * censor-xhr-hook.js is an IIFE injected into the page's main world and cannot be
 * imported directly in Node.js (it depends on SseParser global and real XHR/fetch).
 * We replicate the exact maybeNotifyCreate logic inline — the same pattern used by
 * censor-xhr-hook.auth-capture.spec.js for the setRequestHeader logic.
 */

const CREATE_ENDPOINT = '/api/v0/chat_session/create';

/** Replicates the maybeNotifyCreate function from censor-xhr-hook.js */
function createMaybeNotifyCreate(mockWindow) {
    return function maybeNotifyCreate(url) {
        if (!url) { return; }
        if (url.includes(CREATE_ENDPOINT)) {
            mockWindow.postMessage({ type: 'DSS_CHAT_CREATE_DETECTED' }, '*');
        }
    };
}

/** Replicates the XHR open override from censor-xhr-hook.js (create detection part) */
function createXhrOpenOverride(maybeNotifyCreate) {
    return function xhrOpenOverride(method, url) {
        const dssUrl = typeof url === 'string' ? url : (url ? url.toString() : '');
        maybeNotifyCreate(dssUrl);
        // (original XHR open call omitted — testing logic only)
    };
}

/** Replicates the fetch override from censor-xhr-hook.js */
function createFetchOverride(maybeNotifyCreate) {
    return function fetchOverride(resource, init) {
        const url = typeof resource === 'string'
            ? resource
            : (resource && typeof resource.url === 'string' ? resource.url : '');
        maybeNotifyCreate(url);
        // (original fetch call omitted — testing logic only)
    };
}

describe('censor-xhr-hook: DSS_CHAT_CREATE_DETECTED via XHR open', () => {
    let mockWindow;
    let xhrOpen;

    beforeEach(() => {
        mockWindow = { postMessage: vi.fn() };
        const notify = createMaybeNotifyCreate(mockWindow);
        xhrOpen = createXhrOpenOverride(notify);
    });

    it('posts DSS_CHAT_CREATE_DETECTED when URL contains /api/v0/chat_session/create', () => {
        xhrOpen('POST', 'https://chat.deepseek.com/api/v0/chat_session/create');

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            { type: 'DSS_CHAT_CREATE_DETECTED' },
            '*'
        );
    });

    it('posts DSS_CHAT_CREATE_DETECTED when URL has query string after the endpoint', () => {
        xhrOpen('POST', 'https://chat.deepseek.com/api/v0/chat_session/create?v=1');

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            { type: 'DSS_CHAT_CREATE_DETECTED' },
            '*'
        );
    });

    it('does NOT post DSS_CHAT_CREATE_DETECTED for completion endpoint', () => {
        xhrOpen('POST', 'https://chat.deepseek.com/api/v0/chat/completion');

        expect(mockWindow.postMessage).not.toHaveBeenCalled();
    });

    it('does NOT post DSS_CHAT_CREATE_DETECTED for delete endpoint', () => {
        xhrOpen('POST', 'https://chat.deepseek.com/api/v0/chat_session/delete');

        expect(mockWindow.postMessage).not.toHaveBeenCalled();
    });

    it('does NOT post when URL is empty string', () => {
        xhrOpen('GET', '');

        expect(mockWindow.postMessage).not.toHaveBeenCalled();
    });

    it('does NOT post when URL is null/falsy', () => {
        xhrOpen('GET', null);

        expect(mockWindow.postMessage).not.toHaveBeenCalled();
    });
});

describe('censor-xhr-hook: DSS_CHAT_CREATE_DETECTED via fetch', () => {
    let mockWindow;
    let fetchOverride;

    beforeEach(() => {
        mockWindow = { postMessage: vi.fn() };
        const notify = createMaybeNotifyCreate(mockWindow);
        fetchOverride = createFetchOverride(notify);
    });

    it('posts DSS_CHAT_CREATE_DETECTED when fetch URL string contains the create endpoint', () => {
        fetchOverride('https://chat.deepseek.com/api/v0/chat_session/create', {});

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            { type: 'DSS_CHAT_CREATE_DETECTED' },
            '*'
        );
    });

    it('posts DSS_CHAT_CREATE_DETECTED when resource is a Request-like object with .url property', () => {
        const requestLike = { url: 'https://chat.deepseek.com/api/v0/chat_session/create' };
        fetchOverride(requestLike, {});

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            { type: 'DSS_CHAT_CREATE_DETECTED' },
            '*'
        );
    });

    it('does NOT post for history_messages fetch (non-create URL)', () => {
        fetchOverride('https://chat.deepseek.com/api/v0/chat/history_messages', {});

        expect(mockWindow.postMessage).not.toHaveBeenCalled();
    });

    it('does NOT post when resource is an object without a .url string', () => {
        fetchOverride({ noUrl: true }, {});

        expect(mockWindow.postMessage).not.toHaveBeenCalled();
    });
});

describe('censor-xhr-hook: DSS_AUTH_CAPTURED still fires independently of create detection', () => {
    /**
     * Verifies that create-URL detection and auth-header capture are orthogonal:
     * a create request posted via XHR open posts DSS_CHAT_CREATE_DETECTED, while
     * setRequestHeader('authorization', ...) posts DSS_AUTH_CAPTURED.
     * Both can fire on the same XHR without interfering.
     */
    it('open() on create URL posts create message; setRequestHeader posts auth message independently', () => {
        const postMessages = [];
        const mockWindow = { postMessage: vi.fn((msg) => postMessages.push(msg)) };

        const notify = createMaybeNotifyCreate(mockWindow);
        const xhrOpen = createXhrOpenOverride(notify);

        // Simulate setRequestHeader override (inline from auth-capture logic)
        let lastCapturedAuth = null;
        function setRequestHeaderOverride(name, value) {
            if (name.toLowerCase() === 'authorization' && value !== lastCapturedAuth) {
                lastCapturedAuth = value;
                mockWindow.postMessage({ type: 'DSS_AUTH_CAPTURED', authorization: value }, '*');
            }
        }

        // open() triggers create detection
        xhrOpen('POST', 'https://chat.deepseek.com/api/v0/chat_session/create');
        // setRequestHeader captures auth
        setRequestHeaderOverride('authorization', 'Bearer token-xyz');

        expect(postMessages).toHaveLength(2);
        expect(postMessages[0]).toEqual({ type: 'DSS_CHAT_CREATE_DETECTED' });
        expect(postMessages[1]).toEqual({ type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer token-xyz' });
    });
});
