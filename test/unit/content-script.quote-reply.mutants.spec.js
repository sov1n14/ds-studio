import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import quoteReply from '../../content/quote-reply.js';

function buildScopedDOM(childTag = 'p', textContent = 'hello') {
    const container = document.createElement('div');
    container.className = 'ds-virtual-list-visible-items';
    const child = document.createElement(childTag);
    child.textContent = textContent;
    container.appendChild(child);
    document.body.appendChild(container);
    return { container, child };
}

function makeTextarea(value = '') {
    const ta = document.createElement('textarea');
    ta.value = value;
    document.body.appendChild(ta);
    return ta;
}

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

beforeEach(() => {
    quoteReply.state.btnEl = null;
    quoteReply.state.selectedText = '';
    quoteReply.state.isScrollAttached = false;
    quoteReply.state.hasLocaleSubscription = false;
    if (quoteReply.state.debounceTimer) clearTimeout(quoteReply.state.debounceTimer);
    quoteReply.state.debounceTimer = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('isSelectionInScope — div tag requirement', () => {
    it('returns false when container is span with matching class', () => {
        const container = document.createElement('span');
        container.className = 'ds-virtual-list-visible-items';
        const child = document.createElement('p');
        child.textContent = 'text';
        container.appendChild(child);
        document.body.appendChild(container);
        expect(quoteReply.isSelectionInScope(child)).toBe(false);
    });
});

describe('injectQuote — cursor behavior', () => {
    it('focuses the textarea after injection', () => {
        const ta = makeTextarea('');
        const focusSpy = vi.spyOn(ta, 'focus');
        quoteReply.injectQuote(ta, 'Hello');
        expect(focusSpy).toHaveBeenCalled();
    });

    it('sets cursor to end of injected text', () => {
        const ta = makeTextarea('');
        const rangeSpy = vi.spyOn(ta, 'setSelectionRange');
        quoteReply.injectQuote(ta, 'Hello');
        const expectedLen = '> Hello'.length;
        expect(rangeSpy).toHaveBeenCalledWith(expectedLen, expectedLen);
    });

    it('cursor at end with existing content', () => {
        const ta = makeTextarea('existing');
        const rangeSpy = vi.spyOn(ta, 'setSelectionRange');
        quoteReply.injectQuote(ta, 'Hello');
        const expectedLen = 'existing\n> Hello'.length;
        expect(rangeSpy).toHaveBeenCalledWith(expectedLen, expectedLen);
    });
});

describe('handleSelectionChange — null and whitespace', () => {
    it('null selection hides button', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text', anchorNode: child, focusNode: child,
        }));
        expect(document.querySelector('.dss-quote-btn').style.display).toBe('flex');
        quoteReply.handleSelectionChange(null);
        expect(document.querySelector('.dss-quote-btn').style.display).toBe('none');
    });

    it('tab-only selection treated as empty', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text', anchorNode: child, focusNode: child,
        }));
        quoteReply.handleSelectionChange(makeSelection({ text: '\t\t' }));
        expect(document.querySelector('.dss-quote-btn').style.display).toBe('none');
    });
});

describe('handleSelectionChange — both nodes scope', () => {
    it('anchorNode in scope, focusNode outside hides button', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        const outside = document.createElement('p');
        outside.textContent = 'outside';
        document.body.appendChild(outside);
        quoteReply.handleSelectionChange(makeSelection({
            text: 'selected', anchorNode: child, focusNode: outside,
        }));
        const btn = document.querySelector('.dss-quote-btn');
        expect(btn ? btn.style.display : 'none').toBe('none');
    });

    it('focusNode in scope, anchorNode outside hides button', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        const outside = document.createElement('p');
        outside.textContent = 'outside';
        document.body.appendChild(outside);
        quoteReply.handleSelectionChange(makeSelection({
            text: 'selected', anchorNode: outside, focusNode: child,
        }));
        const btn = document.querySelector('.dss-quote-btn');
        expect(btn ? btn.style.display : 'none').toBe('none');
    });
});

describe('handleSelectionChange — rects guards', () => {
    it('empty rects returns early', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text', anchorNode: child, focusNode: child, rects: [],
        }));
        const btn = document.querySelector('.dss-quote-btn');
        expect(btn ? btn.style.display : 'none').toBe('none');
    });

    it('zero-area rects returns early', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text', anchorNode: child, focusNode: child,
            rects: [{ top: 0, bottom: 0, left: 0, width: 0, right: 0, height: 0 }],
        }));
        const btn = document.querySelector('.dss-quote-btn');
        expect(btn ? btn.style.display : 'none').toBe('none');
    });
});

describe('handleSelectionEvent — debounce', () => {
    it('rapid calls only fire once', () => {
        vi.useFakeTimers();
        const spy = vi.spyOn(quoteReply.state, 'handleSelectionChange');
        quoteReply.state.handleSelectionEvent();
        vi.advanceTimersByTime(100);
        quoteReply.state.handleSelectionEvent();
        vi.advanceTimersByTime(250);
        expect(spy).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});

describe('enable/disable — mousedown listener', () => {
    it('registers mousedown on enable', () => {
        const spy = vi.spyOn(document, 'addEventListener');
        quoteReply.enable();
        expect(spy.mock.calls.find(c => c[0] === 'mousedown')).toBeDefined();
        quoteReply.disable();
    });

    it('removes mousedown on disable', () => {
        quoteReply.enable();
        const spy = vi.spyOn(document, 'removeEventListener');
        quoteReply.disable();
        expect(spy.mock.calls.find(c => c[0] === 'mousedown')).toBeDefined();
    });
});

describe('enable — locale subscription', () => {
    it('subscribes to locale changes', () => {
        const spy = vi.spyOn(globalThis.dsI18n, 'onLocaleChanged');
        quoteReply.state.hasLocaleSubscription = false;
        quoteReply.enable();
        expect(spy).toHaveBeenCalledWith(quoteReply.state.handleLocaleChanged);
        quoteReply.disable();
    });

    it('does not double-subscribe', () => {
        const spy = vi.spyOn(globalThis.dsI18n, 'onLocaleChanged');
        quoteReply.state.hasLocaleSubscription = false;
        quoteReply.enable();
        quoteReply.enable();
        expect(spy).toHaveBeenCalledTimes(1);
        quoteReply.disable();
    });

    it('sets hasLocaleSubscription to true', () => {
        quoteReply.state.hasLocaleSubscription = false;
        quoteReply.enable();
        expect(quoteReply.state.hasLocaleSubscription).toBe(true);
        quoteReply.disable();
    });
});

describe('disable — cleanup', () => {
    it('removes button from DOM', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.enable();
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text', anchorNode: child, focusNode: child,
        }));
        expect(document.querySelector('.dss-quote-btn')).not.toBeNull();
        quoteReply.disable();
        expect(document.querySelector('.dss-quote-btn')).toBeNull();
    });

    it('clears selectedText', () => {
        quoteReply.state.selectedText = 'something';
        quoteReply.enable();
        quoteReply.disable();
        expect(quoteReply.state.selectedText).toBe('');
    });
});

describe('handleDocumentMouseDown', () => {
    it('click outside button hides it', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.enable();
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text', anchorNode: child, focusNode: child,
        }));
        const btn = document.querySelector('.dss-quote-btn');
        expect(btn.style.display).toBe('flex');
        const outsideEl = document.createElement('div');
        document.body.appendChild(outsideEl);
        quoteReply.state.handleDocumentMouseDown({ target: outsideEl });
        expect(btn.style.display).toBe('none');
    });

    it('click on button does not hide it', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.enable();
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text', anchorNode: child, focusNode: child,
        }));
        const btn = document.querySelector('.dss-quote-btn');
        expect(btn.style.display).toBe('flex');
        quoteReply.state.handleDocumentMouseDown({ target: btn });
        expect(btn.style.display).toBe('flex');
    });

    it('no button does not throw', () => {
        quoteReply.state.btnEl = null;
        expect(() => quoteReply.state.handleDocumentMouseDown({ target: document.body })).not.toThrow();
    });
});

describe('handleLocaleChanged', () => {
    it('updates label and preserves SVG', () => {
        const { child } = buildScopedDOM('p', 'AI text');
        quoteReply.enable();
        quoteReply.handleSelectionChange(makeSelection({
            text: 'AI text', anchorNode: child, focusNode: child,
        }));
        const btn = quoteReply.state.btnEl;
        const originalT = globalThis.dsI18n.t;
        globalThis.dsI18n.t = vi.fn(() => 'Quote Reply');
        quoteReply.state.handleLocaleChanged();
        expect(btn.querySelector('span').textContent).toBe('Quote Reply');
        expect(btn.querySelector('svg')).not.toBeNull();
        globalThis.dsI18n.t = originalT;
    });

    it('noop when btnEl is null', () => {
        quoteReply.state.btnEl = null;
        expect(() => quoteReply.state.handleLocaleChanged()).not.toThrow();
    });
});

describe('handleViewportChange', () => {
    it('calls handleSelectionChange via rAF', () => {
        const spy = vi.spyOn(quoteReply.state, 'handleSelectionChange');
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(); return 0; });
        quoteReply.state.handleViewportChange();
        expect(spy).toHaveBeenCalled();
    });
});

describe('showButton — scroll listeners', () => {
    it('attaches scroll and resize on first show', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        quoteReply.state.isScrollAttached = false;
        quoteReply.getButtonEl();
        quoteReply.showButton(100, 200);
        expect(addSpy.mock.calls.find(c => c[0] === 'scroll')).toBeDefined();
        expect(addSpy.mock.calls.find(c => c[0] === 'resize')).toBeDefined();
        expect(quoteReply.state.isScrollAttached).toBe(true);
        quoteReply.hideButton();
    });
});

describe('hideButton — scroll listeners', () => {
    it('removes scroll and resize listeners', () => {
        quoteReply.getButtonEl();
        quoteReply.showButton(100, 200);
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        quoteReply.hideButton();
        expect(removeSpy.mock.calls.find(c => c[0] === 'scroll')).toBeDefined();
        expect(removeSpy.mock.calls.find(c => c[0] === 'resize')).toBeDefined();
        expect(quoteReply.state.isScrollAttached).toBe(false);
    });
});
