import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * DOM inspection: censored-toolbar detection, toolbar lookup, and reading
 * the preceding user prompt out of the virtual list.
 *
 * Split out of the original censor-reply-restore.spec.js monolith; every case
 * below is the unchanged original assertion set.
 */
describe('CensorReplyRestore — censored-reply DOM detection', () => {
    beforeEach(resetCensorReplyRestore);

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
        // True parameter variation: same builder, same assertion, differing button states/expectation.

        it.each([
            ['returns true when buttons[1] and buttons[4] both have ds-icon-button--disabled + aria-disabled', ['enabled', 'disabled', 'enabled', 'enabled', 'disabled'], true],
            ['returns false when button[1] is enabled', ['enabled', 'enabled', 'enabled', 'enabled', 'disabled'], false],
            ['returns false when button[4] is enabled', ['enabled', 'disabled', 'enabled', 'enabled', 'enabled'], false],
            ['returns false when there are fewer than 5 buttons', ['enabled', 'disabled', 'enabled'], false]
        ])('(legacy) %s', (_name, btnStates, expected) => {
            const toolbar = createLegacyToolbar(btnStates);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(expected);
        });

        // ── New DOM tests ──────────────────────────────────────────────────────

        it.each([
            // Mirrors real chat-area.html: buttons[1] has aria-disabled, buttons[4] does NOT
            ['returns true when buttons[1] has ds-button--disabled + aria-disabled and buttons[4] has ds-button--disabled WITHOUT aria-disabled', ['enabled', 'disabled', 'enabled', 'enabled', 'disabled-no-aria'], true],
            ['returns true when both buttons[1] and buttons[4] have ds-button--disabled + aria-disabled', ['enabled', 'disabled', 'enabled', 'enabled', 'disabled'], true],
            ['returns true when both buttons[1] and buttons[4] have only ds-button--disabled (no aria-disabled on either)', ['enabled', 'disabled-no-aria', 'enabled', 'enabled', 'disabled-no-aria'], true],
            ['returns false when no buttons are disabled', ['enabled', 'enabled', 'enabled', 'enabled', 'enabled'], false],
            ['returns false when only buttons[1] is disabled but buttons[4] is not', ['enabled', 'disabled', 'enabled', 'enabled', 'enabled'], false],
            ['returns false when only buttons[4] is disabled but buttons[1] is not', ['enabled', 'enabled', 'enabled', 'enabled', 'disabled-no-aria'], false],
            ['returns false when there are fewer than 5 new-style buttons', ['enabled', 'disabled', 'enabled'], false]
        ])('(new DOM) %s', (_name, btnStates, expected) => {
            const toolbar = createNewDomToolbar(btnStates);
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(expected);
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
});
