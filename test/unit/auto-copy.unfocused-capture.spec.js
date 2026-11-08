// @vitest-environment jsdom
/**
 * Unfocused auto-copy capture (DECISIONS U6-14): when an auto-copy click runs while the DeepSeek document is unfocused, the MAIN-world bridge captures the text the site passes to `navigator.clipboard.writeText` (only for clicks the auto-copy module dispatched; user clicks, other features' clicks and focused clicks are untouched) and forwards it to the isolated world; the content script sends it to the service worker as exactly { type: 'DSS_COPY_TO_CLIPBOARD', text }.
 *
 * Real modules together: content/react-click-bridge.main.js, content/auto-copy.relay.js, content/auto-copy.js and its dependencies. Faked trust boundaries only: the Clipboard API, chrome.runtime.sendMessage and Date (see test/helpers/auto-copy-capture-harness.js). Everything is driven through the page (a new reply completing, events on host buttons, the site's own writeText calls) and observed through the DSS_COPY_TO_CLIPBOARD messages and the promises the site received.
 *
 * Capture window: 1500 ms from the auto-copy click. Every test starts at a fresh fake instant one hour after the previous one, so pending entries left by an earlier test are long expired.
 *
 * Negative scenarios carry a positive control in the same test (a later unfocused auto-copy whose text IS sent), and the writeText-not-from-auto-copy scenarios run while an earlier focused auto-copy click has left the capture window open, so they fail if anything other than the bridge's own auto-copy tracking lets the text through.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { broadcast, changes } from '../helpers/auto-click-harness.js';
import {
    MASTER_KEY, REPLY_KEY, CODE_KEY, installChromeRuntime, resetActivations,
    addCodeBlock, mountPage, awaitingItem, flush, completeNewReply, loadAutoCopy,
} from '../helpers/auto-copy-harness.js';
import {
    COPY_TYPE, CAPTURED_EVENT, clipboardState, resetClipboard, installClipboard, siteResults, deferredWrites, resetSite,
    siteWrite, makeSiteCopyButton, toolbarCopyButton, routeSendMessage, loadRelay, recordUncaught,
} from '../helpers/auto-copy-capture-harness.js';

const settings = ({ reply = false, code = false } = {}) => ({ [MASTER_KEY]: true, [REPLY_KEY]: reply, [CODE_KEY]: code });
const REPLY_ONLY = settings({ reply: true });
const BOTH = settings({ reply: true, code: true });
const WINDOW_MS = 1500;
const OLD_TEXT = 'old reply markdown';

const copyMessage = (text) => ({ type: COPY_TYPE, text });

let clock = Date.UTC(2030, 0, 1);
let copies;
let recorder;

beforeEach(() => {
    clock += 3_600_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    document.body.innerHTML = '';
    resetActivations();
    resetSite();
    installClipboard();
    installChromeRuntime();
    recorder = recordUncaught();
});

afterEach(async () => {
    broadcast(changes([MASTER_KEY, false, true]));
    await flush();
    recorder.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

/** Mount the page (old item's copy button writes OLD_TEXT), load the real modules, route sendMessage and set the document focus state. */
async function setup({ values = REPLY_ONLY, copyModes = ['ok'], isFocused = false, resolvedValue } = {}) {
    const page = mountPage();
    makeSiteCopyButton(toolbarCopyButton(page.old.toolbar), OLD_TEXT);
    await loadRelay();
    await loadAutoCopy(values);
    copies = routeSendMessage(values, copyModes);
    resetClipboard({ isFocused, resolvedValue });
    return page;
}

/** A new reply named `name` whose copy button writes `${name} reply`, with `codeBlocks` code blocks writing `${name} code #i`, completes in `list`. */
async function newReply(list, key, name, { codeBlocks = 0, isDeferred = false } = {}) {
    const parts = awaitingItem(key, name);
    makeSiteCopyButton(toolbarCopyButton(parts.toolbar), `${name} reply`, { isDeferred });
    for (let i = 0; i < codeBlocks; i++) {
        makeSiteCopyButton(addCodeBlock(parts.item, name, i).copy, `${name} code #${i}`, { isDeferred });
    }
    await completeNewReply(list, parts);
    return parts;
}

/** Leave the capture window open: a focused auto-copy click whose writeText resolves (nothing is captured, the relay's pending entry stays live). */
async function focusedAutoCopy(list, key, name) {
    clipboardState.isFocused = true;
    await newReply(list, key, name);
    clipboardState.isFocused = false;
    expect(clipboardState.writes, 'precondition: the focused auto-copy click reached the site').toContain(`${name} reply`);
}

describe('fixture self-check', () => {
    it('the fake clipboard rejects while unfocused, resolves while focused, and refuses an unbound call like Chrome', async () => {
        installClipboard();
        resetClipboard();
        await expect(navigator.clipboard.writeText('a')).rejects.toMatchObject({ name: 'NotAllowedError' });
        resetClipboard({ isFocused: true, resolvedValue: 'done' });
        await expect(navigator.clipboard.writeText('b')).resolves.toBe('done');
        const unbound = navigator.clipboard.writeText;
        expect(() => unbound('c')).toThrow(TypeError);
    });
});

describe('unfocused auto-copy: the site\'s writeText rejects', () => {
    it('reply copy: the service worker receives exactly { type: DSS_COPY_TO_CLIPBOARD, text } with the text the site wrote', async () => {
        const { list } = await setup({ values: REPLY_ONLY });

        await newReply(list, 4, 'new');
        await flush();

        expect(clipboardState.writes, 'the site wrote once').toEqual(['new reply']);
        expect(copies).toEqual([copyMessage('new reply')]);
    });

    it('reply copy and code copy on: one message per copy, each code block first in document order, the reply last (the last message carries the full reply text)', async () => {
        const { list } = await setup({ values: BOTH });

        await newReply(list, 4, 'new', { codeBlocks: 2 });
        await flush();

        expect(copies).toEqual([copyMessage('new code #0'), copyMessage('new code #1'), copyMessage('new reply')]);
        expect(copies.at(-1), 'the last clipboard write the service worker performs is the full reply').toEqual(copyMessage('new reply'));
    });
});

describe('focused auto-copy: the site\'s writeText resolves', () => {
    it('no DSS_COPY_TO_CLIPBOARD message is sent although every copy click reached the site', async () => {
        const { list } = await setup({ values: BOTH, isFocused: true });

        await newReply(list, 4, 'new', { codeBlocks: 1 });
        await flush();

        expect(clipboardState.writes, 'precondition: both copy clicks reached the site, the code block first, the reply last').toEqual(['new code #0', 'new reply']);
        expect(copies).toEqual([]);
    });
});

describe('writeText calls not caused by an auto-copy click are never captured', () => {
    it('a dss:react-click without detail (another feature) on a site copy button: no message, even while the capture window is open', async () => {
        const { list, old } = await setup({ values: REPLY_ONLY });
        await focusedAutoCopy(list, 4, 'focused');

        toolbarCopyButton(old.toolbar).dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true }));
        await flush();
        expect(clipboardState.writes, 'precondition: the plain bridge click reached the site').toContain(OLD_TEXT);
        expect(copies, 'plain dss:react-click').toEqual([]);

        await newReply(list, 6, 'control');
        await flush();
        expect(copies, 'positive control: a later unfocused auto-copy').toEqual([copyMessage('control reply')]);
    });

    it('a dss:react-click with a detail other than auto-copy: no message', async () => {
        const { list, old } = await setup({ values: REPLY_ONLY });
        await focusedAutoCopy(list, 4, 'focused');

        toolbarCopyButton(old.toolbar).dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true, detail: 'auto-retry' }));
        await flush();
        expect(clipboardState.writes, 'precondition: the bridge click reached the site').toContain(OLD_TEXT);
        expect(copies, 'dss:react-click with another detail').toEqual([]);

        await newReply(list, 6, 'control');
        await flush();
        expect(copies, 'positive control').toEqual([copyMessage('control reply')]);
    });

    it('the site calling writeText on its own (no click): no message, even while the capture window is open', async () => {
        const { list } = await setup({ values: REPLY_ONLY });
        await focusedAutoCopy(list, 4, 'focused');

        siteWrite('site direct write');
        await flush();
        expect(copies, 'direct writeText').toEqual([]);

        await newReply(list, 6, 'control');
        await flush();
        expect(copies, 'positive control').toEqual([copyMessage('control reply')]);
    });
});

describe('forged dss:auto-copy-captured events', () => {
    it('with no auto-copy click pending: no message', async () => {
        const { list } = await setup({ values: REPLY_ONLY });

        document.dispatchEvent(new CustomEvent(CAPTURED_EVENT, { detail: 'forged text' }));
        await flush();
        expect(copies, 'forged capture').toEqual([]);

        await newReply(list, 4, 'control');
        await flush();
        expect(copies, 'positive control').toEqual([copyMessage('control reply')]);
    });

    it.each([
        ['an object', { text: 'forged text' }],
        ['a number', 42],
        ['null', null],
        ['no detail', undefined],
    ])('with %s as detail while the capture window is open: no message', async (_name, detail) => {
        const { list } = await setup({ values: REPLY_ONLY });
        await focusedAutoCopy(list, 4, 'focused');

        document.dispatchEvent(new CustomEvent(CAPTURED_EVENT, detail === undefined ? {} : { detail }));
        await flush();
        expect(copies, 'non-string capture').toEqual([]);

        await newReply(list, 6, 'control');
        await flush();
        expect(copies, 'positive control').toEqual([copyMessage('control reply')]);
    });
});

describe('capture window (1500 ms from the auto-copy click)', () => {
    it('the site reaches writeText 1499 ms after the auto-copy click: the text is sent', async () => {
        const { list } = await setup({ values: REPLY_ONLY });
        await newReply(list, 4, 'late', { isDeferred: true });
        expect(deferredWrites, 'precondition: the click reached the site, which deferred its write').toHaveLength(1);

        vi.setSystemTime(clock + WINDOW_MS - 1);
        deferredWrites[0]();
        await flush();

        expect(copies).toEqual([copyMessage('late reply')]);
    });

    it.each([WINDOW_MS, WINDOW_MS + 5000])('the site first reaches writeText %i ms after the auto-copy click: no message', async (delay) => {
        const { list } = await setup({ values: REPLY_ONLY });
        await newReply(list, 4, 'late', { isDeferred: true });
        expect(deferredWrites, 'precondition: the click reached the site, which deferred its write').toHaveLength(1);

        vi.setSystemTime(clock + delay);
        deferredWrites[0]();
        await flush();
        expect(clipboardState.writes, 'precondition: the late write reached the clipboard').toEqual(['late reply']);
        expect(copies, 'write after the window').toEqual([]);

        await newReply(list, 6, 'control');
        await flush();
        expect(copies, 'positive control: an auto-copy after the expired one').toEqual([copyMessage('control reply')]);
    });
});

describe('the site still observes its own writeText outcome', () => {
    it('unfocused auto-copy: the promise the site got rejects with the clipboard\'s own error', async () => {
        const { list } = await setup({ values: REPLY_ONLY });

        await newReply(list, 4, 'new');

        expect(siteResults.map((r) => r.text), 'precondition: the site wrote once').toEqual(['new reply']);
        expect(clipboardState.lastError, 'precondition: the clipboard rejected').toBeInstanceOf(DOMException);
        await expect(siteResults[0].promise).rejects.toBe(clipboardState.lastError);
    });

    it('focused auto-copy: the promise the site got resolves with the clipboard\'s own value', async () => {
        const resolvedValue = { marker: 'clipboard-resolved' };
        const { list } = await setup({ values: REPLY_ONLY, isFocused: true, resolvedValue });

        await newReply(list, 4, 'new');

        expect(siteResults.map((r) => r.text), 'precondition: the site wrote once').toEqual(['new reply']);
        await expect(siteResults[0].promise).resolves.toBe(resolvedValue);
    });

    it('unfocused click that is not an auto-copy: the promise the site got rejects with the clipboard\'s own error', async () => {
        const { old } = await setup({ values: REPLY_ONLY });

        toolbarCopyButton(old.toolbar).dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true }));

        expect(siteResults.map((r) => r.text), 'precondition: the site wrote once').toEqual([OLD_TEXT]);
        await expect(siteResults[0].promise).rejects.toBe(clipboardState.lastError);
    });
});

describe('a failing DSS_COPY_TO_CLIPBOARD send', () => {
    it.each([
        ['rejects', 'reject'],
        ['throws synchronously', 'throw'],
        ['resolves without a response', 'undefined'],
    ])('sendMessage %s: nothing escapes as an uncaught error and the next capture is still sent', async (_name, mode) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { list } = await setup({ values: REPLY_ONLY, copyModes: [mode, 'ok'] });

        await newReply(list, 4, 'first');
        await flush();
        expect(copies, 'precondition: the first capture was attempted').toEqual([copyMessage('first reply')]);

        await newReply(list, 6, 'second');
        await flush();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(copies, 'the next capture is still sent').toEqual([copyMessage('first reply'), copyMessage('second reply')]);
        expect(recorder.uncaught, 'uncaught errors').toEqual([]);
    });
});
