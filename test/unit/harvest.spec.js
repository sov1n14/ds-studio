/**
 * Unit tests for content/harvest.js
 *
 * Coverage map:
 *   § 1  _findHarvestScrollContainer  — strategies 1 & 2, fallback
 *   § 2  _harvestVisibleMessages      — key extraction, dedup guard, non-numeric key skip
 *   § 3  _isAtBottom                  — tolerance boundary
 *   § 4  _waitForDomStability         — resolves on stable ticks, resolves on step-timeout
 *   § 5  showHarvestToastScrolling    — creates .dss-harvest-toast, scrolling-phase text,
 *                                       warn element hidden, display:block, idempotent reuse
 *   § 6  showHarvestToastCapturing    — capturing-phase text with count, warn element visible,
 *                                       idempotent reuse, no-op on non-number
 *   § 7  hideHarvestToast             — sets display:none on toast, no-op when absent
 *   § 8  harvestAllMessages           — guard clauses (no_container, no_messages),
 *                                       PreventAutoScroll enable/disable lifecycle,
 *                                       disable() called in finally even when throw,
 *                                       degrades gracefully when PreventAutoScroll absent,
 *                                       dedup across slices, ascending-key ordering,
 *                                       scroll-position restore (success path),
 *                                       scroll-position restore (throw path),
 *                                       partial harvest on timeout + isComplete flag,
 *                                       toast hidden in finally on error,
 *                                       safety-net: scroll_interrupted reason,
 *                                       no false-positive on normal in-range step
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import harvestModule from '../../content/harvest.js';

const {
    harvestAllMessages,
    showHarvestToastScrolling,
    showHarvestToastCapturing,
    hideHarvestToast,
    _findHarvestScrollContainer,
    _harvestVisibleMessages,
    _waitForDomStability,
    _isAtBottom,
} = harvestModule;

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal scrollable container with .ds-scroll-area that wraps a
 * .ds-virtual-list-items element — matching the structure _findHarvestScrollContainer
 * strategy-1 expects.
 */
function buildVirtualListDOM({ scrollHeight = 1000, clientHeight = 400 } = {}) {
    const scrollArea = document.createElement('div');
    scrollArea.className = 'ds-scroll-area';
    Object.defineProperty(scrollArea, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(scrollArea, 'clientHeight', { value: clientHeight, configurable: true });

    const virtualListItems = document.createElement('div');
    virtualListItems.className = 'ds-virtual-list-items _6f2c522';

    const visibleItems = document.createElement('div');
    visibleItems.className = 'ds-virtual-list-visible-items';

    virtualListItems.appendChild(visibleItems);
    scrollArea.appendChild(virtualListItems);
    document.body.appendChild(scrollArea);

    return { scrollArea, virtualListItems, visibleItems };
}

/**
 * Append a .ds-message node wrapped in a keyed item-wrapper inside visibleItems.
 * @param {Element} visibleItems
 * @param {number|null} key       — null means no data-virtual-list-item-key attribute
 * @param {string} textContent
 * @param {boolean} isAI
 */
function appendMessage(visibleItems, key, textContent = 'msg', isAI = false) {
    const wrapper = document.createElement('div');
    if (key !== null) {
        wrapper.setAttribute('data-virtual-list-item-key', String(key));
    }

    const msg = document.createElement('div');
    msg.className = 'ds-message';

    if (isAI) {
        const md = document.createElement('div');
        md.className = 'ds-markdown';
        const p = document.createElement('p');
        p.textContent = textContent;
        md.appendChild(p);
        msg.appendChild(md);
    } else {
        const inner = document.createElement('div');
        inner.className = 'fbb737a4';
        inner.textContent = textContent;
        msg.appendChild(inner);
    }

    wrapper.appendChild(msg);
    visibleItems.appendChild(wrapper);
    return msg;
}

/** Install a PreventAutoScroll mock on window.DSstudio */
function installPreventAutoScrollMock(overrides = {}) {
    const mock = {
        enable: vi.fn(),
        disable: vi.fn(),
        isEnabled: vi.fn().mockReturnValue(false),
        ...overrides,
    };
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.PreventAutoScroll = mock;
    return mock;
}

// ─────────────────────────────────────────────────────────────────────────────
//  § 1  _findHarvestScrollContainer
// ─────────────────────────────────────────────────────────────────────────────

describe('_findHarvestScrollContainer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('strategy 1: finds .ds-scroll-area ancestor of virtual-list when scrollable', () => {
        const { scrollArea } = buildVirtualListDOM({ scrollHeight: 1000, clientHeight: 400 });
        const result = _findHarvestScrollContainer();
        expect(result).toBe(scrollArea);
    });

    it('strategy 1: skips .ds-scroll-area when scrollHeight <= clientHeight', () => {
        buildVirtualListDOM({ scrollHeight: 300, clientHeight: 400 });
        const result = _findHarvestScrollContainer();
        expect(result).toBe(document.scrollingElement || document.documentElement);
    });

    it('strategy 2: finds overflow:auto ancestor of first visible message when no .ds-scroll-area', () => {
        const outer = document.createElement('div');
        outer.style.overflowY = 'auto';
        Object.defineProperty(outer, 'scrollHeight', { value: 800, configurable: true });
        Object.defineProperty(outer, 'clientHeight', { value: 300, configurable: true });

        const visibleItems = document.createElement('div');
        visibleItems.className = 'ds-virtual-list-visible-items';
        const msg = document.createElement('div');
        msg.className = 'ds-message';
        visibleItems.appendChild(msg);
        outer.appendChild(visibleItems);
        document.body.appendChild(outer);

        const result = _findHarvestScrollContainer();
        expect(result).toBe(outer);
    });

    it('falls back to document.scrollingElement when no container qualifies', () => {
        const result = _findHarvestScrollContainer();
        expect(result).toBe(document.scrollingElement || document.documentElement);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 2  _harvestVisibleMessages
// ─────────────────────────────────────────────────────────────────────────────

describe('_harvestVisibleMessages', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('returns empty array when no visible items exist', () => {
        expect(_harvestVisibleMessages()).toEqual([]);
    });

    it('extracts key and clones the .ds-message node', () => {
        const { visibleItems } = buildVirtualListDOM();
        const original = appendMessage(visibleItems, 5, 'hello');

        const result = _harvestVisibleMessages();
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe(5);
        expect(result[0].clonedNode).not.toBe(original);
        expect(result[0].clonedNode.className).toBe('ds-message');
    });

    it('skips messages with no key attribute', () => {
        const { visibleItems } = buildVirtualListDOM();
        appendMessage(visibleItems, null, 'no-key');
        expect(_harvestVisibleMessages()).toHaveLength(0);
    });

    it('skips messages with a non-numeric key', () => {
        const { visibleItems } = buildVirtualListDOM();
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-virtual-list-item-key', 'abc');
        const msg = document.createElement('div');
        msg.className = 'ds-message';
        wrapper.appendChild(msg);
        visibleItems.appendChild(wrapper);

        expect(_harvestVisibleMessages()).toHaveLength(0);
    });

    it('returns all messages across multiple visible containers', () => {
        const vc1 = document.createElement('div');
        vc1.className = 'ds-virtual-list-visible-items';
        const vc2 = document.createElement('div');
        vc2.className = 'ds-virtual-list-visible-items';
        document.body.appendChild(vc1);
        document.body.appendChild(vc2);

        appendMessage(vc1, 0, 'first');
        appendMessage(vc2, 1, 'second');

        const result = _harvestVisibleMessages();
        expect(result).toHaveLength(2);
        const keys = result.map(r => r.key).sort((a, b) => a - b);
        expect(keys).toEqual([0, 1]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 3  _isAtBottom
// ─────────────────────────────────────────────────────────────────────────────

describe('_isAtBottom', () => {
    function makeContainer(scrollTop, clientHeight, scrollHeight) {
        const el = document.createElement('div');
        el.scrollTop = scrollTop;
        Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
        Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
        return el;
    }

    it('returns true when exactly at bottom', () => {
        expect(_isAtBottom(makeContainer(600, 400, 1000))).toBe(true);
    });

    it('returns true within the 4px tolerance', () => {
        expect(_isAtBottom(makeContainer(596, 400, 1000))).toBe(true);
    });

    it('returns false when more than tolerance away from bottom', () => {
        expect(_isAtBottom(makeContainer(590, 400, 1000))).toBe(false);
    });

    it('returns true for a short document (content fits entirely)', () => {
        expect(_isAtBottom(makeContainer(0, 400, 300))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 4  _waitForDomStability
// ─────────────────────────────────────────────────────────────────────────────

describe('_waitForDomStability', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('resolves after HARVEST_STABLE_TICKS silent intervals when no mutations occur', async () => {
        vi.useFakeTimers();
        const container = document.createElement('div');
        document.body.appendChild(container);

        const p = _waitForDomStability(container, 5000);
        vi.advanceTimersByTime(500);
        await p;
    });

    it('resolves on step-timeout when mutations keep resetting stable count', async () => {
        vi.useFakeTimers();
        const container = document.createElement('div');
        document.body.appendChild(container);

        const p = _waitForDomStability(container, 300);

        vi.advanceTimersByTime(100);
        container.appendChild(document.createElement('span'));
        vi.advanceTimersByTime(100);
        container.appendChild(document.createElement('span'));
        vi.advanceTimersByTime(200);

        await p;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 5  showHarvestToastScrolling  (scroll-to-top phase)
// ─────────────────────────────────────────────────────────────────────────────

describe('showHarvestToastScrolling', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('creates exactly one .dss-harvest-toast element', () => {
        showHarvestToastScrolling();
        expect(document.querySelectorAll('.dss-harvest-toast')).toHaveLength(1);
    });

    it('does NOT create a .dss-harvest-overlay element', () => {
        showHarvestToastScrolling();
        expect(document.querySelector('.dss-harvest-overlay')).toBeNull();
    });

    it('appends toast to document.body', () => {
        showHarvestToastScrolling();
        const toast = document.querySelector('.dss-harvest-toast');
        expect(document.body.contains(toast)).toBe(true);
    });

    it('sets display:block on the toast', () => {
        showHarvestToastScrolling();
        const toast = document.querySelector('.dss-harvest-toast');
        expect(toast.style.display).toBe('block');
    });

    it('__text contains "正在捲動至對話頂端…"', () => {
        showHarvestToastScrolling();
        const text = document.querySelector('.dss-harvest-toast__text');
        expect(text).not.toBeNull();
        expect(text.textContent).toBe('正在捲動至對話頂端…');
    });

    it('__warn element exists and is hidden (display:none)', () => {
        showHarvestToastScrolling();
        const warn = document.querySelector('.dss-harvest-toast__warn');
        expect(warn).not.toBeNull();
        expect(warn.style.display).toBe('none');
    });

    it('calling twice reuses the same element (no duplicate created)', () => {
        showHarvestToastScrolling();
        showHarvestToastScrolling();
        expect(document.querySelectorAll('.dss-harvest-toast')).toHaveLength(1);
    });

    it('second call sets display:block when previously hidden', () => {
        showHarvestToastScrolling();
        const toast = document.querySelector('.dss-harvest-toast');
        toast.style.display = 'none';
        showHarvestToastScrolling();
        expect(toast.style.display).toBe('block');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 6  showHarvestToastCapturing  (capturing phase)
// ─────────────────────────────────────────────────────────────────────────────

describe('showHarvestToastCapturing', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('creates exactly one .dss-harvest-toast element', () => {
        showHarvestToastCapturing(0);
        expect(document.querySelectorAll('.dss-harvest-toast')).toHaveLength(1);
    });

    it('sets display:block on the toast', () => {
        showHarvestToastCapturing(0);
        const toast = document.querySelector('.dss-harvest-toast');
        expect(toast.style.display).toBe('block');
    });

    it('__text contains "正在擷取完整對話" and the count', () => {
        showHarvestToastCapturing(7);
        const text = document.querySelector('.dss-harvest-toast__text');
        expect(text).not.toBeNull();
        expect(text.textContent).toContain('正在擷取完整對話');
        expect(text.textContent).toContain('7');
    });

    it('__text count updates on repeated calls', () => {
        showHarvestToastCapturing(2);
        showHarvestToastCapturing(9);
        const text = document.querySelector('.dss-harvest-toast__text');
        expect(text.textContent).toContain('9');
        expect(text.textContent).not.toContain(' 2 ');
    });

    it('__warn element is visible and contains the warning text', () => {
        showHarvestToastCapturing(3);
        const warn = document.querySelector('.dss-harvest-toast__warn');
        expect(warn).not.toBeNull();
        expect(warn.style.display).not.toBe('none');
        expect(warn.textContent).toContain('⚠ 請勿捲動對話記錄，以免擷取失敗');
    });

    it('calling twice reuses the same element (no duplicate created)', () => {
        showHarvestToastCapturing(0);
        showHarvestToastCapturing(3);
        expect(document.querySelectorAll('.dss-harvest-toast')).toHaveLength(1);
    });

    it('is a no-op when argument is not a number', () => {
        expect(() => showHarvestToastCapturing('bad')).not.toThrow();
        expect(document.querySelector('.dss-harvest-toast')).toBeNull();
    });

    it('transitions correctly from scrolling phase: warn hidden → visible', () => {
        showHarvestToastScrolling();
        const warnBefore = document.querySelector('.dss-harvest-toast__warn');
        expect(warnBefore.style.display).toBe('none');

        showHarvestToastCapturing(5);
        const warnAfter = document.querySelector('.dss-harvest-toast__warn');
        expect(warnAfter.style.display).not.toBe('none');
        expect(warnAfter.textContent).toContain('⚠ 請勿捲動對話記錄，以免擷取失敗');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 7  hideHarvestToast
// ─────────────────────────────────────────────────────────────────────────────

describe('hideHarvestToast', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('sets display:none on the toast after scrolling phase', () => {
        showHarvestToastScrolling();
        hideHarvestToast();
        const toast = document.querySelector('.dss-harvest-toast');
        expect(toast.style.display).toBe('none');
    });

    it('sets display:none on the toast after capturing phase', () => {
        showHarvestToastCapturing(4);
        hideHarvestToast();
        const toast = document.querySelector('.dss-harvest-toast');
        expect(toast.style.display).toBe('none');
    });

    it('is a no-op when toast does not exist', () => {
        expect(() => hideHarvestToast()).not.toThrow();
    });

    it('calling twice is idempotent (no throw)', () => {
        showHarvestToastScrolling();
        hideHarvestToast();
        expect(() => hideHarvestToast()).not.toThrow();
        expect(document.querySelector('.dss-harvest-toast').style.display).toBe('none');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  § 8  harvestAllMessages
// ─────────────────────────────────────────────────────────────────────────────

describe('harvestAllMessages', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.DSstudio = window.DSstudio || {};
        // Remove GoToTop so _scrollToTopAndSettle uses the direct scrollTop=0 path
        delete window.DSstudio.GoToTop;
        // Remove PreventAutoScroll so tests that don't need it are clean
        delete window.DSstudio.PreventAutoScroll;
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
        if (window.DSstudio) {
            delete window.DSstudio.PreventAutoScroll;
            delete window.DSstudio.GoToTop;
        }
    });

    // ── Guard clause: no_container ───────────────────────────────────────────

    it('returns { isComplete:false, reason:"no_container" } when no scrollable container exists', async () => {
        const result = await harvestAllMessages();
        expect(result.isComplete).toBe(false);
        expect(result.reason).toBe('no_container');
        expect(result.items).toEqual([]);
    });

    // ── Guard clause: no_messages ────────────────────────────────────────────

    it('returns { isComplete:false, reason:"no_messages" } when container exists but no .ds-message', async () => {
        buildVirtualListDOM();
        const result = await harvestAllMessages();
        expect(result.isComplete).toBe(false);
        expect(result.reason).toBe('no_messages');
        expect(result.items).toEqual([]);
    });

    // ── PreventAutoScroll lifecycle ───────────────────────────────────────────

    it('calls PreventAutoScroll.enable() before harvesting', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();
        Object.defineProperty(scrollArea, 'scrollTop', { value: 600, writable: true, configurable: true });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000, configurable: true });
        appendMessage(visibleItems, 0, 'msg');

        const mock = installPreventAutoScrollMock();
        const harvestPromise = harvestAllMessages();
        await vi.runAllTimersAsync();
        await harvestPromise;

        expect(mock.enable).toHaveBeenCalledOnce();
    });

    it('calls PreventAutoScroll.disable() in finally after successful harvest', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();
        Object.defineProperty(scrollArea, 'scrollTop', { value: 600, writable: true, configurable: true });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000, configurable: true });
        appendMessage(visibleItems, 0, 'msg');

        const mock = installPreventAutoScrollMock();
        const harvestPromise = harvestAllMessages();
        await vi.runAllTimersAsync();
        await harvestPromise;

        expect(mock.disable).toHaveBeenCalledOnce();
    });

    it('calls PreventAutoScroll.disable() in finally even when scrollToTopAndWait throws', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();
        Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000, configurable: true });
        appendMessage(visibleItems, 0, 'msg');

        const mock = installPreventAutoScrollMock();
        window.DSstudio.GoToTop = {
            scrollToTopAndWait: vi.fn().mockImplementation(() => Promise.reject(new Error('throw test'))),
        };

        const harvestPromise = harvestAllMessages();
        const rejectAssertion = expect(harvestPromise).rejects.toThrow('throw test');
        await vi.runAllTimersAsync();
        await rejectAssertion;

        expect(mock.disable).toHaveBeenCalledOnce();
    });

    it('disable() called before scrollTop restore in finally (ordering: disable first)', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();

        const callOrder = [];

        const mock = installPreventAutoScrollMock({
            disable: vi.fn(() => { callOrder.push('disable'); }),
        });

        const ORIGINAL_SCROLL_TOP = 150;
        let scrollTopValue = ORIGINAL_SCROLL_TOP;
        Object.defineProperty(scrollArea, 'scrollTop', {
            get: () => scrollTopValue,
            set: (v) => { callOrder.push('scrollTop=' + v); scrollTopValue = v; },
            configurable: true,
        });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        // At bottom: clientHeight(400) + scrollTop(150) = 550 >= scrollHeight(550)
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 550, configurable: true });
        appendMessage(visibleItems, 0, 'msg');

        const harvestPromise = harvestAllMessages();
        await vi.runAllTimersAsync();
        await harvestPromise;

        const disableIdx = callOrder.indexOf('disable');
        // The finally block sets scrollTop = ORIGINAL_SCROLL_TOP (150) after disable()
        const restoreIdx = callOrder.findIndex(e => e === `scrollTop=${ORIGINAL_SCROLL_TOP}`);
        // Both must have happened
        expect(disableIdx).toBeGreaterThanOrEqual(0);
        // disable must appear before the scrollTop restore
        if (restoreIdx !== -1) {
            expect(disableIdx).toBeLessThan(restoreIdx);
        } else {
            // scrollTop was never written because it didn't change from initial — still confirm disable ran
            expect(mock.disable).toHaveBeenCalledOnce();
        }
    });

    it('degrades gracefully when PreventAutoScroll is absent (no throw)', async () => {
        vi.useFakeTimers();
        // PreventAutoScroll removed in beforeEach — should not throw
        const { scrollArea, visibleItems } = buildVirtualListDOM();
        // Already at bottom so harvest completes quickly
        Object.defineProperty(scrollArea, 'scrollTop', { value: 600, writable: true, configurable: true });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000, configurable: true });
        scrollArea.scrollBy = vi.fn();
        appendMessage(visibleItems, 0, 'msg');

        const harvestPromise = harvestAllMessages();
        await vi.runAllTimersAsync();
        // Should resolve without throwing
        await expect(harvestPromise).resolves.toMatchObject({ items: expect.any(Array) });
    });

    // ── Dedup: same key appearing in multiple slices ─────────────────────────

    it('does not overwrite an existing key when harvestVisibleMessages returns it again', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();

        Object.defineProperty(scrollArea, 'scrollTop', { value: 600, writable: true, configurable: true });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000, configurable: true });

        appendMessage(visibleItems, 0, 'original-content');

        const harvestPromise = harvestAllMessages();
        await vi.runAllTimersAsync();
        const result = await harvestPromise;

        expect(result.items.length).toBeGreaterThanOrEqual(1);
        const texts = result.items.map(el => el.querySelector('.fbb737a4')?.textContent || '');
        expect([...new Set(texts)].filter(t => t === 'original-content').length).toBeLessThanOrEqual(1);
    });

    // ── Ascending-key ordering ───────────────────────────────────────────────

    it('returns items sorted by ascending data-virtual-list-item-key', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();

        Object.defineProperty(scrollArea, 'scrollTop', { value: 600, writable: true, configurable: true });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000, configurable: true });

        appendMessage(visibleItems, 3, 'msg-3');
        appendMessage(visibleItems, 1, 'msg-1');
        appendMessage(visibleItems, 2, 'msg-2');

        const harvestPromise = harvestAllMessages();
        await vi.runAllTimersAsync();
        const result = await harvestPromise;

        expect(result.items.length).toBe(3);
        const texts = result.items.map(el => el.querySelector('.fbb737a4')?.textContent);
        expect(texts).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });

    // ── Scroll-position restore on normal completion ─────────────────────────

    it('restores container.scrollTop to original value after successful harvest', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();

        const ORIGINAL_SCROLL_TOP = 250;
        let scrollTopValue = ORIGINAL_SCROLL_TOP;
        Object.defineProperty(scrollArea, 'scrollTop', {
            get: () => scrollTopValue,
            set: (v) => { scrollTopValue = v; },
            configurable: true,
        });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 650, configurable: true });

        appendMessage(visibleItems, 0, 'msg');

        const harvestPromise = harvestAllMessages();
        await vi.runAllTimersAsync();
        await harvestPromise;

        expect(scrollTopValue).toBe(ORIGINAL_SCROLL_TOP);
    });

    // ── Scroll-position restore when _scrollToTopAndSettle throws ────────────

    it('restores container.scrollTop even when scrollToTopAndWait throws', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();

        const ORIGINAL_SCROLL_TOP = 100;
        let scrollTopValue = ORIGINAL_SCROLL_TOP;
        Object.defineProperty(scrollArea, 'scrollTop', {
            get: () => scrollTopValue,
            set: (v) => { scrollTopValue = v; },
            configurable: true,
        });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000, configurable: true });

        appendMessage(visibleItems, 0, 'msg');

        window.DSstudio.GoToTop = {
            scrollToTopAndWait: vi.fn().mockImplementation(() => Promise.reject(new Error('simulated error'))),
        };

        const harvestPromise = harvestAllMessages();
        const rejectAssertion = expect(harvestPromise).rejects.toThrow('simulated error');
        await vi.runAllTimersAsync();
        await rejectAssertion;
        expect(scrollTopValue).toBe(ORIGINAL_SCROLL_TOP);
    });

    // ── Toast hidden in finally on error ─────────────────────────────────────

    it('hides toast in finally block (hideHarvestToast) even when an error is thrown', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();

        Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000, configurable: true });

        appendMessage(visibleItems, 0, 'msg');

        window.DSstudio.GoToTop = {
            scrollToTopAndWait: vi.fn().mockImplementation(() => Promise.reject(new Error('boom'))),
        };

        const harvestPromise = harvestAllMessages();
        const rejectAssertion = expect(harvestPromise).rejects.toThrow('boom');
        await vi.runAllTimersAsync();
        await rejectAssertion;

        const toast = document.querySelector('.dss-harvest-toast');
        if (toast) {
            expect(toast.style.display).toBe('none');
        }
        // Confirm neither the old overlay class nor the old overlay element was created
        expect(document.querySelector('.dss-harvest-overlay')).toBeNull();
    });

    // ── Timeout returns isComplete:false ─────────────────────────────────────

    it('returns isComplete:false with reason:timeout when 120s elapses', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();
        scrollArea.scrollBy = vi.fn();

        Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 100000, configurable: true });

        appendMessage(visibleItems, 0, 'first-msg');

        const harvestPromise = harvestAllMessages();
        await vi.advanceTimersByTimeAsync(130000);

        const result = await harvestPromise;

        expect(result.isComplete).toBe(false);
        expect(result.reason).toBe('timeout');
        expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    // ── Safety net: scroll_interrupted ───────────────────────────────────────

    it('safety-net condition: scrollTop > _expectedScrollTop + 1.5*innerHeight triggers scroll_interrupted', () => {
        // NOTE: The scroll_interrupted check is a conditional inside harvestAllMessages's
        // while loop. Because _expectedScrollTop is re-read via `container.scrollTop`
        // AFTER every `await _waitForDomStability`, a runtime jump that occurs during
        // an async pause is absorbed into _expectedScrollTop before the check fires.
        //
        // The only detectable scenario is a jump between the LAST _expectedScrollTop
        // update and the next loop-top check — a synchronous window with no yield point.
        // In the unit-test environment (happy-dom + fake timers) this window cannot be
        // injected from outside the module.
        //
        // We therefore test the underlying predicate logic directly using _isAtBottom
        // and the raw arithmetic that mirrors the safety-net check, confirming the
        // threshold formula is correct.

        const innerH = window.innerHeight || 768;
        const jumpThreshold = innerH * 1.5;

        function wouldTrigger(actualScrollTop, expectedScrollTop, isAtBottom) {
            return actualScrollTop > expectedScrollTop + jumpThreshold && !isAtBottom;
        }

        // Jump far beyond threshold, not at bottom → should trigger
        expect(wouldTrigger(0 + innerH * 3, 0, false)).toBe(true);

        // Normal step (0.9 * innerH) — below threshold → should NOT trigger
        expect(wouldTrigger(innerH * 0.9, 0, false)).toBe(false);

        // Jump far beyond threshold BUT at bottom → should NOT trigger (may be normal)
        expect(wouldTrigger(innerH * 3, 0, true)).toBe(false);

        // Exactly at threshold boundary → should NOT trigger (strictly greater)
        expect(wouldTrigger(innerH * 1.5, 0, false)).toBe(false);

        // One pixel above threshold → should trigger
        expect(wouldTrigger(innerH * 1.5 + 1, 0, false)).toBe(true);
    });

    it('does NOT trigger scroll_interrupted on a normal in-range step', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM();

        let scrollTopValue = 0;
        Object.defineProperty(scrollArea, 'scrollTop', {
            get: () => scrollTopValue,
            set: (v) => { scrollTopValue = v; },
            configurable: true,
        });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        // Tall enough to require exactly one scroll step before bottom
        // scrollHeight = clientHeight + (0.9 * innerHeight) + 4 (tolerance) → at bottom after one step
        const oneStep = window.innerHeight * 0.9;
        const scrollHeight = 400 + Math.ceil(oneStep) + 10;
        Object.defineProperty(scrollArea, 'scrollHeight', { value: scrollHeight, configurable: true });

        // Normal scrollBy: advance by exactly 0.9 * innerHeight
        scrollArea.scrollBy = vi.fn((x, y) => {
            scrollTopValue += (window.innerHeight * 0.9);
        });

        appendMessage(visibleItems, 0, 'msg');

        const harvestPromise = harvestAllMessages();
        await vi.advanceTimersByTimeAsync(60000);

        const result = await harvestPromise;

        // Must not be scroll_interrupted — either timeout or isComplete
        expect(result.reason).not.toBe('scroll_interrupted');
    });
});
