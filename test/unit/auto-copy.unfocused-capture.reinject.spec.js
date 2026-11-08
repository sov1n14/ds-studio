// @vitest-environment jsdom
/**
 * Unfocused auto-copy capture with the MAIN-world bridge evaluated twice in the same window (re-injection): one unfocused auto-copy click must still reach the site once, write once and produce exactly one DSS_COPY_TO_CLIPBOARD message.
 *
 * Own spec file: the bridge's install state lives on `window` / `document` and navigator.clipboard, which survive vi.resetModules, so both evaluations must happen on a window no other test has touched (vitest isolates each spec file). Harness: test/helpers/auto-copy-capture-harness.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { broadcast, changes, installChromeRuntime, loadBridge } from '../helpers/auto-click-harness.js';
import { MASTER_KEY, REPLY_KEY, CODE_KEY, mountPage, awaitingItem, flush, completeNewReply, loadAutoCopy } from '../helpers/auto-copy-harness.js';
import {
    COPY_TYPE, clipboardState, resetClipboard, installClipboard, siteResults, makeSiteCopyButton, toolbarCopyButton, routeSendMessage, loadRelay,
} from '../helpers/auto-copy-capture-harness.js';

const REPLY_ONLY = { [MASTER_KEY]: true, [REPLY_KEY]: true, [CODE_KEY]: false };

afterEach(async () => {
    broadcast(changes([MASTER_KEY, false, true]));
    await flush();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('bridge re-injection', () => {
    it('evaluated twice, one unfocused auto-copy click writes once and sends exactly one message', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.UTC(2030, 0, 1));
        installClipboard();
        installChromeRuntime();
        await loadBridge();
        vi.resetModules();
        await import('../../content/react-click-bridge.main.js');

        const { list } = mountPage();
        await loadRelay();
        await loadAutoCopy(REPLY_ONLY);
        const copies = routeSendMessage(REPLY_ONLY);
        resetClipboard();
        const parts = awaitingItem(4, 'new');
        makeSiteCopyButton(toolbarCopyButton(parts.toolbar), 'new reply');

        await completeNewReply(list, parts);
        await flush();

        expect(siteResults.map((r) => r.text), 'site onClick runs').toEqual(['new reply']);
        expect(clipboardState.writes, 'clipboard writes').toEqual(['new reply']);
        expect(copies).toEqual([{ type: COPY_TYPE, text: 'new reply' }]);
    });
});
