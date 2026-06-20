import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('temporary-chat-fiber-delete', () => {
    let postMessageSpy;
    let anchor;
    let originalDocument;
    let originalWindow;

    beforeEach(() => {
        originalDocument = global.document;
        originalWindow = global.window;

        anchor = {
            href: '/a/chat/s/test-session-id',
            '__reactFiber$123': {
                memoizedProps: {},
                return: {
                    memoizedProps: {
                        onDeleteSession: vi.fn()
                    }
                }
            }
        };

        const sidebar = {
            querySelectorAll: vi.fn().mockReturnValue([anchor])
        };

        global.document = {
            querySelector: vi.fn((selector) => {
                if (selector === 'div.dc04ec1d') return sidebar;
                return null;
            })
        };

        global.window = {
            addEventListener: vi.fn(),
            postMessage: vi.fn()
        };

        postMessageSpy = vi.spyOn(global.window, 'postMessage');

        // Load script
        const scriptPath = require.resolve('../../content/temporary-chat-fiber-delete.js');
        delete require.cache[scriptPath];
        require('../../content/temporary-chat-fiber-delete.js');
    });

    afterEach(() => {
        global.document = originalDocument;
        global.window = originalWindow;
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('should call onDeleteSession and post success result when session is found', () => {
        // Find the registered message listener
        const listenerCall = global.window.addEventListener.mock.calls.find(call => call[0] === 'message');
        const listener = listenerCall[1];

        listener({
            source: global.window,
            data: { type: 'DSS_FIBER_DELETE_SESSION', sessionId: 'test-session-id' }
        });

        expect(anchor['__reactFiber$123'].return.memoizedProps.onDeleteSession).toHaveBeenCalledWith('test-session-id');
        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_RESULT',
            sessionId: 'test-session-id',
            success: true
        }, '*');
    });

    it('should post failure result when session is not found in DOM', () => {
        const listenerCall = global.window.addEventListener.mock.calls.find(call => call[0] === 'message');
        const listener = listenerCall[1];

        listener({
            source: global.window,
            data: { type: 'DSS_FIBER_DELETE_SESSION', sessionId: 'non-existent-id' }
        });

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_RESULT',
            sessionId: 'non-existent-id',
            success: false
        }, '*');
    });

    it('should ignore messages from other sources', () => {
        const listenerCall = global.window.addEventListener.mock.calls.find(call => call[0] === 'message');
        const listener = listenerCall[1];

        listener({
            source: null,
            data: { type: 'DSS_FIBER_DELETE_SESSION', sessionId: 'test-session-id' }
        });

        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('should post failure result when sessionId is missing', () => {
        const listenerCall = global.window.addEventListener.mock.calls.find(call => call[0] === 'message');
        const listener = listenerCall[1];

        listener({
            source: global.window,
            data: { type: 'DSS_FIBER_DELETE_SESSION' }
        });

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_RESULT',
            sessionId: undefined,
            success: false
        }, '*');
    });
});
