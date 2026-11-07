/**
 * content/temporary-chat-fiber-delete.js (MAIN world) — finds the sidebar row of a session and calls the onDeleteSession prop on the nearest React fiber that carries it, then posts DSS_FIBER_DELETE_RESULT back.
 *
 * Fixture: test/fixtures/ds-snapshots/sidebar-expanded.html, the expanded sidebar wrapper captured from the live page (conv2-finished), chat titles and session ids replaced by placeholders. The only addition is a fake React fiber expando on one chat row anchor, the way React attaches __reactFiber$<random> to host nodes; no selector string is mocked, so the module locates the sidebar with its own selector against real markup.
 * The wrapper is mounted as the first element of body: happy-dom 16.8.1 evaluates `:has(> A > B)` as `:has(> A)`, so its first match for the sidebar selector is the first div with a div child, which is the wrapper only when no such div precedes it.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SIDEBAR_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/sidebar-expanded.html'), 'utf8');
const RESULT_TYPE = 'DSS_FIBER_DELETE_RESULT';
const REQUEST_TYPE = 'DSS_FIBER_DELETE_SESSION';

let onMessage;
let postMessageSpy;

function mountSidebar() {
    document.body.innerHTML = SIDEBAR_HTML;
    return document.body.firstElementChild;
}

/** Session id of the n-th chat row (0-based) in the fixture, read from its href. */
function sessionIdOfRow(wrapper, n) {
    const href = wrapper.querySelectorAll('a[href]')[n].getAttribute('href');
    return href.split('/').filter(Boolean).pop();
}

/** Attach a fiber chain to the n-th row: the anchor's own fiber has no handler, its parent fiber carries onDeleteSession. */
function attachFiber(wrapper, n) {
    const onDeleteSession = vi.fn();
    const anchor = wrapper.querySelectorAll('a[href]')[n];
    anchor['__reactFiber$t3st'] = { memoizedProps: {}, return: { memoizedProps: { onDeleteSession } } };
    return onDeleteSession;
}

function send(data, source = window) {
    onMessage({ source, data });
}

beforeEach(() => {
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, fn) => {
        if (type === 'message') onMessage = fn;
    });
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});

    const scriptPath = require.resolve('../../content/temporary-chat-fiber-delete.js');
    delete require.cache[scriptPath];
    require('../../content/temporary-chat-fiber-delete.js');
    addSpy.mockRestore();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    onMessage = undefined;
});

describe('temporary-chat-fiber-delete', () => {
    it('calls onDeleteSession on the row of the requested session and posts success', () => {
        const wrapper = mountSidebar();
        const sessionId = sessionIdOfRow(wrapper, 1);
        const otherHandler = attachFiber(wrapper, 0);
        const onDeleteSession = attachFiber(wrapper, 1);

        send({ type: REQUEST_TYPE, sessionId });

        expect(onDeleteSession, 'handler of the requested row').toHaveBeenCalledWith(sessionId);
        expect(otherHandler, 'handler of another row').not.toHaveBeenCalled();
        expect(postMessageSpy).toHaveBeenCalledWith({ type: RESULT_TYPE, sessionId, success: true }, '*');
    });

    it('posts failure when no sidebar row links to the session', () => {
        const wrapper = mountSidebar();
        const onDeleteSession = attachFiber(wrapper, 0);

        send({ type: REQUEST_TYPE, sessionId: 'non-existent-id' });

        expect(onDeleteSession).not.toHaveBeenCalled();
        expect(postMessageSpy).toHaveBeenCalledWith({ type: RESULT_TYPE, sessionId: 'non-existent-id', success: false }, '*');
    });

    it('ignores messages from other sources', () => {
        const wrapper = mountSidebar();
        const sessionId = sessionIdOfRow(wrapper, 0);
        const onDeleteSession = attachFiber(wrapper, 0);

        send({ type: REQUEST_TYPE, sessionId }, null);

        expect(onDeleteSession).not.toHaveBeenCalled();
        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('posts failure when sessionId is missing', () => {
        mountSidebar();

        send({ type: REQUEST_TYPE });

        expect(postMessageSpy).toHaveBeenCalledWith({ type: RESULT_TYPE, sessionId: undefined, success: false }, '*');
    });
});
