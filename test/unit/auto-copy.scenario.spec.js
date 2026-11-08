// @vitest-environment jsdom
/**
 * content/auto-copy.js — auto-copy reply content and auto-copy code block content (red phase: the module does not exist yet).
 *
 * Requirement (user request): two Features toggles. (a) Auto-copy code block content: click the code block's copy button automatically. (b) Auto-copy reply content: when a new message toolbar (「快捷功能條」) appears, click its copy button automatically; a toolbar that is not new (an old one scrolled back into view) MUST NOT be clicked. Decisions: D-07 a stopped / aborted reply gets no auto-copy; U6-04 code blocks are copied only when the reply completes (its new toolbar appears), never when a banner mounts while streaming; U6-05 both toggles default off; U6-07 (revised) with both on, every code block copy runs first, in document order, and the reply copy runs last, so the clipboard ends holding the full reply (the content the user ultimately pastes); both toggles stay on, the copy logic never turns either off.
 *
 * Contract under test:
 *   - Gates (content/feature-toggle.js): reply copy = master "isEnabled" ON && "isAutoCopyReplyEnabled" true; code copy = master ON && "isAutoCopyCodeEnabled" true. Initial values via DSS_GET_SETTINGS, changes via DSS_SETTINGS_CHANGED.
 *   - A new toolbar is one returned by DSstudio.ReplyCompletion.newToolbarsFromRecords for a mutation batch on the message list; a toolbar for which isStoppedReply is true is skipped entirely.
 *   - For each new, non-stopped toolbar: reply copy activates the toolbar's first direct role="button" child (copy, index 0) once; code copy activates the copy button (first banner button) of every code block inside that toolbar's own item once, in document order, never the download button and never a code block of another item. With both on, the code block copies come first and the reply copy last.
 *   - Activation goes through `dss:react-click` on the target button (the bridge contract), asserted as the guarded React onClick accepting the event (see test/helpers/auto-copy-harness.js).
 *
 * Every negative scenario carries a positive control in the same test (a later new toolbar that IS copied), so "nothing happened" cannot pass because the module never ran.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { broadcast, changes, loadBridge, requestedKeys } from '../helpers/auto-click-harness.js';
import {
    MASTER_KEY, REPLY_KEY, CODE_KEY, installChromeRuntime, activations, resetActivations, guard,
    addCodeBlock, mountPage, awaitingItem, completeItem, makeStopped, flush, completeNewReply, loadAutoCopy,
} from '../helpers/auto-copy-harness.js';

const settings = ({ master = true, reply = false, code = false } = {}) => ({ [MASTER_KEY]: master, [REPLY_KEY]: reply, [CODE_KEY]: code });
const REPLY_ONLY = settings({ reply: true });
const CODE_ONLY = settings({ code: true });
const BOTH = settings({ reply: true, code: true });

beforeEach(() => {
    document.body.innerHTML = '';
    resetActivations();
    installChromeRuntime();
});

afterEach(async () => {
    // Close every gate so this test's observer cannot act on the next test's page.
    broadcast(changes([MASTER_KEY, false, true]));
    await flush();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('fixture self-checks', () => {
    it('an untrusted .click() on a guarded button activates nothing; a dss:react-click through the bridge activates it once', async () => {
        const { old } = mountPage();
        const copy = old.toolbar.querySelector('[role="button"]');
        await loadBridge();

        copy.click();
        expect(activations(), 'untrusted click').toEqual([]);

        copy.dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true }));
        expect(activations(), 'bridge activation').toEqual(['old:reply']);
    });
});

describe('initial settings request', () => {
    it('requests the master key and both own keys through GET_SETTINGS', async () => {
        mountPage();
        await loadAutoCopy(settings());

        expect(requestedKeys()).toEqual(expect.arrayContaining([MASTER_KEY, REPLY_KEY, CODE_KEY]));
    });
});

describe('a new reply completes (new toolbar in an already-mounted item)', () => {
    it('reply copy on: activates only the new toolbar\'s copy button, once', async () => {
        const { list } = mountPage({ oldCodeBlock: true });
        await loadAutoCopy(REPLY_ONLY);
        const fresh = awaitingItem(4, 'new');
        addCodeBlock(fresh.item, 'new', 0);

        await completeNewReply(list, fresh);

        expect(activations()).toEqual(['new:reply']);
    });

    it('code copy on: activates the copy button of each code block in the new reply\'s item, once each, in document order; not the reply copy, not downloads, not the old item\'s code block', async () => {
        const { list } = mountPage({ oldCodeBlock: true });
        await loadAutoCopy(CODE_ONLY);
        const fresh = awaitingItem(4, 'new');
        addCodeBlock(fresh.item, 'new', 0);
        addCodeBlock(fresh.item, 'new', 1);

        await completeNewReply(list, fresh);

        expect(activations()).toEqual(['new:code#0', 'new:code#1']);
    });

    it('both on: each code block copy first in document order, then the reply copy last (U6-07 revised); both toggles stay on, so the next new reply is copied the same way', async () => {
        const { list } = mountPage({ oldCodeBlock: true });
        await loadAutoCopy(BOTH);
        const fresh = awaitingItem(4, 'new');
        addCodeBlock(fresh.item, 'new', 0);
        addCodeBlock(fresh.item, 'new', 1);

        await completeNewReply(list, fresh);

        expect(activations(), 'first reply: code blocks first, the full reply last').toEqual(['new:code#0', 'new:code#1', 'new:reply']);

        const next = awaitingItem(6, 'next');
        addCodeBlock(next.item, 'next', 0);
        await completeNewReply(list, next);
        expect(activations(), 'both toggles still on: the next reply gets both, its reply copy last').toEqual(['new:code#0', 'new:code#1', 'new:reply', 'next:code#0', 'next:reply']);
    });

    it('code copy on, reply without code blocks: nothing is activated (no fallback to other items)', async () => {
        const { list } = mountPage({ oldCodeBlock: true });
        await loadAutoCopy(CODE_ONLY);
        const control = awaitingItem(6, 'control');
        addCodeBlock(control.item, 'control', 0);
        const fresh = awaitingItem(4, 'new');

        await completeNewReply(list, fresh);
        expect(activations(), 'reply without code blocks').toEqual([]);

        await completeNewReply(list, control);
        expect(activations(), 'positive control: a later reply with a code block').toEqual(['control:code#0']);
    });

    it('two toolbars arriving in one batch: each reply copy once, in document order', async () => {
        const { list } = mountPage();
        await loadAutoCopy(REPLY_ONLY);
        const first = awaitingItem(4, 'first');
        const second = awaitingItem(6, 'second');
        list.append(first.item, second.item);
        await flush();

        second.item.appendChild(second.row);
        first.item.appendChild(first.row);
        await flush();

        expect(activations()).toEqual(['first:reply', 'second:reply']);
    });

    it('a toolbar is copied once: later mutations inside the completed reply do not copy it again', async () => {
        const { list } = mountPage();
        await loadAutoCopy(BOTH);
        const fresh = awaitingItem(4, 'new');
        await completeNewReply(list, fresh);
        expect(activations(), 'precondition: the new toolbar was copied').toEqual(['new:reply']);

        const paragraph = document.createElement('p');
        paragraph.textContent = 'late text';
        fresh.item.querySelector('.ds-markdown').appendChild(paragraph);
        await flush();

        expect(activations()).toEqual(['new:reply']);
    });
});

describe('toolbars that are not a newly completed reply are never copied', () => {
    it('old messages already on the page when the feature turns on: nothing is copied', async () => {
        const { old } = mountPage({ oldCodeBlock: true });
        expect(old.item.contains(old.toolbar), 'precondition: the old item holds its toolbar').toBe(true);

        await loadAutoCopy(BOTH);
        expect(activations(), 'after enable').toEqual([]);

        const control = awaitingItem(4, 'control');
        await completeNewReply(document.querySelector('.ds-virtual-list-visible-items'), control);
        expect(activations(), 'positive control: a later new reply').toEqual(['control:reply']);
    });

    it('stopped reply (D-07): neither the reply nor its code blocks are copied, and the continue button is not pressed', async () => {
        const { list } = mountPage();
        await loadAutoCopy(BOTH);
        const stopped = awaitingItem(4, 'stopped');
        addCodeBlock(stopped.item, 'stopped', 0);
        makeStopped(stopped.row, 'stopped');

        await completeNewReply(list, stopped);
        expect(activations(), 'stopped reply').toEqual([]);

        const control = awaitingItem(6, 'control');
        addCodeBlock(control.item, 'control', 0);
        await completeNewReply(list, control);
        expect(activations(), 'positive control: a later normal reply').toEqual(['control:code#0', 'control:reply']);
    });

    it('scroll re-mount: an item scrolled out and back in with its toolbar (and code block) inside is not copied', async () => {
        const { list, old } = mountPage();
        await loadAutoCopy(BOTH);

        old.item.remove();
        await flush();
        const remounted = completeItem(2, 'remounted');
        addCodeBlock(remounted.item, 'remounted', 0);
        list.appendChild(remounted.item);
        await flush();
        expect(activations(), 'scroll re-mount').toEqual([]);

        const control = awaitingItem(4, 'control');
        await completeNewReply(list, control);
        expect(activations(), 'positive control: a later new reply').toEqual(['control:reply']);
    });

    it('code block banners mounting while the reply streams (no toolbar yet) are not copied; they are copied once when the toolbar arrives (U6-04)', async () => {
        const { list } = mountPage();
        await loadAutoCopy(CODE_ONLY);
        const fresh = awaitingItem(4, 'new');
        list.appendChild(fresh.item);
        await flush();

        addCodeBlock(fresh.item, 'new', 0);
        await flush();
        addCodeBlock(fresh.item, 'new', 1);
        await flush();
        expect(activations(), 'while streaming').toEqual([]);

        fresh.item.appendChild(fresh.row);
        await flush();
        expect(activations(), 'at completion').toEqual(['new:code#0', 'new:code#1']);
    });
});

describe('gating', () => {
    it('both own toggles off (fresh install defaults): nothing is copied; turning reply copy on afterwards copies the next new reply', async () => {
        const { list } = mountPage();
        await loadAutoCopy(settings());
        const first = awaitingItem(4, 'first');
        addCodeBlock(first.item, 'first', 0);
        await completeNewReply(list, first);
        expect(activations(), 'both toggles off').toEqual([]);

        broadcast(changes([REPLY_KEY, true, false]));
        await flush();
        const control = awaitingItem(6, 'control');
        addCodeBlock(control.item, 'control', 0);
        await completeNewReply(list, control);
        expect(activations(), 'positive control: reply copy turned on').toEqual(['control:reply']);
    });

    it('master switch off with both own toggles on: nothing is copied; master on afterwards copies the next new reply', async () => {
        const { list } = mountPage();
        await loadAutoCopy(settings({ master: false, reply: true, code: true }));
        const first = awaitingItem(4, 'first');
        addCodeBlock(first.item, 'first', 0);
        await completeNewReply(list, first);
        expect(activations(), 'master off').toEqual([]);

        broadcast(changes([MASTER_KEY, true, false]));
        await flush();
        const control = awaitingItem(6, 'control');
        addCodeBlock(control.item, 'control', 0);
        await completeNewReply(list, control);
        expect(activations(), 'positive control: master on').toEqual(['control:code#0', 'control:reply']);
    });

    it.each([
        ['reply copy turned off', REPLY_ONLY, [REPLY_KEY, false, true], ['first:reply']],
        ['code copy turned off', CODE_ONLY, [CODE_KEY, false, true], ['first:code#0']],
        ['master switch turned off', BOTH, [MASTER_KEY, false, true], ['first:code#0', 'first:reply']],
    ])('%s after being on: the next new reply is not copied (the observer stops)', async (_name, initial, change, firstCopies) => {
        const { list } = mountPage();
        await loadAutoCopy(initial);
        const first = awaitingItem(4, 'first');
        addCodeBlock(first.item, 'first', 0);
        await completeNewReply(list, first);
        expect(activations(), 'precondition: the first new reply was copied while on').toEqual(firstCopies);

        broadcast(changes(change));
        await flush();
        const later = awaitingItem(6, 'later');
        addCodeBlock(later.item, 'later', 0);
        await completeNewReply(list, later);

        expect(activations(), 'after turning off').toEqual(firstCopies);
    });

    it('turning code copy on while reply copy stays on: the next new reply gets both, the code block first and the reply last', async () => {
        const { list } = mountPage();
        await loadAutoCopy(REPLY_ONLY);
        broadcast(changes([CODE_KEY, true, false]));
        await flush();
        const fresh = awaitingItem(4, 'new');
        addCodeBlock(fresh.item, 'new', 0);

        await completeNewReply(list, fresh);

        expect(activations()).toEqual(['new:code#0', 'new:reply']);
    });
});
