/**
 * Targeted mutant-killer tests for the censor-reply-restore module family.
 * Each group targets survived Stryker mutants by asserting observable behavior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore, buildChatPair } from '../helpers/censor-reply-restore-fixtures.js';
import DSSelectors from '../../content/ds-selectors.js';
const KeyToMessageIdMap = require('../../content/censor-reply-restore.keymap.js');
const markdownBundle = require('../../content/censor-reply-restore.markdown.js');

describe('observer.js mutant killers', () => {
    beforeEach(resetCensorReplyRestore);
    describe('_startObserver()', () => {
        it('creates observer when none exists', () => {
            CensorReplyRestore._observer = null;
            CensorReplyRestore._startObserver();
            expect(CensorReplyRestore._observer).not.toBeNull();
            expect(CensorReplyRestore._observer).toBeInstanceOf(MutationObserver);
            CensorReplyRestore._stopObserver();
        });
        it('idempotent', () => {
            CensorReplyRestore._observer = null;
            CensorReplyRestore._startObserver();
            const first = CensorReplyRestore._observer;
            CensorReplyRestore._startObserver();
            expect(CensorReplyRestore._observer).toBe(first);
            CensorReplyRestore._stopObserver();
        });
    });
    describe('_stopObserver()', () => {
        it('nulls _observer', () => {
            CensorReplyRestore._startObserver();
            CensorReplyRestore._stopObserver();
            expect(CensorReplyRestore._observer).toBeNull();
        });
        it('safe when null', () => {
            CensorReplyRestore._observer = null;
            expect(() => CensorReplyRestore._stopObserver()).not.toThrow();
        });
    });
    describe('_scanNode()', () => {
        afterEach(() => { vi.restoreAllMocks(); });
        it('restores each .ds-message descendant', () => {
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreMessage').mockImplementation(() => {});
            const w = document.createElement('div');
            const m1 = document.createElement('div'); m1.className = 'ds-message';
            const m2 = document.createElement('div'); m2.className = 'ds-message';
            w.appendChild(m1); w.appendChild(m2);
            CensorReplyRestore._scanNode(w);
            expect(spy).toHaveBeenCalledTimes(2);
        });
        it('restores node itself if MESSAGE_CLASS', () => {
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreMessage').mockImplementation(() => {});
            const n = document.createElement('div'); n.className = DSSelectors.MESSAGE_CLASS;
            CensorReplyRestore._scanNode(n);
            expect(spy).toHaveBeenCalledWith(n);
        });
        it('early return for MESSAGE_CLASS (one call)', () => {
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreMessage').mockImplementation(() => {});
            const n = document.createElement('div'); n.className = DSSelectors.MESSAGE_CLASS;
            document.body.appendChild(n);
            CensorReplyRestore._scanNode(n);
            expect(spy).toHaveBeenCalledTimes(1);
        });
        it('virtual-item fallback finds sibling', () => {
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreMessage').mockImplementation(() => {});
            const vi2 = document.createElement('div');
            vi2.setAttribute('data-virtual-list-item-key', 'k');
            const inner = document.createElement('div');
            const sib = document.createElement('div'); sib.className = 'ds-message';
            vi2.appendChild(inner); vi2.appendChild(sib);
            document.body.appendChild(vi2);
            CensorReplyRestore._scanNode(inner);
            expect(spy).toHaveBeenCalledWith(sib);
        });
        it('text node no-op', () => {
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreMessage').mockImplementation(() => {});
            CensorReplyRestore._scanNode(document.createTextNode('x'));
            expect(spy).not.toHaveBeenCalled();
        });
        it('virtual-item no msg child no-op', () => {
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreMessage').mockImplementation(() => {});
            const vi2 = document.createElement('div');
            vi2.setAttribute('data-virtual-list-item-key', 'k');
            vi2.appendChild(document.createElement('div'));
            document.body.appendChild(vi2);
            CensorReplyRestore._scanNode(vi2.firstChild);
            expect(spy).not.toHaveBeenCalled();
        });
    });
    describe('applyToExisting()', () => {
        afterEach(() => { vi.restoreAllMocks(); });
        it('calls _tryRestoreMessage for each assistant msg', () => {
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreMessage').mockImplementation(() => {});
            vi.spyOn(CensorReplyRestore, '_tryRestoreFromStoredRecords').mockReturnValue(false);
            document.body.appendChild(Object.assign(document.createElement('div'), { className: 'ds-message _63c77b1' }));
            document.body.appendChild(Object.assign(document.createElement('div'), { className: 'ds-message _63c77b1' }));
            CensorReplyRestore.applyToExisting();
            expect(spy).toHaveBeenCalledTimes(2);
        });
        it('calls _tryRestoreFromStoredRecords', () => {
            vi.spyOn(CensorReplyRestore, '_tryRestoreMessage').mockImplementation(() => {});
            const s = vi.spyOn(CensorReplyRestore, '_tryRestoreFromStoredRecords').mockReturnValue(false);
            CensorReplyRestore.applyToExisting();
            expect(s).toHaveBeenCalled();
        });
    });
});

describe('entry mutant killers', () => {
    beforeEach(resetCensorReplyRestore);
    describe('enable()', () => {
        afterEach(() => { vi.restoreAllMocks(); });
        it('sets enabled true', () => {
            CensorReplyRestore.enabled = false;
            vi.spyOn(CensorReplyRestore, '_startFragmentListener').mockImplementation(() => {});
            vi.spyOn(CensorReplyRestore, 'applyToExisting').mockImplementation(() => {});
            vi.spyOn(CensorReplyRestore, '_startObserver').mockImplementation(() => {});
            CensorReplyRestore.enable();
            expect(CensorReplyRestore.enabled).toBe(true);
        });
        it('idempotent', () => {
            const f = vi.spyOn(CensorReplyRestore, '_startFragmentListener').mockImplementation(() => {});
            vi.spyOn(CensorReplyRestore, 'applyToExisting').mockImplementation(() => {});
            vi.spyOn(CensorReplyRestore, '_startObserver').mockImplementation(() => {});
            CensorReplyRestore.enabled = false;
            CensorReplyRestore.enable(); CensorReplyRestore.enable();
            expect(f).toHaveBeenCalledTimes(1);
        });
    });
    describe('disable()', () => {
        afterEach(() => { vi.restoreAllMocks(); });
        it('sets enabled false, stops observer', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._observer = { disconnect: vi.fn() };
            CensorReplyRestore.disable();
            expect(CensorReplyRestore.enabled).toBe(false);
            expect(CensorReplyRestore._observer).toBeNull();
        });
        it('idempotent', () => {
            CensorReplyRestore.enabled = false;
            const s = vi.spyOn(CensorReplyRestore, '_stopObserver');
            CensorReplyRestore.disable();
            expect(s).not.toHaveBeenCalled();
        });
    });
    describe('_findKeyForMessageId()', () => {
        it('null->null', () => expect(CensorReplyRestore._findKeyForMessageId(null)).toBeNull());
        it('undefined->null', () => expect(CensorReplyRestore._findKeyForMessageId(undefined)).toBeNull());
        it('delegates', () => { CensorReplyRestore._keyToMessageId.set('k', 42); expect(CensorReplyRestore._findKeyForMessageId(42)).toBe('k'); });
        it('unmapped->null', () => expect(CensorReplyRestore._findKeyForMessageId(999)).toBeNull());
    });
    describe('_keyToMessageId setter', () => {
        it('wraps plain Map to support findKey', () => {
            CensorReplyRestore._keyToMessageId = new Map([['a', 1]]);
            expect(typeof CensorReplyRestore._keyToMessageId.findKey).toBe('function');
            expect(CensorReplyRestore._keyToMessageId.get('a')).toBe(1);
            expect(CensorReplyRestore._keyToMessageId.findKey(1)).toBe('a');
        });
        it('preserves data after reassignment', () => {
            CensorReplyRestore._keyToMessageId.set('b', 2);
            const prev = CensorReplyRestore._keyToMessageId;
            CensorReplyRestore._keyToMessageId = prev;
            expect(CensorReplyRestore._keyToMessageId.get('b')).toBe(2);
            expect(CensorReplyRestore._keyToMessageId.findKey(2)).toBe('b');
        });
    });
    describe('_onFragmentComplete() guards', () => {
        it('disabled no-op', () => {
            CensorReplyRestore.enabled = false; CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._onFragmentComplete({ messageId: 1, fragments: [{ type: 'RESPONSE', content: 'x' }], censored: true });
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });
        it('no messageId no-op', () => {
            CensorReplyRestore.enabled = true; CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._onFragmentComplete({ fragments: [{ type: 'RESPONSE', content: 'x' }], censored: true });
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });
        it('no fragments no-op', () => {
            CensorReplyRestore.enabled = true; CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._onFragmentComplete({ messageId: 1, censored: true });
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });
        it('stores thinkingElapsedSecs', () => {
            CensorReplyRestore.enabled = true; CensorReplyRestore._pendingQueue = []; CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._onFragmentComplete({ messageId: 50, fragments: [{ type: 'RESPONSE', content: 'y' }], censored: true, thinkingElapsedSecs: 5.5 });
            expect(CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey(null, 50)].thinking_elapsed_secs).toBe(5.5);
        });
        it('defaults thinkingElapsedSecs to 0', () => {
            CensorReplyRestore.enabled = true; CensorReplyRestore._pendingQueue = []; CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._onFragmentComplete({ messageId: 51, fragments: [{ type: 'RESPONSE', content: 'z' }], censored: true });
            expect(CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey(null, 51)].thinking_elapsed_secs).toBe(0);
        });
    });
    describe('_recordKey()', () => {
        it('numeric coercion', () => expect(CensorReplyRestore._recordKey('s', 123)).toBe('s::123'));
        it('0->nosession', () => expect(CensorReplyRestore._recordKey(0, 1)).toBe('nosession::1'));
        it('false->nosession', () => expect(CensorReplyRestore._recordKey(false, 1)).toBe('nosession::1'));
    });
});

describe('_extractRenderableFragments mutant killers', () => {
    beforeEach(resetCensorReplyRestore);

    it('empty array', () => {
        const r = CensorReplyRestore._extractRenderableFragments([]);
        expect(r.hasThink).toBe(false);
        expect(r.hasResponse).toBe(false);
        expect(r.thinkContent).toBe('');
        expect(r.responseContent).toBe('');
    });

    it('null/undefined skipped', () => {
        const r = CensorReplyRestore._extractRenderableFragments([null, undefined, { type: 'RESPONSE', content: 'ok' }]);
        expect(r.hasResponse).toBe(true);
        expect(r.responseContent).toBe('ok');
    });

    it('fragment without type skipped', () => {
        const r = CensorReplyRestore._extractRenderableFragments([{ content: 'x' }]);
        expect(r.hasThink).toBe(false); expect(r.hasResponse).toBe(false);
    });

    it('THINK empty skipped', () => expect(CensorReplyRestore._extractRenderableFragments([{ type: 'THINK', content: '' }]).hasThink).toBe(false));
    it('THINK non-string skipped', () => expect(CensorReplyRestore._extractRenderableFragments([{ type: 'THINK', content: 42 }]).hasThink).toBe(false));

    it('multiple THINKs joined', () => {
        const r = CensorReplyRestore._extractRenderableFragments([{ type: 'THINK', content: 'A' }, { type: 'THINK', content: 'B' }]);
        expect(r.thinkContent).toContain("A");
        expect(r.thinkContent).toContain("B");
        expect(r.thinkContent.indexOf("A")).toBeLessThan(r.thinkContent.indexOf("B"));
    });

    it('RESPONSE empty sets hasResponse', () => expect(CensorReplyRestore._extractRenderableFragments([{ type: 'RESPONSE', content: '' }]).hasResponse).toBe(true));
    it('RESPONSE non-string skipped', () => expect(CensorReplyRestore._extractRenderableFragments([{ type: 'RESPONSE', content: 123 }]).hasResponse).toBe(false));
    it('RESPONSEs concatenate', () => expect(CensorReplyRestore._extractRenderableFragments([{ type: 'RESPONSE', content: 'A ' }, { type: 'RESPONSE', content: 'B' }]).responseContent).toBe('A B'));
    it('unknown type ignored', () => { const r = CensorReplyRestore._extractRenderableFragments([{ type: 'X', content: 'x' }]); expect(r.hasThink).toBe(false); expect(r.hasResponse).toBe(false); });
});

// ============================================================================
// dom.inject.js mutant killers
// ============================================================================

describe('dom.inject.js mutant killers', () => {
    beforeEach(resetCensorReplyRestore);
    afterEach(() => { vi.restoreAllMocks(); });

    describe('_createRestoredContainer()', () => {
        it('returns div with correct class names', () => {
            const el = CensorReplyRestore._createRestoredContainer('<p>test</p>');
            expect(el.tagName).toBe('DIV');
            expect(el.classList.contains('ds-markdown')).toBe(true);
            expect(el.classList.contains('ds-assistant-message-main-content')).toBe(true);
            expect(el.classList.contains('restored-content')).toBe(true);
        });
        it('sets zoom style', () => {
            const el = CensorReplyRestore._createRestoredContainer('');
            expect(el.getAttribute('style')).toContain('--ds-md-zoom: 1.143');
        });
        it('sets innerHTML', () => {
            const el = CensorReplyRestore._createRestoredContainer('<p>hi</p>');
            expect(el.innerHTML).toBe('<p>hi</p>');
        });
    });

    describe('_injectThinkContent()', () => {
        it('builds think block when no container and inserts before restoredEl', () => {
            const parent = document.createElement('div');
            const restoredEl = document.createElement('div');
            restoredEl.className = 'restored-content';
            parent.appendChild(restoredEl);
            const msgEl = document.createElement('div');
            CensorReplyRestore._injectThinkContent(msgEl, 'think text', { thinking_elapsed_secs: 3 }, restoredEl);
            expect(parent.firstChild).not.toBe(restoredEl);
            expect(parent.children.length).toBe(2);
            expect(parent.lastChild).toBe(restoredEl);
        });
        it('uses existing think container and adds restored-content class', () => {
            const msgEl = document.createElement('div');
            const tc = document.createElement('div');
            tc.className = DSSelectors.THINK_BLOCK_CLASS;
            const tce = document.createElement('div');
            tce.className = DSSelectors.THINK_CONTENT_CLASS;
            const md = document.createElement('div');
            md.className = DSSelectors.MARKDOWN_CLASS;
            tce.appendChild(md); tc.appendChild(tce); msgEl.appendChild(tc);
            const restoredEl = document.createElement('div');
            CensorReplyRestore._injectThinkContent(msgEl, '**bold**', {}, restoredEl);
            expect(tc.classList.contains('restored-content')).toBe(true);
            expect(md.innerHTML).not.toBe('');
            expect(md.getAttribute('style')).toContain('--ds-md-zoom: 1.143');
        });
        it('clears existing separator content', () => {
            const msgEl = document.createElement('div');
            const tc = document.createElement('div');
            tc.className = DSSelectors.THINK_BLOCK_CLASS;
            const tce = document.createElement('div');
            tce.className = DSSelectors.THINK_CONTENT_CLASS;
            const sep = document.createElement('div');
            sep.className = DSSelectors.THINK_SEPARATOR_CLASS;
            sep.textContent = 'old content';
            tce.appendChild(sep); tc.appendChild(tce); msgEl.appendChild(tc);
            const restoredEl = document.createElement('div');
            CensorReplyRestore._injectThinkContent(msgEl, 'text', {}, restoredEl);
            expect(sep.innerHTML).toBe('');
        });
        it('creates markdown element after separator when none exists', () => {
            const msgEl = document.createElement('div');
            const tc = document.createElement('div');
            tc.className = DSSelectors.THINK_BLOCK_CLASS;
            const tce = document.createElement('div');
            tce.className = DSSelectors.THINK_CONTENT_CLASS;
            const sep = document.createElement('div');
            sep.className = DSSelectors.THINK_SEPARATOR_CLASS;
            tce.appendChild(sep); tc.appendChild(tce); msgEl.appendChild(tc);
            const restoredEl = document.createElement('div');
            CensorReplyRestore._injectThinkContent(msgEl, 'text', {}, restoredEl);
            const mdEl = tce.querySelector('.' + DSSelectors.MARKDOWN_CLASS);
            expect(mdEl).not.toBeNull();
            expect(sep.nextElementSibling).toBe(mdEl);
        });
        it('appends markdown to thinkContentEl when no separator', () => {
            const msgEl = document.createElement('div');
            const tc = document.createElement('div');
            tc.className = DSSelectors.THINK_BLOCK_CLASS;
            const tce = document.createElement('div');
            tce.className = DSSelectors.THINK_CONTENT_CLASS;
            tc.appendChild(tce); msgEl.appendChild(tc);
            const restoredEl = document.createElement('div');
            CensorReplyRestore._injectThinkContent(msgEl, 'text', {}, restoredEl);
            const mdEl = tce.querySelector('.' + DSSelectors.MARKDOWN_CLASS);
            expect(mdEl).not.toBeNull();
            expect(tce.lastChild).toBe(mdEl);
        });
        it('returns early if thinkContentEl is missing', () => {
            const msgEl = document.createElement('div');
            const tc = document.createElement('div');
            tc.className = DSSelectors.THINK_BLOCK_CLASS;
            msgEl.appendChild(tc);
            const restoredEl = document.createElement('div');
            expect(() => CensorReplyRestore._injectThinkContent(msgEl, 'text', {}, restoredEl)).not.toThrow();
        });
    });


    describe('_injectRestoredContent()', () => {
        function buildMsgWithMainContent() {
            const msgEl = document.createElement('div');
            const parent = document.createElement('div');
            const mainContent = document.createElement('div');
            mainContent.className = 'ds-markdown ds-assistant-message-main-content';
            parent.appendChild(mainContent);
            msgEl.appendChild(parent);
            return { msgEl, mainContent, parent };
        }
        it('empty fragments returns early', () => {
            const { msgEl, mainContent } = buildMsgWithMainContent();
            CensorReplyRestore._injectRestoredContent(msgEl, { fragments: [] });
            expect(mainContent.classList.contains('dss-censored-hidden')).toBe(false);
        });
        it('no fragments key returns early', () => {
            const { msgEl, mainContent } = buildMsgWithMainContent();
            CensorReplyRestore._injectRestoredContent(msgEl, {});
            expect(mainContent.classList.contains('dss-censored-hidden')).toBe(false);
        });
        it('neither think nor response returns early', () => {
            const { msgEl, mainContent } = buildMsgWithMainContent();
            CensorReplyRestore._injectRestoredContent(msgEl, { fragments: [{ type: 'UNKNOWN', content: 'x' }] });
            expect(mainContent.classList.contains('dss-censored-hidden')).toBe(false);
        });
        it('hides original and injects restored element', () => {
            const { msgEl, mainContent, parent } = buildMsgWithMainContent();
            CensorReplyRestore._injectRestoredContent(msgEl, { fragments: [{ type: 'RESPONSE', content: 'restored' }] });
            expect(mainContent.classList.contains('dss-censored-hidden')).toBe(true);
            const restored = parent.querySelector('.restored-content');
            expect(restored).not.toBeNull();
            expect(restored.innerHTML).toContain('restored-badge');
        });
        it('does not duplicate dss-censored-hidden class', () => {
            const { msgEl, mainContent } = buildMsgWithMainContent();
            mainContent.classList.add('dss-censored-hidden');
            CensorReplyRestore._injectRestoredContent(msgEl, { fragments: [{ type: 'RESPONSE', content: 'x' }] });
            expect(mainContent.className.match(/dss-censored-hidden/g).length).toBe(1);
        });

        it('think-only shows think-only badge', () => {
            const { msgEl, parent } = buildMsgWithMainContent();
            CensorReplyRestore._injectRestoredContent(msgEl, { fragments: [{ type: 'THINK', content: 'thinking...' }], thinking_elapsed_secs: 2 });
            const restored = parent.querySelector('.restored-content');
            expect(restored).not.toBeNull();
            expect(restored.innerHTML).toContain(dsI18n.t('restoredBadgeThinkOnly'));
        });
        it('response shows normal badge', () => {
            const { msgEl, parent } = buildMsgWithMainContent();
            CensorReplyRestore._injectRestoredContent(msgEl, { fragments: [{ type: 'RESPONSE', content: 'hello' }] });
            const restored = parent.querySelector('.restored-content');
            expect(restored.innerHTML).toContain(dsI18n.t('restoredBadge'));
        });
        it('returns early when no mainContent', () => {
            const msgEl = document.createElement('div');
            expect(() => CensorReplyRestore._injectRestoredContent(msgEl, { fragments: [{ type: 'RESPONSE', content: 'x' }] })).not.toThrow();
        });
        it('inserts restoredEl right after mainContent', () => {
            const { msgEl, mainContent } = buildMsgWithMainContent();
            CensorReplyRestore._injectRestoredContent(msgEl, { fragments: [{ type: 'RESPONSE', content: 'test' }] });
            expect(mainContent.nextElementSibling.classList.contains('restored-content')).toBe(true);
        });
    });

    describe('_tryRestoreMessage()', () => {
        afterEach(() => { vi.restoreAllMocks(); });
        it('skips if already restored', () => {
            CensorReplyRestore._currentSessionId = 'sess1';
            vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
            const msgEl = buildChatPair('key1', 'prompt');
            CensorReplyRestore._keyToMessageId.set('key1', 42);
            CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('sess1', 42)] = {
                message_id: 42, fragments: [{ type: 'RESPONSE', content: 'r' }], censored: true, thinking_elapsed_secs: 0
            };
            const restored = document.createElement('div');
            restored.className = 'restored-content';
            msgEl.appendChild(restored);
            const spy = vi.spyOn(CensorReplyRestore, '_injectRestoredContent');
            CensorReplyRestore._tryRestoreMessage(msgEl);
            expect(spy).not.toHaveBeenCalled();
        });
        it('skips if no toolbar group', () => {
            const msgEl = document.createElement('div');
            document.body.appendChild(msgEl);
            const spy = vi.spyOn(CensorReplyRestore, '_isCensored');
            CensorReplyRestore._tryRestoreMessage(msgEl);
            expect(spy).not.toHaveBeenCalled();
        });
        it('skips if not censored', () => {
            vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
            const msgEl = buildChatPair('key1', 'prompt', { censored: false });
            CensorReplyRestore._currentSessionId = 'sess1';
            const spy = vi.spyOn(CensorReplyRestore, '_injectRestoredContent');
            CensorReplyRestore._tryRestoreMessage(msgEl);
            expect(spy).not.toHaveBeenCalled();
        });
        it('triggers _tryRestoreFromStoredRecords when no messageId', () => {
            vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
            const msgEl = buildChatPair('key1', 'prompt');
            CensorReplyRestore._currentSessionId = 'sess1';
            CensorReplyRestore._hasStoredRecordsApplied = false;
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreFromStoredRecords').mockReturnValue(true);
            CensorReplyRestore._tryRestoreMessage(msgEl);
            expect(spy).toHaveBeenCalled();
            expect(CensorReplyRestore._hasStoredRecordsApplied).toBe(true);
        });
        it('does not call _tryRestoreFromStoredRecords when already applied', () => {
            vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
            const msgEl = buildChatPair('key1', 'prompt');
            CensorReplyRestore._currentSessionId = 'sess1';
            CensorReplyRestore._hasStoredRecordsApplied = true;
            const spy = vi.spyOn(CensorReplyRestore, '_tryRestoreFromStoredRecords');
            CensorReplyRestore._tryRestoreMessage(msgEl);
            expect(spy).not.toHaveBeenCalled();
        });
        it('injects content when record exists for messageId', () => {
            vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
            CensorReplyRestore._currentSessionId = 'sess1';
            const msgEl = buildChatPair('key1', 'prompt');
            CensorReplyRestore._keyToMessageId.set('key1', 42);
            CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('sess1', 42)] = {
                message_id: 42, fragments: [{ type: 'RESPONSE', content: 'restored' }], censored: true, thinking_elapsed_secs: 0
            };
            CensorReplyRestore._tryRestoreMessage(msgEl);
            expect(msgEl.querySelector('.restored-content')).not.toBeNull();
        });
    });
});


// ============================================================================
// storage.js mutant killers
// ============================================================================

describe('storage.js mutant killers', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_saveFragment()', () => {
        it('stores record with session-scoped key', async () => {
            CensorReplyRestore._restoredMessages = {};
            await CensorReplyRestore._saveFragment({
                message_id: 10, fragments: [{ type: 'RESPONSE', content: 'x' }],
                thinking_elapsed_secs: 1.5, chat_session_id: 'sess1', prompt_key: 'hello'
            });
            const key = CensorReplyRestore._recordKey('sess1', 10);
            expect(CensorReplyRestore._restoredMessages[key]).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[key].message_id).toBe(10);
            expect(CensorReplyRestore._restoredMessages[key].thinking_elapsed_secs).toBe(1.5);
            expect(CensorReplyRestore._restoredMessages[key].censored).toBe(true);
            expect(CensorReplyRestore._restoredMessages[key].chat_session_id).toBe('sess1');
            expect(CensorReplyRestore._restoredMessages[key].prompt_key).toBe('hello');
        });
        it('defaults thinking_elapsed_secs to 0', async () => {
            await CensorReplyRestore._saveFragment({ message_id: 11, fragments: [], chat_session_id: null });
            const key = CensorReplyRestore._recordKey(null, 11);
            expect(CensorReplyRestore._restoredMessages[key].thinking_elapsed_secs).toBe(0);
        });
        it('defaults chat_session_id to null', async () => {
            await CensorReplyRestore._saveFragment({ message_id: 12, fragments: [] });
            const key = CensorReplyRestore._recordKey(null, 12);
            expect(CensorReplyRestore._restoredMessages[key].chat_session_id).toBeNull();
        });
        it('defaults prompt_key to null', async () => {
            await CensorReplyRestore._saveFragment({ message_id: 13, fragments: [] });
            const key = CensorReplyRestore._recordKey(null, 13);
            expect(CensorReplyRestore._restoredMessages[key].prompt_key).toBeNull();
        });
        it('stores restored_at as a timestamp', async () => {
            const before = Date.now();
            await CensorReplyRestore._saveFragment({ message_id: 15, fragments: [] });
            const key = CensorReplyRestore._recordKey(null, 15);
            expect(CensorReplyRestore._restoredMessages[key].restored_at).toBeGreaterThanOrEqual(before);
            expect(CensorReplyRestore._restoredMessages[key].restored_at).toBeLessThanOrEqual(Date.now());
        });
    });

    describe('_evictOldest()', () => {
        it('no-op when entries <= STORAGE_MAX_ENTRIES', () => {
            CensorReplyRestore._restoredMessages = { a: { restored_at: 1 } };
            CensorReplyRestore._evictOldest();
            expect(CensorReplyRestore._restoredMessages.a).toBeDefined();
        });
        it('evicts oldest entries beyond limit', () => {
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 2;
            CensorReplyRestore._restoredMessages = { old: { restored_at: 100 }, mid: { restored_at: 200 }, new1: { restored_at: 300 } };
            CensorReplyRestore._evictOldest();
            expect(CensorReplyRestore._restoredMessages.old).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages.mid).toBeDefined();
            expect(CensorReplyRestore._restoredMessages.new1).toBeDefined();
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 200;
        });
        it('evicts multiple when far over limit', () => {
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 1;
            CensorReplyRestore._restoredMessages = { a: { restored_at: 10 }, b: { restored_at: 20 }, c: { restored_at: 30 } };
            CensorReplyRestore._evictOldest();
            expect(Object.keys(CensorReplyRestore._restoredMessages).length).toBe(1);
            expect(CensorReplyRestore._restoredMessages.c).toBeDefined();
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 200;
        });
        it('sorts by restored_at ascending to evict oldest first', () => {
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 2;
            CensorReplyRestore._restoredMessages = { newest: { restored_at: 999 }, oldest: { restored_at: 1 }, middle: { restored_at: 500 } };
            CensorReplyRestore._evictOldest();
            expect(CensorReplyRestore._restoredMessages.oldest).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages.middle).toBeDefined();
            expect(CensorReplyRestore._restoredMessages.newest).toBeDefined();
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 200;
        });
    });


    describe('_loadRestoredMessages()', () => {
        afterEach(() => { vi.restoreAllMocks(); });
        it('filters out records without censored === true', async () => {
            vi.spyOn(StorageManager, 'getRestoredMessages').mockResolvedValue({
                'sess::1': { censored: true, message_id: 1, chat_session_id: 'sess' },
                'sess::2': { censored: false, message_id: 2, chat_session_id: 'sess' },
                'sess::3': { message_id: 3, chat_session_id: 'sess' }
            });
            vi.spyOn(StorageManager, 'saveRestoredMessages').mockResolvedValue();
            await CensorReplyRestore._loadRestoredMessages();
            expect(CensorReplyRestore._restoredMessages['sess::1']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['sess::2']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['sess::3']).toBeUndefined();
        });
        it('migrates old-format keys (no ::) to new format', async () => {
            vi.spyOn(StorageManager, 'getRestoredMessages').mockResolvedValue({
                '42': { censored: true, message_id: 42, chat_session_id: 'sess1' }
            });
            vi.spyOn(StorageManager, 'saveRestoredMessages').mockResolvedValue();
            await CensorReplyRestore._loadRestoredMessages();
            const newKey = CensorReplyRestore._recordKey('sess1', 42);
            expect(CensorReplyRestore._restoredMessages[newKey]).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['42']).toBeUndefined();
        });
        it('writes back when migration occurs', async () => {
            vi.spyOn(StorageManager, 'getRestoredMessages').mockResolvedValue({
                '7': { censored: true, message_id: 7, chat_session_id: 's' }
            });
            const saveSpy = vi.spyOn(StorageManager, 'saveRestoredMessages').mockResolvedValue();
            await CensorReplyRestore._loadRestoredMessages();
            expect(saveSpy).toHaveBeenCalled();
        });
        it('writes back when count changes (filtering)', async () => {
            vi.spyOn(StorageManager, 'getRestoredMessages').mockResolvedValue({
                'sess::1': { censored: true, message_id: 1, chat_session_id: 'sess' },
                'sess::2': { censored: false, message_id: 2, chat_session_id: 'sess' }
            });
            const saveSpy = vi.spyOn(StorageManager, 'saveRestoredMessages').mockResolvedValue();
            await CensorReplyRestore._loadRestoredMessages();
            expect(saveSpy).toHaveBeenCalled();
        });
        it('does not write back when nothing changed', async () => {
            vi.spyOn(StorageManager, 'getRestoredMessages').mockResolvedValue({
                'sess::1': { censored: true, message_id: 1, chat_session_id: 'sess' }
            });
            const saveSpy = vi.spyOn(StorageManager, 'saveRestoredMessages').mockResolvedValue();
            await CensorReplyRestore._loadRestoredMessages();
            expect(saveSpy).not.toHaveBeenCalled();
        });
        it('catches errors and sets empty messages', async () => {
            vi.spyOn(StorageManager, 'getRestoredMessages').mockRejectedValue(new Error('fail'));
            await CensorReplyRestore._loadRestoredMessages();
            expect(CensorReplyRestore._restoredMessages).toEqual({});
        });
    });
});


// ============================================================================
// keymap.js (KeyToMessageIdMap) mutant killers
// ============================================================================

describe('keymap.js (KeyToMessageIdMap) mutant killers', () => {
    let map;
    beforeEach(() => { map = new KeyToMessageIdMap(); });

    describe('set()', () => {
        it('stores value retrievable via get', () => {
            map.set('k1', 'mid1');
            expect(map.get('k1')).toBe('mid1');
        });
        it('maintains reverse index for findKey', () => {
            map.set('k1', 100);
            expect(map.findKey(100)).toBe('k1');
        });
        it('overwrites release old messageId from reverse index', () => {
            map.set('k1', 100);
            map.set('k1', 200);
            expect(map.findKey(100)).toBeNull();
            expect(map.findKey(200)).toBe('k1');
        });
        it('multiple keys same messageId all findable', () => {
            map.set('k1', 100);
            map.set('k2', 100);
            const found = map.findKey(100);
            expect(found === 'k1' || found === 'k2').toBe(true);
        });
        it('returns the map (chainable)', () => {
            const result = map.set('k', 1);
            expect(result).toBe(map);
        });
    });

    describe('delete()', () => {
        it('removes key from map', () => {
            map.set('k1', 100);
            map.delete('k1');
            expect(map.has('k1')).toBe(false);
        });
        it('removes from reverse index', () => {
            map.set('k1', 100);
            map.delete('k1');
            expect(map.findKey(100)).toBeNull();
        });
        it('returns true for existing key', () => {
            map.set('k1', 100);
            expect(map.delete('k1')).toBe(true);
        });
        it('returns false for non-existing key', () => {
            expect(map.delete('nonexistent')).toBe(false);
        });
        it('does not affect other keys with same messageId', () => {
            map.set('k1', 100);
            map.set('k2', 100);
            map.delete('k1');
            expect(map.findKey(100)).toBe('k2');
        });
    });

    describe('clear()', () => {
        it('empties both map and reverse index', () => {
            map.set('k1', 100);
            map.set('k2', 200);
            map.clear();
            expect(map.size).toBe(0);
            expect(map.findKey(100)).toBeNull();
            expect(map.findKey(200)).toBeNull();
        });
    });

    describe('findKey()', () => {
        it('null for empty map', () => {
            expect(map.findKey(100)).toBeNull();
        });
        it('coerces messageId to string for lookup', () => {
            map.set('k1', 42);
            expect(map.findKey('42')).toBe('k1');
            expect(map.findKey(42)).toBe('k1');
        });
        it('null for unregistered messageId', () => {
            map.set('k1', 100);
            expect(map.findKey(999)).toBeNull();
        });
    });

    describe('constructor with entries', () => {
        it('populates from iterable', () => {
            const m = new KeyToMessageIdMap([['a', 1], ['b', 2]]);
            expect(m.get('a')).toBe(1);
            expect(m.findKey(1)).toBe('a');
            expect(m.findKey(2)).toBe('b');
        });
        it('null entries safe', () => {
            const m = new KeyToMessageIdMap(null);
            expect(m.size).toBe(0);
        });
    });

    describe('_releaseMessageId()', () => {
        it('cleans up Set entry when last key deleted', () => {
            map.set('k1', 100);
            map.delete('k1');
            expect(map._keysByMessageId.has('100')).toBe(false);
        });
        it('does not remove Set when other keys remain', () => {
            map.set('k1', 100);
            map.set('k2', 100);
            map.delete('k1');
            expect(map._keysByMessageId.has('100')).toBe(true);
            expect(map._keysByMessageId.get('100').size).toBe(1);
        });
    });
});


// ============================================================================
// dom.scan.js mutant killers
// ============================================================================

describe('dom.scan.js mutant killers', () => {
    beforeEach(resetCensorReplyRestore);
    afterEach(() => { vi.restoreAllMocks(); });

    it('returns false when currentSessionId is falsy', () => {
        CensorReplyRestore._currentSessionId = null;
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        expect(CensorReplyRestore._tryRestoreFromStoredRecords()).toBe(false);
    });

    it('returns false when no unrestored censored messages', () => {
        CensorReplyRestore._currentSessionId = 'sess1';
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        expect(CensorReplyRestore._tryRestoreFromStoredRecords()).toBe(false);
    });

    it('returns false when no matching session records', () => {
        CensorReplyRestore._currentSessionId = 'sess1';
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        buildChatPair('asst-key-1', 'hello');
        CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('other', 1)] = {
            message_id: 1, censored: true, chat_session_id: 'other', prompt_key: 'hello',
            fragments: [{ type: 'RESPONSE', content: 'x' }]
        };
        expect(CensorReplyRestore._tryRestoreFromStoredRecords()).toBe(false);
    });

    it('returns false when record has no prompt_key', () => {
        CensorReplyRestore._currentSessionId = 'sess1';
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        buildChatPair('asst-key-1', 'hello');
        CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('sess1', 1)] = {
            message_id: 1, censored: true, chat_session_id: 'sess1', prompt_key: null,
            fragments: [{ type: 'RESPONSE', content: 'x' }]
        };
        expect(CensorReplyRestore._tryRestoreFromStoredRecords()).toBe(false);
    });

    it('returns false when record censored !== true', () => {
        CensorReplyRestore._currentSessionId = 'sess1';
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        buildChatPair('asst-key-1', 'hello');
        CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('sess1', 1)] = {
            message_id: 1, censored: false, chat_session_id: 'sess1', prompt_key: 'hello',
            fragments: [{ type: 'RESPONSE', content: 'x' }]
        };
        expect(CensorReplyRestore._tryRestoreFromStoredRecords()).toBe(false);
    });

    it('returns false when record chat_session_id is falsy', () => {
        CensorReplyRestore._currentSessionId = 'sess1';
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        buildChatPair('asst-key-1', 'hello');
        CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('sess1', 1)] = {
            message_id: 1, censored: true, chat_session_id: null, prompt_key: 'hello',
            fragments: [{ type: 'RESPONSE', content: 'x' }]
        };
        expect(CensorReplyRestore._tryRestoreFromStoredRecords()).toBe(false);
    });

    it('returns true and injects when prompt keys match', () => {
        CensorReplyRestore._currentSessionId = 'sess1';
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        buildChatPair('asst-key-1', 'hello');
        CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('sess1', 1)] = {
            message_id: 1, censored: true, chat_session_id: 'sess1', prompt_key: 'hello',
            fragments: [{ type: 'RESPONSE', content: 'restored!' }], thinking_elapsed_secs: 0
        };
        expect(CensorReplyRestore._tryRestoreFromStoredRecords()).toBe(true);
        expect(document.querySelector('.restored-content')).not.toBeNull();
    });

    it('prompt_key mismatch does not inject', () => {
        CensorReplyRestore._currentSessionId = 'sess1';
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        buildChatPair('asst-key-1', 'hello');
        CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('sess1', 1)] = {
            message_id: 1, censored: true, chat_session_id: 'sess1', prompt_key: 'different prompt',
            fragments: [{ type: 'RESPONSE', content: 'x' }]
        };
        expect(CensorReplyRestore._tryRestoreFromStoredRecords()).toBe(false);
    });

    it('sets _keyToMessageId for matched virtualItem', () => {
        CensorReplyRestore._currentSessionId = 'sess1';
        vi.spyOn(CensorReplyRestore, '_checkSessionChange').mockImplementation(() => {});
        buildChatPair('asst-key-1', 'hello');
        CensorReplyRestore._restoredMessages[CensorReplyRestore._recordKey('sess1', 77)] = {
            message_id: 77, censored: true, chat_session_id: 'sess1', prompt_key: 'hello',
            fragments: [{ type: 'RESPONSE', content: 'x' }], thinking_elapsed_secs: 0
        };
        CensorReplyRestore._tryRestoreFromStoredRecords();
        expect(CensorReplyRestore._keyToMessageId.get('asst-key-1')).toBe(77);
    });
});


// ============================================================================
// thinkblock.js mutant killers
// ============================================================================

describe('thinkblock.js mutant killers', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_buildThinkBlock()', () => {
        it('returns a container element with correct class', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'thinking...' }, 5);
            expect(el).toBeInstanceOf(HTMLElement);
            expect(el.className).toContain(DSSelectors.THINK_BLOCK_CLASS);
        });
        it('renders think content as markdown', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: '**bold**' }, 0);
            const md = el.querySelector('.' + DSSelectors.MARKDOWN_CLASS);
            expect(md).not.toBeNull();
            expect(md.innerHTML).toContain('<strong>');
        });
        it('sets --ds-md-zoom style on markdown element', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 0);
            const md = el.querySelector('.' + DSSelectors.MARKDOWN_CLASS);
            expect(md.getAttribute('style')).toContain('--ds-md-zoom: 1.143');
        });
        it('contains header with cursor pointer', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'x' }, 0);
            const header = el.querySelector('.' + DSSelectors.THINK_HEADER_CLASS.split(' ')[0]);
            expect(header).not.toBeNull();
            expect(header.style.cursor).toBe('pointer');
        });
        it('contains spacer element', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'x' }, 0);
            expect(el.querySelector('.' + DSSelectors.THINK_SPACER_CLASS)).not.toBeNull();
        });
        it('contains think content area with correct classes', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'x' }, 0);
            const tc = el.querySelector('.' + DSSelectors.THINK_CONTENT_CLASS);
            expect(tc).not.toBeNull();
            expect(tc.classList.contains(DSSelectors.THINK_CONTENT_OUTER_CLASS)).toBe(true);
            expect(tc.classList.contains(DSSelectors.THINK_CONTENT_MODIFIER_CLASS)).toBe(true);
        });
        it('contains footer element', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'x' }, 0);
            expect(el.querySelector('.' + DSSelectors.THINK_FOOTER_CLASS)).not.toBeNull();
        });
        it('contains separator element', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'x' }, 0);
            expect(el.querySelector('.' + DSSelectors.THINK_SEPARATOR_CLASS)).not.toBeNull();
        });
        it('header click toggles collapsed state', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 0);
            document.body.appendChild(el);
            const header = el.querySelector('.' + DSSelectors.THINK_HEADER_CLASS.split(' ')[0]);
            expect(el.getAttribute('data-ht-collapsed')).toBeNull();
            header.click();
            expect(el.getAttribute('data-ht-collapsed')).toBe('1');
            header.click();
            expect(el.getAttribute('data-ht-collapsed')).toBe('0');
        });
        it('header click toggles think content display', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 0);
            document.body.appendChild(el);
            const header = el.querySelector('.' + DSSelectors.THINK_HEADER_CLASS.split(' ')[0]);
            const tc = el.querySelector(DSSelectors.THINK_CONTENT_SELECTOR);
            header.click();
            expect(tc.style.display).toBe('none');
            header.click();
            expect(tc.style.display).toBe('block');
        });
        it('displays elapsed seconds when provided', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'x' }, 12.7);
            expect(el.innerHTML).toContain('13');
        });
        it('container style has required CSS custom properties', () => {
            const el = CensorReplyRestore._buildThinkBlock({ content: 'x' }, 0);
            const style = el.getAttribute('style');
            expect(style).toContain('--collapsible-area-title-height');
            expect(style).toContain('--group-title-sticky-base-top');
        });
    });
});


// ============================================================================
// markdown.js mutant killers
// ============================================================================

describe('markdown.js mutant killers', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_escapeHtml()', () => {
        it('escapes ampersand', () => expect(CensorReplyRestore._escapeHtml('a&b')).toBe('a&amp;b'));
        it('escapes less than', () => expect(CensorReplyRestore._escapeHtml('a<b')).toBe('a&lt;b'));
        it('escapes greater than', () => expect(CensorReplyRestore._escapeHtml('a>b')).toBe('a&gt;b'));
        it('escapes all three', () => expect(CensorReplyRestore._escapeHtml('<a&b>')).toBe('&lt;a&amp;b&gt;'));
        it('no-op on safe string', () => expect(CensorReplyRestore._escapeHtml('hello')).toBe('hello'));
    });

    describe('_renderInline()', () => {
        it('renders bold', () => {
            const r = CensorReplyRestore._renderInline('**bold**');
            expect(r).toContain('<strong>');
            expect(r).toContain('bold');
        });
        it('renders italic', () => {
            const r = CensorReplyRestore._renderInline('*italic*');
            expect(r).toContain('<em>');
        });
        it('renders links', () => {
            const r = CensorReplyRestore._renderInline('[text](http://url)');
            expect(r).toContain('<a href="http://url"');
            expect(r).toContain('target="_blank"');
        });
        it('escapes HTML in text', () => {
            const r = CensorReplyRestore._renderInline('<script>');
            expect(r).not.toContain('<script>');
            expect(r).toContain('&lt;script&gt;');
        });
    });

    describe('_renderMarkdown()', () => {
        it('empty/falsy returns empty string', () => {
            expect(CensorReplyRestore._renderMarkdown('')).toBe('');
            expect(CensorReplyRestore._renderMarkdown(null)).toBe('');
            expect(CensorReplyRestore._renderMarkdown(undefined)).toBe('');
        });
        it('paragraph', () => {
            const r = CensorReplyRestore._renderMarkdown('Hello world');
            expect(r).toContain('<p class="ds-markdown-paragraph">');
            expect(r).toContain('Hello world');
        });
        it('heading levels 1-6', () => {
            for (let lvl = 1; lvl <= 6; lvl++) {
                const r = CensorReplyRestore._renderMarkdown('#'.repeat(lvl) + ' Title');
                expect(r).toContain('<h' + lvl + '>');
                expect(r).toContain('</h' + lvl + '>');
            }
        });
        it('horizontal rule', () => {
            expect(CensorReplyRestore._renderMarkdown('---')).toContain('<hr>');
        });
        it('blockquote', () => {
            const r = CensorReplyRestore._renderMarkdown('> quoted text');
            expect(r).toContain('<blockquote>');
            expect(r).toContain('quoted text');
        });
        it('unordered list with dashes', () => {
            const r = CensorReplyRestore._renderMarkdown('- item1\n- item2');
            expect(r).toContain('<ul>');
            expect(r).toContain('<li>');
            expect(r).toContain('item1');
            expect(r).toContain('item2');
        });
        it('unordered list with asterisks', () => {
            expect(CensorReplyRestore._renderMarkdown('* item1\n* item2')).toContain('<ul>');
        });
        it('ordered list', () => {
            const r = CensorReplyRestore._renderMarkdown('1. first\n2. second');
            expect(r).toContain('<ol start="1">');
            expect(r).toContain('first');
        });

        it('code block with language', () => {
            const r = CensorReplyRestore._renderMarkdown('```js\nconst x = 1;\n```');
            expect(r).toContain('md-code-block');
            expect(r).toContain('md-code-lang');
            expect(r).toContain('js');
        });
        it('code block without language', () => {
            const r = CensorReplyRestore._renderMarkdown('```\ncode here\n```');
            expect(r).toContain('md-code-block');
            expect(r).toContain('<pre>');
        });
        it('code block escapes HTML in code', () => {
            const r = CensorReplyRestore._renderMarkdown('```\n<div>test</div>\n```');
            expect(r).toContain('&lt;div&gt;');
        });
        it('table rendering', () => {
            const r = CensorReplyRestore._renderMarkdown('| H1 | H2 |\n| --- | --- |\n| c1 | c2 |');
            expect(r).toContain('<table>');
            expect(r).toContain('<thead>');
            expect(r).toContain('<th>');
            expect(r).toContain('<tbody>');
            expect(r).toContain('<td>');
        });
        it('table with < 2 rows returns empty', () => {
            const r = CensorReplyRestore._renderMarkdown('| H1 | H2 |');
            expect(r).not.toContain('<table>');
        });
        it('empty lines are skipped', () => {
            const r = CensorReplyRestore._renderMarkdown('para1\n\npara2');
            expect(r).toContain('para1');
            expect(r).toContain('para2');
        });
        it('multi-line paragraph joins lines', () => {
            const r = CensorReplyRestore._renderMarkdown('line1\nline2');
            expect(r).toContain('line1 line2');
        });
        it('multi-line blockquote', () => {
            const r = CensorReplyRestore._renderMarkdown('> line1\n> line2');
            expect(r).toContain('line1');
            expect(r).toContain('line2');
        });
    });

    describe('_renderTokens()', () => {
        it('unknown token type produces no output', () => {
            expect(CensorReplyRestore._renderTokens([{ type: 'nonexistent', content: 'x' }])).toBe('');
        });
    });

    describe('_renderTable()', () => {
        it('empty rows returns empty string', () => {
            expect(CensorReplyRestore._renderTable([])).toBe('');
        });
        it('single row returns empty string', () => {
            expect(CensorReplyRestore._renderTable(['| H1 | H2 |'])).toBe('');
        });
        it('body rows render as td', () => {
            const r = CensorReplyRestore._renderTable(['| H1 |', '| --- |', '| D1 |']);
            expect(r).toContain('<td>');
            expect(r).toContain('D1');
        });
    });
});

