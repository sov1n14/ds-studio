/**
 * MAIN-world patch (content/prevent-auto-scroll.js): user-scroll allow window.
 *
 * Requirement (user ruling): anti-auto-scroll blocks only program-triggered scrolls; a user's click on DeepSeek's native scroll-to-bottom button must be allowed. Decided design: the bridge publishes an allow-until moment on the bridge element; while Date.now() is before it, the patch lets downward scrolls through, otherwise it blocks as before.
 *
 * Observable outcome: the list's real (native) scroll position. The native scroll engine is the modelled trust boundary (test/helpers/prevent-auto-scroll-harness.js); the patch is the real file run through test/helpers/load-classic-script.js. The allow-until key is the harness's ALLOW_UNTIL_DATASET_KEY (assumed contract, see there).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
    ALLOW_UNTIL_DATASET_KEY, ALLOW_WINDOW_MS, LIST_SCROLL_HEIGHT, LIST_CLIENT_HEIGHT,
    installNativeScrollModel, loadMainPatch, createBridgeElement, nativeTopOf, placeAt,
} from '../helpers/prevent-auto-scroll-harness.js';

const BOTTOM = LIST_SCROLL_HEIGHT - LIST_CLIENT_HEIGHT;
const USER_POSITION = 1000;

let bridge;
let list;

function makeList() {
    const el = document.createElement('div');
    el.className = 'ds-virtual-list ds-scroll-area';
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => LIST_SCROLL_HEIGHT });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => LIST_CLIENT_HEIGHT });
    document.body.appendChild(el);
    return el;
}

beforeAll(() => {
    installNativeScrollModel();
    // Production order: the bridge element exists before the patch is injected.
    bridge = createBridgeElement({ enabled: true });
    loadMainPatch();
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    bridge.dataset.enabled = 'true';
    delete bridge.dataset[ALLOW_UNTIL_DATASET_KEY];
    list = makeList();
    placeAt(list, USER_POSITION);
});

afterEach(() => {
    list.remove();
    vi.useRealTimers();
});

function openWindow(offsetMs) {
    bridge.dataset[ALLOW_UNTIL_DATASET_KEY] = String(Date.now() + offsetMs);
}

describe('fixture self-check (passes on pre-fix code by design)', () => {
    it('with protection disabled, a downward scrollTo moves the list: the native model and the patch pass-through work', () => {
        bridge.dataset.enabled = 'false';
        list.scrollTo({ top: BOTTOM, behavior: 'instant' });
        expect(nativeTopOf(list), 'disabled protection must not hold the list').toBe(BOTTOM);
    });
});

describe('allow window open (allow-until in the future)', () => {
    it('a downward Element.scrollTo({ top, behavior: "instant" }) reaches the bottom', () => {
        openWindow(ALLOW_WINDOW_MS);
        list.scrollTo({ top: BOTTOM, behavior: 'instant' });
        expect(nativeTopOf(list), 'user-initiated scroll-to-bottom must not be blocked inside the allow window').toBe(BOTTOM);
    });

    it('a downward scrollTop assignment reaches the bottom', () => {
        openWindow(ALLOW_WINDOW_MS);
        list.scrollTop = BOTTOM;
        expect(nativeTopOf(list), 'scrollTop setter must let a downward write through inside the allow window').toBe(BOTTOM);
    });

    it('stays open for the whole window: a scrollTo 400 ms after opening still proceeds', () => {
        openWindow(ALLOW_WINDOW_MS);
        vi.advanceTimersByTime(400);
        list.scrollTo({ top: BOTTOM, behavior: 'instant' });
        expect(nativeTopOf(list), 'window must still be open 400 ms into a 500 ms window').toBe(BOTTOM);
    });
});

describe('allow window closed: today\'s blocking stays (these pass on pre-fix code by design)', () => {
    it('allow-until in the past: a downward scrollTo is blocked', () => {
        openWindow(-1);
        list.scrollTo({ top: BOTTOM, behavior: 'instant' });
        expect(nativeTopOf(list), 'expired window must block').toBe(USER_POSITION);
    });

    it('window expired by elapsed time: opened, then 501 ms later a downward scrollTo is blocked', () => {
        openWindow(ALLOW_WINDOW_MS);
        vi.advanceTimersByTime(ALLOW_WINDOW_MS + 1);
        list.scrollTo({ top: BOTTOM, behavior: 'instant' });
        expect(nativeTopOf(list), 'window must close once Date.now() passes allow-until').toBe(USER_POSITION);
    });

    it('allow-until absent: a downward scrollTo is blocked', () => {
        list.scrollTo({ top: BOTTOM, behavior: 'instant' });
        expect(nativeTopOf(list)).toBe(USER_POSITION);
    });

    it('allow-until absent: a downward scrollTop assignment is blocked', () => {
        list.scrollTop = BOTTOM;
        expect(nativeTopOf(list)).toBe(USER_POSITION);
    });

    it('allow-until in the past: a downward scrollTop assignment is blocked', () => {
        openWindow(-1);
        list.scrollTop = BOTTOM;
        expect(nativeTopOf(list)).toBe(USER_POSITION);
    });

    it('allow-until not a number: a downward scrollTo is blocked', () => {
        bridge.dataset[ALLOW_UNTIL_DATASET_KEY] = 'garbage';
        list.scrollTo({ top: BOTTOM, behavior: 'instant' });
        expect(nativeTopOf(list), 'an unparseable allow-until must not open the window').toBe(USER_POSITION);
    });
});
