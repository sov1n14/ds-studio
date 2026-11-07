import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import {
    resetCensorReplyRestore,
    buildChatPair,
    createUserItem,
    createAssistantItem,
    toolbarButtonsOf,
    mountVisibleItems
} from '../helpers/censor-reply-restore-fixtures.js';

/**
 * DOM inspection: censored-toolbar detection, toolbar lookup, and reading
 * the preceding user prompt out of the virtual list.
 *
 * Split out of the original censor-reply-restore.spec.js monolith. Toolbar-lookup and prompt-lookup cases run on live DeepSeek markup from the shared fixtures helper.
 */
describe('CensorReplyRestore — censored-reply DOM detection', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_isCensored()', () => {
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
        // Fixtures are live DeepSeek markup (test/helpers/censor-reply-restore-fixtures.js). The expected toolbar group is identified structurally, as the shared parent of the assistant item's toolbar buttons.

        function mountAssistantItem(key) {
            const item = createAssistantItem(key, { censored: false });
            mountVisibleItems().appendChild(item);
            const buttons = toolbarButtonsOf(item);
            return { item, msgEl: item.querySelector('.ds-message'), buttons, group: buttons[0].parentElement };
        }

        it('finds the toolbar group of a finished assistant reply, not its outer .ds-flex wrapper', () => {
            const { msgEl, group } = mountAssistantItem('asst-1');
            const result = CensorReplyRestore._getToolbarGroup(msgEl);
            expect(result).toBe(group);
            expect(result).not.toBe(group.parentElement);
        });

        it('returns null for a user message, whose edit/copy row holds only 2 buttons', () => {
            const userItem = createUserItem('user-1', 'Hello');
            mountVisibleItems().appendChild(userItem);
            expect(CensorReplyRestore._getToolbarGroup(userItem.querySelector('.ds-message'))).toBeNull();
        });

        it('returns null while the reply is streaming (live page renders no toolbar wrapper yet)', () => {
            const { msgEl, group } = mountAssistantItem('asst-2');
            group.parentElement.remove();
            expect(CensorReplyRestore._getToolbarGroup(msgEl)).toBeNull();
        });
    });

    describe('_getPrecedingUserPromptKey()', () => {
        it('returns normalized prompt text when preceding user message exists', () => {
            const asstMsg = buildChatPair('asst-1', 'Hello world');
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstMsg)).toBe('Hello world');
        });

        it('returns null when there is no preceding sibling (first message in chat)', () => {
            const asstItem = createAssistantItem('asst-1');
            mountVisibleItems().appendChild(asstItem);
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstItem.querySelector('.ds-message'))).toBeNull();
        });

        it('returns null when preceding message is also an assistant message (not user)', () => {
            const container = mountVisibleItems();
            container.appendChild(createAssistantItem('asst-prev'));
            const asstItem = createAssistantItem('asst-1');
            container.appendChild(asstItem);
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstItem.querySelector('.ds-message'))).toBeNull();
        });

        it('handles whitespace-heavy prompt text (normalizes it)', () => {
            const asstMsg = buildChatPair('asst-1', '  Hello    world  ');
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstMsg)).toBe('Hello world');
        });

        it('returns the nearest preceding user message when there are multiple preceding turns', () => {
            buildChatPair('asst-1', 'First user');
            const asstMsg2 = buildChatPair('asst-2', 'Second user');
            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstMsg2)).toBe('Second user');
        });

        it('returns null when assistant msg has no data-virtual-list-item-key ancestor', () => {
            const orphanMsg = createAssistantItem('asst-1').querySelector('.ds-message');
            document.body.appendChild(orphanMsg);
            expect(CensorReplyRestore._getPrecedingUserPromptKey(orphanMsg)).toBeNull();
        });
    });
});

// ---------------------------------------------------------------------------
// Mutant-killing boundary and fallback tests
// ---------------------------------------------------------------------------

describe('CensorReplyRestore — mutant-killing boundary tests', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('_isCensored() — exactly 4 buttons boundary (kills < 5 → < 4 mutant)', () => {
        it('returns false when toolbar has exactly 4 buttons with censored pattern positions', () => {
            const toolbar = document.createElement('div');
            toolbar.className = 'ds-flex _965abe9 _54866f7';
            // 4 buttons: [enabled, disabled, enabled, disabled]
            // Even though buttons[1] is disabled, there are only 4 buttons total (< 5)
            const states = ['enabled', 'disabled', 'enabled', 'disabled'];
            for (const state of states) {
                const btn = document.createElement('div');
                btn.setAttribute('role', 'button');
                btn.className = 'ds-button ds-button--icon';
                if (state === 'disabled') {
                    btn.classList.add('ds-button--disabled');
                }
                toolbar.appendChild(btn);
            }
            expect(CensorReplyRestore._isCensored(toolbar)).toBe(false);
        });
    });

    describe('_getToolbarGroup() — parentElement fallback path', () => {
        it('finds the toolbar group via parentElement when no [data-virtual-list-item-key] ancestor exists', () => {
            // Live assistant item with only its virtual-list key removed: closest() finds nothing, so lookup scopes to messageEl.parentElement (the item itself).
            const item = createAssistantItem('asst-1');
            item.removeAttribute('data-virtual-list-item-key');
            document.body.appendChild(item);
            const group = toolbarButtonsOf(item)[0].parentElement;

            expect(CensorReplyRestore._getToolbarGroup(item.querySelector('.ds-message'))).toBe(group);
        });
    });

    describe('_getToolbarGroup() — exactly 4 icon buttons boundary (kills >= 5 → >= 4 mutant)', () => {
        it('returns null when the toolbar group holds exactly 4 icon buttons', () => {
            // Live assistant item with the last 2 of its 6 toolbar buttons removed.
            const item = createAssistantItem('asst-boundary');
            mountVisibleItems().appendChild(item);
            const buttons = toolbarButtonsOf(item);
            buttons[5].remove();
            buttons[4].remove();

            expect(CensorReplyRestore._getToolbarGroup(item.querySelector('.ds-message'))).toBeNull();
        });
    });

    describe('_getPrecedingUserPromptKey() — skips non-message siblings', () => {
        it('skips a non-message div between user and assistant items and still finds the user message', () => {
            const container = mountVisibleItems();
            container.appendChild(createUserItem('user-1', 'User prompt here'));

            // Non-message sibling (e.g. a divider or ad injection)
            const divider = document.createElement('div');
            divider.setAttribute('data-virtual-list-item-key', 'divider-1');
            // No .ds-message child inside
            const innerDiv = document.createElement('div');
            innerDiv.className = 'some-divider-class';
            innerDiv.textContent = '---';
            divider.appendChild(innerDiv);
            container.appendChild(divider);

            const asstItem = createAssistantItem('asst-1');
            container.appendChild(asstItem);

            expect(CensorReplyRestore._getPrecedingUserPromptKey(asstItem.querySelector('.ds-message'))).toBe('User prompt here');
        });
    });
});

// ---------------------------------------------------------------------------
// Mutant-killing: _getToolbarGroup primary lookup (kills the "if (toolbar) return toolbar" guard mutated to false)
// ---------------------------------------------------------------------------

describe('CensorReplyRestore — _getToolbarGroup primary lookup mutant killer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('still finds the toolbar group by structure when DeepSeek renames the icon-button modifier class', () => {
        // Live assistant item with only the ds-button--icon modifier stripped from its toolbar buttons (a class rotation). The toolbar group keeps its real nesting and six role=button children, so a structural lookup must still return it.
        const item = createAssistantItem('asst-toolbar-mutant');
        mountVisibleItems().appendChild(item);
        const buttons = toolbarButtonsOf(item);
        for (const btn of buttons) btn.classList.remove('ds-button--icon');
        const group = buttons[0].parentElement;

        expect(CensorReplyRestore._getToolbarGroup(item.querySelector('.ds-message'))).toBe(group);
    });
});
