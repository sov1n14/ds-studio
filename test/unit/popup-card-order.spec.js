/**
 * popup.html card layout - which toggles each settings card holds, and in what order.
 *
 * Requirement (user request, DECISIONS D-27): reorder the popup controls, positions only. Expected sequence, top to bottom:
 *   - Features card: showSystemTime, autoCopyReply, autoCopyCode, preventAutoScroll, autoRetry, autoContinue, 連網搜索 radios (name="websearchToggle"), 回覆完成通知 radios (name="replyNotificationToggle").
 *   - UI Adjustments card: sidebarAutoHide, hideThinking, autoExpandMessages, autoOpenSidebar, chatWidth, inputWidth.
 *
 * Each card is located by its .card-title heading; a control is identified by its checkbox id or, for a radio group, by the group name, collected in DOM order. Range sliders are excluded because D-27 names the width controls by their toggle.
 */
import { describe, it, expect } from 'vitest';
import { parsePopupHtml } from '../helpers/popup-master-switch-harness.js';

/** The .card whose .card-title heading reads `heading` exactly. */
function findCard(doc, heading) {
    const title = [...doc.querySelectorAll('.card-title')].find((el) => el.textContent.trim() === heading);
    if (!title) throw new Error(`could not locate the ${heading} card in popup.html`);
    return title.closest('.card');
}

/** Checkbox ids and radio-group names inside `card`, in DOM order, each radio group listed once. */
function controlSequence(card) {
    const seen = new Set();
    for (const input of card.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
        seen.add(input.type === 'radio' ? `radio:${input.name}` : input.id);
    }
    return [...seen];
}

const EXPECTED = [
    ['Features', [
        'showSystemTimeToggle',
        'autoCopyReplyToggle',
        'autoCopyCodeToggle',
        'preventAutoScrollToggle',
        'autoRetryToggle',
        'autoContinueToggle',
        'radio:websearchToggle',
        'radio:replyNotificationToggle',
    ]],
    ['UI Adjustments', [
        'sidebarAutoHideToggle',
        'hideThinkingToggle',
        'autoExpandMessagesToggle',
        'autoOpenSidebarToggle',
        'chatWidthToggle',
        'inputWidthToggle',
    ]],
];

describe('popup.html - card control order (D-27)', () => {
    it.each(EXPECTED)('the %s card holds exactly these controls in this order', (heading, expected) => {
        expect(controlSequence(findCard(parsePopupHtml(), heading)), `${heading} card controls, top to bottom`).toEqual(expected);
    });
});
