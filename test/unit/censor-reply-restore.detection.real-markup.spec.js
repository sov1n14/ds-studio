/**
 * _getToolbarGroup / _isCensored against real DeepSeek conversation markup.
 *
 * Fixture: test/fixtures/ds-snapshots/conv2-finished-visible-items.html, the visible virtual-list
 * items of a finished conversation captured from the live page (message text replaced by
 * placeholders). The assistant item (key "2") holds the .ds-message, then an outer .ds-flex
 * wrapper whose children are the toolbar group and a spacer; the toolbar group's direct children
 * are the six icon buttons.
 *
 * Scenario: DeepSeek rotates the toolbar group's hashed classes, so the primary toolbar selector
 * no longer finds it and lookup must fall back to structure. Each test strips the group down to
 * the bare `ds-flex` class to model that rotation.
 *
 * Required behaviour: the returned toolbar group is the element whose direct children are the
 * icon buttons, not the outer wrapper.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';

const FIXTURE = path.resolve(__dirname, '../fixtures/ds-snapshots/conv2-finished-visible-items.html');

function mountFinishedConversationWithRotatedToolbarHash() {
    document.body.innerHTML = fs.readFileSync(FIXTURE, 'utf8');
    const item = document.querySelector('[data-virtual-list-item-key="2"]');
    const messageEl = item.querySelector('.ds-message');
    const iconButtons = [...item.querySelectorAll('[role="button"].ds-button--icon')];
    const toolbarGroup = iconButtons[0].parentElement;
    const outerWrapper = toolbarGroup.parentElement;
    toolbarGroup.className = 'ds-flex';
    return { messageEl, iconButtons, toolbarGroup, outerWrapper };
}

describe('CensorReplyRestore._getToolbarGroup — real assistant toolbar with rotated hash classes', () => {
    beforeEach(resetCensorReplyRestore);

    it('fixture sanity: six icon buttons share one direct parent, wrapped by an outer .ds-flex', () => {
        const { iconButtons, toolbarGroup, outerWrapper } = mountFinishedConversationWithRotatedToolbarHash();
        expect(iconButtons).toHaveLength(6);
        expect(iconButtons.every((btn) => btn.parentElement === toolbarGroup)).toBe(true);
        expect(outerWrapper.classList.contains('ds-flex')).toBe(true);
    });

    it('returns the element whose direct children are the icon buttons, not the outer wrapper', () => {
        const { messageEl, toolbarGroup, outerWrapper } = mountFinishedConversationWithRotatedToolbarHash();

        const group = CensorReplyRestore._getToolbarGroup(messageEl);

        expect(group, 'returned the outer .ds-flex wrapper instead of the toolbar group').not.toBe(outerWrapper);
        expect(group).toBe(toolbarGroup);
    });

    it('control: a censored reply (buttons 1 and 4 disabled) is judged censored through the looked-up group', () => {
        const { messageEl, iconButtons } = mountFinishedConversationWithRotatedToolbarHash();
        iconButtons[1].classList.add('ds-button--disabled');
        iconButtons[1].setAttribute('aria-disabled', 'true');
        iconButtons[4].classList.add('ds-button--disabled');

        const group = CensorReplyRestore._getToolbarGroup(messageEl);

        expect(group).not.toBeNull();
        expect(CensorReplyRestore._isCensored(group)).toBe(true);
    });
});
