/**
 * Scenario: the user clicks DeepSeek's native scroll-to-bottom button while anti-auto-scroll is on.
 *
 * Requirement (user ruling): anti-auto-scroll blocks only program-triggered scrolls; when the user actively clicks "scroll to bottom", it is allowed.
 *
 * Scenario trigger (CLAUDE.md Scenario Unit Tests): cross-module mutable state. The isolated-world bridge (content/prevent-auto-scroll-bridge.js) writes the allow window onto the shared bridge element and the MAIN-world patch (content/prevent-auto-scroll.js) reads it to decide. Both are the real modules in one document; only the trust boundaries are modelled (native scroll engine, isTrusted, chrome.runtime) by test/helpers/prevent-auto-scroll-harness.js.
 *
 * DeepSeek's native handler is modelled from the live probe: on click it calls Element.scrollTo({ top, behavior: 'instant' }) on .ds-virtual-list.ds-scroll-area, then the virtual list re-measures and repeats scrollTo up to 5 more times within about 25 ms, each time with a grown scrollHeight.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
    LIST_SCROLL_HEIGHT, LIST_CLIENT_HEIGHT,
    installNativeScrollModel, loadMainPatch, loadBridgeWithFeatureOn, mountChatList,
    userClick, scriptedClickSequence, nativeTopOf, placeAt,
} from '../helpers/prevent-auto-scroll-harness.js';

const USER_POSITION = 1000;
const REMEASURE_GROWTH = 120;
const REMEASURE_STEPS = [5, 10, 15, 20, 25];
const BASE_TIME = new Date('2026-11-08T12:00:00Z').getTime();

let api;
let page;
let testIndex = 0;

/** DeepSeek's onClick on the native role=button: jump to the bottom, then re-measure and jump again five times. */
function installDeepSeekGoBottomHandler(control, list, geometry) {
    control.addEventListener('click', () => {
        list.scrollTo({ top: list.scrollHeight, behavior: 'instant' });
        REMEASURE_STEPS.forEach((delay) => setTimeout(() => {
            geometry.scrollHeight += REMEASURE_GROWTH;
            list.scrollTo({ top: list.scrollHeight, behavior: 'instant' });
        }, delay));
    });
}

/** Program-driven auto-scroll as DeepSeek streams a reply: the same jump sequence with no user press. */
function streamingAutoScroll(list, geometry) {
    list.scrollTo({ top: list.scrollHeight, behavior: 'instant' });
    REMEASURE_STEPS.forEach((delay) => setTimeout(() => {
        geometry.scrollHeight += REMEASURE_GROWTH;
        list.scrollTo({ top: list.scrollHeight, behavior: 'instant' });
    }, delay));
}

function bottomOf(geometry) {
    return geometry.scrollHeight - geometry.clientHeight;
}

beforeAll(async () => {
    installNativeScrollModel();
    api = await loadBridgeWithFeatureOn();
    page = mountChatList();
    installDeepSeekGoBottomHandler(page.nativeControl, page.list, page.geometry);
    loadMainPatch();
});

beforeEach(() => {
    vi.useFakeTimers();
    testIndex += 1;
    vi.setSystemTime(BASE_TIME + testIndex * 60000);
    page.geometry.scrollHeight = LIST_SCROLL_HEIGHT;
    page.geometry.clientHeight = LIST_CLIENT_HEIGHT;
    placeAt(page.list, USER_POSITION);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('user clicks the native scroll-to-bottom button with anti-auto-scroll on', () => {
    it('precondition: protection is on (persistent, from settings)', () => {
        expect(api.isPersistent()).toBe(true);
        expect(api.isEnabled()).toBe(true);
    });

    it('the first jump lands at the bottom right away', () => {
        userClick(page.nativeIcon);
        expect(nativeTopOf(page.list), 'the user-initiated jump must move the list off the reading position').toBe(LIST_SCROLL_HEIGHT - LIST_CLIENT_HEIGHT);
    });

    it('after the re-measure burst settles the list sits at the final bottom', () => {
        userClick(page.nativeIcon);
        vi.advanceTimersByTime(30);
        expect(nativeTopOf(page.list), 'every re-measure jump inside the window must land, ending at the grown bottom').toBe(bottomOf(page.geometry));
        expect(page.geometry.scrollHeight).toBe(LIST_SCROLL_HEIGHT + REMEASURE_GROWTH * REMEASURE_STEPS.length);
    });

    it('once the window has passed, streaming auto-scroll is blocked again', () => {
        userClick(page.nativeIcon);
        vi.advanceTimersByTime(30);
        const settled = nativeTopOf(page.list);
        expect(settled, 'the click itself must have scrolled').toBe(bottomOf(page.geometry));
        vi.advanceTimersByTime(2000);
        streamingAutoScroll(page.list, page.geometry);
        vi.advanceTimersByTime(30);
        expect(nativeTopOf(page.list), 'program scrolls after the window must stay blocked').toBe(settled);
    });
});

describe('no user press: program scrolls stay blocked (pass on pre-fix code by design)', () => {
    it('streaming auto-scroll with no click leaves the list at the reading position', () => {
        streamingAutoScroll(page.list, page.geometry);
        vi.advanceTimersByTime(30);
        expect(nativeTopOf(page.list)).toBe(USER_POSITION);
    });

    it('a scripted (untrusted) click on the native button runs DeepSeek\'s handler but the jumps stay blocked', () => {
        scriptedClickSequence(page.nativeIcon);
        vi.advanceTimersByTime(30);
        expect(nativeTopOf(page.list), 'an extension or page script clicking the button is a program scroll').toBe(USER_POSITION);
    });
});
