/**
 * Regression tests for go-top behaviour when the scroll container does NOT
 * overflow (scrollHeight <= clientHeight).
 *
 * Bug: _findScrollContainer() rejects a .ds-scroll-area whose
 * scrollHeight <= clientHeight (lines 198, 213, 228) and falls back to
 * document.scrollingElement. go-top.scroll.js then sets _scrollContainer = null,
 * which removes the scrollTop fast path in _isAtTop(), forcing reliance on the
 * anchor selector. After MAX_ANCHOR_RETRIES, scrollToTopAndWait resolves
 * { success: false } -- breaking export for single-exchange conversations.
 *
 * Required behaviour (per comment at go-top.scroll.js:60-61): a non-overflowing
 * container is still a valid container. Non-overflow means "content is short",
 * not "container is invalid".
 *
 * Mirrors test/unit/harvest.non-overflow.spec.js (the same bug class in
 * harvest.dom.js, fixed in commit d682b21).
 *
 * Secondary defect: go-top.scroll.js lines 140 and 152 resolve
 * { success: false } with NO reason property, collapsing every distinct
 * failure mode into one generic alert. A failed scroll must carry a
 * machine-readable reason so the caller can tell the user something true.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState } from '../helpers/go-top-fixtures.js';

function buildConversationDOM({ scrollHeight = 752, clientHeight = 752 } = {}) {
    const scrollArea = document.createElement('div');
    scrollArea.className = 'ds-scroll-area';
    Object.defineProperty(scrollArea, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(scrollArea, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });
    const virtualListItems = document.createElement('div');
    virtualListItems.className = 'ds-virtual-list-items';
    const visibleItems = document.createElement('div');
    visibleItems.className = 'ds-virtual-list-visible-items';
    const wrapper1 = document.createElement('div');
    wrapper1.setAttribute('data-virtual-list-item-key', '1');
    const msg1 = document.createElement('div');
    msg1.className = 'ds-message';
    wrapper1.appendChild(msg1);
    const wrapper2 = document.createElement('div');
    wrapper2.setAttribute('data-virtual-list-item-key', '2');
    const msg2 = document.createElement('div');
    msg2.className = 'ds-message';
    const md = document.createElement('div');
    md.className = 'ds-markdown';
    md.textContent = 'reply';
    msg2.appendChild(md);
    wrapper2.appendChild(msg2);
    visibleItems.appendChild(wrapper1);
    visibleItems.appendChild(wrapper2);
    virtualListItems.appendChild(visibleItems);
    scrollArea.appendChild(virtualListItems);
    document.body.appendChild(scrollArea);
    return { scrollArea, anchor: wrapper1 };
}

function buildVirtualListOnlyDOM({ scrollHeight = 752, clientHeight = 752 } = {}) {
    const scrollArea = document.createElement('div');
    scrollArea.className = 'ds-scroll-area';
    Object.defineProperty(scrollArea, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(scrollArea, 'clientHeight', { value: clientHeight, configurable: true });
    const virtualListItems = document.createElement('div');
    virtualListItems.className = 'ds-virtual-list-items';
    scrollArea.appendChild(virtualListItems);
    document.body.appendChild(scrollArea);
    const anchor = document.createElement('span');
    document.body.appendChild(anchor);
    return { scrollArea, anchor };
}

function buildOverflowAutoDOM({ scrollHeight = 752, clientHeight = 752 } = {}) {
    const container = document.createElement('div');
    container.style.overflowY = 'auto';
    Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true });
    const anchor = document.createElement('span');
    container.appendChild(anchor);
    document.body.appendChild(container);
    return { container, anchor };
}

describe('GoToTop: non-overflowing scroll container (short conversation)', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { vi.useRealTimers(); });

    it('_findScrollContainer returns .ds-scroll-area via anchor walk-up even when scrollHeight === clientHeight', () => {
        const { scrollArea, anchor } = buildConversationDOM({ scrollHeight: 752, clientHeight: 752 });
        const result = GoToTop._findScrollContainer(anchor);
        expect(result).toBe(scrollArea);
        expect(GoToTop._scrollContainer).toBe(scrollArea);
    });

    it('_findScrollContainer returns .ds-scroll-area via virtual-list walk-up even when scrollHeight === clientHeight', () => {
        const { scrollArea, anchor } = buildVirtualListOnlyDOM({ scrollHeight: 600, clientHeight: 600 });
        const result = GoToTop._findScrollContainer(anchor);
        expect(result).toBe(scrollArea);
        expect(GoToTop._scrollContainer).toBe(scrollArea);
    });

    it('_findScrollContainer returns overflow-y:auto ancestor even when scrollHeight === clientHeight', () => {
        const { container, anchor } = buildOverflowAutoDOM({ scrollHeight: 400, clientHeight: 400 });
        const result = GoToTop._findScrollContainer(anchor);
        expect(result).toBe(container);
        expect(GoToTop._scrollContainer).toBe(container);
    });

    it('CONTRAST: _findScrollContainer returns .ds-scroll-area when scrollHeight > clientHeight', () => {
        const { scrollArea, anchor } = buildConversationDOM({ scrollHeight: 2000, clientHeight: 400 });
        const result = GoToTop._findScrollContainer(anchor);
        expect(result).toBe(scrollArea);
        expect(GoToTop._scrollContainer).toBe(scrollArea);
    });

    it('CONTRAST: _findScrollContainer falls back to document.scrollingElement when no scrollable ancestor exists', () => {
        const anchor = document.createElement('span');
        document.body.appendChild(anchor);
        GoToTop._scrollContainer = null;
        const fallback = document.scrollingElement || document.documentElement;
        const result = GoToTop._findScrollContainer(anchor);
        expect(result).toBe(fallback);
        expect(GoToTop._scrollContainer).toBeNull();
    });

    it('scrollToTopAndWait resolves { success: true } when container does not overflow', async () => {
        vi.useFakeTimers();
        const { scrollArea } = buildConversationDOM({ scrollHeight: 752, clientHeight: 752 });
        scrollArea.scrollBy = vi.fn();
        GoToTop._scrollContainer = null;
        GoToTop._isLocked = false;
        GoToTop.enabled = true;
        GoToTop._masterEnabled = true;
        GoToTop.TIMEOUT = 5000;
        const promise = GoToTop.scrollToTopAndWait({ timeout: 5000 });
        await vi.advanceTimersByTimeAsync(2000);
        const result = await promise;
        expect(result).toEqual({ success: true });
    }, 10000);

    it('scrollToTopAndWait resolves with a defined non-empty reason when scroll fails', async () => {
        vi.useFakeTimers();
        const container = document.createElement('div');
        container.style.overflowY = 'auto';
        Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true });
        Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
        container.scrollBy = vi.fn();
        document.body.appendChild(container);
        GoToTop._scrollContainer = container;
        GoToTop._isLocked = false;
        GoToTop.enabled = true;
        GoToTop._masterEnabled = true;
        GoToTop.TIMEOUT = 5000;
        // _isAtTop returns false to simulate anchor verification failure
        // (the anchor-based confirmation disagrees with scrollTop position).
        // This drives the retry loop to exhaustion via the consecutiveMisses path.
        vi.spyOn(GoToTop, '_isAtTop').mockReturnValue(false);
        const promise = GoToTop.scrollToTopAndWait({ timeout: 20000 });
        await vi.advanceTimersByTimeAsync(20000);
        const result = await promise;
        expect(result.success).toBe(false);
        expect(result).toHaveProperty('reason');
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
    }, 30000);
});
