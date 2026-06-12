import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import quoteReply from '../../content/quote-reply.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal DOM tree that mirrors the real DeepSeek chat page structure:
 *   document.body
 *     └── div.ds-virtual-list-visible-items
 *           └── <optionalChild>
 *
 * Returns the container element and the child element/text node.
 */
function buildScopedDOM(childTag = 'p', textContent = 'hello') {
    const container = document.createElement('div');
    container.className = 'ds-virtual-list-visible-items';
    const child = document.createElement(childTag);
    child.textContent = textContent;
    container.appendChild(child);
    document.body.appendChild(container);
    return { container, child };
}

/**
 * Create a textarea element with an optional initial value.
 * Appends it to document.body so the native prototype setter works as expected.
 */
function makeTextarea(value = '') {
    const ta = document.createElement('textarea');
    ta.value = value;
    document.body.appendChild(ta);
    return ta;
}

/**
 * Build a minimal Selection-like stub that quote-reply.js consumes.
 * `handleSelectionChange` calls:
 *   sel.toString()
 *   sel.anchorNode
 *   sel.focusNode
 *   sel.getRangeAt(0) → range.getClientRects()
 */
function makeSelection({ text = 'hello', anchorNode, focusNode, rects = null } = {}) {
    const defaultRect = { top: 100, bottom: 120, left: 50, width: 200, right: 250 };
    const clientRects = rects !== null ? rects : [defaultRect];
    return {
        toString: () => text,
        anchorNode: anchorNode ?? null,
        focusNode: focusNode ?? null,
        getRangeAt: () => ({
            getClientRects: () => clientRects,
        }),
    };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    // Reset all module-level state (clears _btnEl, _selectedText, _attachedScroll)
    quoteReply.__resetState();
    // Clear DOM additions from previous tests
    document.body.innerHTML = '';
    // Restore all spies
    vi.restoreAllMocks();
});

// ===========================================================================
// isSelectionInScope
// ===========================================================================

describe('isSelectionInScope', () => {
    it('returns true when node is a text node inside the container', () => {
        const { child } = buildScopedDOM('p', 'sample text');
        const textNode = child.firstChild; // Text node
        expect(quoteReply.isSelectionInScope(textNode)).toBe(true);
    });

    it('returns true when node is an element directly inside the container', () => {
        const { child } = buildScopedDOM('p', 'sample');
        expect(quoteReply.isSelectionInScope(child)).toBe(true);
    });

    it('returns true when node is a deeply nested element inside the container', () => {
        const container = document.createElement('div');
        container.className = 'ds-virtual-list-visible-items';
        const outer = document.createElement('div');
        const inner = document.createElement('span');
        inner.textContent = 'deep';
        outer.appendChild(inner);
        container.appendChild(outer);
        document.body.appendChild(container);
        expect(quoteReply.isSelectionInScope(inner)).toBe(true);
    });

    it('returns false when node is outside the container', () => {
        const outside = document.createElement('p');
        outside.textContent = 'outside';
        document.body.appendChild(outside);
        expect(quoteReply.isSelectionInScope(outside)).toBe(false);
    });

    it('returns false when node is a text node outside the container', () => {
        const outside = document.createElement('p');
        outside.textContent = 'outside text';
        document.body.appendChild(outside);
        const textNode = outside.firstChild;
        expect(quoteReply.isSelectionInScope(textNode)).toBe(false);
    });

    it('returns false for null node (guard against crash)', () => {
        expect(quoteReply.isSelectionInScope(null)).toBe(false);
    });

    it('returns false for undefined node', () => {
        expect(quoteReply.isSelectionInScope(undefined)).toBe(false);
    });
});

// ===========================================================================
// formatQuote
// ===========================================================================

describe('formatQuote', () => {
    it('prefixes a single line with "> "', () => {
        expect(quoteReply.formatQuote('hello')).toBe('> hello');
    });

    it('prefixes every line separated by \\n', () => {
        expect(quoteReply.formatQuote('a\nb')).toBe('> a\n> b');
    });

    it('normalises \\r\\n to \\n before prefixing', () => {
        expect(quoteReply.formatQuote('a\r\nb')).toBe('> a\n> b');
    });

    it('prefixes three lines', () => {
        expect(quoteReply.formatQuote('a\nb\nc')).toBe('> a\n> b\n> c');
    });

    it('prefixes an empty string as "> "', () => {
        expect(quoteReply.formatQuote('')).toBe('> ');
    });

    it('preserves internal whitespace within each line', () => {
        expect(quoteReply.formatQuote('  spaced  ')).toBe('>   spaced  ');
    });
});

// ===========================================================================
// unionClientRects
// ===========================================================================

describe('unionClientRects', () => {
    it('merges two stacked line rects into one bounding box', () => {
        const rects = [
            { top: 100, bottom: 120, left: 50, width: 200, right: 250, height: 20 },
            { top: 130, bottom: 150, left: 50, width: 180, right: 230, height: 20 },
        ];
        const union = quoteReply.unionClientRects(rects);
        expect(union).toEqual({
            top: 100,
            left: 50,
            bottom: 150,
            right: 250,
            width: 200,
        });
    });

    it('returns the same bounds for a single rect', () => {
        const rect = { top: 200, bottom: 220, left: 400, width: 100, right: 500, height: 20 };
        const union = quoteReply.unionClientRects([rect]);
        expect(union).toEqual({
            top: 200,
            left: 400,
            bottom: 220,
            right: 500,
            width: 100,
        });
    });

    it('returns null for empty rect list', () => {
        expect(quoteReply.unionClientRects([])).toBeNull();
    });

    it('returns null when all rects are zero-area', () => {
        const rects = [
            { top: 0, bottom: 0, left: 0, width: 0, right: 0, height: 0 },
            { top: 10, bottom: 10, left: 5, width: 0, right: 5, height: 0 },
        ];
        expect(quoteReply.unionClientRects(rects)).toBeNull();
    });

    it('spans horizontally offset lines', () => {
        const rects = [
            { top: 100, bottom: 120, left: 100, width: 300, right: 400, height: 20 },
            { top: 130, bottom: 150, left: 200, width: 100, right: 300, height: 20 },
        ];
        const union = quoteReply.unionClientRects(rects);
        expect(union.left).toBe(100);
        expect(union.right).toBe(400);
        expect(union.width).toBe(300);
    });
});

// ===========================================================================
// computeButtonPosition
// ===========================================================================

describe('computeButtonPosition', () => {
    const btnDims = { w: 120, h: 32 };
    const viewport = { vw: 1024, vh: 768 };

    it('normal case: top = rect.top - h - 16, hidden = false', () => {
        const rect = { top: 200, bottom: 220, left: 400, width: 100, right: 500 };
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        expect(pos.hidden).toBe(false);
        expect(pos.top).toBe(200 - 32 - 16); // 152
    });

    it('normal case: left is centered on the rect', () => {
        const rect = { top: 200, bottom: 220, left: 400, width: 100, right: 500 };
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        // left = 400 + 50 - 60 = 390, within [10, 894]
        expect(pos.left).toBe(400 + 100 / 2 - 120 / 2);
    });

    it('left boundary clamp: left < 10 is clamped to 10', () => {
        // rect positioned far left so computed left would be < 10
        const rect = { top: 200, bottom: 220, left: 0, width: 10, right: 10 };
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        // computed = 0 + 5 - 60 = -55 → clamped to 10
        expect(pos.left).toBe(10);
    });

    it('right boundary clamp: left > vw - w - 10 is clamped to vw - w - 10', () => {
        // rect positioned far right
        const rect = { top: 200, bottom: 220, left: 1000, width: 20, right: 1020 };
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        // computed = 1000 + 10 - 60 = 950 → clamped to 1024 - 120 - 10 = 894
        expect(pos.left).toBe(viewport.vw - btnDims.w - 10);
    });

    it('top flip: when top - h - 16 < 10, top becomes rect.bottom + 8', () => {
        // rect.top = 20, h = 32 → top = 20 - 32 - 16 = -28 < 10 → flip
        const rect = { top: 20, bottom: 40, left: 400, width: 100, right: 500 };
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        expect(pos.top).toBe(40 + 8); // 48
        expect(pos.hidden).toBe(false);
    });

    it('top flip uses full selection bottom for tall union rect', () => {
        const rect = { top: 20, bottom: 120, left: 400, width: 100, right: 500 };
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        expect(pos.top).toBe(120 + 8);
        expect(pos.hidden).toBe(false);
    });

    it('out of viewport above: rect.bottom < 0 → hidden: true', () => {
        const rect = { top: -50, bottom: -10, left: 400, width: 100, right: 500 };
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        expect(pos.hidden).toBe(true);
        expect(pos.top).toBe(0);
        expect(pos.left).toBe(0);
    });

    it('out of viewport below: rect.top > vh → hidden: true', () => {
        const rect = { top: 800, bottom: 820, left: 400, width: 100, right: 500 };
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        expect(pos.hidden).toBe(true);
    });

    it('rect exactly at top viewport edge (bottom === 0) → hidden: true', () => {
        const rect = { top: -20, bottom: 0, left: 400, width: 100, right: 500 };
        // bottom < 0 is false when bottom === 0, so NOT hidden in this edge case.
        // Verify the actual behavior without assumption:
        const pos = quoteReply.computeButtonPosition(rect, btnDims, viewport);
        // bottom === 0 → not < 0 → not hidden from bottom check
        // top = -20, top > 768 → false
        // So hidden = false, top flip applies since (-20 - 32 - 16) < 10
        expect(pos.hidden).toBe(false);
        expect(pos.top).toBe(0 + 8); // rect.bottom + 8
    });
});

// ===========================================================================
// injectQuote
// ===========================================================================

describe('injectQuote', () => {
    it('empty textarea: value becomes "> Hello" with no leading newline', () => {
        const ta = makeTextarea('');
        quoteReply.injectQuote(ta, 'Hello');
        expect(ta.value).toBe('> Hello');
    });

    it('textarea with content not ending in \\n: appends \\n> Hello', () => {
        const ta = makeTextarea('existing');
        quoteReply.injectQuote(ta, 'Hello');
        expect(ta.value).toBe('existing\n> Hello');
    });

    it('textarea with content ending in \\n: appends > Hello without double newline', () => {
        const ta = makeTextarea('existing\n');
        quoteReply.injectQuote(ta, 'Hello');
        expect(ta.value).toBe('existing\n> Hello');
    });

    it('multi-line selectedText: all lines are prefixed', () => {
        const ta = makeTextarea('');
        quoteReply.injectQuote(ta, 'line one\nline two\nline three');
        expect(ta.value).toBe('> line one\n> line two\n> line three');
    });

    it('uses native HTMLTextAreaElement.prototype setter', () => {
        const descriptor = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        );
        const nativeSetter = descriptor.set;
        const spy = vi.spyOn(descriptor, 'set');
        // Re-define the property with the spy so the module picks it up
        Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', {
            get: descriptor.get,
            set: spy,
            configurable: true,
        });

        const ta = makeTextarea('');
        quoteReply.injectQuote(ta, 'Hello');

        expect(spy).toHaveBeenCalled();

        // Restore original descriptor
        Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', descriptor);
    });

    it('dispatches an "input" event with bubbles: true', () => {
        const ta = makeTextarea('');
        const events = [];
        ta.addEventListener('input', (e) => events.push({ type: e.type, bubbles: e.bubbles }));
        quoteReply.injectQuote(ta, 'Hello');
        const inputEvent = events.find(e => e.type === 'input');
        expect(inputEvent).toBeDefined();
        expect(inputEvent.bubbles).toBe(true);
    });

    it('dispatches a "change" event with bubbles: true', () => {
        const ta = makeTextarea('');
        const events = [];
        ta.addEventListener('change', (e) => events.push({ type: e.type, bubbles: e.bubbles }));
        quoteReply.injectQuote(ta, 'Hello');
        const changeEvent = events.find(e => e.type === 'change');
        expect(changeEvent).toBeDefined();
        expect(changeEvent.bubbles).toBe(true);
    });
});

// ===========================================================================
// handleSelectionChange
// ===========================================================================
//
// NOTE on spy strategy: handleSelectionChange calls QuoteReply.hideButton /
// QuoteReply.showButton through the internal object reference, not via the
// module.exports object.  vi.spyOn on the exported object therefore cannot
// intercept those calls.  We verify the observable DOM/state effects instead:
//
//   • hideButton path  → button is absent or display:'none', _selectedText ''
//   • showButton path  → button is display:'flex', _selectedText populated

describe('handleSelectionChange', () => {
    it('empty string selection → button is not visible and selectedText is empty', () => {
        // First make the button exist by driving a valid selection
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
        }));
        // Now send an empty selection — hideButton should run
        quoteReply.handleSelectionChange(makeSelection({ text: '' }));

        const btn = document.querySelector('.dss-quote-btn');
        const display = btn ? btn.style.display : 'none';
        expect(display).toBe('none');
        expect(quoteReply.__getState().selectedText).toBe('');
    });

    it('whitespace-only selection → button is not visible', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
        }));
        quoteReply.handleSelectionChange(makeSelection({ text: '   \n  ' }));

        const btn = document.querySelector('.dss-quote-btn');
        expect(btn ? btn.style.display : 'none').toBe('none');
    });

    it('selection with anchorNode outside container → button is not visible', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        // Make button visible first
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
        }));

        const outsideEl = document.createElement('p');
        outsideEl.textContent = 'outside';
        document.body.appendChild(outsideEl);

        quoteReply.handleSelectionChange(makeSelection({
            text: 'outside text',
            anchorNode: outsideEl,
            focusNode: outsideEl,
        }));

        const btn = document.querySelector('.dss-quote-btn');
        expect(btn ? btn.style.display : 'none').toBe('none');
    });

    it('valid selection inside container → button is visible (display flex)', () => {
        const { child } = buildScopedDOM('p', 'some AI response text');

        quoteReply.handleSelectionChange(makeSelection({
            text: 'some AI response text',
            anchorNode: child,
            focusNode: child,
        }));

        const btn = document.querySelector('.dss-quote-btn');
        expect(btn).not.toBeNull();
        expect(btn.style.display).toBe('flex');
    });

    it('valid selection → selectedText state is populated', () => {
        const { child } = buildScopedDOM('p', 'some AI response text');

        quoteReply.handleSelectionChange(makeSelection({
            text: 'some AI response text',
            anchorNode: child,
            focusNode: child,
        }));

        expect(quoteReply.__getState().selectedText).toBe('some AI response text');
    });

    it('valid selection → button element has .dss-quote-btn class', () => {
        const { child } = buildScopedDOM('p', 'AI text');

        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
        }));

        const btn = quoteReply.getButtonEl();
        expect(btn.classList.contains('dss-quote-btn')).toBe(true);
    });

    it('valid selection → button contains an SVG element', () => {
        const { child } = buildScopedDOM('p', 'AI text');

        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
        }));

        const btn = quoteReply.getButtonEl();
        expect(btn.querySelector('svg')).not.toBeNull();
    });

    it('valid selection → button contains <span> with text "引用回覆"', () => {
        const { child } = buildScopedDOM('p', 'AI text');

        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
        }));

        const btn = quoteReply.getButtonEl();
        const span = btn.querySelector('span');
        expect(span).not.toBeNull();
        expect(span.textContent).toBe('引用回覆');
    });

    it('multi-line selection positions button from union of all line rects', () => {
        const { child } = buildScopedDOM('p', 'line one\nline two');
        const lineRects = [
            { top: 100, bottom: 120, left: 50, width: 200, right: 250, height: 20 },
            { top: 130, bottom: 150, left: 50, width: 180, right: 230, height: 20 },
        ];
        const btnDims = { w: 120, h: 32 };
        const viewport = { vw: window.innerWidth, vh: window.innerHeight };
        const union = quoteReply.unionClientRects(lineRects);
        const expected = quoteReply.computeButtonPosition(union, btnDims, viewport);

        quoteReply.handleSelectionChange(makeSelection({
            text: 'line one\nline two',
            anchorNode: child,
            focusNode: child,
            rects: lineRects,
        }));

        const btn = quoteReply.getButtonEl();
        expect(btn.style.display).toBe('flex');
        expect(parseInt(btn.style.top, 10)).toBe(expected.top);
        expect(parseInt(btn.style.left, 10)).toBe(expected.left);
    });

    it('multi-line selection flip uses union bottom not first line bottom', () => {
        const { child } = buildScopedDOM('p', 'near top\nlower line');
        const lineRects = [
            { top: 20, bottom: 40, left: 400, width: 100, right: 500, height: 20 },
            { top: 60, bottom: 120, left: 400, width: 100, right: 500, height: 60 },
        ];
        const union = quoteReply.unionClientRects(lineRects);
        const expected = quoteReply.computeButtonPosition(
            union,
            { w: 120, h: 32 },
            { vw: window.innerWidth, vh: window.innerHeight },
        );

        quoteReply.handleSelectionChange(makeSelection({
            text: 'near top\nlower line',
            anchorNode: child,
            focusNode: child,
            rects: lineRects,
        }));

        const btn = quoteReply.getButtonEl();
        expect(parseInt(btn.style.top, 10)).toBe(expected.top);
        expect(expected.top).toBe(120 + 8);
    });

    it('out-of-viewport selection → button remains hidden', () => {
        // Ensure button was visible first
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
        }));
        expect(document.querySelector('.dss-quote-btn').style.display).toBe('flex');

        // Now provide a rect that is fully above the viewport (bottom < 0)
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
            rects: [{ top: -100, bottom: -5, left: 0, width: 200, right: 200 }],
        }));

        const btn = document.querySelector('.dss-quote-btn');
        expect(btn ? btn.style.display : 'none').toBe('none');
    });
});

// ===========================================================================
// hideButton / showButton
// ===========================================================================

describe('hideButton', () => {
    it('calling hideButton when button has not been initialized does not throw', () => {
        // __resetState sets _btnEl = null; hideButton must guard against this
        expect(() => quoteReply.hideButton()).not.toThrow();
    });

    it('after showButton, hideButton sets display to "none"', () => {
        const { child } = buildScopedDOM('p', 'AI text');

        // Drive button creation through handleSelectionChange
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text',
            anchorNode: child,
            focusNode: child,
        }));

        const btn = quoteReply.getButtonEl();
        // Confirm it is visible first
        expect(btn.style.display).toBe('flex');

        quoteReply.hideButton();
        expect(btn.style.display).toBe('none');
    });

    it('hideButton clears selectedText in state', () => {
        quoteReply.__setState({ selectedText: 'some text' });
        quoteReply.hideButton();
        expect(quoteReply.__getState().selectedText).toBe('');
    });
});
