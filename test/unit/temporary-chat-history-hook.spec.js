import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

/**
 * Unit tests for content/temporary-chat-history-hook.js
 *
 * The hook is an IIFE (main world script) that patches history.pushState and
 * history.replaceState. When called with a non-falsy url, it posts a
 * { type: 'DSS_HISTORY_NAV', url: <absoluteUrl> } message via window.postMessage
 * and then delegates to the original method.
 *
 * Strategy: load the IIFE into a vm sandbox that exposes a controlled
 * history object and a window.postMessage spy, then assert on posted messages
 * and delegation to originals.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const HOOK_SRC = fs.readFileSync(
    path.join(ROOT, 'content', 'temporary-chat-history-hook.js'),
    'utf-8',
);

/** Build a fresh sandbox and load the hook into it. */
function loadHook({ locationHref = 'https://chat.deepseek.com/' } = {}) {
    const postedMessages = [];
    const originalPushState = vi.fn();
    const originalReplaceState = vi.fn();

    const sandbox = {
        URL,       // expose the host environment's URL constructor
        history: {
            pushState: originalPushState,
            replaceState: originalReplaceState,
        },
        window: {
            location: { href: locationHref },
            postMessage: vi.fn((data) => postedMessages.push(data)),
        },
    };

    // The IIFE references `window.postMessage` and `window.location.href`.
    // It also uses `history.pushState` / `history.replaceState` directly.
    vm.createContext(sandbox);
    vm.runInContext(HOOK_SRC, sandbox);

    return { sandbox, postedMessages, originalPushState, originalReplaceState };
}

// ── Group A: pushState interception ──────────────────────────────────────────

describe('A — history.pushState interception', () => {
    it('A1: pushState with absolute URL posts DSS_HISTORY_NAV with that URL', () => {
        const { sandbox, postedMessages } = loadHook();
        const url = 'https://chat.deepseek.com/a/chat/s/aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';

        sandbox.history.pushState({}, '', url);

        expect(postedMessages).toHaveLength(1);
        expect(postedMessages[0]).toEqual({ type: 'DSS_HISTORY_NAV', url });
    });

    it('A2: pushState with relative URL posts DSS_HISTORY_NAV with resolved absolute URL', () => {
        const base = 'https://chat.deepseek.com/';
        const { sandbox, postedMessages } = loadHook({ locationHref: base });

        sandbox.history.pushState({}, '', '/a/chat/s/bbbb2222-cccc-dddd-eeee-ffffffffffff');

        expect(postedMessages).toHaveLength(1);
        expect(postedMessages[0].type).toBe('DSS_HISTORY_NAV');
        expect(postedMessages[0].url).toBe(
            'https://chat.deepseek.com/a/chat/s/bbbb2222-cccc-dddd-eeee-ffffffffffff',
        );
    });

    it('A3: pushState with null url does NOT post any message', () => {
        const { sandbox, postedMessages } = loadHook();

        sandbox.history.pushState({}, '', null);

        expect(postedMessages).toHaveLength(0);
    });

    it('A4: pushState with undefined url does NOT post any message', () => {
        const { sandbox, postedMessages } = loadHook();

        sandbox.history.pushState({}, '', undefined);

        expect(postedMessages).toHaveLength(0);
    });

    it('A5: original pushState is still called after interception (navigation actually happens)', () => {
        const { sandbox, originalPushState } = loadHook();
        const state = { key: 'val' };

        sandbox.history.pushState(state, '', '/new-path');

        expect(originalPushState).toHaveBeenCalledTimes(1);
    });
});

// ── Group B: replaceState interception ───────────────────────────────────────

describe('B — history.replaceState interception', () => {
    it('B1: replaceState with absolute URL posts DSS_HISTORY_NAV with that URL', () => {
        const { sandbox, postedMessages } = loadHook();
        const url = 'https://chat.deepseek.com/a/chat/s/cccc3333-dddd-eeee-ffff-000000000000';

        sandbox.history.replaceState({}, '', url);

        expect(postedMessages).toHaveLength(1);
        expect(postedMessages[0]).toEqual({ type: 'DSS_HISTORY_NAV', url });
    });

    it('B2: replaceState with relative URL posts DSS_HISTORY_NAV with resolved absolute URL', () => {
        const base = 'https://chat.deepseek.com/some/page';
        const { sandbox, postedMessages } = loadHook({ locationHref: base });

        sandbox.history.replaceState({}, '', '/a/chat/s/dddd4444-eeee-ffff-0000-111111111111');

        expect(postedMessages).toHaveLength(1);
        expect(postedMessages[0].type).toBe('DSS_HISTORY_NAV');
        expect(postedMessages[0].url).toBe(
            'https://chat.deepseek.com/a/chat/s/dddd4444-eeee-ffff-0000-111111111111',
        );
    });

    it('B3: replaceState with null url does NOT post any message', () => {
        const { sandbox, postedMessages } = loadHook();

        sandbox.history.replaceState({}, '', null);

        expect(postedMessages).toHaveLength(0);
    });

    it('B4: original replaceState is still called after interception', () => {
        const { sandbox, originalReplaceState } = loadHook();

        sandbox.history.replaceState({}, '', '/replace-path');

        expect(originalReplaceState).toHaveBeenCalledTimes(1);
    });
});

// ── Group C: message shape ────────────────────────────────────────────────────

describe('C — posted message shape', () => {
    it('C1: posted message has exactly type and url properties', () => {
        const { sandbox, postedMessages } = loadHook();

        sandbox.history.pushState({}, '', 'https://chat.deepseek.com/');

        expect(postedMessages).toHaveLength(1);
        const msg = postedMessages[0];
        expect(Object.keys(msg).sort()).toEqual(['type', 'url'].sort());
    });

    it('C2: postMessage is called with target origin * (second argument)', () => {
        const { sandbox } = loadHook();
        const postMessageSpy = sandbox.window.postMessage;

        sandbox.history.pushState({}, '', 'https://chat.deepseek.com/a/chat/s/eeee5555-0000-1111-2222-333333333333');

        expect(postMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_HISTORY_NAV' }),
            '*',
        );
    });
});
