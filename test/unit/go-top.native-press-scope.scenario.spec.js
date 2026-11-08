/**
 * GoToTop — scope of the native go-bottom press cancel.
 * Harness: test/helpers/go-top-native-press-harness.js (C1 to C5 live in go-top.native-bottom-cancel.scenario.spec.js)
 *
 * Decided behaviour (lead, from the user's answer "按到底部即取消 Go Top"):
 *   - The native-press cancel applies only to a Go Top the user started from the Go Top button. A scroll-to-top started by harvest / export (content/harvest.js _scrollToTopAndSettle awaits GoToTop.scrollToTopAndWait({ timeout: 30000 })) is not cancelled by a native press: it completes and settles successfully, so the export is not aborted.
 *   - A Go Top stopped by the user (a native press, or a second click on the Go Top button) produces no unhandled promise rejection in the page and no [DSS] console.warn: a user stop is silent (docs/architecture/content-ui.md, scrollToTopAndWait() item 7).
 *   - The native-press cancel lives only as long as the button-started Go Top: once that Go Top ends, a later export scroll-to-top is again not cancelled by a native press.
 *
 *   S1 — export scroll-to-top + trusted native press mid-scroll → settles { success: true } with the list at the top.
 *   S2 — Go Top started by a trusted click on the button + trusted native press → no unhandled rejection and no [DSS] warning; the page stays at the bottom.
 *   S3 — Go Top started by a trusted click on the button + second trusted click (toggle off) → no unhandled rejection and no [DSS] warning; Go Top stays stopped.
 *   S4 — Go Top started by a trusted click on the button + SPA route change (popstate to a new path) → no unhandled rejection; exactly one [DSS] console.warn reporting the abort.
 *   S5 — Go Top started by a trusted click on the button + the feature is disabled (GoToTop.disable(), the master-toggle off path) → no unhandled rejection; exactly one [DSS] console.warn reporting the abort.
 *   S6 — a button-started Go Top ends (completes, is stopped by a native press, or is stopped by a second click), then an export scroll-to-top runs + trusted native press mid-scroll → the export settles { success: true } with the list at the top.
 *        The harness matches document listeners by type, callback and capture flag as Chrome does, so a native-press listener whose removal misses (a capture flag that differs from the add) stays attached here as it does in Chrome, and cancels the export.
 *
 * S2 to S5 never attach a handler to the button's Go Top promise: the button's own click handler is the only caller, as in the page. They remove the harness's pass-through spy on scrollToTopAndWait first, because a vitest spy attaches its own then-handlers to every returned promise to record settled results, which marks a rejection as handled and hides it.
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
    restoreMutationDelivery,
    restoreSpecListenerMatching,
    userClick,
    watchUnhandledRejections,
} from '../helpers/go-top-native-press-harness.js';

const POLL = GoToTop.ANCHOR_POLL_INTERVAL;
/** Far longer than Go Top's settle gate (3 stable polls) and the host re-measure burst. */
const LONG_WAIT = POLL * 20;
/** The option harvest passes (content/harvest.js _scrollToTopAndSettle). */
const HARVEST_SCROLL_OPTIONS = { timeout: 30000 };
const STOPPED = { success: false, reason: 'stopped-by-user' };

/** Restores the real scrollToTopAndWait so nothing but the button's own click handler holds the returned promise. */
function removeHandlerAttachingSpy() {
    vi.mocked(GoToTop.scrollToTopAndWait).mockRestore();
    expect(vi.isMockFunction(GoToTop.scrollToTopAndWait), 'precondition: scrollToTopAndWait must be the real method').toBe(false);
}

/** Silences console.warn and returns only the warnings that carry the extension's [DSS] prefix. */
function watchDssWarnings() {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => warnSpy.mock.calls.filter((args) => typeof args[0] === 'string' && args[0].startsWith('[DSS]'));
}

/** True when any argument of a console call is an object whose `reason` matches — the abort result the lifecycle rejects with. */
function reportsReason(args, reason) {
    return args.some((a) => a !== null && typeof a === 'object' && a.reason === reason);
}

describe('GoToTop — scope of the native go-bottom press cancel', () => {
    let rejections;

    beforeEach(() => {
        resetGoToTopState();
        vi.useFakeTimers();
        rejections = watchUnhandledRejections();
    });
    afterEach(() => {
        rejections.dispose();
        resetGoToTopState();
        restoreSpecListenerMatching();
        restoreMutationDelivery();
        vi.useRealTimers();
    });

    it('S1 — an export scroll-to-top is not cancelled by a trusted native press: it settles { success: true } with the list at the top', async () => {
        const h = mountGoTopConversation();
        const exportScroll = trackSettle(window.DSstudio.GoToTop.scrollToTopAndWait(HARVEST_SCROLL_OPTIONS));
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'precondition: the export scroll must have moved the list to the top').toBe(0);
        expect(exportScroll.settled, 'precondition: the export scroll must still be running when the native button is pressed').toBe(false);

        userClick(h.nativeIcon);
        await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS);
        expect(h.list.scrollTop, 'precondition: the host go-bottom handler must have landed at the bottom').toBe(BOTTOM);
        await vi.advanceTimersByTimeAsync(LONG_WAIT);

        expect.soft(exportScroll.value, 'the export scroll-to-top must settle successfully, so the export is not aborted').toEqual({ success: true });
        expect.soft(h.list.scrollTop, 'the export scroll-to-top must still reach the top').toBe(0);
    });

    it('S2 — a Go Top started from the button and stopped by a trusted native press leaves no unhandled rejection and no [DSS] warning', async () => {
        const h = mountGoTopConversation();
        removeHandlerAttachingSpy();
        const dssWarnings = watchDssWarnings();
        userClick(h.cloneIcon);
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'precondition: Go Top must have moved the list to the top').toBe(0);

        userClick(h.nativeIcon);
        await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS + LONG_WAIT);
        expect(h.list.scrollTop, 'precondition: the native press must stop Go Top and leave the page at the bottom').toBe(BOTTOM);

        const unhandled = await rejections.collect();
        expect.soft(dssWarnings(), 'a Go Top stopped by the user with a native press must stay silent: no [DSS] console.warn').toEqual([]);
        expect(unhandled, 'a Go Top stopped by the user must not produce an unhandled promise rejection').toEqual([]);
    });

    it('S3 — a Go Top started from the button and stopped by a second button click leaves no unhandled rejection and no [DSS] warning', async () => {
        const h = mountGoTopConversation();
        removeHandlerAttachingSpy();
        const dssWarnings = watchDssWarnings();
        userClick(h.cloneIcon);
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'precondition: Go Top must have moved the list to the top').toBe(0);

        userClick(h.cloneIcon);
        await vi.advanceTimersByTimeAsync(0);
        h.list.scrollTop = 20000;
        await vi.advanceTimersByTimeAsync(LONG_WAIT);
        expect(h.list.scrollTop, 'precondition: the second click must stop Go Top (no Go Top pulls the list back to the top)').toBe(20000);

        const unhandled = await rejections.collect();
        expect.soft(dssWarnings(), 'a Go Top stopped by the user with a second click must stay silent: no [DSS] console.warn').toEqual([]);
        expect(unhandled, 'a Go Top stopped by the user must not produce an unhandled promise rejection').toEqual([]);
    });

    it('S4 — a Go Top started from the button and aborted by an SPA route change leaves no unhandled rejection and warns once with [DSS]', async () => {
        const h = mountGoTopConversation();
        removeHandlerAttachingSpy();
        const dssWarnings = watchDssWarnings();
        userClick(h.cloneIcon);
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'precondition: Go Top must have moved the list to the top').toBe(0);
        expect(dssWarnings(), 'precondition: a running Go Top must not have warned yet').toEqual([]);

        window.history.pushState({}, '', '/a/chat/s/go-top-route-abort');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await vi.advanceTimersByTimeAsync(0);
        h.list.scrollTop = 20000;
        await vi.advanceTimersByTimeAsync(LONG_WAIT);
        expect(h.list.scrollTop, 'precondition: the route change must stop Go Top (no Go Top pulls the list back to the top)').toBe(20000);

        const warnings = dssWarnings();
        expect.soft(warnings, 'a lifecycle abort of a button-started Go Top must emit exactly one [DSS] console.warn').toHaveLength(1);
        expect.soft(warnings.length === 1 && reportsReason(warnings[0], 'aborted'), 'the [DSS] warning must carry the abort result (reason "aborted") so the cause is diagnosable').toBe(true);
        expect(await rejections.collect(), 'a Go Top aborted by a route change must not produce an unhandled promise rejection').toEqual([]);
    });

    it('S5 — a Go Top started from the button and aborted by disabling the feature leaves no unhandled rejection and warns once with [DSS]', async () => {
        const h = mountGoTopConversation();
        removeHandlerAttachingSpy();
        const dssWarnings = watchDssWarnings();
        userClick(h.cloneIcon);
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'precondition: Go Top must have moved the list to the top').toBe(0);
        expect(dssWarnings(), 'precondition: a running Go Top must not have warned yet').toEqual([]);

        GoToTop._masterEnabled = false;
        GoToTop.disable();
        await vi.advanceTimersByTimeAsync(0);
        h.list.scrollTop = 20000;
        await vi.advanceTimersByTimeAsync(LONG_WAIT);
        expect(h.list.scrollTop, 'precondition: disabling must stop Go Top (no Go Top pulls the list back to the top)').toBe(20000);

        const warnings = dssWarnings();
        expect.soft(warnings, 'a lifecycle abort of a button-started Go Top must emit exactly one [DSS] console.warn').toHaveLength(1);
        expect.soft(warnings.length === 1 && reportsReason(warnings[0], 'aborted'), 'the [DSS] warning must carry the abort result (reason "aborted") so the cause is diagnosable').toBe(true);
        expect(await rejections.collect(), 'a Go Top aborted by disabling the feature must not produce an unhandled promise rejection').toEqual([]);
    });

    it.each([
        ['completes at the top', { success: true }, () => {}],
        ['is stopped by a trusted native press', STOPPED, (h) => userClick(h.nativeIcon)],
        ['is stopped by a second button click', STOPPED, (h) => userClick(h.cloneIcon)],
    ])('S6 — after a button-started Go Top %s, a later export scroll-to-top is not cancelled by a trusted native press', async (_end, expectedEnd, endGoTop) => {
        const h = mountGoTopConversation();
        userClick(h.cloneIcon);
        const buttonGoTop = trackSettle(h.goTopCalls()[0]);
        await vi.advanceTimersByTimeAsync(POLL);
        expect(h.list.scrollTop, 'precondition: Go Top must have moved the list to the top').toBe(0);
        endGoTop(h);
        await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS + LONG_WAIT);
        expect(buttonGoTop.value, 'precondition: the button-started Go Top must have ended this way').toEqual(expectedEnd);

        const exportScroll = trackSettle(window.DSstudio.GoToTop.scrollToTopAndWait(HARVEST_SCROLL_OPTIONS));
        await vi.advanceTimersByTimeAsync(POLL);
        expect(exportScroll.settled, 'precondition: the export scroll must still be running when the native button is pressed').toBe(false);

        userClick(h.nativeIcon);
        await vi.advanceTimersByTimeAsync(HOST_SCROLL_SETTLE_MS + LONG_WAIT);

        expect.soft(exportScroll.value, 'the ended Go Top must leave no native-press cancel behind: the export scroll-to-top must settle successfully').toEqual({ success: true });
        expect.soft(h.list.scrollTop, 'the export scroll-to-top must still reach the top').toBe(0);
    });
});
