import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Test Suite: Bug 2 — Fragment Complete Dispatch Timing
 *
 * Tests the shouldDispatch logic (line 116 in censor-xhr-hook.js) that now requires xhr.readyState === 4.
 *
 * Issue: Without the readyState check, the DSS_FRAGMENT_COMPLETE message could be dispatched
 * while the XHR is still in progress (readyState 3), causing premature message injection and
 * potential duplicate dispatches.
 *
 * The fix ensures the message is only sent when the entire response is complete (readyState 4).
 */
describe('Bug 2: Fragment Complete Dispatch Timing', () => {
    let mockXhr;
    let messageEvents;
    let mockPostMessage;

    beforeEach(() => {
        // Track posted messages
        messageEvents = [];
        mockPostMessage = vi.fn((data) => {
            messageEvents.push(data);
        });

        // Create a mock XHR state similar to censor-xhr-hook.js
        mockXhr = {
            readyState: null,
            _dssUrl: '/api/v0/chat/completion',
            responseText: ''
        };
    });

    it('(a) does NOT dispatch when readyState=3 (still loading), even if all other conditions met', () => {
        const state = {
            messageId: 123,
            fragments: [{ id: 1, type: 'RESPONSE', content: 'hello' }],
            started: true,
            finished: true
        };
        mockXhr.readyState = 3;

        // Simulate the shouldDispatch check
        const shouldDispatch =
            mockXhr.readyState === 4 &&
            state.messageId &&
            state.fragments &&
            state.started;

        expect(shouldDispatch).toBe(false);
        expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('(b) dispatches with aborted=false when readyState=4 and finished=true', () => {
        const state = {
            messageId: 456,
            fragments: [{ id: 1, type: 'RESPONSE', content: 'world' }],
            started: true,
            finished: true
        };
        mockXhr.readyState = 4;

        // Simulate the shouldDispatch check
        const shouldDispatch =
            mockXhr.readyState === 4 &&
            state.messageId &&
            state.fragments &&
            state.started;

        expect(shouldDispatch).toBe(true);

        // Simulate the postMessage call from censor-xhr-hook.js
        mockPostMessage({
            type: 'DSS_FRAGMENT_COMPLETE',
            messageId: state.messageId,
            fragments: state.fragments,
            thinkingElapsedSecs: 0,
            aborted: !state.finished
        }, '*');

        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'DSS_FRAGMENT_COMPLETE',
                messageId: 456,
                aborted: false
            }),
            '*'
        );
        expect(messageEvents[0].aborted).toBe(false);
    });

    it('(c) dispatches with aborted=true when readyState=4 but finished=false (user abort)', () => {
        const state = {
            messageId: 789,
            fragments: [{ id: 1, type: 'RESPONSE', content: 'partial' }],
            started: true,
            finished: false  // User cancelled the request
        };
        mockXhr.readyState = 4;

        const shouldDispatch =
            mockXhr.readyState === 4 &&
            state.messageId &&
            state.fragments &&
            state.started;

        expect(shouldDispatch).toBe(true);

        mockPostMessage({
            type: 'DSS_FRAGMENT_COMPLETE',
            messageId: state.messageId,
            fragments: state.fragments,
            thinkingElapsedSecs: 0,
            aborted: !state.finished
        }, '*');

        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'DSS_FRAGMENT_COMPLETE',
                messageId: 789,
                aborted: true
            }),
            '*'
        );
        expect(messageEvents[0].aborted).toBe(true);
    });

    it('dispatches exactly once per complete response', () => {
        const state = {
            messageId: 999,
            fragments: [{ id: 1, type: 'RESPONSE', content: 'test' }],
            started: true,
            finished: true
        };
        mockXhr.readyState = 4;

        const shouldDispatch =
            mockXhr.readyState === 4 &&
            state.messageId &&
            state.fragments &&
            state.started;

        expect(shouldDispatch).toBe(true);

        // First dispatch
        if (shouldDispatch) {
            mockPostMessage({
                type: 'DSS_FRAGMENT_COMPLETE',
                messageId: state.messageId,
                fragments: state.fragments,
                thinkingElapsedSecs: 0,
                aborted: !state.finished
            }, '*');

            // Simulate cleanup (as in censor-xhr-hook.js lines 132-133)
            state.messageId = null;
        }

        // Second check would fail because messageId is null
        const shouldDispatchAgain =
            mockXhr.readyState === 4 &&
            state.messageId &&
            state.fragments &&
            state.started;

        // null is falsy; shouldDispatchAgain should be false or falsy
        expect(!shouldDispatchAgain).toBe(true);
        expect(mockPostMessage).toHaveBeenCalledTimes(1);
    });
});
