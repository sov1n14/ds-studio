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

import { describe, it, expect, beforeEach, afterEach, vi } from \x27vitest\x27;
import \x27../../utils/storage-manager.js\x27;
import GoToTop from \x27../../content/go-top.js\x27;
import { resetGoToTopState } from \x27../helpers/go-top-fixtures.js\x27;

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/**
 * Build the DeepSeek conversation DOM with a .ds-scroll-area containing
 * a virtual list and message wrappers.
 *
 * happy-dom has no layout engine: scrollHeight and clientHeight default to 0.
 * We define them explicitly so both non-overflow and overflow cases are
 * deliberate and distinguishable.
 *
 * @param {{ scrollHeight?: number, clientHeight?: number }} dims
 * @returns {{ scrollArea: Element, anchor: Element }}
 */
function buildConversationDOM({ scrollHeight = 752, clientHeight = 752 } = {}) {
    const scrollArea = document.createElement(\x27div\x27);
    scrollArea.className = \x27ds-scroll-area\x27;
    Object.defineProperty(scrollArea, \x27scrollHeight\x27, { value: scrollHeight, configurable: true });
    Object.defineProperty(scrollArea, \x27clientHeight\x27, { value: clientHeight, configurable: true });
    Object.defineProperty(scrollArea, \x27scrollTop\x27, { value: 0, writable: true, configurable: true });
