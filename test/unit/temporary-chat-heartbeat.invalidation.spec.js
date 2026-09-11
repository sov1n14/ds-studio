/**
 * content/temporary-chat-heartbeat.js — synchronous catch-block branching.
 *
 * Contract (from requirements):
 *   When chrome.runtime.sendMessage THROWS synchronously:
 *   - If err.message includes 'Extension context invalidated':
 *     stop() is called AND DSSInvalidationToast.show() is called,
 *     console.warn is NOT called.
 *   - If err.message is anything else:
 *     stop() is called AND console.warn is called,
 *     DSSInvalidationToast.show() is NOT called.
 *
 * Note: sendHeartbeat's catch is internal — start() continues and sets up
 * the interval after the first sendHeartbeat call. The test focuses on
 * WHICH branch executes (toast vs warn), not on interval state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/temporary-chat-constants.js';

let heartbeat;
let sendMessage;
let showSpy;
let warnSpy;

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });

    showSpy = vi.fn();
    globalThis.DSSInvalidationToast = { show: showSpy };

    vi.resetModules();
    await import('../../utils/temporary-chat-constants.js');
    await import('../../content/temporary-chat-heartbeat.js');
    heartbeat = globalThis.TemporaryChatHeartbeat;

    sendMessage = globalThis.chrome.runtime.sendMessage;
    sendMessage.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    heartbeat.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.DSSInvalidationToast;
});

describe('heartbeat catch-block — Extension context invalidated', () => {
    it('calls DSSInvalidationToast.show() and not console.warn', () => {
        sendMessage.mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });

        heartbeat.start('uuid-inv');

        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe('heartbeat catch-block — other synchronous error', () => {
    it('calls console.warn and not DSSInvalidationToast.show()', () => {
        sendMessage.mockImplementation(() => {
            throw new Error('Some other runtime error');
        });

        heartbeat.start('uuid-other');

        expect(warnSpy).toHaveBeenCalled();
        expect(showSpy).not.toHaveBeenCalled();
    });
});
