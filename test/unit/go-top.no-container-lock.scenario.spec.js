/**
 * GoToTop — a Go Top click that finds no scroll container must not lock out later clicks.
 * Harness: test/helpers/go-top-native-press-harness.js (real GoToTop enabled, its clone injected into the captured live floating bar, a tracked scroller).
 *
 * Requirement: the Go Top button scrolls the conversation to the top on every click that is not a toggle-stop of a Go Top still running. A click that found no scroll container ran no scroll, so nothing is running afterwards; once the page renders the chat, the next click must scroll the list to the top.
 *
 *   N1 — click while no scroll container can be found (the `no_container` result), then the chat renders, then a second click → the list scrolls from the bottom to the top.
 *   N0 — control: the same second click on the same page, without the earlier no-container click → the list scrolls to the top (proves the harness observes the scroll).
 *
 * Only one locator is modelled: `_findScrollContainer`, gated on `isChatRendered` (null before the chat renders, the fixture's scroller after), because happy-dom has no layout to resolve the container, as in the harness itself. `_scrollContainer` is cleared after mount: the state the page is in when the connect-time probe found no container, so every click re-probes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState } from '../helpers/go-top-fixtures.js';
import {
    BOTTOM,
    mountGoTopConversation,
    trackSettle,
    restoreMutationDelivery,
    restoreSpecListenerMatching,
    userClick,
} from '../helpers/go-top-native-press-harness.js';

const POLL = GoToTop.ANCHOR_POLL_INTERVAL;
/** Far longer than Go Top's settle gate (3 stable polls). */
const LONG_WAIT = POLL * 20;

/** Mounts the conversation and gates the scroll-container locator on whether the chat has rendered. */
function mountWithContainerGate({ isChatRendered }) {
    const h = mountGoTopConversation();
    const gate = { isChatRendered };
    vi.mocked(GoToTop._findScrollContainer).mockImplementation(function findWhenRendered() {
        if (!gate.isChatRendered) return null;
        this._scrollContainer = h.list;
        return h.list;
    });
    GoToTop._scrollContainer = null;
    return { h, gate };
}

describe('GoToTop — a no-container click must not lock out later Go Top clicks', () => {
    beforeEach(() => {
        resetGoToTopState();
        vi.useFakeTimers();
    });
    afterEach(() => {
        resetGoToTopState();
        restoreSpecListenerMatching();
        restoreMutationDelivery();
        vi.useRealTimers();
    });

    it('N0 (control) — with the chat rendered, a Go Top click scrolls the list from the bottom to the top', async () => {
        const { h } = mountWithContainerGate({ isChatRendered: true });
        expect(h.list.scrollTop, 'precondition: the conversation starts at the bottom').toBe(BOTTOM);

        userClick(h.cloneIcon);
        const goTop = trackSettle(h.goTopCalls()[0]);
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'a Go Top click must move the list to the top').toBe(0);

        await vi.advanceTimersByTimeAsync(LONG_WAIT);
        expect.soft(goTop.value, 'the Go Top must complete at the top').toEqual({ success: true });
        expect(h.list.scrollTop, 'the list must stay at the top after Go Top completes').toBe(0);
    });

    it('N1 — a click while no scroll container exists, then the chat renders: the next Go Top click scrolls the list to the top', async () => {
        const { h, gate } = mountWithContainerGate({ isChatRendered: false });
        expect(h.list.scrollTop, 'precondition: the conversation starts at the bottom').toBe(BOTTOM);

        userClick(h.cloneIcon);
        const firstGoTop = trackSettle(h.goTopCalls()[0]);
        await vi.advanceTimersByTimeAsync(LONG_WAIT);
        expect(firstGoTop.value, 'precondition: the first click must end with the no_container result').toEqual({ success: false, reason: 'no_container' });
        expect(h.list.scrollTop, 'precondition: a click with no container must not move the list').toBe(BOTTOM);

        gate.isChatRendered = true;

        userClick(h.cloneIcon);
        const secondGoTop = trackSettle(h.goTopCalls()[1]);
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'after the chat renders, the next Go Top click must move the list to the top (a no_container click must not leave Go Top locked)').toBe(0);

        await vi.advanceTimersByTimeAsync(LONG_WAIT);
        expect.soft(secondGoTop.value, 'the second Go Top must complete at the top').toEqual({ success: true });
        expect(h.list.scrollTop, 'the list must stay at the top after the second Go Top completes').toBe(0);
    });
});
