/**
 * MAIN-world patch (content/prevent-auto-scroll.js): every intercepted scroll API, every argument form (surviving / NoCoverage Stryker mutants).
 *
 * Requirement: while protection is on (bridge element dataset.enabled === 'true') and no user allow window is open, a program-triggered scroll that would move a scroller or the page DOWN does not move it; every other scroll (upward, horizontal-only, same vertical position, a call with no vertical target) reaches the browser and takes effect. With protection off or no bridge element on the page, every scroll takes effect. The allow window is open only while Date.now() is before the allow-until moment.
 * APIs covered: window.scrollTo, window.scrollBy, Element.prototype.scrollTo, Element.prototype.scrollBy, Element.prototype.scrollIntoView and the Element.prototype.scrollTop setter.
 *
 * Observable outcome: the real (native) scroll position of the list or the page after the call. The native scroll engine is the modelled trust boundary and follows Chrome's WebIDL overloads: one argument is a ScrollToOptions dictionary (null / undefined become an empty dictionary, a primitive throws TypeError), two or more arguments are (x, y) with non-finite values normalized to 0, writes clamp to [0, scrollHeight - clientHeight]. The page scrolls its scrolling element (documentElement in standards mode, body in quirks mode). The patch is the real file run through loadMainPatch (test/helpers/prevent-auto-scroll-harness.js).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ALLOW_UNTIL_DATASET_KEY, loadMainPatch, createBridgeElement } from '../helpers/prevent-auto-scroll-harness.js';

const LIST_SCROLL_HEIGHT = 5000;
const LIST_CLIENT_HEIGHT = 800;
const LIST_BOTTOM = LIST_SCROLL_HEIGHT - LIST_CLIENT_HEIGHT;
const LIST_SCROLL_WIDTH = 2000;
const LIST_CLIENT_WIDTH = 600;
const PAGE_SCROLL_HEIGHT = 6000;
const PAGE_CLIENT_HEIGHT = 1000;
const PAGE_BOTTOM = PAGE_SCROLL_HEIGHT - PAGE_CLIENT_HEIGHT;
const READING_POSITION = 1000;

// ── Native scroll engine (trust boundary) ──

const nativeTop = new WeakMap();
const nativeLeft = new WeakMap();
let scrollingElement = null;

function finiteOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function clampTo(value, max) {
    return Math.min(Math.max(0, finiteOrZero(value)), Math.max(0, max));
}

function writeTop(el, value) {
    nativeTop.set(el, clampTo(value, (Number(el.scrollHeight) || 0) - (Number(el.clientHeight) || 0)));
}

function writeLeft(el, value) {
    nativeLeft.set(el, clampTo(value, (Number(el.scrollWidth) || 0) - (Number(el.clientWidth) || 0)));
}

const topOf = (el) => nativeTop.get(el) ?? 0;
const leftOf = (el) => nativeLeft.get(el) ?? 0;

/** WebIDL overload resolution of scrollTo / scrollBy as Chrome performs it. */
function parseScrollArgs(args, api) {
    if (args.length === 0) return {};
    if (args.length === 1) {
        const options = args[0];
        if (options === undefined || options === null) return {};
        if (typeof options !== 'object' && typeof options !== 'function') {
            throw new TypeError('Failed to execute ' + api + ': The provided value is not of type ScrollToOptions.');
        }
        return {
            left: options.left === undefined ? undefined : finiteOrZero(options.left),
            top: options.top === undefined ? undefined : finiteOrZero(options.top),
        };
    }
    return { left: finiteOrZero(args[0]), top: finiteOrZero(args[1]) };
}

function nativeScrollTo(el, args, api) {
    const { left, top } = parseScrollArgs(args, api);
    if (left !== undefined) writeLeft(el, left);
    if (top !== undefined) writeTop(el, top);
}

function nativeScrollBy(el, args, api) {
    const { left, top } = parseScrollArgs(args, api);
    if (left !== undefined) writeLeft(el, leftOf(el) + left);
    if (top !== undefined) writeTop(el, topOf(el) + top);
}

/** Installed BEFORE the patch loads, so the patch captures these as its originals. */
function installNativeScrollEngine() {
    Object.defineProperty(Element.prototype, 'scrollTop', {
        configurable: true, enumerable: true, get() { return topOf(this); }, set(v) { writeTop(this, v); },
    });
    Object.defineProperty(Element.prototype, 'scrollLeft', {
        configurable: true, enumerable: true, get() { return leftOf(this); }, set(v) { writeLeft(this, v); },
    });
    Element.prototype.scrollTo = function scrollTo(...args) { nativeScrollTo(this, args, 'scrollTo'); };
    Element.prototype.scroll = Element.prototype.scrollTo;
    Element.prototype.scrollBy = function scrollBy(...args) { nativeScrollBy(this, args, 'scrollBy'); };
    // Layout model: the target's offset inside its scroller is data-offset-top; scrollIntoView aligns it to the scroller's top.
    Element.prototype.scrollIntoView = function scrollIntoView() {
        const scroller = this.closest('.ds-scroll-area');
        if (scroller) writeTop(scroller, Number(this.dataset.offsetTop));
    };
    window.scrollTo = function scrollTo(...args) { nativeScrollTo(scrollingElement, args, 'scrollTo'); };
    window.scrollBy = function scrollBy(...args) { nativeScrollBy(scrollingElement, args, 'scrollBy'); };
}

function giveGeometry(el, { scrollHeight, clientHeight, scrollWidth = 0, clientWidth = 0 }) {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth });
}

function makeList() {
    const el = document.createElement('div');
    el.className = 'ds-virtual-list ds-scroll-area';
    giveGeometry(el, {
        scrollHeight: LIST_SCROLL_HEIGHT, clientHeight: LIST_CLIENT_HEIGHT, scrollWidth: LIST_SCROLL_WIDTH, clientWidth: LIST_CLIENT_WIDTH,
    });
    document.body.appendChild(el);
    return el;
}

function addMessage(scroller, offsetTop) {
    const msg = document.createElement('div');
    msg.className = 'ds-message';
    msg.dataset.offsetTop = String(offsetTop);
    scroller.appendChild(msg);
    return msg;
}

let bridge;
let list;

beforeAll(() => {
    installNativeScrollEngine();
    giveGeometry(document.documentElement, { scrollHeight: PAGE_SCROLL_HEIGHT, clientHeight: PAGE_CLIENT_HEIGHT });
    giveGeometry(document.body, { scrollHeight: PAGE_SCROLL_HEIGHT, clientHeight: PAGE_CLIENT_HEIGHT });
    // Production order: the bridge element exists before the patch is injected.
    bridge = createBridgeElement({ enabled: true });
    loadMainPatch();
});

beforeEach(() => {
    if (!bridge.isConnected) document.documentElement.appendChild(bridge);
    bridge.dataset.enabled = 'true';
    delete bridge.dataset[ALLOW_UNTIL_DATASET_KEY];
    scrollingElement = document.documentElement;
    writeTop(document.documentElement, 0);
    writeTop(document.body, 0);
    list = makeList();
    writeTop(list, READING_POSITION);
    writeLeft(list, 0);
});

afterEach(() => {
    list.remove();
    vi.useRealTimers();
});

describe('native engine self-check (passes on the current code by design)', () => {
    it('with protection off, Element.scrollTo, window.scrollTo and a scrollLeft write all take effect, so every blocked-case assertion below can fail', () => {
        bridge.dataset.enabled = 'false';
        list.scrollTo({ top: LIST_BOTTOM });
        window.scrollTo(0, 2000);
        list.scrollLeft = 300;
        expect(topOf(list)).toBe(LIST_BOTTOM);
        expect(topOf(document.documentElement)).toBe(2000);
        expect(leftOf(list)).toBe(300);
    });
});

describe('protection switch on the bridge element', () => {
    it('with no bridge element on the page, a downward Element.scrollTo moves the list and does not throw', () => {
        bridge.remove();
        expect(() => list.scrollTo({ top: LIST_BOTTOM }), 'a missing bridge must mean not protecting, not a crash').not.toThrow();
        expect(topOf(list), 'no bridge element: the scroll must take effect').toBe(LIST_BOTTOM);
    });

    it('with no bridge element on the page, a downward window.scrollTo moves the page', () => {
        bridge.remove();
        expect(() => window.scrollTo(0, PAGE_BOTTOM)).not.toThrow();
        expect(topOf(document.documentElement)).toBe(PAGE_BOTTOM);
    });
});

describe('user allow window boundary', () => {
    it('allow-until equal to now: the window has already closed and a downward Element.scrollTo is blocked', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
        bridge.dataset[ALLOW_UNTIL_DATASET_KEY] = String(Date.now());
        list.scrollTo({ top: LIST_BOTTOM });
        expect(topOf(list), 'the window is open only while Date.now() is BEFORE allow-until').toBe(READING_POSITION);
    });

    it('allow-until 1 ms after now: the window is open and a downward Element.scrollTo proceeds', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
        bridge.dataset[ALLOW_UNTIL_DATASET_KEY] = String(Date.now() + 1);
        list.scrollTo({ top: LIST_BOTTOM });
        expect(topOf(list)).toBe(LIST_BOTTOM);
    });
});

describe('window.scrollTo / window.scrollBy with protection on', () => {
    beforeEach(() => {
        writeTop(document.documentElement, READING_POSITION);
    });

    it('window.scrollTo(0, y) below the current position does not move the page', () => {
        window.scrollTo(0, PAGE_BOTTOM);
        expect(topOf(document.documentElement), 'downward window.scrollTo(x, y) must be blocked').toBe(READING_POSITION);
    });

    it('window.scrollTo({ top }) below the current position does not move the page', () => {
        window.scrollTo({ top: PAGE_BOTTOM, behavior: 'instant' });
        expect(topOf(document.documentElement)).toBe(READING_POSITION);
    });

    it('window.scrollTo(0, y) above the current position moves the page up', () => {
        window.scrollTo(0, 300);
        expect(topOf(document.documentElement), 'upward window.scrollTo must take effect').toBe(300);
    });

    it('quirks-mode page (body is the scrolling element): an upward window.scrollTo moves the page up and a downward one is blocked', () => {
        writeTop(document.documentElement, 0);
        scrollingElement = document.body;
        writeTop(document.body, READING_POSITION);
        window.scrollTo(0, 300);
        expect(topOf(document.body), 'upward scroll of a body-scrolled page must take effect').toBe(300);
        window.scrollTo(0, PAGE_BOTTOM);
        expect(topOf(document.body), 'downward scroll of a body-scrolled page must be blocked').toBe(300);
    });

    it('window.scrollBy(0, +N) does not move the page', () => {
        window.scrollBy(0, 500);
        expect(topOf(document.documentElement), 'downward window.scrollBy must be blocked').toBe(READING_POSITION);
    });

    it('window.scrollBy(0, -N) moves the page up', () => {
        window.scrollBy(0, -400);
        expect(topOf(document.documentElement), 'upward window.scrollBy must take effect').toBe(READING_POSITION - 400);
    });
});

describe('window.scrollTo / window.scrollBy with protection off', () => {
    beforeEach(() => {
        bridge.dataset.enabled = 'false';
        writeTop(document.documentElement, READING_POSITION);
    });

    it('window.scrollTo(0, y) below the current position moves the page down', () => {
        window.scrollTo(0, PAGE_BOTTOM);
        expect(topOf(document.documentElement)).toBe(PAGE_BOTTOM);
    });

    it('window.scrollTo(0, y) above the current position moves the page up', () => {
        window.scrollTo(0, 300);
        expect(topOf(document.documentElement)).toBe(300);
    });

    it('window.scrollBy(0, +N) moves the page down', () => {
        window.scrollBy(0, 500);
        expect(topOf(document.documentElement), 'protection off: downward window.scrollBy must take effect').toBe(READING_POSITION + 500);
    });
});

describe('Element.scrollTo argument forms with protection on', () => {
    it('scrollTo(x, y) above the current position moves the list up', () => {
        expect(() => list.scrollTo(0, 200)).not.toThrow();
        expect(topOf(list), 'upward scrollTo(x, y) must take effect').toBe(200);
    });

    it('scrollTo(x, y) below the current position does not move the list', () => {
        list.scrollTo(0, LIST_BOTTOM);
        expect(topOf(list)).toBe(READING_POSITION);
    });

    it('scrollTo({ top }) above the list position moves the list up, while the page itself sits at the top', () => {
        list.scrollTo({ top: 200 });
        expect(topOf(list), 'the list is compared with its own position, not the page position').toBe(200);
    });

    it('scrollTo({ top: same, left }) at the current vertical position applies the horizontal move', () => {
        list.scrollTo({ top: READING_POSITION, left: 300 });
        expect(leftOf(list), 'a call that does not move the list down must reach the browser').toBe(300);
        expect(topOf(list)).toBe(READING_POSITION);
    });

    it('scrollTo({ left }) with no vertical target applies the horizontal move', () => {
        list.scrollTo({ left: 300 });
        expect(leftOf(list), 'a horizontal-only scroll (wide code block) must not be blocked').toBe(300);
    });

    it('scrollTo(null) does not throw and leaves the list where it is', () => {
        expect(() => list.scrollTo(null), 'null is an empty ScrollToOptions dictionary').not.toThrow();
        expect(topOf(list)).toBe(READING_POSITION);
    });

    it('scrollTo(undefined) does not throw and leaves the list where it is', () => {
        expect(() => list.scrollTo(undefined), 'an undefined optional argument is an empty ScrollToOptions dictionary').not.toThrow();
        expect(topOf(list), 'an empty dictionary has no vertical target').toBe(READING_POSITION);
    });

    it('scrollTo(null, y) below the current position is blocked without throwing', () => {
        expect(() => list.scrollTo(null, LIST_BOTTOM)).not.toThrow();
        expect(topOf(list), 'two arguments with a null x still scroll to y, a downward scroll').toBe(READING_POSITION);
    });

    it('scrollTo({ left: 0 }, y) below the current position is blocked: two arguments are the (x, y) overload', () => {
        list.scrollTo({ left: 0 }, LIST_BOTTOM);
        expect(topOf(list), 'with two arguments the object is x and the call scrolls to y').toBe(READING_POSITION);
    });
});

describe('Element.scrollBy with protection on', () => {
    it('scrollBy(0, +N) does not move the list', () => {
        list.scrollBy(0, 500);
        expect(topOf(list), 'downward scrollBy(x, y) must be blocked').toBe(READING_POSITION);
    });

    it('scrollBy({ top: +N }) does not move the list', () => {
        list.scrollBy({ top: 500, behavior: 'instant' });
        expect(topOf(list), 'downward scrollBy({ top }) must be blocked').toBe(READING_POSITION);
    });

    it('scrollBy(0, -N) moves the list up', () => {
        list.scrollBy(0, -400);
        expect(topOf(list), 'upward scrollBy must take effect').toBe(READING_POSITION - 400);
    });

    it('scrollBy({ left }) with no vertical delta applies the horizontal move', () => {
        list.scrollBy({ left: 120 });
        expect(leftOf(list)).toBe(120);
    });

    it('scrollBy(N, 0) with a zero vertical delta applies the horizontal move', () => {
        list.scrollBy(120, 0);
        expect(leftOf(list), 'a zero vertical delta is not a downward scroll').toBe(120);
    });
});

describe('Element.scrollBy with protection off', () => {
    it('scrollBy(0, +N) moves the list down', () => {
        bridge.dataset.enabled = 'false';
        list.scrollBy(0, 500);
        expect(topOf(list)).toBe(READING_POSITION + 500);
    });
});

describe('Element.scrollIntoView', () => {
    it('with protection on, scrollIntoView of a message below does not pull the list down', () => {
        const msg = addMessage(list, 3000);
        msg.scrollIntoView();
        expect(topOf(list), 'scrollIntoView must not move the list while protection is on').toBe(READING_POSITION);
    });

    it('with protection off, scrollIntoView of a message below scrolls the list to it', () => {
        bridge.dataset.enabled = 'false';
        const msg = addMessage(list, 3000);
        msg.scrollIntoView({ block: 'start' });
        expect(topOf(list)).toBe(3000);
    });
});

describe('Element.scrollTop setter with protection on', () => {
    it('an upward scrollTop assignment moves the list up', () => {
        list.scrollTop = 200;
        expect(topOf(list), 'upward scrollTop writes must take effect').toBe(200);
    });
});
