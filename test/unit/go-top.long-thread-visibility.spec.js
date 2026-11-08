/**
 * GoToTop — button visibility after the native "Go bottom" jump in a long conversation.
 * Shared fixtures: test/helpers/go-top-fixtures.js
 *
 * Bug (user report): "In longer conversations, clicking "Go bottom" returns to the bottom, but after that, the "Go Top" button disappears (it seems to only happen in threads with many message exchanges)."
 *
 * Live capture on the user's long conversation (lead probe): at the top the button is display:none (correct). After the native Go bottom click the message-list scroller reads scrollTop 62438, clientHeight 740, scrollHeight 63178; [data-virtual-list-item-key="1"] is not mounted; the first mounted .ds-message is one very tall message with rect top -3440 / bottom 45, overlapping the viewport top. Scroller, floating bar and button were all connected. The button stayed display:none until ~9500 px of wheel-up mounted a first message with bottom -26576.
 *
 * Decided behaviour (lead): the button is shown whenever the list is scrolled at least one viewport away from the top (scrollTop >= clientHeight), even when the first mounted message still reaches into the viewport. The existing show rule (first mounted message bottom < 0) and hide rule (at top) stay; the keep-current band remains only when scrollTop < clientHeight and the first mounted message bottom >= 0.
 *
 *   R1  — red: hidden at the top, then the long-thread bottom state from the capture → visible.
 *   R2  — guard: at the top (scrollTop 0) → hidden.
 *   R3  — guard: scrollTop 200 (< clientHeight), first message bottom >= 0, previously hidden → stays hidden.
 *   R3b — guard: same band, previously visible → stays visible (keep-current in the other direction, no flicker).
 *   R4  — guard: scrollTop 400 (< clientHeight), first message bottom < 0 → visible (existing show rule alone).
 *
 * Trust boundaries modelled here: browser layout on the scroller (scrollTop / scrollHeight / clientHeight) and on the mounted .ds-message elements (getBoundingClientRect), which happy-dom cannot compute; values come from the live capture above. _findScrollContainer is pinned to the fixture scroller as go-top.enable.spec.js does, because happy-dom cannot resolve overflow. Every other part runs through the real module: enable() injects the button, the real scroll listener (100 ms leading-edge throttle) drives the real visibility evaluation, and the real first-message and at-top lookups read the captured DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState, createFullWrapperWithNativeButton } from '../helpers/go-top-fixtures.js';

/** Captured long-thread scroller geometry. */
const CLIENT_HEIGHT = 740;
const SCROLL_HEIGHT = 63178;
const BOTTOM_SCROLL_TOP = 62438;

/** Longer than the scroll listener's 100 ms throttle and the observer debounces (50 / 80 ms). */
const SETTLE_MS = 250;

/**
 * Mounts the captured live message list, gives the scroller a settable scroll position and the captured long-thread size, and gives every mounted .ds-message a settable rect. Returns handles plus setState(), which moves the page to a new layout.
 */
function mountLongThread() {
    const { nativeBtn } = createFullWrapperWithNativeButton();
    // The fixture mounts the captured .ds-virtual-list.ds-scroll-area root as the only body child; it is the scroller.
    const listRoot = document.body.firstElementChild;

    let scrollTop = 0;
    Object.defineProperty(listRoot, 'scrollHeight', { configurable: true, get: () => SCROLL_HEIGHT });
    Object.defineProperty(listRoot, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT });
    Object.defineProperty(listRoot, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v) => { scrollTop = v; } });

    const messages = Array.from(listRoot.querySelectorAll('.ds-message'));
    if (messages.length < 2) throw new Error('long-thread fixture: expected the captured list to mount at least two .ds-message elements');
    if (listRoot.querySelector('[data-virtual-list-item-key="1"]')) throw new Error('long-thread fixture: key "1" must not be mounted (capture state)');
    const rects = messages.map(() => ({ top: 0, bottom: 0, height: 0 }));
    messages.forEach((el, i) => { el.getBoundingClientRect = () => ({ ...rects[i], left: 0, right: 800, width: 800, x: 0, y: rects[i].top }); });

    /**
     * Moves the page: sets the scroll position and stacks the mounted messages from `firstTop` with the given heights (later messages sit directly below the first), so every mounted message's rect stays consistent with the first one.
     */
    function setState({ top, firstTop, heights }) {
        scrollTop = top;
        let y = firstTop;
        rects.forEach((r, i) => {
            const h = heights[Math.min(i, heights.length - 1)];
            r.top = y; r.height = h; r.bottom = y + h;
            y += h;
        });
    }

    vi.spyOn(GoToTop, '_findScrollContainer').mockImplementation(function findFixtureScroller() {
        this._scrollContainer = listRoot;
        return listRoot;
    });

    return { listRoot, nativeBtn, setState };
}

/** Delivers one scroll event the way the browser does after a position change, then lets throttles and debounces elapse. */
async function scrollTo(listRoot, setState, state) {
    setState(state);
    listRoot.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
}

/** The Go Top button the user sees right now. */
function liveButton() {
    const btn = document.querySelector('.dsw-gotop');
    expect(btn, 'Go Top button must be injected into the page').not.toBeNull();
    return btn;
}

/** Top-of-thread layout: list at scrollTop 0, first mounted message starts at the viewport top. */
const AT_TOP = { top: 0, firstTop: 0, heights: [400, 600] };

describe('GoToTop — visibility after Go bottom in a long conversation', () => {
    let page;

    beforeEach(async () => {
        resetGoToTopState();
        vi.useFakeTimers();
        page = mountLongThread();
        page.setState(AT_TOP);
        GoToTop._masterEnabled = true;
        GoToTop.enable();
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
    });

    afterEach(() => {
        GoToTop.disable();
        vi.useRealTimers();
    });

    it('R1: after Go bottom lands at the captured long-thread bottom (scrollTop 62438, first mounted message top -3440 / bottom 45), the button is visible', async () => {
        // Precondition: at the top the button is hidden, as observed live.
        expect(liveButton().style.display, 'at the top the button starts hidden').toBe('none');

        // Native Go bottom jump: React unmounts its own go-bottom button at the bottom, and the scroller lands on the captured position.
        page.nativeBtn.remove();
        await scrollTo(page.listRoot, page.setState, { top: BOTTOM_SCROLL_TOP, firstTop: -3440, heights: [3485, 600] });

        expect(
            liveButton().style.display,
            'scrollTop 62438 is ~84 viewports below the top: the Go Top button must be visible even though the first mounted message (bottom 45) still reaches into the viewport',
        ).not.toBe('none');
    });

    it('R2: returning to the top (scrollTop 0) hides a visible button', async () => {
        // Make it visible first through the existing show rule, so the hide is observable.
        await scrollTo(page.listRoot, page.setState, { top: 400, firstTop: -400, heights: [380, 600] });
        expect(liveButton().style.display, 'setup: first message bottom -20 must show the button').not.toBe('none');

        await scrollTo(page.listRoot, page.setState, AT_TOP);
        expect(liveButton().style.display, 'at scrollTop 0 the button must be hidden').toBe('none');
    });

    it('R3: within the first viewport (scrollTop 200 < clientHeight 740) with the first message bottom >= 0, a hidden button stays hidden', async () => {
        expect(liveButton().style.display).toBe('none');
        await scrollTo(page.listRoot, page.setState, { top: 200, firstTop: -200, heights: [400, 600] });
        expect(liveButton().style.display, 'keep-current band: a hidden button must not appear at scrollTop 200 while the first message (bottom 200) is still on screen').toBe('none');
    });

    it('R3b: within the first viewport with the first message bottom >= 0, a visible button stays visible', async () => {
        // Make it visible through the existing show rule: first message (height 380) fully scrolled past at scrollTop 400.
        await scrollTo(page.listRoot, page.setState, { top: 400, firstTop: -400, heights: [380, 600] });
        expect(liveButton().style.display, 'setup: first message bottom -20 must show the button').not.toBe('none');

        // Scroll back up to 200: the first message (bottom 180) re-enters the viewport, list not at top.
        await scrollTo(page.listRoot, page.setState, { top: 200, firstTop: -200, heights: [380, 600] });
        expect(liveButton().style.display, 'keep-current band: a visible button must not disappear at scrollTop 200').not.toBe('none');
    });

    it('R4: within the first viewport (scrollTop 400 < clientHeight 740), the first message bottom < 0 shows the button', async () => {
        expect(liveButton().style.display).toBe('none');
        await scrollTo(page.listRoot, page.setState, { top: 400, firstTop: -400, heights: [380, 600] });
        expect(liveButton().style.display, 'first message bottom -20 (scrolled past) must show the button').not.toBe('none');
    });
});
