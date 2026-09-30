/**
 * Round-2 mutant-killer tests for the censor-reply-restore module family.
 * Every assertion targets observable behavior: DOM end-state, return values, stored records, or the reply sent over the chrome.runtime trust boundary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore, buildChatPair } from '../helpers/censor-reply-restore-fixtures.js';
import DSSelectors from '../../content/ds-selectors.js';
const KeyToMessageIdMap = require('../../content/censor-reply-restore.keymap.js');

const CRR = CensorReplyRestore;
const SESSION = 'abc123';

function setSession(id) {
    vi.spyOn(window.location, 'pathname', 'get').mockReturnValue(id ? '/a/chat/s/' + id : '/');
}

// Seeds one stored record the way _saveFragment would persist it.
function seed(mid, { session = SESSION, prompt = null, response = 'restored reply', think = null, censored = true } = {}) {
    const fragments = [];
    if (think !== null) fragments.push({ type: 'THINK', content: think });
    if (response !== null) fragments.push({ type: 'RESPONSE', content: response });
    const rec = { message_id: mid, fragments, restored_at: Date.now(), thinking_elapsed_secs: 0, censored, chat_session_id: session, prompt_key: prompt === null ? null : CRR._normalizePrompt(prompt) };
    CRR._restoredMessages[CRR._recordKey(session, mid)] = rec;
    return rec;
}

const restoredOf = (el) => el.querySelector('.restored-content');
const tick = () => new Promise((r) => setTimeout(r, 0));

// Censored assistant message inside a virtual item that has no preceding user prompt.
function buildLoneAssistant(key) {
    const msg = buildChatPair(key, 'unused');
    msg.closest(DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR).previousElementSibling.remove();
    return msg;
}

// Censored assistant message whose container is NOT a virtual list item.
function buildAssistantWithoutVirtualItem() {
    const msg = buildChatPair('tmp', 'unused');
    const item = msg.closest(DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR);
    item.previousElementSibling.remove();
    item.removeAttribute(DSSelectors.VIRTUAL_ITEM_KEY_ATTR);
    return msg;
}

function captureWindowErrors(fn) {
    const errors = [];
    const onError = (e) => { errors.push(e.error || e.message); e.preventDefault(); };
    window.addEventListener('error', onError);
    try { fn(); } finally { window.removeEventListener('error', onError); }
    return errors;
}

beforeEach(() => {
    resetCensorReplyRestore();
    setSession(SESSION);
    CRR._currentSessionId = SESSION;
});
afterEach(() => {
    resetCensorReplyRestore();
    vi.restoreAllMocks();
});

describe('entry: _findKeyForMessageId()', () => {
    it('returns null for a null messageId even when a key is bound to null', () => {
        CRR._keyToMessageId = new Map([['k-null', null]]);
        expect(CRR._findKeyForMessageId(null)).toBeNull();
    });
    it('returns null for an undefined messageId even when a key is bound to undefined', () => {
        CRR._keyToMessageId = new Map([['k-undef', undefined]]);
        expect(CRR._findKeyForMessageId(undefined)).toBeNull();
    });
});

describe('entry: _onFragmentComplete()', () => {
    it('drops the stale pending queue when the chat session changed before the fragment arrived', () => {
        CRR.enabled = true;
        CRR._currentSessionId = 'aaa';
        setSession('bbb');
        CRR._pendingQueue = ['stale'];
        CRR._onFragmentComplete({ messageId: 'new', fragments: [{ type: 'RESPONSE', content: 'x' }], censored: true, chatSessionId: 'bbb', promptText: 'p' });
        expect(CRR._pendingQueue).toEqual(['new']);
        expect(CRR._currentSessionId).toBe('bbb');
    });
    it('restores an already-rendered censored message immediately', () => {
        CRR.enabled = true;
        const msg = buildChatPair('k1', 'hello there');
        CRR._onFragmentComplete({ messageId: 'm1', fragments: [{ type: 'RESPONSE', content: 'original answer' }], censored: true, chatSessionId: SESSION, promptText: 'hello there' });
        expect(restoredOf(msg)).not.toBeNull();
        expect(restoredOf(msg).textContent).toContain('original answer');
    });
});

describe('entry: window message listener', () => {
    const TYPE = () => globalThis.DSS_TEMP_CHAT.DSS_FRAGMENT_COMPLETE_TYPE;
    const payload = (mid) => ({ type: TYPE(), messageId: mid, fragments: [{ type: 'RESPONSE', content: 'x' }], censored: true, chatSessionId: SESSION, promptText: 'p' });
    beforeEach(() => {
        CRR.enabled = true;
        CRR._startFragmentListener();
    });
    it('stores a fragment posted from the page window', () => {
        window.dispatchEvent(new MessageEvent('message', { source: window, data: payload('w1') }));
        expect(CRR._restoredMessages[CRR._recordKey(SESSION, 'w1')]).toBeDefined();
    });
    it('ignores a message whose source is not the page window', () => {
        window.dispatchEvent(new MessageEvent('message', { data: payload('w2') }));
        expect(CRR._restoredMessages[CRR._recordKey(SESSION, 'w2')]).toBeUndefined();
    });
    it('ignores a message of another type', () => {
        window.dispatchEvent(new MessageEvent('message', { source: window, data: { ...payload('w3'), type: 'OTHER' } }));
        expect(CRR._restoredMessages[CRR._recordKey(SESSION, 'w3')]).toBeUndefined();
    });
    it('tolerates a message with null data', () => {
        const errors = captureWindowErrors(() => {
            window.dispatchEvent(new MessageEvent('message', { source: window, data: null }));
        });
        expect(errors).toEqual([]);
        expect(Object.keys(CRR._restoredMessages)).toEqual([]);
    });
});

describe('entry: enable()', () => {
    it('restores censored messages already on the page', () => {
        seed('m1', { prompt: 'hi' });
        const msg = buildChatPair('k1', 'hi');
        CRR.enable();
        expect(restoredOf(msg)).not.toBeNull();
    });
    it('restores censored messages rendered after enabling', async () => {
        seed('m1', { prompt: 'hi' });
        CRR.enable();
        const msg = buildChatPair('k1', 'hi');
        await tick();
        expect(restoredOf(msg)).not.toBeNull();
    });
});

describe('entry: start() popup message handling', () => {
    it('clears restored records and acknowledges the clear request', async () => {
        await CRR.start();
        seed('m1', { prompt: 'hi' });
        const sendResponse = vi.fn();
        chrome.runtime.onMessage.callListeners({ type: DSS_CONTENT_MSG.CLEAR_RESTORED_MESSAGES }, {}, sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
        expect(CRR._restoredMessages).toEqual({});
    });
    it('neither replies nor clears on an unrelated message', async () => {
        await CRR.start();
        seed('m1', { prompt: 'hi' });
        const sendResponse = vi.fn();
        chrome.runtime.onMessage.callListeners({ type: 'somethingElse' }, {}, sendResponse);
        expect(sendResponse).not.toHaveBeenCalled();
        expect(Object.keys(CRR._restoredMessages)).toHaveLength(1);
    });
});

describe('observer: live DOM mutations', () => {
    // Builds a restorable pair, then detaches it so it can be re-inserted while the observer runs.
    function detachedRestorablePair() {
        seed('m1', { prompt: 'hi' });
        const msg = buildChatPair('k1', 'hi');
        const container = msg.closest('.ds-virtual-list-visible-items');
        container.remove();
        return { msg, container };
    }
    it('restores a message inserted deep inside an existing subtree', async () => {
        const wrapper = document.createElement('div');
        document.body.appendChild(wrapper);
        const { msg, container } = detachedRestorablePair();
        CRR.enabled = true;
        CRR._startObserver();
        wrapper.appendChild(container);
        await tick();
        expect(restoredOf(msg)).not.toBeNull();
    });
    it('does nothing while the feature is disabled', async () => {
        const { msg, container } = detachedRestorablePair();
        CRR.enabled = false;
        CRR._startObserver();
        document.body.appendChild(container);
        await tick();
        expect(restoredOf(msg)).toBeNull();
    });
    it('stops reacting after _stopObserver()', async () => {
        const { msg, container } = detachedRestorablePair();
        CRR.enabled = true;
        CRR._startObserver();
        CRR._stopObserver();
        document.body.appendChild(container);
        await tick();
        expect(restoredOf(msg)).toBeNull();
    });
    it('ignores added text nodes', async () => {
        CRR.enabled = true;
        CRR._startObserver();
        const errors = [];
        const onError = (e) => { errors.push(e.error); e.preventDefault(); };
        window.addEventListener('error', onError);
        document.body.appendChild(document.createTextNode('plain text'));
        await tick();
        window.removeEventListener('error', onError);
        expect(errors).toEqual([]);
    });
});

describe('observer: _scanNode()', () => {
    it('does not restore an unrelated sibling message when the added node already contains a message', () => {
        seed('m1', { prompt: 'hi' });
        const msgA = buildChatPair('k1', 'hi');
        CRR._keyToMessageId.set('k1', 'm1');
        const node = document.createElement('div');
        const msgB = document.createElement('div');
        msgB.className = 'ds-message _63c77b1';
        const mainB = document.createElement('div');
        mainB.className = 'ds-markdown ds-assistant-message-main-content';
        msgB.appendChild(mainB);
        node.appendChild(msgB);
        msgA.after(node);
        CRR._scanNode(node);
        expect(restoredOf(msgB)).not.toBeNull();
        expect(restoredOf(msgA)).toBeNull();
    });
    it('tolerates an element that is neither a message nor inside a virtual item', () => {
        const orphan = document.createElement('div');
        document.body.appendChild(orphan);
        expect(() => CRR._scanNode(orphan)).not.toThrow();
    });
});

describe('dom.inject: _tryRestoreMessage()', () => {
    it('picks up a SPA chat switch before resolving the message', () => {
        CRR._currentSessionId = 'aaa';
        setSession('bbb');
        CRR._hasStoredRecordsApplied = true;
        seed('m1', { prompt: 'hi', session: 'bbb' });
        const msg = buildChatPair('k1', 'hi');
        CRR._tryRestoreMessage(msg);
        expect(restoredOf(msg)).not.toBeNull();
    });
    it('does not restore a message whose toolbar is not censored', () => {
        seed('m1', { prompt: 'hi' });
        const msg = buildChatPair('k1', 'hi', { censored: false });
        CRR._tryRestoreMessage(msg);
        expect(restoredOf(msg)).toBeNull();
    });
    it('keeps the stored-record scan retryable when the fallback scan restored nothing', () => {
        const msg = buildLoneAssistant('k1');
        CRR._tryRestoreMessage(msg);
        expect(restoredOf(msg)).toBeNull();
        expect(CRR._hasStoredRecordsApplied).toBe(false);
    });
    it('binds the virtual item key to a messageId taken from the live queue', () => {
        seed('m1', { prompt: null });
        CRR._pendingQueue = ['m1'];
        const msg = buildChatPair('k1', 'hi');
        CRR._tryRestoreMessage(msg);
        expect(restoredOf(msg)).not.toBeNull();
        expect(CRR._findKeyForMessageId('m1')).toBe('k1');
    });
    it('restores a queued message that lives outside any virtual item', () => {
        seed('m1', { prompt: null });
        CRR._pendingQueue = ['m1'];
        const msg = buildAssistantWithoutVirtualItem();
        expect(() => CRR._tryRestoreMessage(msg)).not.toThrow();
        expect(restoredOf(msg)).not.toBeNull();
    });
});

describe('dom.inject: content injection', () => {
    it('builds a think block carrying the think text when the page has none', () => {
        const msg = buildChatPair('k1', 'hi');
        CRR._injectRestoredContent(msg, { fragments: [{ type: 'THINK', content: 'deep thought' }, { type: 'RESPONSE', content: 'answer' }], thinking_elapsed_secs: 3 });
        const think = msg.querySelector(DSSelectors.THINK_BLOCK_SELECTOR);
        expect(think).not.toBeNull();
        expect(think.textContent).toContain('deep thought');
    });
    it('tolerates a detached restored container when building a think block', () => {
        const msg = buildChatPair('k1', 'hi');
        const detached = document.createElement('div');
        expect(() => CRR._injectThinkContent(msg, 'x', { thinking_elapsed_secs: 0 }, detached)).not.toThrow();
    });
    it('clears the old separator body of an existing think container', () => {
        const msg = buildChatPair('k1', 'hi');
        const block = document.createElement('div');
        block.className = DSSelectors.THINK_BLOCK_CLASS;
        const content = document.createElement('div');
        content.className = DSSelectors.THINK_CONTENT_CLASS;
        const sep = document.createElement('div');
        sep.className = DSSelectors.THINK_SEPARATOR_CLASS;
        sep.textContent = 'censored old thinking';
        content.appendChild(sep);
        block.appendChild(content);
        msg.prepend(block);
        const restoredEl = document.createElement('div');
        msg.appendChild(restoredEl);
        CRR._injectThinkContent(msg, 'new thinking', { thinking_elapsed_secs: 0 }, restoredEl);
        expect(sep.innerHTML).toBe('');
        expect(content.textContent).toContain('new thinking');
        expect(content.textContent).not.toContain('censored old thinking');
    });
    it('shows the think-only badge when only THINK was captured', () => {
        const msg = buildChatPair('k1', 'hi');
        CRR._injectRestoredContent(msg, { fragments: [{ type: 'THINK', content: 'partial' }], thinking_elapsed_secs: 0 });
        const badge = msg.querySelector('.restored-content .restored-badge');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe(dsI18n.t('restoredBadgeThinkOnly'));
    });
});

describe('dom.resolve: _getMessageIdFromElement() queue fallback', () => {
    it('consumes the queue for a message without a readable prompt', () => {
        seed('m1', { prompt: 'something else' });
        CRR._pendingQueue = ['m1'];
        const msg = buildLoneAssistant('k1');
        expect(CRR._getMessageIdFromElement(msg)).toBe('m1');
        expect(CRR._pendingQueue).toEqual([]);
    });
    it('consumes the queue when the queued record prompt matches the element prompt', () => {
        seed('m1', { prompt: 'hi', censored: false });
        CRR._pendingQueue = ['m1'];
        const msg = buildChatPair('k1', 'hi');
        expect(CRR._getMessageIdFromElement(msg)).toBe('m1');
    });
});

describe('dom.resolve: _resolveMessageIdFromStorage()', () => {
    it('returns null for a message without a preceding prompt even if a record has no prompt key', () => {
        seed('m1', { prompt: null });
        expect(CRR._resolveMessageIdFromStorage(buildLoneAssistant('k1'))).toBeNull();
    });
    it('ignores records not flagged censored', () => {
        seed('m1', { prompt: 'hi', censored: false });
        expect(CRR._resolveMessageIdFromStorage(buildChatPair('k1', 'hi'))).toBeNull();
    });
    it('ignores records from another chat session', () => {
        seed('m1', { prompt: 'hi', session: 'other' });
        expect(CRR._resolveMessageIdFromStorage(buildChatPair('k1', 'hi'))).toBeNull();
    });
    it('picks the lowest message_id among duplicate-prompt candidates', () => {
        seed('2', { prompt: 'hi' });
        seed('1', { prompt: 'hi' });
        expect(CRR._resolveMessageIdFromStorage(buildChatPair('k1', 'hi'))).toBe('1');
    });
});

describe('dom.scan: _tryRestoreFromStoredRecords()', () => {
    it('does not restore an already-restored message a second time', () => {
        seed('m1', { prompt: 'hi' });
        const msg = buildChatPair('k1', 'hi');
        expect(CRR._tryRestoreFromStoredRecords()).toBe(true);
        expect(CRR._tryRestoreFromStoredRecords()).toBe(false);
        expect(msg.querySelectorAll('.restored-content')).toHaveLength(1);
    });
    it('never matches a message without a preceding user prompt', () => {
        seed('m1', { prompt: 'null' });
        const msg = buildLoneAssistant('k1');
        expect(CRR._tryRestoreFromStoredRecords()).toBe(false);
        expect(restoredOf(msg)).toBeNull();
    });
    it('skips legacy records that have no prompt key', () => {
        seed('m1', { prompt: null });
        const msg = buildChatPair('k1', 'null');
        expect(CRR._tryRestoreFromStoredRecords()).toBe(false);
        expect(restoredOf(msg)).toBeNull();
    });
    it('reports no match and binds nothing when the session has no records', () => {
        buildChatPair('k1', 'undefined');
        expect(CRR._tryRestoreFromStoredRecords()).toBe(false);
        expect(CRR._keyToMessageId.has('k1')).toBe(false);
    });
    it('pairs only as many messages as there are records for a repeated prompt', () => {
        seed('m1', { prompt: 'same' });
        const first = buildChatPair('k1', 'same');
        const second = buildChatPair('k2', 'same');
        expect(CRR._tryRestoreFromStoredRecords()).toBe(true);
        expect(restoredOf(first)).not.toBeNull();
        expect(restoredOf(second)).toBeNull();
        expect(CRR._keyToMessageId.has('k2')).toBe(false);
    });
    it('pairs repeated-prompt messages with records in ascending message_id order', () => {
        seed('2', { prompt: 'same', response: 'second reply' });
        seed('1', { prompt: 'same', response: 'first reply' });
        const first = buildChatPair('k1', 'same');
        const second = buildChatPair('k2', 'same');
        CRR._tryRestoreFromStoredRecords();
        expect(restoredOf(first).textContent).toContain('first reply');
        expect(restoredOf(second).textContent).toContain('second reply');
    });
});

describe('storage bundle', () => {
    it('evicts the oldest record once the cap is exceeded on save', async () => {
        const originalMax = CRR.STORAGE_MAX_ENTRIES;
        CRR.STORAGE_MAX_ENTRIES = 2;
        try {
            CRR._restoredMessages = {
                'abc123::old': { message_id: 'old', restored_at: 1, censored: true },
                'abc123::mid': { message_id: 'mid', restored_at: 2, censored: true },
            };
            await CRR._saveFragment({ message_id: 'new', fragments: [], chat_session_id: SESSION, prompt_key: 'p' });
            expect(Object.keys(CRR._restoredMessages).sort()).toEqual(['abc123::mid', 'abc123::new']);
        } finally {
            CRR.STORAGE_MAX_ENTRIES = originalMax;
        }
    });
    it('falls back to an empty record set when storage read fails', async () => {
        CRR._restoredMessages = { stale: { message_id: 'x', censored: true } };
        vi.spyOn(StorageManager, 'getRestoredMessages').mockRejectedValue(new Error('storage unavailable'));
        await CRR._loadRestoredMessages();
        expect(CRR._restoredMessages).toEqual({});
    });
});

describe('keymap: KeyToMessageIdMap', () => {
    it('keeps earlier keys findable when a second key maps to the same messageId', () => {
        const m = new KeyToMessageIdMap();
        m.set('a', 1);
        m.set('b', 1);
        m.delete('b');
        expect(m.findKey(1)).toBe('a');
    });
    it('returns null for a messageId never mapped', () => {
        expect(new KeyToMessageIdMap().findKey('never')).toBeNull();
    });
});

describe('thinkblock: _buildThinkBlock()', () => {
    function build(elapsed = 0) {
        const block = CRR._buildThinkBlock({ content: 'reasoning' }, elapsed);
        document.body.appendChild(block);
        const header = block.firstElementChild;
        const iconRow = header.querySelector('.' + DSSelectors.THINK_HEADER_ICON_ROW_CLASS);
        const arrow = iconRow.querySelector('.ds-icon:not(.' + DSSelectors.THINK_ICON_CLASS + ')');
        return { block, header, iconRow, arrow, content: block.querySelector(DSSelectors.THINK_CONTENT_SELECTOR) };
    }
    it('header text is exactly the localized label with no elapsed seconds', () => {
        const { header } = build(0);
        expect(header.textContent).toBe(dsI18n.t('thinkBlockHeader', { seconds: '' }));
    });
    it('lays out icon, status label, arrow and divider in their own slots', () => {
        const { header, iconRow, arrow } = build(5);
        const thinkIcon = iconRow.querySelector('.' + DSSelectors.THINK_ICON_CLASS);
        expect(thinkIcon.parentElement).toBe(iconRow);
        expect(thinkIcon.querySelector('svg')).not.toBeNull();
        const status = header.querySelector(DSSelectors.THINK_STATUS_SELECTOR);
        expect(status.parentElement).toBe(iconRow);
        expect(status.textContent).toBe(dsI18n.t('thinkBlockHeader', { seconds: 5 }));
        expect(arrow.parentElement).toBe(iconRow);
        expect(arrow.querySelector('svg path')).not.toBeNull();
        const divider = header.querySelector('.' + DSSelectors.THINK_DIVIDER_CLASS);
        expect(divider.parentElement).toBe(header);
    });
    it('header clicks flip the arrow between two distinct non-empty shapes', () => {
        const { header, arrow } = build();
        const path = arrow.querySelector('svg path');
        header.click();
        const collapsedShape = path.getAttribute('d');
        header.click();
        const expandedShape = path.getAttribute('d');
        expect(collapsedShape).toBeTruthy();
        expect(expandedShape).toBeTruthy();
        expect(collapsedShape).not.toBe(expandedShape);
    });
    it('header click still toggles when the think content element is gone', () => {
        const { block, header, content } = build();
        content.remove();
        const errors = captureWindowErrors(() => header.click());
        expect(errors).toEqual([]);
        expect(block.getAttribute('data-ht-collapsed')).toBe('1');
    });
    it('header click still toggles when the arrow icon is gone', () => {
        const { block, header, arrow } = build();
        arrow.querySelector('svg').remove();
        const errors = captureWindowErrors(() => header.click());
        expect(errors).toEqual([]);
        expect(block.getAttribute('data-ht-collapsed')).toBe('1');
    });
    it('clicking a child other than the header leaves the think content display untouched', () => {
        const { block, content } = build();
        block.querySelector('.' + DSSelectors.THINK_SPACER_CLASS).click();
        expect(content.style.display).toBe('');
    });
});

describe('markdown: _renderMarkdown()', () => {
    const render = (md) => {
        const d = document.createElement('div');
        d.innerHTML = CRR._renderMarkdown(md);
        return d;
    };
    const texts = (d, sel) => [...d.querySelectorAll(sel)].map((e) => e.textContent);
    const topP = (d) => [...d.children].filter((e) => e.tagName === 'P').map((e) => e.textContent);

    it('recognizes an indented heading', () => {
        expect(texts(render('  # Title'), 'h1')).toEqual(['Title']);
    });
    it('trims the code fence language label', () => {
        expect(texts(render('``` python\nprint(1)\n```'), '.md-code-lang')).toEqual(['python']);
    });
    it('renders an unterminated code fence to the end of input', () => {
        expect(texts(render('```\ncode line'), 'pre')).toEqual(['code line']);
    });
    it('closes a fence only on a line starting with the fence, allowing indentation', () => {
        const d = render('```\nabc```\nx\n  ```\nafter');
        expect(texts(d, 'pre')).toEqual(['abc```\nx']);
        expect(texts(d, 'p')).toEqual(['after']);
    });
    it('treats only a line made entirely of dashes as a rule', () => {
        expect(render('---abc').querySelector('hr')).toBeNull();
        expect(render('abc---').querySelector('hr')).toBeNull();
        expect(render('---').querySelector('hr')).not.toBeNull();
    });
    it('groups indented quote lines into one blockquote without the marker', () => {
        const d = render('> a\n  > b\n\nplain');
        expect(texts(d, 'blockquote')).toEqual(['a\nb']);
        expect(topP(d)).toEqual(['plain']);
    });
    it('groups dash and star items, including indented ones, into one list', () => {
        const d = render('- a\n  - b\n* c\n  * d\n-   e\n\nafter');
        expect(d.querySelectorAll('ul')).toHaveLength(1);
        expect(texts(d, 'li')).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(topP(d)).toEqual(['after']);
    });
    it('ends a list at a line that merely contains a dash or star marker', () => {
        const dash = render('- a\nfoo - bar');
        expect(texts(dash, 'li')).toEqual(['a']);
        expect(topP(dash)).toEqual(['foo - bar']);
        const star = render('* a\nfoo * bar');
        expect(texts(star, 'li')).toEqual(['a']);
        expect(topP(star)).toEqual(['foo * bar']);
    });
    it('does not start a list from a mid-line dash', () => {
        const d = render('x - y');
        expect(d.querySelector('ul')).toBeNull();
        expect(texts(d, 'p')).toEqual(['x - y']);
    });
    it('groups indented numbered items into one ordered list', () => {
        const d = render('1. a\n  2. b\nfoo 3. c\n\nVersion 2. released');
        expect(d.querySelectorAll('ol')).toHaveLength(1);
        expect(texts(d, 'li')).toEqual(['a', 'b']);
        expect(topP(d)).toEqual(['foo 3. c', 'Version 2. released']);
    });
    it('requires a table line to both start and end with a pipe', () => {
        expect(render('a | b |').querySelector('table')).toBeNull();
        expect(render('| a | b').querySelector('table')).toBeNull();
    });
    it('keeps indented and trailing-space rows in the same table', () => {
        const html = CRR._renderMarkdown('| h1 | h2 |\n|---|---|\n  | c | d |\n| e | f |  ');
        const d = document.createElement('div');
        d.innerHTML = html;
        expect(d.querySelectorAll('table')).toHaveLength(1);
        expect(texts(d, 'th')).toEqual(['h1', 'h2']);
        expect([...d.querySelectorAll('tbody tr')].map((tr) => texts(tr, 'td'))).toEqual([['c', 'd'], ['e', 'f']]);
        expect(html.match(/<tr>/g)).toHaveLength(3);
        expect(html.match(/<\/tr>/g)).toHaveLength(3);
    });
    it('ignores the indentation of the header row when splitting cells', () => {
        expect(texts(render('  | h1 | h2 |\n|---|---|\n| c | d |'), 'th')).toEqual(['h1', 'h2']);
    });
    it('ends a table at a line that does not start with a pipe', () => {
        const d = render('| h1 | h2 |\n|---|---|\n| c | d |\ntext |');
        expect(d.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(topP(d)).toEqual(['text |']);
    });
    it('ends a table at a line that does not end with a pipe', () => {
        const d = render('| h1 | h2 |\n|---|---|\n| c | d |\n| partial');
        expect(d.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(topP(d)).toEqual(['| partial']);
    });
    it('treats a whitespace-only line as a paragraph break', () => {
        expect(texts(render('a\n   \nb'), 'p')).toEqual(['a', 'b']);
    });
    it('joins trimmed paragraph lines with a single space', () => {
        expect(texts(render('a\n   b'), 'p')).toEqual(['a b']);
    });
});

describe('round-2 follow-ups', () => {
    const TYPE = () => globalThis.DSS_TEMP_CHAT.DSS_FRAGMENT_COMPLETE_TYPE;
    // Posts one fragment and returns how many times it was enqueued (one per live listener).
    function postAndCount(mid) {
        CRR._pendingQueue = [];
        window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: TYPE(), messageId: mid, fragments: [{ type: 'RESPONSE', content: 'x' }], censored: true, chatSessionId: SESSION, promptText: 'p' } }));
        return CRR._pendingQueue.filter((q) => q === mid).length;
    }
    it('_startFragmentListener() adds exactly one listener once, then is idempotent', () => {
        CRR.enabled = true;
        CRR._isFragmentListenerStarted = false;
        const before = postAndCount('f1');
        CRR._startFragmentListener();
        const afterFirst = postAndCount('f2');
        CRR._startFragmentListener();
        const afterSecond = postAndCount('f3');
        expect(afterFirst).toBe(before + 1);
        expect(afterSecond).toBe(afterFirst);
    });
    it('start() leaves the feature enabled', async () => {
        await CRR.start();
        expect(CRR.enabled).toBe(true);
    });
    it('inserts the restored think markdown directly after the separator, not at the end', () => {
        const msg = buildChatPair('k1', 'hi');
        const block = document.createElement('div');
        block.className = DSSelectors.THINK_BLOCK_CLASS;
        const content = document.createElement('div');
        content.className = DSSelectors.THINK_CONTENT_CLASS;
        const sep = document.createElement('div');
        sep.className = DSSelectors.THINK_SEPARATOR_CLASS;
        const trailing = document.createElement('div');
        trailing.className = 'trailing-sibling';
        content.appendChild(sep);
        content.appendChild(trailing);
        block.appendChild(content);
        msg.prepend(block);
        const restoredEl = document.createElement('div');
        msg.appendChild(restoredEl);
        CRR._injectThinkContent(msg, 'new thinking', { thinking_elapsed_secs: 0 }, restoredEl);
        const md = content.querySelector(DSSelectors.MARKDOWN_SELECTOR);
        expect(md.previousElementSibling).toBe(sep);
        expect(md.nextElementSibling).toBe(trailing);
    });
});
