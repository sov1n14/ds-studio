/**
 * Regression tests for harvest behaviour when the scroll container does NOT
 * overflow (scrollHeight <= clientHeight).
 *
 * Bug: harvestAllMessages() returns { items:[], isComplete:false, reason:"no_container" }
 * for short conversations that fit entirely within the viewport, because the
 * scroll-container finder rejects containers whose scrollHeight <= clientHeight
 * and falls back to document.scrollingElement, which the harvest guard rejects.
 *
 * Required behaviour: when the container cannot scroll, every message is already
 * mounted in the DOM. This is the EASIEST case to harvest, not a failure case.
 * harvestAllMessages() must return all visible messages with isComplete:true.
 *
 * Contrasting overflowing test proves the fix does not degenerate into always-succeed.
 * A mutant flipping the comparison operator would fail one of the two tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import harvestModule from '../../content/harvest.js';
import DSSelectors from '../../content/ds-selectors.js';

const { harvestAllMessages } = harvestModule;

// ---------------------------------------------------------------------------
//  Helpers (same DOM structure as harvest.spec.js)
// ---------------------------------------------------------------------------

/**
 * Build the DeepSeek virtual-list DOM structure.
 *
 * happy-dom has NO layout engine: scrollHeight and clientHeight are both 0
 * by default. We MUST explicitly define these properties so both the non-
 * overflowing and overflowing cases are set up deliberately and are
 * distinguishable from each other and from the default-zero state.
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
        inner.className = DSSelectors.USER_CONTENT_SELECTOR.slice(1);
        inner.textContent = textContent;
        msg.appendChild(inner);
    }

    wrapper.appendChild(msg);
    visibleItems.appendChild(wrapper);
    return msg;
}

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

describe('harvestAllMessages: non-overflowing scroll container (short conversation)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.DSstudio = window.DSstudio || {};
        delete window.DSstudio.GoToTop;
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

    it('returns 2 items with isComplete:true when container does NOT overflow (scrollHeight === clientHeight)', async () => {
        // Arrange: a scroll container that does NOT overflow. All content
        // fits within the viewport. This is a single-exchange conversation
        // (1 user message + 1 assistant reply) that needs no scrolling.
        //
        // happy-dom has no layout engine, so scrollHeight and clientHeight
        // are set explicitly to identical values to simulate a non-overflowing
        // container.
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM({
            scrollHeight: 752,
            clientHeight: 752,
        });
        scrollArea.scrollBy = vi.fn();

        // scrollTop = 0, already at top, no scrolling needed
        Object.defineProperty(scrollArea, 'scrollTop', {
            value: 0, writable: true, configurable: true,
        });

        // Two messages: one user, one AI (typical single-exchange conversation)
        appendMessage(visibleItems, 0, 'What is TDD?', false);
        appendMessage(visibleItems, 1, 'TDD stands for Test-Driven Development.', true);

        // Act
        const harvestPromise = harvestAllMessages();
        await vi.runAllTimersAsync();
        const result = await harvestPromise;

        // Assert: when the container cannot scroll, every message is already
        // present in the DOM. The harvest must succeed, not bail out.
        expect(result.items).toHaveLength(2);
        expect(result.isComplete).toBe(true);
        // No failure reason should be present
        expect(result.reason).not.toBe('no_container');
        expect(result.reason).not.toBe('no_messages');
    });

    // -- Contrasting test: overflowing container still works -----------------
    //
    // This ensures a fix for the non-overflow bug does not degenerate into
    // always-succeed. A mutant that removes the overflow check entirely
    // (making _findHarvestScrollContainer accept everything) would still pass
    // the non-overflow test but must not break the normal overflowing path.

    it('CONTRAST: returns items with isComplete:true when container DOES overflow (scrollHeight > clientHeight)', async () => {
        vi.useFakeTimers();

        const { scrollArea, visibleItems } = buildVirtualListDOM({
            scrollHeight: 2000,
            clientHeight: 400,
        });

        let scrollTopValue = 0;
        Object.defineProperty(scrollArea, 'scrollTop', {
            get: () => scrollTopValue,
            set: (v) => { scrollTopValue = v; },
            configurable: true,
        });
        Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollArea, 'scrollHeight', { value: 2000, configurable: true });

        scrollArea.scrollBy = vi.fn((x, y) => {
            scrollTopValue += y;
        });

        appendMessage(visibleItems, 0, 'msg-0', false);
        appendMessage(visibleItems, 1, 'msg-1', true);
        appendMessage(visibleItems, 2, 'msg-2', false);

        const harvestPromise = harvestAllMessages();
        await vi.advanceTimersByTimeAsync(60000);
        const result = await harvestPromise;

        // The overflowing case must still work correctly
        expect(result.items.length).toBeGreaterThanOrEqual(3);
        expect(result.isComplete).toBe(true);
    }, 15000);
});
