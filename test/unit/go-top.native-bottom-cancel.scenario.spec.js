/**
 * GoToTop — a press on DeepSeek's native go-bottom button cancels a running Go Top.
 * Harness: test/helpers/go-top-native-press-harness.js
 *
 * Bug (user report): in a long conversation Go Top takes seconds to settle; pressing the native "go bottom" button meanwhile jumps the page to the bottom, then the page snaps back to the first message once Go Top's loop settles.
 * Decided behaviour (user's answer): a trusted press on the native go-bottom button while Go Top runs stops Go Top immediately and the page stays at the bottom; the user's last click wins.
 *
 *   C1 — trusted native press during Go Top: the Go Top call settles with the existing abort contract { success: false, reason: 'stopped-by-user' } (go-top.visibility.spec.js "toggle"), and no later write moves the list off the bottom, with a quiet DOM and with a busy DOM.
 *   C2 — guard: an untrusted (scripted) native press does not cancel Go Top.
 *   C3 — guard: a press on the extension's own clone (.dsw-gotop) is not a native press, both with the clone beside the native wrapper and with the clone inside the native ._0706cde wrapper (where only .dsw-gotop tells the two apart).
 *   C4 — after a native-press cancel, Go Top is idle: the next Go Top click starts a fresh scroll that reaches the top.
 *   C5 — guard: with no Go Top running, a trusted native press leaves Go Top unaffected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState } from '../helpers/go-top-fixtures.js';
import {
    BOTTOM,
    HOST_SCROLL_SETTLE_MS,
    mountGoTopConversation,
    trackSettle,
    startContainerMutations,
    restoreMutationDelivery,
    dispatchWithTrust,
    userClick,
    scriptedClickSequence,
} from '../helpers/go-top-native-press-harness.js';

const STOPPED = { success: false, reason: 'stopped-by-user' };
const POLL = GoToTop.ANCHOR_POLL_INTERVAL;
/** Far longer than Go Top's settle gate (3 stable polls) and the host re-measure burst. */
const LONG_WAIT = POLL * 20;

describe('GoToTop — native go-bottom press during Go Top', () => {
    beforeEach(() => {
        resetGoToTopState();
        vi.useFakeTimers();
    });
    afterEach(() => {
        resetGoToTopState();
        restoreMutationDelivery();
        vi.useRealTimers();
    });

    /** Starts Go Top the way the user does (trusted click on the clone) and returns its settle tracker after one poll, asserting it is still running. */
    async function startGoTop(h) {
        const before = h.goTopCalls().length;
        userClick(h.cloneIcon);
        const calls = h.goTopCalls();
        expect(calls.length, 'precondition: clicking the Go Top button must call scrollToTopAndWait').toBe(before + 1);
        const goTop = trackSettle(calls[calls.length - 1]);
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'precondition: Go Top must have moved the list to the top').toBe(0);
        expect(goTop.settled, 'precondition: Go Top must still be running when the native button is pressed').toBe(false);
        return goTop;
    }

    describe('C1 — a trusted native press stops Go Top and the page stays at the bottom', () => {
        it('quiet DOM: Go Top settles stopped-by-user and the list never returns to the top after the press', async () => {
            const h = mountGoTopConversation();
            const goTop = await startGoTop(h);

            const pressAt = h.history.length;
            userClick(h.nativeIcon);
            await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS);
            expect(h.list.scrollTop, 'precondition: the host go-bottom handler must have landed at the bottom').toBe(BOTTOM);

            await vi.advanceTimersByTimeAsync(LONG_WAIT);

            expect.soft(h.list.scrollTop, 'the page must stay at the bottom after the native press').toBe(BOTTOM);
            expect.soft(h.history.slice(pressAt), 'no write after the native press may move the list back to the top').not.toContain(0);
            expect.soft(goTop.settled, 'the running Go Top call must settle once the native button is pressed').toBe(true);
            expect.soft(goTop.value, 'the running Go Top call must settle with the abort contract').toEqual(STOPPED);
        });

        it('busy DOM: with the conversation still mutating during and after the press, the list stays at the bottom once the DOM goes quiet', async () => {
            const h = mountGoTopConversation();
            const stopMutations = startContainerMutations(h.list, 50);
            const goTop = await startGoTop(h);

            const pressAt = h.history.length;
            userClick(h.nativeIcon);
            await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS);
            expect(h.list.scrollTop, 'precondition: the host go-bottom handler must have landed at the bottom').toBe(BOTTOM);

            await vi.advanceTimersByTimeAsync(1000);
            stopMutations();
            await vi.advanceTimersByTimeAsync(LONG_WAIT);

            expect.soft(h.list.scrollTop, 'the page must stay at the bottom after the DOM goes quiet').toBe(BOTTOM);
            expect.soft(h.history.slice(pressAt), 'no write after the native press may move the list back to the top').not.toContain(0);
            expect.soft(goTop.value, 'the running Go Top call must settle with the abort contract').toEqual(STOPPED);
        });
    });

    describe('C2 — guard: an untrusted native press does not cancel Go Top', () => {
        it('a scripted click sequence on the native control leaves Go Top running to the top', async () => {
            const h = mountGoTopConversation();
            const goTop = await startGoTop(h);

            scriptedClickSequence(h.nativeIcon);
            await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS);
            expect(h.list.scrollTop, "precondition: the scripted press must reach the host go-bottom handler").toBe(BOTTOM);
            await vi.advanceTimersByTimeAsync(LONG_WAIT);

            expect(goTop.value, 'Go Top must finish normally after an untrusted press').toEqual({ success: true });
            expect(h.list.scrollTop, 'Go Top must still bring the list to the top').toBe(0);
        });
    });

    describe.each([
        ['clone beside the native wrapper', false],
        ['clone inside the native ._0706cde wrapper', true],
    ])('C3 — guard: the extension clone (.dsw-gotop) is not the native control (%s)', (_layout, cloneInsideNativeWrapper) => {
        it('a trusted pointerdown on the clone does not cancel Go Top', async () => {
            const h = mountGoTopConversation({ cloneInsideNativeWrapper });
            expect(h.clone.closest('._0706cde') !== null, 'precondition: fixture layout').toBe(cloneInsideNativeWrapper);
            const goTop = await startGoTop(h);

            dispatchWithTrust(h.cloneIcon, 'pointerdown', true);
            await vi.advanceTimersByTimeAsync(LONG_WAIT);

            expect(goTop.value, 'a pointerdown on the clone must not stop Go Top').toEqual({ success: true });
            expect(h.list.scrollTop).toBe(0);
        });

        it('a trusted click on the clone during Go Top stops it exactly once and does not restart it', async () => {
            const h = mountGoTopConversation({ cloneInsideNativeWrapper });
            expect(h.clone.closest('._0706cde') !== null, 'precondition: fixture layout').toBe(cloneInsideNativeWrapper);
            const goTop = await startGoTop(h);

            userClick(h.cloneIcon);
            await vi.advanceTimersByTimeAsync(0);
            expect(goTop.value, 'the clone click must stop the running Go Top (existing toggle)').toEqual(STOPPED);

            // After the toggle-off click the user wheels to the middle of the conversation; a restarted Go Top would pull the list back to 0.
            h.list.scrollTop = 20000;
            await vi.advanceTimersByTimeAsync(LONG_WAIT);
            expect(h.list.scrollTop, 'no Go Top may be running after the toggle-off click').toBe(20000);
        });
    });

    describe('C4 — after a native-press cancel, Go Top is idle again', () => {
        it('the next Go Top click starts a fresh scroll that reaches the top, even while the DOM is still busy', async () => {
            const h = mountGoTopConversation();
            const stopMutations = startContainerMutations(h.list, 50);
            await startGoTop(h);

            userClick(h.nativeIcon);
            await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS);
            expect(h.list.scrollTop, 'precondition: the host go-bottom handler must have landed at the bottom').toBe(BOTTOM);
            await vi.advanceTimersByTimeAsync(300);

            userClick(h.cloneIcon);
            const calls = h.goTopCalls();
            const second = calls[calls.length - 1];
            expect.soft(second, 'the second Go Top click must start a new scroll (a promise), not toggle off a stale one').toBeInstanceOf(Promise);
            const fresh = trackSettle(second);

            await vi.advanceTimersByTimeAsync(POLL);
            expect.soft(h.list.scrollTop, 'the fresh Go Top must move the list to the top').toBe(0);

            stopMutations();
            await vi.advanceTimersByTimeAsync(LONG_WAIT);
            expect.soft(fresh.value, 'the fresh Go Top must finish successfully').toEqual({ success: true });
            expect.soft(h.list.scrollTop).toBe(0);
        });
    });

    describe('C5 — guard: no Go Top running', () => {
        it('a trusted native press only scrolls to the bottom, and the next Go Top click still reaches the top', async () => {
            const h = mountGoTopConversation();
            h.list.scrollTop = 20000;

            userClick(h.nativeIcon);
            await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS + LONG_WAIT);
            expect(h.list.scrollTop, 'the native press must land at the bottom and stay there').toBe(BOTTOM);

            userClick(h.cloneIcon);
            const calls = h.goTopCalls();
            expect(calls.length, 'the Go Top click must call scrollToTopAndWait').toBe(1);
            const goTop = trackSettle(calls[0]);
            await vi.advanceTimersByTimeAsync(LONG_WAIT);

            expect(goTop.value, 'Go Top must run normally after a native press made while idle').toEqual({ success: true });
            expect(h.list.scrollTop).toBe(0);
        });
    });
});
