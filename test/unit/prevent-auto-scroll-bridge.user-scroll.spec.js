/**
 * Bridge (content/prevent-auto-scroll-bridge.js): a trusted press on DeepSeek's native scroll-to-bottom button opens a 500 ms allow window; nothing else does.
 *
 * Requirement (user ruling): anti-auto-scroll blocks only program-triggered scrolls; when the user actively clicks "scroll to bottom", the scroll is allowed.
 *
 * The window is observed only through its effect: a downward Element.scrollTo on the real message list, run through the real MAIN patch (content/prevent-auto-scroll.js via test/helpers/load-classic-script.js) in the same document. No dataset key is read here.
 *
 * Trusted events: happy-dom cannot mint isTrusted === true, so test/helpers/prevent-auto-scroll-harness.js gives the event instance an own isTrusted data property (see dispatchWithTrust). The bridge reads event.isTrusted as it would in Chrome; no test-only flag exists.
 *
 * DOM: the captured live message list (test/fixtures/ds-snapshots/conv2-finished-message-list.html) with the native _0706cde wrapper around the real role=button control, plus the extension's .dsw-gotop clone of that control in the same floating bar.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
    ALLOW_WINDOW_MS, LIST_SCROLL_HEIGHT, LIST_CLIENT_HEIGHT,
    installNativeScrollModel, loadMainPatch, loadBridgeWithFeatureOn, mountChatList, addGoTopClone,
    dispatchWithTrust, userClick, nativeTopOf, placeAt,
} from '../helpers/prevent-auto-scroll-harness.js';

const BOTTOM = LIST_SCROLL_HEIGHT - LIST_CLIENT_HEIGHT;
const USER_POSITION = 1000;

let api;
let page;
let goTopClone;
let testIndex = 0;
const BASE_TIME = new Date('2026-11-08T12:00:00Z').getTime();

beforeAll(async () => {
    installNativeScrollModel();
    api = await loadBridgeWithFeatureOn();
    page = mountChatList();
    goTopClone = addGoTopClone(page.floatingBar, page.nativeControl);
    // The bridge injects the MAIN patch; happy-dom cannot run a chrome-extension: URL, so the real file is run here instead, after the bridge element exists (production order).
    loadMainPatch();
});

beforeEach(() => {
    vi.useFakeTimers();
    // A fresh epoch per test lets any window opened by an earlier test lapse without touching bridge internals.
    testIndex += 1;
    vi.setSystemTime(BASE_TIME + testIndex * 60000);
    placeAt(page.list, USER_POSITION);
});

afterEach(() => {
    vi.useRealTimers();
});


/** What DeepSeek's native button handler does on click: jump the list to the bottom. */
function nativeJumpToBottom() {
    page.list.scrollTo({ top: page.list.scrollHeight, behavior: 'instant' });
}

describe('harness self-checks (pass on pre-fix code by design)', () => {
    it('protection is on: bridge reports enabled', () => {
        expect(api.isEnabled()).toBe(true);
    });

    it('a document capture listener reads isTrusted true from userClick and not true from el.click()', () => {
        const seen = [];
        const record = (e) => seen.push(e.isTrusted);
        document.addEventListener('click', record, true);
        try {
            userClick(page.nativeIcon);
            page.nativeControl.click();
        } finally {
            document.removeEventListener('click', record, true);
        }
        expect(seen[0]).toBe(true);
        expect(seen[1]).not.toBe(true);
    });

    it('with protection switched off, the same jump moves the list, so every blocked-case assertion below can fail', () => {
        api.setPersistent(false);
        try {
            nativeJumpToBottom();
            expect(nativeTopOf(page.list)).toBe(BOTTOM);
        } finally {
            api.setPersistent(true);
        }
        expect(api.isEnabled()).toBe(true);
    });

    it('with no press at all, a program-driven jump to the bottom is blocked', () => {
        nativeJumpToBottom();
        expect(nativeTopOf(page.list)).toBe(USER_POSITION);
    });
});

describe('trusted press inside the native go-bottom button opens the window', () => {
    it('trusted pointerdown alone on the native button icon: the jump to the bottom proceeds', () => {
        dispatchWithTrust(page.nativeIcon, 'pointerdown', true);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list), 'trusted pointerdown on the native button must open the allow window').toBe(BOTTOM);
    });

    it('trusted click alone on the native button icon: the jump to the bottom proceeds', () => {
        dispatchWithTrust(page.nativeIcon, 'click', true);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list), 'trusted click on the native button must open the allow window').toBe(BOTTOM);
    });

    it('trusted click on the native role=button control itself: the jump to the bottom proceeds', () => {
        dispatchWithTrust(page.nativeControl, 'click', true);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list), 'trusted click on the control element must open the allow window').toBe(BOTTOM);
    });

    it('the window is still open 450 ms after the trusted click', () => {
        dispatchWithTrust(page.nativeIcon, 'click', true);
        vi.advanceTimersByTime(450);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list), 'a scroll 450 ms after the press is inside the 500 ms window').toBe(BOTTOM);
    });
});

describe('window closes and stays shut for everything else (pass on pre-fix code by design)', () => {
    it('a jump 501 ms after the trusted click is blocked', () => {
        dispatchWithTrust(page.nativeIcon, 'click', true);
        vi.advanceTimersByTime(ALLOW_WINDOW_MS + 1);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list), 'the window must close after 500 ms').toBe(USER_POSITION);
    });

    it('untrusted el.click() on the native button does not open the window', () => {
        page.nativeControl.click();
        nativeJumpToBottom();
        expect(nativeTopOf(page.list)).toBe(USER_POSITION);
    });

    it('untrusted pointerdown and click (isTrusted === false, as Chrome reports script events) do not open the window', () => {
        dispatchWithTrust(page.nativeIcon, 'pointerdown', false);
        dispatchWithTrust(page.nativeIcon, 'click', false);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list)).toBe(USER_POSITION);
    });

    it('a trusted press on the extension .dsw-gotop clone does not open the window', () => {
        userClick(goTopClone.cloneIcon);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list), 'the clone is not the native scroll-to-bottom button').toBe(USER_POSITION);
    });

    it('a trusted press on the composer textarea does not open the window', () => {
        userClick(page.textarea);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list)).toBe(USER_POSITION);
    });

    it('a trusted press on the message list body does not open the window', () => {
        userClick(page.list);
        nativeJumpToBottom();
        expect(nativeTopOf(page.list)).toBe(USER_POSITION);
    });
});
