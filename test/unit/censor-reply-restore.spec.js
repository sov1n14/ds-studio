import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import StorageManager from '../../utils/storage-manager.js';

describe('CensorReplyRestore', () => {
    beforeEach(() => {
        CensorReplyRestore.disable();
        CensorReplyRestore.enabled = false;
        CensorReplyRestore._pendingQueue = [];
        CensorReplyRestore._keyToMessageId = new Map();
        CensorReplyRestore._restoredMessages = {};
        CensorReplyRestore._storedRecordsApplied = false;
        CensorReplyRestore._currentSessionId = null;
        document.body.innerHTML = '';
    });

    describe('_parseSseEvent()', () => {
        it('parses initial response event with message_id and fragments', () => {
            const state = {};
            const line = 'data: {"v":{"response":{"message_id":38,"fragments":[{"id":2,"type":"THINK","content":"We"}]}}}';
            CensorReplyRestore._parseSseEvent(state, line);
            expect(state.messageId).toBe(38);
            expect(state.fragments).toHaveLength(1);
            expect(state.fragments[0].type).toBe('THINK');
            expect(state.started).toBe(true);
        });

        it('appends content to the last fragment on APPEND /content', () => {
            const state = {
                messageId: 38,
                fragments: [{ id: 2, type: 'THINK', content: 'We' }],
                started: true
            };
            const line = 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":" need"}';
            CensorReplyRestore._parseSseEvent(state, line);
            expect(state.fragments[0].content).toBe('We need');
        });

        it('pushes new fragment on APPEND /fragments', () => {
            const state = {
                messageId: 38,
                fragments: [{ id: 2, type: 'THINK', content: 'We' }],
                started: true
            };
            const line = 'data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"Hi"}]}';
            CensorReplyRestore._parseSseEvent(state, line);
            expect(state.fragments).toHaveLength(2);
            expect(state.fragments[1].type).toBe('RESPONSE');
        });

        it('sets elapsed_secs on SET /elapsed_secs', () => {
            const state = {
                messageId: 38,
                fragments: [{ id: 2, type: 'THINK', content: 'We' }],
                started: true
            };
            const line = 'data: {"p":"response/fragments/-1/elapsed_secs","o":"SET","v":1.425}';
            CensorReplyRestore._parseSseEvent(state, line);
            expect(state.thinkingElapsedSecs).toBe(1.425);
        });

        it('marks finished on SET FINISHED', () => {
            const state = {
                messageId: 38,
                fragments: [{ id: 2, type: 'THINK', content: 'We' }],
                started: true
            };
            const line = 'data: {"p":"response/status","o":"SET","v":"FINISHED"}';
            CensorReplyRestore._parseSseEvent(state, line);
            expect(state.finished).toBe(true);
        });

        it('handles BATCH operations recursively', () => {
            const state = {
                messageId: 38,
                fragments: [{ id: 2, type: 'THINK', content: '' }],
                started: true
            };
            const batchLine = 'data: {"o":"BATCH","v":[{"o":"APPEND","v":"hello"},{"o":"SET","p":"x/elapsed_secs","v":0.5}]}';
            CensorReplyRestore._parseSseEvent(state, batchLine);
            expect(state.fragments[0].content).toBe('hello');
        });

        it('handles short format {"v":"..."} as continuation APPEND to fragments/-1/content', () => {
            const state = {
                messageId: 38,
                fragments: [{ id: 2, type: 'THINK', content: 'ab' }],
                started: true
            };
            // Event with v value but no p (path) or o (operation) — is a short-format continuation
            // Should append to last fragment's content per SSE spec
            const line = 'data: {"v":"cd"}';
            CensorReplyRestore._parseSseEvent(state, line);
            // Content should be appended to produce combined value
            expect(state.fragments[0].content).toBe('abcd');
        });

        it('ignores short format {"v":"..."} when fragments is empty', () => {
            const state = {
                messageId: 38,
                fragments: [],
                started: true
            };
            // Short-format event with empty fragments should be silently ignored
            const line = 'data: {"v":"cd"}';
            CensorReplyRestore._parseSseEvent(state, line);
            // Fragments should remain empty, no error thrown
            expect(state.fragments).toHaveLength(0);
        });

        it('silently ignores invalid JSON', () => {
            const state = { started: true, fragments: [] };
            const line = 'data: {invalid';
            expect(() => CensorReplyRestore._parseSseEvent(state, line)).not.toThrow();
            expect(state.fragments).toHaveLength(0);
        });
    });

    describe('_renderMarkdown()', () => {
        it('renders a simple paragraph', () => {
            const html = CensorReplyRestore._renderMarkdown('Hello world');
            expect(html).toContain('<p class="ds-markdown-paragraph">');
            expect(html).toContain('<span>Hello world</span>');
        });

        it('renders headings', () => {
            const html = CensorReplyRestore._renderMarkdown('# Title\n## Sub');
            expect(html).toContain('<h1><span>Title</span></h1>');
            expect(html).toContain('<h2><span>Sub</span></h2>');
        });

        it('renders bold and italic', () => {
            const html = CensorReplyRestore._renderMarkdown('**bold** and *italic*');
            expect(html).toContain('<strong><span>bold</span></strong>');
            expect(html).toContain('<em><span>italic</span></em>');
        });

        it('renders inline code', () => {
            const html = CensorReplyRestore._renderMarkdown('Use `code` here');
            expect(html).toContain('<code>code</code>');
        });

        it('renders links', () => {
            const html = CensorReplyRestore._renderMarkdown('[text](https://example.com)');
            expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">');
            expect(html).toContain('<span>text</span>');
        });

        it('renders horizontal rule', () => {
            const html = CensorReplyRestore._renderMarkdown('---');
            expect(html).toContain('<hr>');
        });

        it('renders blockquote', () => {
            const html = CensorReplyRestore._renderMarkdown('> quote text');
            expect(html).toContain('<blockquote>');
            expect(html).toContain('quote text');
        });

        it('renders unordered list', () => {
            const html = CensorReplyRestore._renderMarkdown('- item1\n- item2');
            expect(html).toContain('<ul>');
            expect(html).toContain('<li><p><span>item1</span></p></li>');
            expect(html).toContain('<li><p><span>item2</span></p></li>');
        });

        it('renders ordered list', () => {
            const html = CensorReplyRestore._renderMarkdown('1. first\n2. second');
            expect(html).toContain('<ol start="1">');
            expect(html).toContain('<span>first</span>');
        });

        it('renders code block', () => {
            const html = CensorReplyRestore._renderMarkdown('```js\nconst x = 1;\n```');
            expect(html).toContain('<div class="md-code-block md-code-block-dark">');
            expect(html).toContain('const x = 1;');
        });

        it('renders tables', () => {
            const md = '| H1 | H2 |\n|---|---|\n| A | B |';
            const html = CensorReplyRestore._renderMarkdown(md);
            expect(html).toContain('<table>');
            expect(html).toContain('<th><span>H1</span></th>');
            expect(html).toContain('<td><span>A</span></td>');
        });

        it('returns empty string for null/empty input', () => {
            expect(CensorReplyRestore._renderMarkdown('')).toBe('');
            expect(CensorReplyRestore._renderMarkdown(null)).toBe('');
        });
    });

    describe('_isCensored()', () => {
        // ── Legacy DOM helpers (.ds-icon-button) ───────────────────────────────

        function createLegacyToolbar(btnStates) {
            const toolbar = document.createElement('div');
            toolbar.className = 'ds-flex';
            for (let i = 0; i < btnStates.length; i++) {
                const btn = document.createElement('button');
                btn.className = 'ds-icon-button';
                if (btnStates[i] === 'disabled') {
                    btn.classList.add('ds-icon-button--disabled');
                    btn.setAttribute('aria-disabled', 'true');
                } else if (btnStates[i] === 'enabled-disabled') {
                    btn.setAttribute('aria-disabled', 'true');
                }
                toolbar.appendChild(btn);
            }
            return toolbar;
        }

        // ── New DOM helpers ([role="button"].ds-button.ds-button--icon) ────────

        /**
         * Creates a new-style ds-button toolbar.
         * @param {Array<'enabled'|'disabled'|'disabled-no-aria'>} btnStates
         *   'disabled'          → ds-button--disabled + aria-disabled="true"
         *   'disabled-no-aria'  → ds-button--disabled only (no aria-disabled)
         *   'enabled'           → no disabled class
         */
        function createNewDomToolbar(btnStates) {
            const toolbar = document.createElement('div');
            toolbar.className = 'ds-flex _965abe9 _54866f7';
            for (let i = 0; i < btnStates.length; i++) {
                const btn = document.createElement('div');
                btn.setAttribute('role', 'button');
                btn.className = 'ds-button ds-button--icon';
                if (btnStates[i] === 'disabled') {
                    btn.classList.add('ds-button--disabled');
                    btn.setAttribute('aria-disabled', 'true');
                } else if (btnStates[i] === 'disabled-no-aria') {
                    btn.classList.add('ds-button--disabled');
                    // intentionally no aria-disabled attribute
                }
                toolbar.appendChild(btn);
            }
            return toolbar;
        }

        // ── Legacy DOM tests ───────────────────────────────────────────────────

        it('(legacy) returns true when buttons[1] and buttons[4] both have ds-icon-button--disabled + aria-disabled', () => {
            const toolbar = createLegacyToolbar(['enabled', 'disabled', 'enabled', 'enabled', 'disabled']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(true);
        });

        it('(legacy) returns false when button[1] is enabled', () => {
            const toolbar = createLegacyToolbar(['enabled', 'enabled', 'enabled', 'enabled', 'disabled']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(false);
        });

        it('(legacy) returns false when button[4] is enabled', () => {
            const toolbar = createLegacyToolbar(['enabled', 'disabled', 'enabled', 'enabled', 'enabled']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(false);
        });

        it('(legacy) returns false when there are fewer than 5 buttons', () => {
            const toolbar = createLegacyToolbar(['enabled', 'disabled', 'enabled']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(false);
        });

        // ── New DOM tests ──────────────────────────────────────────────────────

        it('(new DOM) returns true when buttons[1] has ds-button--disabled + aria-disabled and buttons[4] has ds-button--disabled WITHOUT aria-disabled', () => {
            // Mirrors real chat-area.html: buttons[1] has aria-disabled, buttons[4] does NOT
            const toolbar = createNewDomToolbar(['enabled', 'disabled', 'enabled', 'enabled', 'disabled-no-aria']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(true);
        });

        it('(new DOM) returns true when both buttons[1] and buttons[4] have ds-button--disabled + aria-disabled', () => {
            const toolbar = createNewDomToolbar(['enabled', 'disabled', 'enabled', 'enabled', 'disabled']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(true);
        });

        it('(new DOM) returns true when both buttons[1] and buttons[4] have only ds-button--disabled (no aria-disabled on either)', () => {
            const toolbar = createNewDomToolbar(['enabled', 'disabled-no-aria', 'enabled', 'enabled', 'disabled-no-aria']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(true);
        });

        it('(new DOM) returns false when no buttons are disabled', () => {
            const toolbar = createNewDomToolbar(['enabled', 'enabled', 'enabled', 'enabled', 'enabled']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(false);
        });

        it('(new DOM) returns false when only buttons[1] is disabled but buttons[4] is not', () => {
            const toolbar = createNewDomToolbar(['enabled', 'disabled', 'enabled', 'enabled', 'enabled']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(false);
        });

        it('(new DOM) returns false when only buttons[4] is disabled but buttons[1] is not', () => {
            const toolbar = createNewDomToolbar(['enabled', 'enabled', 'enabled', 'enabled', 'disabled-no-aria']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(false);
        });

        it('(new DOM) returns false when there are fewer than 5 new-style buttons', () => {
            const toolbar = createNewDomToolbar(['enabled', 'disabled', 'enabled']);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(false);
        });

        // ── Null / invalid input ───────────────────────────────────────────────

        it('returns false for null input', () => {
            expect(CensorReplyRestore._isCensored(null)).toBe(false);
        });

        it('returns false for a plain object without querySelectorAll', () => {
            expect(CensorReplyRestore._isCensored({})).toBe(false);
        });
    });

    describe('_getToolbarGroup()', () => {
        /**
         * Builds a virtual-list item containing an assistant message element
         * and optionally a separate toolbar sibling inside the same container.
         */
        function buildVirtualItem({ toolbarClassName, buttonCount, useNewDom }) {
            const container = document.createElement('div');
            container.setAttribute('data-virtual-list-item-key', 'asst-1');

            const msgEl = document.createElement('div');
            msgEl.className = 'ds-message _63c77b1';
            container.appendChild(msgEl);

            const toolbar = document.createElement('div');
            toolbar.className = toolbarClassName;
            for (let i = 0; i < buttonCount; i++) {
                const btn = document.createElement('div');
                if (useNewDom) {
                    btn.setAttribute('role', 'button');
                    btn.className = 'ds-button ds-button--icon';
                } else {
                    btn.className = 'ds-icon-button';
                }
                toolbar.appendChild(btn);
            }
            container.appendChild(toolbar);

            document.body.appendChild(container);
            return { msgEl, toolbar };
        }

        beforeEach(() => {
            document.body.innerHTML = '';
        });

        it('(primary) finds .ds-flex._965abe9 container containing new-style ds-button children', () => {
            const { msgEl, toolbar } = buildVirtualItem({
                toolbarClassName: 'ds-flex _965abe9 _54866f7',
                buttonCount: 5,
                useNewDom: true
            });
            const result = CensorReplyRestore._getToolbarGroup(msgEl);
            expect(result).toBe(toolbar);
        });

        it('(primary) finds .ds-flex._965abe9 container containing legacy ds-icon-button children', () => {
            const { msgEl, toolbar } = buildVirtualItem({
                toolbarClassName: 'ds-flex _965abe9',
                buttonCount: 5,
                useNewDom: false
            });
            const result = CensorReplyRestore._getToolbarGroup(msgEl);
            expect(result).toBe(toolbar);
        });

        it('(fallback) finds .ds-flex with 5 new-style buttons when no .ds-flex._965abe9 exists', () => {
            const { msgEl, toolbar } = buildVirtualItem({
                toolbarClassName: 'ds-flex some-other-class',
                buttonCount: 5,
                useNewDom: true
            });
            const result = CensorReplyRestore._getToolbarGroup(msgEl);
            expect(result).toBe(toolbar);
        });

        it('(fallback) returns null when the only .ds-flex has fewer than 5 buttons', () => {
            const { msgEl } = buildVirtualItem({
                toolbarClassName: 'ds-flex some-other-class',
                buttonCount: 3,
                useNewDom: true
            });
            const result = CensorReplyRestore._getToolbarGroup(msgEl);
            expect(result).toBeNull();
        });

        it('returns null when there is no .ds-flex toolbar at all', () => {
            const container = document.createElement('div');
            container.setAttribute('data-virtual-list-item-key', 'asst-2');
            const msgEl = document.createElement('div');
            msgEl.className = 'ds-message _63c77b1';
            container.appendChild(msgEl);
            document.body.appendChild(container);

            const result = CensorReplyRestore._getToolbarGroup(msgEl);
            expect(result).toBeNull();
        });
    });

    describe('SSE short format continuation patches', () => {
        it('accumulates multiple short-format continuation events into fragment content', () => {
            const state = {
                messageId: 38,
                fragments: [{ id: 2, type: 'THINK', content: '用户' }],
                started: true
            };

            // Simulate the sequence from api-response-first.yml:
            // 1. Initial APPEND with path
            let line = 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"提问"}';
            CensorReplyRestore._parseSseEvent(state, line);

            // 2-7. Multiple short-format continuation events
            const shortFormEvents = ['为什么', '中国', '禁止', '了', '小熊'];
            for (const value of shortFormEvents) {
                line = `data: {"v":"${value}"}`;
                CensorReplyRestore._parseSseEvent(state, line);
            }

            // After all events, the content should be the concatenation
            expect(state.fragments[0].content).toBe('用户提问为什么中国禁止了小熊');
            // Verify that content was actually accumulated (not just first 4 chars or similar regression)
            expect(state.fragments[0].content.length).toBeGreaterThan(4);
        });
    });

    describe('_evictOldest()', () => {
        it('removes oldest entries when exceeding STORAGE_MAX_ENTRIES', () => {
            const old = CensorReplyRestore.STORAGE_MAX_ENTRIES;
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 3;
            CensorReplyRestore._restoredMessages = {
                '1': { message_id: 1, restored_at: 100 },
                '2': { message_id: 2, restored_at: 200 },
                '3': { message_id: 3, restored_at: 300 },
                '4': { message_id: 4, restored_at: 50 }
            };
            CensorReplyRestore._evictOldest();
            const keys = Object.keys(CensorReplyRestore._restoredMessages);
            expect(keys).toHaveLength(3);
            expect(keys).not.toContain('4');
            CensorReplyRestore.STORAGE_MAX_ENTRIES = old;
        });

        it('does nothing when under the limit', () => {
            CensorReplyRestore._restoredMessages = {
                '1': { message_id: 1, restored_at: 100 },
                '2': { message_id: 2, restored_at: 200 }
            };
            CensorReplyRestore._evictOldest();
            expect(Object.keys(CensorReplyRestore._restoredMessages)).toHaveLength(2);
        });

        it('removes the correct number of entries when over by multiple', () => {
            const old = CensorReplyRestore.STORAGE_MAX_ENTRIES;
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 2;
            CensorReplyRestore._restoredMessages = {
                'a': { message_id: 1, restored_at: 10 },
                'b': { message_id: 2, restored_at: 20 },
                'c': { message_id: 3, restored_at: 5 },
                'd': { message_id: 4, restored_at: 15 }
            };
            CensorReplyRestore._evictOldest();
            expect(Object.keys(CensorReplyRestore._restoredMessages)).toHaveLength(2);
            CensorReplyRestore.STORAGE_MAX_ENTRIES = old;
        });
    });

    describe('_injectRestoredContent()', () => {
        function createMessageEl(withThinkContainer) {
            const msgEl = document.createElement('div');
            msgEl.className = 'ds-message _63c77b1';

            if (withThinkContainer) {
                const thinkWrap = document.createElement('div');
                thinkWrap.className = '_74c0879';
                const thinkContent = document.createElement('div');
                thinkContent.className = 'e1675d8b ds-think-content _767406f';
                const sep = document.createElement('div');
                sep.className = '_9ecc93a';
                thinkContent.appendChild(sep);
                thinkWrap.appendChild(thinkContent);
                msgEl.appendChild(thinkWrap);
            }

            const mainContent = document.createElement('div');
            mainContent.className = 'ds-markdown ds-assistant-message-main-content';
            mainContent.textContent = 'censored text';
            msgEl.appendChild(mainContent);

            return msgEl;
        }

        it('injects response content without think fragment', () => {
            const msgEl = createMessageEl(false);
            const record = {
                message_id: 38,
                fragments: [{ type: 'RESPONSE', content: 'Hello' }]
            };

            CensorReplyRestore._injectRestoredContent(msgEl, record);
            const mainContent = msgEl.querySelector('.ds-assistant-message-main-content.restored-content');
            expect(mainContent).not.toBeNull();
            expect(mainContent.innerHTML).toContain('Hello');
            expect(mainContent.innerHTML).toContain('restored-badge');
        });

        it('injects response with think fragment when think container exists', () => {
            const msgEl = createMessageEl(true);
            const record = {
                message_id: 38,
                fragments: [
                    { type: 'THINK', content: 'thinking...' },
                    { type: 'RESPONSE', content: 'answer' }
                ],
                thinking_elapsed_secs: 2.5
            };

            CensorReplyRestore._injectRestoredContent(msgEl, record);
            const thinkContent = msgEl.querySelector('._74c0879.restored-content');
            expect(thinkContent).not.toBeNull();
            const restoredEl = msgEl.querySelector('.ds-assistant-message-main-content.restored-content');
            expect(restoredEl).not.toBeNull();
            expect(restoredEl.innerHTML).toContain('answer');
        });

        it('builds think block when think container is missing', () => {
            const msgEl = createMessageEl(false);
            const record = {
                message_id: 38,
                fragments: [
                    { type: 'THINK', content: 'thinking...' },
                    { type: 'RESPONSE', content: 'answer' }
                ]
            };

            CensorReplyRestore._injectRestoredContent(msgEl, record);
            const thinkBlock = msgEl.querySelector('._74c0879');
            expect(thinkBlock).not.toBeNull();
        });

        it('does nothing for empty fragments', () => {
            const msgEl = createMessageEl(false);
            CensorReplyRestore._injectRestoredContent(msgEl, { message_id: 38, fragments: [] });
            const mainContent = msgEl.querySelector('.restored-content');
            expect(mainContent).toBeNull();
        });

        it('adds dss-censored-hidden class to original content element', () => {
            const msgEl = createMessageEl(false);
            const record = { message_id: 38, fragments: [{ type: 'RESPONSE', content: 'Hello' }] };
            CensorReplyRestore._injectRestoredContent(msgEl, record);
            const originalContent = msgEl.querySelector('.ds-assistant-message-main-content:not(.restored-content)');
            expect(originalContent).not.toBeNull();
            expect(originalContent.classList.contains('dss-censored-hidden')).toBe(true);
        });

        it('does not double-inject when restored-content already exists', () => {
            const msgEl = createMessageEl(false);
            const mainContent = msgEl.querySelector('.ds-assistant-message-main-content');
            mainContent.classList.add('restored-content');
            const record = { message_id: 38, fragments: [{ type: 'RESPONSE', content: 'Hello' }] };
            CensorReplyRestore._tryRestoreMessage(msgEl);
            expect(msgEl.querySelectorAll('.restored-content')).toHaveLength(1);
        });
    });

    describe('_onFragmentComplete() — censored flag filtering', () => {
        it('receives censored: false payload — does NOT modify _pendingQueue or _restoredMessages', () => {
            CensorReplyRestore.enabled = true;
            const initialQueueLength = CensorReplyRestore._pendingQueue.length;
            const initialRestoredCount = Object.keys(CensorReplyRestore._restoredMessages).length;

            CensorReplyRestore._onFragmentComplete({
                messageId: 100,
                fragments: [{ type: 'RESPONSE', content: 'uncensored response' }],
                thinkingElapsedSecs: 0,
                censored: false
            });

            expect(CensorReplyRestore._pendingQueue).toHaveLength(initialQueueLength);
            expect(Object.keys(CensorReplyRestore._restoredMessages)).toHaveLength(initialRestoredCount);
        });

        it('receives censored: true payload — adds messageId to queue and saves record with censored: true', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};

            CensorReplyRestore._onFragmentComplete({
                messageId: 42,
                fragments: [{ type: 'THINK', content: 'thinking' }, { type: 'RESPONSE', content: 'censored response' }],
                thinkingElapsedSecs: 1.5,
                censored: true
            });

            expect(CensorReplyRestore._pendingQueue).toContain(42);
            // No chatSessionId provided → stored under 'nosession::42' (session-scoped key scheme)
            expect(CensorReplyRestore._restoredMessages['nosession::42']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['nosession::42'].censored).toBe(true);
            expect(CensorReplyRestore._restoredMessages['nosession::42'].fragments[0].type).toBe('THINK');
        });

        it('passes chatSessionId and promptText into _saveFragment', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};

            CensorReplyRestore._onFragmentComplete({
                messageId: 77,
                fragments: [{ type: 'RESPONSE', content: 'test' }],
                thinkingElapsedSecs: 0,
                censored: true,
                chatSessionId: 'session-123',
                promptText: 'Hello world'
            });

            // chatSessionId='session-123' → stored under 'session-123::77' (session-scoped key scheme)
            expect(CensorReplyRestore._restoredMessages['session-123::77']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['session-123::77'].chat_session_id).toBe('session-123');
            expect(CensorReplyRestore._restoredMessages['session-123::77'].prompt_key).toBe('Hello world');
        });
    });

    describe('_parseSseEvent() — censored flag detection', () => {
        it('parses SSE with BATCH containing CONTENT_FILTER — sets state.censored to true', () => {
            const state = {
                messageId: 24,
                fragments: [{ type: 'THINK', content: '用户问' }],
                started: true,
                censored: false,
                finished: false
            };
            const line = 'data: {"p":"response","o":"BATCH","v":[{"p":"ban_regenerate","v":true},{"p":"response/status","o":"SET","v":"CONTENT_FILTER"}]}';
            CensorReplyRestore._parseSseEvent(state, line);
            expect(state.censored).toBe(true);
        });

        it('parses fully normal reply (FINISHED with no CONTENT_FILTER) — sets state.censored to false', () => {
            const state = {
                messageId: 12,
                fragments: [{ type: 'THINK', content: '嗯' }, { type: 'RESPONSE', content: '這是一個重要問題' }],
                started: true,
                censored: false,
                finished: false
            };
            const line = 'data: {"p":"response/status","o":"SET","v":"FINISHED"}';
            CensorReplyRestore._parseSseEvent(state, line);
            expect(state.finished).toBe(true);
            expect(state.censored).toBe(false);
        });
    });

    describe('_loadRestoredMessages() — storage cleanup', () => {
        it('loads storage with mixed censored flags — keeps only censored: true records', async () => {
            const storedData = {
                '12': { message_id: 12, censored: false, fragments: [{ type: 'RESPONSE', content: 'uncensored' }] },
                '24': { message_id: 24, censored: true, fragments: [{ type: 'RESPONSE', content: 'censored content' }] }
            };

            // Pre-populate the in-memory storage mock with mixed data
            await new Promise((resolve) => {
                chrome.storage.local.set({ restored_messages: storedData }, resolve);
            });

            // Load the messages (should filter out censored: false entries)
            await CensorReplyRestore._loadRestoredMessages();

            // Verify that only censored: true records were kept.
            // Bare keys (no '::') are legacy format and get migrated to session-scoped keys.
            // '12' is censored: false → filtered out entirely.
            // '24' is censored: true, no chat_session_id embedded → migrated to 'nosession::24'.
            expect(CensorReplyRestore._restoredMessages['12']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['24']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['nosession::24']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['nosession::24'].censored).toBe(true);
        });
    });

    describe('_tryRestoreFromStoredRecords() — skips non-censored records', () => {
        beforeEach(() => {
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._restoredMessages = {};
            document.body.innerHTML = '';
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('skips record with censored !== true — record is filtered out, no injection', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            // User message (preceding)
            const userItem = document.createElement('div');
            userItem.setAttribute('data-virtual-list-item-key', 'user-1');
            const userMsgDiv = document.createElement('div');
            userMsgDiv.className = 'ds-message';
            const userContent = document.createElement('div');
            userContent.className = 'fbb737a4';
            userContent.textContent = 'Hello';
            userMsgDiv.appendChild(userContent);
            userItem.appendChild(userMsgDiv);
            document.body.appendChild(userItem);

            // Assistant message with toolbar indicating censorship
            const asstItem = document.createElement('div');
            asstItem.setAttribute('data-virtual-list-item-key', 'asst-1');
            const msgEl = document.createElement('div');
            msgEl.className = 'ds-message _63c77b1';
            const mainContent = document.createElement('div');
            mainContent.className = 'ds-markdown ds-assistant-message-main-content';
            msgEl.appendChild(mainContent);
            asstItem.appendChild(msgEl);
            // Censored toolbar: buttons 2 and 5 disabled (0-indexed 1 and 4)
            const toolbar = document.createElement('div');
            toolbar.className = 'ds-flex';
            for (const state of ['enabled', 'disabled', 'enabled', 'enabled', 'disabled']) {
                const btn = document.createElement('button');
                btn.className = 'ds-icon-button';
                if (state === 'disabled') {
                    btn.classList.add('ds-icon-button--disabled');
                    btn.setAttribute('aria-disabled', 'true');
                }
                toolbar.appendChild(btn);
            }
            asstItem.appendChild(toolbar);
            document.body.appendChild(asstItem);

            CensorReplyRestore._restoredMessages = {
                '100': {
                    message_id: 100,
                    censored: false,
                    fragments: [{ type: 'RESPONSE', content: 'should not be injected' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000',
                    prompt_key: 'Hello'
                }
            };

            CensorReplyRestore._tryRestoreFromStoredRecords();
            const restoredContent = msgEl.querySelector('.restored-content');
            expect(restoredContent).toBeNull();
        });
    });

    describe('clearAllRestoredMessages()', () => {
        it('clears _restoredMessages in memory and sets storage to empty object', () => {
            CensorReplyRestore._restoredMessages = {
                '5': { message_id: 5, censored: true, fragments: [] }
            };
            CensorReplyRestore._keyToMessageId.set('vkey_5', 5);

            CensorReplyRestore.clearAllRestoredMessages();

            expect(CensorReplyRestore._restoredMessages).toEqual({});
            expect(CensorReplyRestore._keyToMessageId.size).toBe(0);
        });
    });

    describe('End-to-end: censored vs. non-censored contamination', () => {
        it('sequence: non-censored fragment → censored fragment — only censored appears in restored messages', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};

            // Fragment 1: censored: false
            CensorReplyRestore._onFragmentComplete({
                messageId: 200,
                fragments: [{ type: 'RESPONSE', content: 'This is safe content' }],
                thinkingElapsedSecs: 0,
                censored: false
            });

            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
            expect(CensorReplyRestore._restoredMessages['200']).toBeUndefined();

            // Fragment 2: censored: true
            CensorReplyRestore._onFragmentComplete({
                messageId: 201,
                fragments: [{ type: 'RESPONSE', content: 'This is censored content' }],
                thinkingElapsedSecs: 0,
                censored: true
            });

            expect(CensorReplyRestore._pendingQueue).toContain(201);
            // No chatSessionId → stored under 'nosession::201' (session-scoped key scheme)
            expect(CensorReplyRestore._restoredMessages['nosession::201']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['nosession::201'].censored).toBe(true);
            expect(CensorReplyRestore._restoredMessages['200']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['nosession::200']).toBeUndefined();
        });
    });

    describe('_tryRestoreFromStoredRecords() — session+prompt anchoring', () => {
        function createChatPair(assistantKey, userPromptText) {
            const container = document.createElement('div');
            container.className = 'ds-virtual-list-visible-items';

            const userItem = document.createElement('div');
            userItem.setAttribute('data-virtual-list-item-key', 'user-' + assistantKey);
            const userMsg = document.createElement('div');
            userMsg.className = 'ds-message';
            const userContent = document.createElement('div');
            userContent.className = 'fbb737a4';
            userContent.textContent = userPromptText;
            userMsg.appendChild(userContent);
            userItem.appendChild(userMsg);
            container.appendChild(userItem);

            const asstItem = document.createElement('div');
            asstItem.setAttribute('data-virtual-list-item-key', assistantKey);
            const asstMsg = document.createElement('div');
            asstMsg.className = 'ds-message _63c77b1';
            const mainContent = document.createElement('div');
            mainContent.className = 'ds-markdown ds-assistant-message-main-content';
            mainContent.textContent = 'censored text';
            asstMsg.appendChild(mainContent);
            asstItem.appendChild(asstMsg);

            // Censored toolbar: buttons 2 and 5 disabled (0-indexed 1 and 4)
            const toolbar = document.createElement('div');
            toolbar.className = 'ds-flex';
            for (const state of ['enabled', 'disabled', 'enabled', 'enabled', 'disabled']) {
                const btn = document.createElement('button');
                btn.className = 'ds-icon-button';
                if (state === 'disabled') {
                    btn.classList.add('ds-icon-button--disabled');
                    btn.setAttribute('aria-disabled', 'true');
                }
                toolbar.appendChild(btn);
            }
            asstItem.appendChild(toolbar);
            container.appendChild(asstItem);

            document.body.appendChild(container);
            return asstMsg;
        }

        beforeEach(() => {
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._restoredMessages = {};
            document.body.innerHTML = '';
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('restores messages by matching prompt_key between DOM and records', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            createChatPair('asst-1', 'What is AI?');
            createChatPair('asst-2', 'Tell me a joke');
            createChatPair('asst-3', 'Explain quantum physics');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'AI response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'What is AI?', restored_at: 100
                },
                '102': {
                    message_id: 102, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Joke response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'Tell me a joke', restored_at: 200
                },
                '103': {
                    message_id: 103, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Physics response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'Explain quantum physics', restored_at: 300
                }
            };

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(true);

            const msgEls = document.querySelectorAll('.ds-message._63c77b1');
            expect(msgEls).toHaveLength(3);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(3);
            for (const msgEl of msgEls) {
                expect(msgEl.querySelector('.restored-content')).not.toBeNull();
            }
        });

        it('pairs duplicate prompts by message_id order', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            createChatPair('asst-1', 'hello');
            createChatPair('asst-2', 'hello');

            CensorReplyRestore._restoredMessages = {
                '100': {
                    message_id: 100, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'First response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'hello', restored_at: 100
                },
                '200': {
                    message_id: 200, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Second response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'hello', restored_at: 200
                }
            };

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(true);

            const msgEls = document.querySelectorAll('.ds-message._63c77b1');
            expect(CensorReplyRestore._keyToMessageId.size).toBe(2);
            const firstRestored = msgEls[0].querySelector('.restored-content');
            const secondRestored = msgEls[1].querySelector('.restored-content');
            expect(firstRestored).not.toBeNull();
            expect(secondRestored).not.toBeNull();
            expect(firstRestored.innerHTML).toContain('First response');
            expect(secondRestored.innerHTML).toContain('Second response');
        });

        it('does NOT inject records from a different chat_session_id', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/a0000000-0000-0000-0000-000000000001');

            createChatPair('asst-1', 'Hello');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Wrong session' }],
                    chat_session_id: 'b0000000-0000-0000-0000-000000000002', prompt_key: 'Hello', restored_at: 100
                }
            };

            CensorReplyRestore._tryRestoreFromStoredRecords();

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });

        it('skips legacy records without prompt_key or chat_session_id', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            createChatPair('asst-1', 'Hello');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Legacy' }]
                    // no chat_session_id, no prompt_key
                }
            };

            CensorReplyRestore._tryRestoreFromStoredRecords();

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });

        it('does nothing when current session cannot be determined from URL', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/other/page');

            createChatPair('asst-1', 'Hello');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Content' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'Hello', restored_at: 100
                }
            };

            CensorReplyRestore._tryRestoreFromStoredRecords();

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });

        it('returns false when no records can be matched', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            createChatPair('asst-1', 'What is AI?');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Unmatched' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'nonexistent', restored_at: 100
                }
            };

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();

            expect(result).toBe(false);
            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });
    });

    describe('_buildThinkBlock() — no longer forces collapse', () => {
        it('think block is expanded by default', () => {
            const container = CensorReplyRestore._buildThinkBlock({ content: 'test thinking' }, 1.5);

            expect(container.hasAttribute('data-ht-collapsed')).toBe(false);

            const thinkContent = container.querySelector('.ds-think-content');
            expect(thinkContent.style.display).not.toBe('none');
        });

        it('container click handler hides content when data-ht-collapsed is set', () => {
            const container = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 1.5);
            document.body.appendChild(container);

            container.setAttribute('data-ht-collapsed', '1');
            container.click();

            const thinkContent = container.querySelector('.ds-think-content');
            expect(thinkContent.style.display).toBe('none');
        });

        it('container click handler shows content when data-ht-collapsed is cleared', () => {
            const container = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 1.5);
            document.body.appendChild(container);

            container.setAttribute('data-ht-collapsed', '0');
            container.click();

            const thinkContent = container.querySelector('.ds-think-content');
            expect(thinkContent.style.display).not.toBe('none');
        });

        it('container click does NOT fire when header is clicked', () => {
            const container = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 1.5);
            document.body.appendChild(container);

            const header = container.querySelector('._245c867');
            const thinkContent = container.querySelector('.ds-think-content');

            header.click();

            expect(container.getAttribute('data-ht-collapsed')).toBe('1');
            expect(thinkContent.style.display).toBe('none');

            header.click();

            expect(container.getAttribute('data-ht-collapsed')).toBe('0');
            expect(thinkContent.style.display).not.toBe('none');
        });
    });

    describe('_normalizePrompt()', () => {
        it('trims leading and trailing whitespace', () => {
            expect(CensorReplyRestore._normalizePrompt('  hello  ')).toBe('hello');
        });

        it('collapses multiple internal whitespace to single space', () => {
            expect(CensorReplyRestore._normalizePrompt('hello    world')).toBe('hello world');
        });

        it('collapses mixed internal whitespace (tabs, newlines, spaces)', () => {
            expect(CensorReplyRestore._normalizePrompt('hello\t  \nworld')).toBe('hello world');
        });

        it('returns empty string for null input', () => {
            expect(CensorReplyRestore._normalizePrompt(null)).toBe('');
        });

        it('returns empty string for non-string input (number)', () => {
            expect(CensorReplyRestore._normalizePrompt(42)).toBe('');
        });

        it('returns empty string for non-string input (object)', () => {
            expect(CensorReplyRestore._normalizePrompt({})).toBe('');
        });

        it('does not modify already-clean text', () => {
            expect(CensorReplyRestore._normalizePrompt('hello world')).toBe('hello world');
        });

        it('returns empty string for empty string', () => {
            expect(CensorReplyRestore._normalizePrompt('')).toBe('');
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // New tests: _getMessageIdFromElement, _resolveMessageIdFromStorage,
    // _storedRecordsApplied guard, Gap A/B/C/F/G
    // ─────────────────────────────────────────────────────────────────

    /**
     * Shared DOM helper: builds a user+assistant chat pair in a virtual list container.
     * Returns the assistant message element.
     */
    function buildChatPair(assistantKey, userPromptText, { censored = true } = {}) {
        const container = document.createElement('div');
        container.className = 'ds-virtual-list-visible-items';

        const userItem = document.createElement('div');
        userItem.setAttribute('data-virtual-list-item-key', 'user-' + assistantKey);
        const userMsg = document.createElement('div');
        userMsg.className = 'ds-message';
        const userContent = document.createElement('div');
        userContent.className = 'fbb737a4';
        userContent.textContent = userPromptText;
        userMsg.appendChild(userContent);
        userItem.appendChild(userMsg);
        container.appendChild(userItem);

        const asstItem = document.createElement('div');
        asstItem.setAttribute('data-virtual-list-item-key', assistantKey);
        const asstMsg = document.createElement('div');
        asstMsg.className = 'ds-message _63c77b1';
        const mainContent = document.createElement('div');
        mainContent.className = 'ds-markdown ds-assistant-message-main-content';
        mainContent.textContent = 'censored text';
        asstMsg.appendChild(mainContent);
        asstItem.appendChild(asstMsg);

        // Toolbar — censored pattern: buttons[1] and buttons[4] disabled
        const toolbar = document.createElement('div');
        toolbar.className = 'ds-flex';
        for (const state of ['enabled', 'disabled', 'enabled', 'enabled', 'disabled']) {
            const btn = document.createElement('button');
            btn.className = 'ds-icon-button';
            if (state === 'disabled' && censored) {
                btn.classList.add('ds-icon-button--disabled');
                btn.setAttribute('aria-disabled', 'true');
            }
            toolbar.appendChild(btn);
        }
        asstItem.appendChild(toolbar);
        container.appendChild(asstItem);

        document.body.appendChild(container);
        return asstMsg;
    }

    describe('_getMessageIdFromElement()', () => {
        beforeEach(() => {
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._storedRecordsApplied = false;
            document.body.innerHTML = '';
            vi.restoreAllMocks();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('(1) _keyToMessageId hit returns id WITHOUT consuming _pendingQueue', () => {
            const msgEl = buildChatPair('asst-key1', 'hello');
            const asstItem = document.querySelector('[data-virtual-list-item-key="asst-key1"]');
            CensorReplyRestore._keyToMessageId.set('asst-key1', 777);
            CensorReplyRestore._pendingQueue = [888];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(777);
            // Queue must NOT have been consumed
            expect(CensorReplyRestore._pendingQueue).toEqual([888]);
        });

        it('(2) storage match takes precedence over non-empty _pendingQueue — queue NOT consumed', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/aaaaaaaa-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-key2', 'storage prompt');
            CensorReplyRestore._restoredMessages = {
                '500': {
                    message_id: 500, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'stored' }],
                    chat_session_id: 'aaaaaaaa-0000-0000-0000-000000000001',
                    prompt_key: 'storage prompt',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [999];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(500);
            // Queue must NOT have been consumed
            expect(CensorReplyRestore._pendingQueue).toEqual([999]);
        });

        it('(3) queue fallback used only when both map and storage miss', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/bbbbbbbb-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-key3', 'no match prompt');
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._pendingQueue = [321];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(321);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('(4) all empty → returns null', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/cccccccc-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-key4', 'nothing here');
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._pendingQueue = [];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBeNull();
        });

        // ── v2.8.12 queue-purge and queue-validation tests ──────────────────────

        it('(5) map-path purge: resolving via map removes that id from queue, leaving other ids intact', () => {
            // _keyToMessageId maps 'asst-purge1' -> 11; queue contains [11, 22]
            // After resolution, 11 must be purged; 22 must remain.
            const msgEl = buildChatPair('asst-purge1', 'map purge prompt');
            CensorReplyRestore._keyToMessageId.set('asst-purge1', 11);
            CensorReplyRestore._pendingQueue = [11, 22];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(11);
            expect(CensorReplyRestore._pendingQueue).toEqual([22]);
        });

        it('(6) map-path purge: when resolved id is absent from queue, queue is unchanged', () => {
            const msgEl = buildChatPair('asst-purge2', 'map purge absent prompt');
            CensorReplyRestore._keyToMessageId.set('asst-purge2', 33);
            CensorReplyRestore._pendingQueue = [44, 55];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(33);
            expect(CensorReplyRestore._pendingQueue).toEqual([44, 55]);
        });

        it('(7) storage-path purge: resolving via storage removes that id from queue, leaving other ids intact', () => {
            // Storage resolves to id=66; queue contains [66, 77]
            // After resolution, 66 must be purged; 77 must remain.
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/dddddddd-1111-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-purge3', 'storage purge prompt');
            CensorReplyRestore._restoredMessages = {
                '66': {
                    message_id: 66, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'purge test' }],
                    chat_session_id: 'dddddddd-1111-0000-0000-000000000001',
                    prompt_key: 'storage purge prompt',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [66, 77];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(66);
            expect(CensorReplyRestore._pendingQueue).toEqual([77]);
        });

        it('(8) storage-path purge: when resolved id is absent from queue, queue is unchanged', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/eeeeeeee-2222-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-purge4', 'storage purge absent');
            CensorReplyRestore._restoredMessages = {
                '88': {
                    message_id: 88, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'no queue match' }],
                    chat_session_id: 'eeeeeeee-2222-0000-0000-000000000001',
                    prompt_key: 'storage purge absent',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [99, 100];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(88);
            expect(CensorReplyRestore._pendingQueue).toEqual([99, 100]);
        });

        it('(9) queue fallback rejection: prompt mismatch → returns null, queue NOT consumed', () => {
            // Candidate id=2 has stored record with prompt_key='P1';
            // element is preceded by prompt 'P2' → mismatch → null returned, queue length unchanged.
            const SESSION = 'ffff0001-0000-0000-0000-000000000001';
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            const msgEl = buildChatPair('asst-reject1', 'P2');

            const recordKey = CensorReplyRestore._recordKey(SESSION, 2);
            CensorReplyRestore._restoredMessages = {
                [recordKey]: {
                    message_id: 2, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'msg 2 content' }],
                    chat_session_id: SESSION,
                    prompt_key: 'P1',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [2];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBeNull();
            // Queue must NOT have been consumed — length still 1
            expect(CensorReplyRestore._pendingQueue).toHaveLength(1);
            expect(CensorReplyRestore._pendingQueue[0]).toBe(2);
        });

        it('(10) queue fallback acceptance — prompt keys match: shifts and returns id', () => {
            const SESSION = 'aaaa0011-0000-0000-0000-000000000001';
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            const msgEl = buildChatPair('asst-accept1', 'matching prompt');

            const recordKey = CensorReplyRestore._recordKey(SESSION, 5);
            CensorReplyRestore._restoredMessages = {
                [recordKey]: {
                    message_id: 5, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'correct content' }],
                    chat_session_id: SESSION,
                    prompt_key: 'matching prompt',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [5];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(5);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('(11) queue fallback acceptance — no stored record yet: shifts and returns id (legacy last-resort)', () => {
            const SESSION = 'bbbb0022-0000-0000-0000-000000000001';
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            // Candidate id=7 has NO record in _restoredMessages → allow shift
            const msgEl = buildChatPair('asst-accept2', 'some prompt');
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._pendingQueue = [7];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(7);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('(12) queue fallback acceptance — element has no obtainable prompt key: blind shift preserved', () => {
            // Build an element with NO virtual-list-item-key ancestor so _getPrecedingUserPromptKey returns null
            // → queue fallback proceeds without validation
            const orphanMsg = document.createElement('div');
            orphanMsg.className = 'ds-message _63c77b1';
            document.body.appendChild(orphanMsg);

            CensorReplyRestore._pendingQueue = [9];

            const result = CensorReplyRestore._getMessageIdFromElement(orphanMsg);

            expect(result).toBe(9);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('(13) full field regression — stale queue bug scenario end-to-end', () => {
            // Simulates the exact field failure scenario:
            // msg2 resolves via storage (stale queue entry must be purged).
            // Then msg6's censored element appears before its fragment → must resolve null (not stale 2).
            // Then msg6's fragment arrives, re-scan injects correctly.
            const SESSION = 'cccc0033-0000-0000-0000-000000000001';
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;
            CensorReplyRestore.enabled = true;

            // --- Phase 1: element A (msg2) appears; queue/map/storage all empty → null ---
            const elA = buildChatPair('asst-msg2', 'Prompt P1');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};
            expect(CensorReplyRestore._getMessageIdFromElement(elA)).toBeNull();

            // --- Phase 2: fragment for msg2 arrives (censored, P1) ---
            // Directly set up as _onFragmentComplete would — save record and push queue
            const keyMsg2 = CensorReplyRestore._recordKey(SESSION, 2);
            CensorReplyRestore._restoredMessages[keyMsg2] = {
                message_id: 2, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'msg2 content' }],
                chat_session_id: SESSION,
                prompt_key: 'Prompt P1',
                restored_at: 100
            };
            CensorReplyRestore._pendingQueue = [2];

            // --- Phase 3: re-scan element A resolves via storage → queue must be purged ---
            const idA = CensorReplyRestore._getMessageIdFromElement(elA);
            expect(idA).toBe(2);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0); // purged!

            // --- Phase 4: element B (msg6) appears BEFORE its fragment → must resolve null ---
            const elB = buildChatPair('asst-msg6', 'Prompt P2');
            expect(CensorReplyRestore._getMessageIdFromElement(elB)).toBeNull();
            // Queue still empty — not erroneously populated
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);

            // --- Phase 5: fragment for msg6 arrives ---
            const keyMsg6 = CensorReplyRestore._recordKey(SESSION, 6);
            CensorReplyRestore._restoredMessages[keyMsg6] = {
                message_id: 6, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'msg6 content' }],
                chat_session_id: SESSION,
                prompt_key: 'Prompt P2',
                restored_at: 200
            };
            CensorReplyRestore._pendingQueue = [6];

            // --- Phase 6: re-scan element B resolves to msg6 (storage path) → correct injection ---
            const idB = CensorReplyRestore._getMessageIdFromElement(elB);
            expect(idB).toBe(6);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);

            // Confirm element A was NOT assigned msg6's id
            expect(idA).toBe(2);
        });
    });

    describe('_resolveMessageIdFromStorage()', () => {
        beforeEach(() => {
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._storedRecordsApplied = false;
            document.body.innerHTML = '';
            vi.restoreAllMocks();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('match by session+prompt_key returns id and writes into _keyToMessageId', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/dddddddd-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r1', 'What is AI?');
            CensorReplyRestore._restoredMessages = {
                '600': {
                    message_id: 600, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'AI is...' }],
                    chat_session_id: 'dddddddd-0000-0000-0000-000000000001',
                    prompt_key: 'What is AI?',
                    restored_at: 1000
                }
            };

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(result).toBe(600);
            expect(CensorReplyRestore._keyToMessageId.get('asst-r1')).toBe(600);
            // Queue must remain untouched
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('no match → returns null', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/eeeeeeee-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r2', 'something else');
            CensorReplyRestore._restoredMessages = {
                '601': {
                    message_id: 601, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: 'eeeeeeee-0000-0000-0000-000000000001',
                    prompt_key: 'different prompt',
                    restored_at: 1000
                }
            };

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(result).toBeNull();
        });

        it('wrong session → returns null', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/ffffffff-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r3', 'hello');
            CensorReplyRestore._restoredMessages = {
                '602': {
                    message_id: 602, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: '00000000-0000-0000-0000-000000000099',
                    prompt_key: 'hello',
                    restored_at: 1000
                }
            };

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(result).toBeNull();
        });

        it('messageId already claimed in _keyToMessageId → skipped, returns null', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/11111111-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r4', 'hello again');
            CensorReplyRestore._restoredMessages = {
                '603': {
                    message_id: 603, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: '11111111-0000-0000-0000-000000000001',
                    prompt_key: 'hello again',
                    restored_at: 1000
                }
            };
            // 603 is already claimed by another virtual item key
            CensorReplyRestore._keyToMessageId.set('some-other-key', 603);

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(result).toBeNull();
        });

        it('_pendingQueue is never mutated by _resolveMessageIdFromStorage', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/22222222-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r5', 'do not touch queue');
            CensorReplyRestore._restoredMessages = {
                '604': {
                    message_id: 604, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: '22222222-0000-0000-0000-000000000001',
                    prompt_key: 'do not touch queue',
                    restored_at: 1000
                }
            };
            CensorReplyRestore._pendingQueue = [701, 702];

            CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(CensorReplyRestore._pendingQueue).toEqual([701, 702]);
        });
    });

    describe('Gap A — post-refresh: _tryRestoreMessage injects from stored records', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('restores censored message on first call after refresh (empty queue, empty keyMap)', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/33333333-0000-0000-0000-000000000001');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._storedRecordsApplied = false;
            document.body.innerHTML = '';

            // Use session-scoped key format (v2.8.11+): "{sessionId}::{messageId}"
            CensorReplyRestore._restoredMessages = {
                '33333333-0000-0000-0000-000000000001::700': {
                    message_id: 700, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Restored answer' }],
                    chat_session_id: '33333333-0000-0000-0000-000000000001',
                    prompt_key: 'What is quantum computing?',
                    restored_at: 500
                }
            };

            const msgEl = buildChatPair('asst-refresh1', 'What is quantum computing?');

            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(msgEl.querySelector('.restored-content')).not.toBeNull();
            expect(msgEl.querySelector('.restored-content').innerHTML).toContain('Restored answer');
        });
    });

    describe('Gap C — idempotency: second _tryRestoreMessage does not double-inject', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('second invocation on already-restored element produces exactly one .restored-content node', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/44444444-0000-0000-0000-000000000001');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._storedRecordsApplied = false;
            document.body.innerHTML = '';

            // Use session-scoped key format (v2.8.11+): "{sessionId}::{messageId}"
            CensorReplyRestore._restoredMessages = {
                '44444444-0000-0000-0000-000000000001::800': {
                    message_id: 800, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Idempotent answer' }],
                    chat_session_id: '44444444-0000-0000-0000-000000000001',
                    prompt_key: 'Idempotent prompt',
                    restored_at: 600
                }
            };

            const msgEl = buildChatPair('asst-idem1', 'Idempotent prompt');

            CensorReplyRestore._tryRestoreMessage(msgEl);
            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(msgEl.querySelectorAll('.restored-content')).toHaveLength(1);
        });
    });

    describe('Gap B — cold start: applyToExisting() with stored records injects correctly', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('applyToExisting with populated storage and empty runtime maps injects into all censored messages', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/55555555-0000-0000-0000-000000000001');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._storedRecordsApplied = false;
            document.body.innerHTML = '';

            CensorReplyRestore._restoredMessages = {
                '901': {
                    message_id: 901, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Cold start answer 1' }],
                    chat_session_id: '55555555-0000-0000-0000-000000000001',
                    prompt_key: 'Cold prompt 1',
                    restored_at: 700
                },
                '902': {
                    message_id: 902, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Cold start answer 2' }],
                    chat_session_id: '55555555-0000-0000-0000-000000000001',
                    prompt_key: 'Cold prompt 2',
                    restored_at: 800
                }
            };

            buildChatPair('asst-cold1', 'Cold prompt 1');
            buildChatPair('asst-cold2', 'Cold prompt 2');

            CensorReplyRestore.applyToExisting();

            const msgEls = document.querySelectorAll('.ds-message._63c77b1');
            for (const el of msgEls) {
                expect(el.querySelector('.restored-content')).not.toBeNull();
            }
        });
    });

    describe('_storedRecordsApplied guard semantics', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('is true after full scan is triggered (messageId not resolvable via map or storage, but stored records exist)', () => {
            // Scenario: _resolveMessageIdFromStorage returns null (no prompt_key ancestor for this element),
            // so _getMessageIdFromElement returns null, triggering _tryRestoreFromStoredRecords via the fallback.
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/66666666-0000-0000-0000-000000000001');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._storedRecordsApplied = false;
            document.body.innerHTML = '';

            CensorReplyRestore._restoredMessages = {
                '1001': {
                    message_id: 1001, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'guard test' }],
                    chat_session_id: '66666666-0000-0000-0000-000000000001',
                    prompt_key: 'Guard test prompt',
                    restored_at: 900
                }
            };

            // Build a censored assistant msg WITH a user sibling so _tryRestoreFromStoredRecords can match it,
            // but WITHOUT a virtual-item key ancestor so that _getPrecedingUserPromptKey returns null
            // (causing _resolveMessageIdFromStorage to return null → messageId null → full scan triggered).
            const orphanContainer = document.createElement('div');
            // No data-virtual-list-item-key on the container

            const userItem = document.createElement('div');
            userItem.setAttribute('data-virtual-list-item-key', 'user-guard1');
            const userMsg = document.createElement('div');
            userMsg.className = 'ds-message';
            const userContent = document.createElement('div');
            userContent.className = 'fbb737a4';
            userContent.textContent = 'Guard test prompt';
            userMsg.appendChild(userContent);
            userItem.appendChild(userMsg);
            orphanContainer.appendChild(userItem);

            // The assistant item has a virtual-list key (needed so _tryRestoreFromStoredRecords can find it)
            // but the msgEl itself has NO data-virtual-list-item-key ANCESTOR at the time
            // _resolveMessageIdFromStorage is called (we'll detach and re-attach to simulate).
            // Simpler: just build the pair normally and mock _resolveMessageIdFromStorage to return null.
            const asstItem = document.createElement('div');
            asstItem.setAttribute('data-virtual-list-item-key', 'asst-guard1');
            const msgEl = document.createElement('div');
            msgEl.className = 'ds-message _63c77b1';
            const mainContent = document.createElement('div');
            mainContent.className = 'ds-markdown ds-assistant-message-main-content';
            mainContent.textContent = 'censored';
            msgEl.appendChild(mainContent);
            asstItem.appendChild(msgEl);

            const toolbar = document.createElement('div');
            toolbar.className = 'ds-flex';
            for (const state of ['enabled', 'disabled', 'enabled', 'enabled', 'disabled']) {
                const btn = document.createElement('button');
                btn.className = 'ds-icon-button';
                if (state === 'disabled') {
                    btn.classList.add('ds-icon-button--disabled');
                    btn.setAttribute('aria-disabled', 'true');
                }
                toolbar.appendChild(btn);
            }
            asstItem.appendChild(toolbar);
            orphanContainer.appendChild(asstItem);
            document.body.appendChild(orphanContainer);

            // Mock _resolveMessageIdFromStorage to return null so full-scan path is exercised
            vi.spyOn(CensorReplyRestore, '_resolveMessageIdFromStorage').mockReturnValue(null);

            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(CensorReplyRestore._storedRecordsApplied).toBe(true);
        });

        it('_onFragmentComplete resets _storedRecordsApplied to false after pushing to queue', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._storedRecordsApplied = true;
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};

            CensorReplyRestore._onFragmentComplete({
                messageId: 1100,
                fragments: [{ type: 'RESPONSE', content: 'live reply' }],
                thinkingElapsedSecs: 0,
                censored: true
            });

            expect(CensorReplyRestore._storedRecordsApplied).toBe(false);
        });
    });

    describe('Gaps F/G — _tryRestoreFromStoredRecords edge cases', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('(Gap F) returns false when session id cannot be derived from URL', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/non-chat/page');
            document.body.innerHTML = '';

            CensorReplyRestore._restoredMessages = {
                '200': {
                    message_id: 200, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: '77777777-0000-0000-0000-000000000001',
                    prompt_key: 'hello',
                    restored_at: 1000
                }
            };
            buildChatPair('asst-gapf', 'hello');

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();

            expect(result).toBe(false);
        });

        it('(Gap G) returns false when there are no unrestored censored elements in DOM', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/88888888-0000-0000-0000-000000000001');
            document.body.innerHTML = '';

            CensorReplyRestore._restoredMessages = {
                '201': {
                    message_id: 201, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'y' }],
                    chat_session_id: '88888888-0000-0000-0000-000000000001',
                    prompt_key: 'some prompt',
                    restored_at: 1000
                }
            };
            // Build a chat pair with non-censored toolbar (censored: false → buttons all enabled)
            buildChatPair('asst-gapg', 'some prompt', { censored: false });

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();

            expect(result).toBe(false);
        });
    });

    describe('_getPrecedingUserPromptKey()', () => {
        function createChatPair(assistantKey, userPromptText) {
            const container = document.createElement('div');
            container.className = 'ds-virtual-list-visible-items';

            const userItem = document.createElement('div');
            userItem.setAttribute('data-virtual-list-item-key', 'user-1');
            const userMsg = document.createElement('div');
            userMsg.className = 'ds-message';
            const userContent = document.createElement('div');
            userContent.className = 'fbb737a4';
            userContent.textContent = userPromptText;
            userMsg.appendChild(userContent);
            userItem.appendChild(userMsg);
            container.appendChild(userItem);

            const asstItem = document.createElement('div');
            asstItem.setAttribute('data-virtual-list-item-key', assistantKey);
            const asstMsg = document.createElement('div');
            asstMsg.className = 'ds-message _63c77b1';
            asstItem.appendChild(asstMsg);
            container.appendChild(asstItem);

            document.body.appendChild(container);
            return asstMsg;
        }

        beforeEach(() => {
            document.body.innerHTML = '';
        });

        it('returns normalized prompt text when preceding user message exists', () => {
            const asstMsg = createChatPair('asst-1', 'Hello world');
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstMsg)).toBe('Hello world');
        });

        it('returns null when there is no preceding sibling (first message in chat)', () => {
            const container = document.createElement('div');
            const asstItem = document.createElement('div');
            asstItem.setAttribute('data-virtual-list-item-key', 'asst-1');
            const asstMsg = document.createElement('div');
            asstMsg.className = 'ds-message _63c77b1';
            asstItem.appendChild(asstMsg);
            container.appendChild(asstItem);
            document.body.appendChild(container);
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstMsg)).toBeNull();
        });

        it('returns null when preceding message is also an assistant message (not user)', () => {
            const container = document.createElement('div');

            const prevItem = document.createElement('div');
            prevItem.setAttribute('data-virtual-list-item-key', 'asst-prev');
            const prevMsg = document.createElement('div');
            prevMsg.className = 'ds-message _63c77b1';
            prevItem.appendChild(prevMsg);
            container.appendChild(prevItem);

            const asstItem = document.createElement('div');
            asstItem.setAttribute('data-virtual-list-item-key', 'asst-1');
            const asstMsg = document.createElement('div');
            asstMsg.className = 'ds-message _63c77b1';
            asstItem.appendChild(asstMsg);
            container.appendChild(asstItem);
            document.body.appendChild(container);
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstMsg)).toBeNull();
        });

        it('handles whitespace-heavy prompt text (normalizes it)', () => {
            const asstMsg = createChatPair('asst-1', '  Hello    world  ');
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstMsg)).toBe('Hello world');
        });

        it('returns first user message when there are multiple preceding siblings', () => {
            const container = document.createElement('div');
            container.className = 'ds-virtual-list-visible-items';

            // First pair: user + assistant
            const user1 = document.createElement('div');
            user1.setAttribute('data-virtual-list-item-key', 'user-1');
            const userMsg1 = document.createElement('div');
            userMsg1.className = 'ds-message';
            const userContent1 = document.createElement('div');
            userContent1.className = 'fbb737a4';
            userContent1.textContent = 'First user';
            userMsg1.appendChild(userContent1);
            user1.appendChild(userMsg1);
            container.appendChild(user1);

            const asst1 = document.createElement('div');
            asst1.setAttribute('data-virtual-list-item-key', 'asst-1');
            const asstMsg1 = document.createElement('div');
            asstMsg1.className = 'ds-message _63c77b1';
            asst1.appendChild(asstMsg1);
            container.appendChild(asst1);

            // Second pair: user + assistant
            const user2 = document.createElement('div');
            user2.setAttribute('data-virtual-list-item-key', 'user-2');
            const userMsg2 = document.createElement('div');
            userMsg2.className = 'ds-message';
            const userContent2 = document.createElement('div');
            userContent2.className = 'fbb737a4';
            userContent2.textContent = 'Second user';
            userMsg2.appendChild(userContent2);
            user2.appendChild(userMsg2);
            container.appendChild(user2);

            const asst2 = document.createElement('div');
            asst2.setAttribute('data-virtual-list-item-key', 'asst-2');
            const asstMsg2 = document.createElement('div');
            asstMsg2.className = 'ds-message _63c77b1';
            asst2.appendChild(asstMsg2);
            container.appendChild(asst2);

            document.body.appendChild(container);

            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstMsg2)).toBe('Second user');
        });

        it('returns null when assistant msg has no data-virtual-list-item-key ancestor', () => {
            const orphanMsg = document.createElement('div');
            orphanMsg.className = 'ds-message _63c77b1';
            document.body.appendChild(orphanMsg);
            expect(CensorReplyRestore._getPrecedingUserPromptKey(orphanMsg)).toBeNull();
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // v2.8.11 session-scoped key tests
    // ─────────────────────────────────────────────────────────────────

    describe('_recordKey() — session-scoped key helper', () => {
        it('returns "{sessionId}::{messageId}" format for normal session', () => {
            expect(CensorReplyRestore._recordKey('abc-123', 42)).toBe('abc-123::42');
        });

        it('uses "nosession" prefix when sessionId is null', () => {
            expect(CensorReplyRestore._recordKey(null, 42)).toBe('nosession::42');
        });

        it('uses "nosession" prefix when sessionId is undefined', () => {
            expect(CensorReplyRestore._recordKey(undefined, 5)).toBe('nosession::5');
        });

        it('uses "nosession" prefix when sessionId is empty string', () => {
            expect(CensorReplyRestore._recordKey('', 99)).toBe('nosession::99');
        });

        it('coerces numeric messageId to string', () => {
            const key = CensorReplyRestore._recordKey('sess-1', 100);
            expect(key).toBe('sess-1::100');
        });
    });

    describe('_saveFragment() — session-scoped save and lookup round-trip', () => {
        const SESSION_A = 'aaaaaaaa-1111-1111-1111-111111111111';
        const SESSION_B = 'bbbbbbbb-2222-2222-2222-222222222222';

        beforeEach(() => {
            CensorReplyRestore._restoredMessages = {};
        });

        it('saves under session-scoped key and record is retrievable at that key', async () => {
            await CensorReplyRestore._saveFragment({
                message_id: 2,
                fragments: [{ type: 'RESPONSE', content: 'Chat A content' }],
                thinking_elapsed_secs: 0,
                chat_session_id: SESSION_A,
                prompt_key: 'What is AI?'
            });

            const expectedKey = SESSION_A + '::2';
            expect(CensorReplyRestore._restoredMessages[expectedKey]).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[expectedKey].fragments[0].content).toBe('Chat A content');
        });

        it('cross-chat collision regression: chat A and chat B both save message_id=2, keys are distinct', async () => {
            await CensorReplyRestore._saveFragment({
                message_id: 2,
                fragments: [{ type: 'RESPONSE', content: 'Chat A content' }],
                thinking_elapsed_secs: 0,
                chat_session_id: SESSION_A,
                prompt_key: 'prompt A'
            });
            await CensorReplyRestore._saveFragment({
                message_id: 2,
                fragments: [{ type: 'RESPONSE', content: 'Chat B content' }],
                thinking_elapsed_secs: 0,
                chat_session_id: SESSION_B,
                prompt_key: 'prompt B'
            });

            const keyA = SESSION_A + '::2';
            const keyB = SESSION_B + '::2';
            expect(CensorReplyRestore._restoredMessages[keyA].fragments[0].content).toBe('Chat A content');
            expect(CensorReplyRestore._restoredMessages[keyB].fragments[0].content).toBe('Chat B content');
        });

        it('record saved under session A is NOT found when looking up under session B key', async () => {
            await CensorReplyRestore._saveFragment({
                message_id: 2,
                fragments: [{ type: 'RESPONSE', content: 'Chat A only' }],
                thinking_elapsed_secs: 0,
                chat_session_id: SESSION_A,
                prompt_key: 'prompt'
            });

            const wrongKey = SESSION_B + '::2';
            expect(CensorReplyRestore._restoredMessages[wrongKey]).toBeUndefined();
        });
    });

    describe('_loadRestoredMessages() — legacy key migration', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('bare-key records are re-keyed using embedded chat_session_id', async () => {
            const SESSION = '11112222-3333-4444-5555-666677778888';
            const storedData = {
                '55': {
                    message_id: 55, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'migrated content' }],
                    chat_session_id: SESSION
                }
            };
            await new Promise((resolve) => { chrome.storage.local.set({ restored_messages: storedData }, resolve); });

            await CensorReplyRestore._loadRestoredMessages();

            // Bare key must be gone; session-scoped key must exist
            expect(CensorReplyRestore._restoredMessages['55']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages[SESSION + '::55']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[SESSION + '::55'].fragments[0].content).toBe('migrated content');
        });

        it('bare-key record with null chat_session_id migrates to "nosession::{messageId}"', async () => {
            const storedData = {
                '99': {
                    message_id: 99, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'no-session content' }],
                    chat_session_id: null
                }
            };
            await new Promise((resolve) => { chrome.storage.local.set({ restored_messages: storedData }, resolve); });

            await CensorReplyRestore._loadRestoredMessages();

            expect(CensorReplyRestore._restoredMessages['99']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['nosession::99']).toBeDefined();
        });

        it('nosession record never matches a live session element via _resolveMessageIdFromStorage', async () => {
            const storedData = {
                '77': {
                    message_id: 77, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'null session content' }],
                    chat_session_id: null,
                    prompt_key: 'test prompt'
                }
            };
            await new Promise((resolve) => { chrome.storage.local.set({ restored_messages: storedData }, resolve); });
            await CensorReplyRestore._loadRestoredMessages();

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/a1b2c3d4-0000-0000-0000-000000000001');
            document.body.innerHTML = '';
            const msgEl = buildChatPair('asst-nosess', 'test prompt');

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);
            expect(result).toBeNull();
        });

        it('already session-scoped keys (contain "::") are preserved unchanged', async () => {
            const SESSION = 'aabbccdd-0000-0000-0000-000000000001';
            const storedData = {
                [SESSION + '::33']: {
                    message_id: 33, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'already scoped' }],
                    chat_session_id: SESSION
                }
            };
            await new Promise((resolve) => { chrome.storage.local.set({ restored_messages: storedData }, resolve); });

            await CensorReplyRestore._loadRestoredMessages();

            expect(CensorReplyRestore._restoredMessages[SESSION + '::33']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[SESSION + '::33'].fragments[0].content).toBe('already scoped');
        });
    });

    describe('Null-session strictness', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('_resolveMessageIdFromStorage returns null when URL has no session id', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/other/path');
            document.body.innerHTML = '';
            const msgEl = buildChatPair('asst-ns1', 'a prompt');
            CensorReplyRestore._restoredMessages = {
                'nosession::10': {
                    message_id: 10, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'null-session data' }],
                    chat_session_id: null,
                    prompt_key: 'a prompt',
                    restored_at: 100
                }
            };

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);
            expect(result).toBeNull();
        });

        it('_tryRestoreFromStoredRecords does not inject when current URL has no session id', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/other/path');
            document.body.innerHTML = '';
            buildChatPair('asst-ns2', 'a prompt');
            CensorReplyRestore._restoredMessages = {
                'nosession::20': {
                    message_id: 20, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'should not inject' }],
                    chat_session_id: null,
                    prompt_key: 'a prompt',
                    restored_at: 100
                }
            };

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(false);
            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });
    });

    describe('_checkSessionChange() — clearing rules', () => {
        it('(a) null → non-null: preserves _pendingQueue and _keyToMessageId, updates _currentSessionId', () => {
            // All session IDs must match /[a-f0-9-]+/ (hex chars and dash only)
            const NEW_SESSION = 'a0000001-0000-0000-0000-000000000001';
            CensorReplyRestore._currentSessionId = null;
            CensorReplyRestore._pendingQueue = [10, 20];
            CensorReplyRestore._keyToMessageId.set('k1', 10);
            CensorReplyRestore._storedRecordsApplied = true;

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + NEW_SESSION);
            CensorReplyRestore._checkSessionChange();

            expect(CensorReplyRestore._currentSessionId).toBe(NEW_SESSION);
            // Queue and map must be preserved (first message may already be in queue)
            expect(CensorReplyRestore._pendingQueue).toEqual([10, 20]);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(1);
            // _storedRecordsApplied is NOT reset on null→non-null
            expect(CensorReplyRestore._storedRecordsApplied).toBe(true);

            vi.restoreAllMocks();
        });

        it('(b) non-null → different non-null: clears _pendingQueue, _keyToMessageId, and resets _storedRecordsApplied', () => {
            const OLD_SESSION = 'b0000001-0000-0000-0000-000000000001';
            const DIFF_SESSION = 'b0000002-0000-0000-0000-000000000002';
            CensorReplyRestore._currentSessionId = OLD_SESSION;
            CensorReplyRestore._pendingQueue = [5, 6];
            CensorReplyRestore._keyToMessageId.set('k2', 5);
            CensorReplyRestore._storedRecordsApplied = true;

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + DIFF_SESSION);
            CensorReplyRestore._checkSessionChange();

            expect(CensorReplyRestore._currentSessionId).toBe(DIFF_SESSION);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(0);
            expect(CensorReplyRestore._storedRecordsApplied).toBe(false);

            vi.restoreAllMocks();
        });

        it('(c) non-null → null (navigated away from chat): clears runtime state', () => {
            const SOME_SESSION = 'c0000001-0000-0000-0000-000000000001';
            CensorReplyRestore._currentSessionId = SOME_SESSION;
            CensorReplyRestore._pendingQueue = [7];
            CensorReplyRestore._keyToMessageId.set('k3', 7);
            CensorReplyRestore._storedRecordsApplied = true;

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/other/page');
            CensorReplyRestore._checkSessionChange();

            expect(CensorReplyRestore._currentSessionId).toBeNull();
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(0);
            expect(CensorReplyRestore._storedRecordsApplied).toBe(false);

            vi.restoreAllMocks();
        });

        it('(d) same session → no-op: nothing is cleared', () => {
            const STABLE_SESSION = 'd0000001-0000-0000-0000-000000000001';
            CensorReplyRestore._currentSessionId = STABLE_SESSION;
            CensorReplyRestore._pendingQueue = [1, 2, 3];
            CensorReplyRestore._keyToMessageId.set('k4', 1);
            CensorReplyRestore._storedRecordsApplied = true;

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + STABLE_SESSION);
            CensorReplyRestore._checkSessionChange();

            expect(CensorReplyRestore._currentSessionId).toBe(STABLE_SESSION);
            expect(CensorReplyRestore._pendingQueue).toEqual([1, 2, 3]);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(1);
            expect(CensorReplyRestore._storedRecordsApplied).toBe(true);

            vi.restoreAllMocks();
        });
    });

    describe('SPA contamination regression: chat switch must not inject stale content', () => {
        const SESSION_A = 'aaaa0001-0000-0000-0000-000000000001';
        const SESSION_B = 'bbbb0002-0000-0000-0000-000000000002';

        afterEach(() => {
            vi.restoreAllMocks();
            document.body.innerHTML = '';
        });

        it('after switching from chat A to chat B, censored element with same virtual key must NOT get chat A content', () => {
            // Step 1: Chat A — restore message_id=2 (map entry set, record stored under A)
            CensorReplyRestore._currentSessionId = SESSION_A;
            CensorReplyRestore._keyToMessageId.set('2', 2);
            CensorReplyRestore._restoredMessages[SESSION_A + '::2'] = {
                message_id: 2, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'Chat A content for message 2' }],
                chat_session_id: SESSION_A,
                prompt_key: 'chat A question',
                restored_at: 100
            };
            CensorReplyRestore._storedRecordsApplied = true;

            // Step 2: URL changes to chat B — simulate _checkSessionChange
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION_B);
            CensorReplyRestore._checkSessionChange();

            // Verify runtime state was cleared
            expect(CensorReplyRestore._keyToMessageId.size).toBe(0);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
            expect(CensorReplyRestore._storedRecordsApplied).toBe(false);
            expect(CensorReplyRestore._currentSessionId).toBe(SESSION_B);

            // Step 3: Build chat B DOM with same virtual-item-key "2" and a different prompt
            document.body.innerHTML = '';
            buildChatPair('2', 'chat B question');

            // Step 4: Attempt restore — chat B record does NOT exist, so nothing should be injected
            const msgEl = document.querySelector('.ds-message._63c77b1');
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });

        it('after switch, a censored element whose prompt does not match any chat B record must not be injected', () => {
            // Only chat A record exists for a given prompt
            CensorReplyRestore._currentSessionId = SESSION_A;
            CensorReplyRestore._restoredMessages[SESSION_A + '::5'] = {
                message_id: 5, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'Chat A only' }],
                chat_session_id: SESSION_A,
                prompt_key: 'only in A',
                restored_at: 100
            };

            // Switch to chat B
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION_B);
            CensorReplyRestore._checkSessionChange();

            document.body.innerHTML = '';
            // In chat B, we have a censored element with a prompt that matches chat A's prompt
            buildChatPair('asst-chatb', 'only in A');

            const msgEl = document.querySelector('.ds-message._63c77b1');
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._tryRestoreMessage(msgEl);

            // Must NOT inject chat A's content into chat B
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });
    });

    describe('Live-XHR happy path with session scoping', () => {
        const SESSION = 'aabb0001-0000-0000-0000-000000000001';

        afterEach(() => {
            vi.restoreAllMocks();
            document.body.innerHTML = '';
        });

        it('fragment complete with matching chatSessionId saves and allows restore of censored element', async () => {
            CensorReplyRestore.enabled = true;
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);

            // Simulate _checkSessionChange acquiring session
            CensorReplyRestore._checkSessionChange();
            expect(CensorReplyRestore._currentSessionId).toBe(SESSION);

            // Fire live fragment
            CensorReplyRestore._onFragmentComplete({
                messageId: 300,
                fragments: [{ type: 'RESPONSE', content: 'live XHR content' }],
                thinkingElapsedSecs: 0,
                censored: true,
                chatSessionId: SESSION,
                promptText: 'live question'
            });

            // Record must be saved under session-scoped key
            const key = SESSION + '::300';
            expect(CensorReplyRestore._restoredMessages[key]).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[key].chat_session_id).toBe(SESSION);
            expect(CensorReplyRestore._restoredMessages[key].fragments[0].content).toBe('live XHR content');

            // Build censored DOM element and restore it
            document.body.innerHTML = '';
            buildChatPair('asst-live', 'live question');
            const msgEl = document.querySelector('.ds-message._63c77b1');

            // _pendingQueue has [300] from _onFragmentComplete
            expect(CensorReplyRestore._pendingQueue).toContain(300);

            // Attempt restore via _tryRestoreMessage (uses queue path → record lookup via session key)
            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(msgEl.querySelector('.restored-content')).not.toBeNull();
            expect(msgEl.querySelector('.restored-content').innerHTML).toContain('live XHR content');
        });
    });

    describe('Refresh-restore path with session-scoped storage', () => {
        const SESSION = 'ccdd0001-0000-0000-0000-000000000001';

        afterEach(() => {
            vi.restoreAllMocks();
            document.body.innerHTML = '';
        });

        it('storage pre-populated with session-scoped records for current session → observer-path restore succeeds', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            // Pre-populate as if _loadRestoredMessages already ran (session-scoped keys)
            CensorReplyRestore._restoredMessages = {
                [SESSION + '::400']: {
                    message_id: 400, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'refresh restored content' }],
                    chat_session_id: SESSION,
                    prompt_key: 'refresh question',
                    restored_at: 1000
                }
            };

            document.body.innerHTML = '';
            buildChatPair('asst-refresh2', 'refresh question');

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(true);

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).not.toBeNull();
            expect(msgEl.querySelector('.restored-content').innerHTML).toContain('refresh restored content');
        });

        it('records from a different session in storage are not injected on refresh', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            const OTHER_SESSION = 'eeee0002-0000-0000-0000-000000000001';
            CensorReplyRestore._restoredMessages = {
                [OTHER_SESSION + '::401']: {
                    message_id: 401, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'other session content' }],
                    chat_session_id: OTHER_SESSION,
                    prompt_key: 'refresh question',
                    restored_at: 1000
                }
            };

            document.body.innerHTML = '';
            buildChatPair('asst-refresh3', 'refresh question');

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(false);

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });
    });

});
