const QuoteReply = {
    isSelectionInScope(node) {
        if (!node) return false;
        const el = node.nodeType === 3 ? node.parentElement : node;
        return !!el.closest('div.ds-virtual-list-visible-items');
    },

    formatQuote(text) {
        return text.split(/\r?\n/).map(l => '> ' + l).join('\n');
    },

    unionClientRects(rects) {
        if (!rects || rects.length === 0) return null;

        let top = Infinity;
        let left = Infinity;
        let bottom = -Infinity;
        let right = -Infinity;

        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.width === 0 && r.height === 0) continue;
            top = Math.min(top, r.top);
            left = Math.min(left, r.left);
            bottom = Math.max(bottom, r.bottom);
            right = Math.max(right, r.right);
        }

        if (top === Infinity) return null;

        return { top, left, bottom, right, width: right - left };
    },

    computeButtonPosition(selectionRect, btnDims, viewport) {
        if (selectionRect.bottom < 0 || selectionRect.top > viewport.vh) {
            return { top: 0, left: 0, hidden: true };
        }

        let top = selectionRect.top - btnDims.h - 16;
        let left = selectionRect.left + selectionRect.width / 2 - btnDims.w / 2;

        left = Math.max(10, Math.min(left, viewport.vw - btnDims.w - 10));

        if (top < 10) {
            top = selectionRect.bottom + 8;
        }

        return { top, left, hidden: false };
    },

    getButtonEl() {
        if (!_btnEl) {
            if (!document.getElementById('dss-quote-reply-style')) {
                const style = document.createElement('style');
                style.id = 'dss-quote-reply-style';
                style.textContent = `
.dss-quote-btn {
  position: fixed;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  cursor: pointer;
  user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 500;
  background: #ffffff;
  color: #333333;
  border: 1px solid #e0e0e0;
  transition: opacity 0.15s;
}
@media (prefers-color-scheme: dark) {
  .dss-quote-btn {
    background: #2d2d2d;
    color: #e0e0e0;
    border-color: #555555;
  }
}
html[data-theme="dark"] .dss-quote-btn {
  background: #2d2d2d;
  color: #e0e0e0;
  border-color: #555555;
}
.dss-quote-btn:hover {
  opacity: 0.85;
}`;
                document.head.appendChild(style);
            }

            _btnEl = document.createElement('div');
            _btnEl.className = 'dss-quote-btn';
            _btnEl.style.display = 'none';
            _btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"></path></svg><span>引用回覆</span>`;

            _btnEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });

            _btnEl.addEventListener('click', () => {
                const textarea = document.querySelector('textarea');
                if (textarea) {
                    QuoteReply.injectQuote(textarea, _selectedText);
                }
                QuoteReply.hideButton();
            });

            document.body.appendChild(_btnEl);
        }

        return _btnEl;
    },

    showButton(top, left) {
        _btnEl.style.top = top + 'px';
        _btnEl.style.left = left + 'px';
        _btnEl.style.display = 'flex';

        if (!_attachedScroll) {
            window.addEventListener('scroll', _scrollHandler, { capture: true, passive: true });
            window.addEventListener('resize', _resizeHandler);
            _attachedScroll = true;
        }
    },

    hideButton() {
        if (_btnEl) {
            _btnEl.style.display = 'none';
        }

        if (_attachedScroll) {
            window.removeEventListener('scroll', _scrollHandler, { capture: true });
            window.removeEventListener('resize', _resizeHandler);
            _attachedScroll = false;
        }

        _selectedText = '';
    },

    injectQuote(textarea, selectedText) {
        const quoted = QuoteReply.formatQuote(selectedText);
        const current = textarea.value;
        const newVal = current === '' ? quoted : current + (current.endsWith('\n') ? '' : '\n') + quoted;

        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(textarea, newVal);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        textarea.focus();
        textarea.setSelectionRange(newVal.length, newVal.length);
    },

    handleSelectionChange(selectionLike) {
        const sel = selectionLike !== undefined ? selectionLike : window.getSelection();

        if (!sel || sel.toString().trim() === '') {
            QuoteReply.hideButton();
            return;
        }

        if (!QuoteReply.isSelectionInScope(sel.anchorNode) || !QuoteReply.isSelectionInScope(sel.focusNode)) {
            QuoteReply.hideButton();
            return;
        }

        _selectedText = sel.toString();

        const range = sel.getRangeAt(0);
        const rects = range.getClientRects();

        if (!rects || rects.length === 0) return;

        const selectionRect = QuoteReply.unionClientRects(rects);
        if (!selectionRect) return;

        const btn = QuoteReply.getButtonEl();
        const btnDims = { w: btn.offsetWidth || 120, h: btn.offsetHeight || 32 };
        const viewport = { vw: window.innerWidth, vh: window.innerHeight };

        const pos = QuoteReply.computeButtonPosition(selectionRect, btnDims, viewport);

        if (pos.hidden) {
            QuoteReply.hideButton();
        } else {
            QuoteReply.showButton(pos.top, pos.left);
        }
    },

    init() {
        if (!document.getElementById('dss-quote-reply-style')) {
            const style = document.createElement('style');
            style.id = 'dss-quote-reply-style';
            style.textContent = `
.dss-quote-btn {
  position: fixed;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  cursor: pointer;
  user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 500;
  background: #ffffff;
  color: #333333;
  border: 1px solid #e0e0e0;
  transition: opacity 0.15s;
}
@media (prefers-color-scheme: dark) {
  .dss-quote-btn {
    background: #2d2d2d;
    color: #e0e0e0;
    border-color: #555555;
  }
}
html[data-theme="dark"] .dss-quote-btn {
  background: #2d2d2d;
  color: #e0e0e0;
  border-color: #555555;
}
.dss-quote-btn:hover {
  opacity: 0.85;
}`;
            document.head.appendChild(style);
        }

        QuoteReply.getButtonEl();

        document.addEventListener('mouseup', () => {
            clearTimeout(_debounceTimer);
            _debounceTimer = setTimeout(() => QuoteReply.handleSelectionChange(), 250);
        });

        document.addEventListener('keyup', (e) => {
            if (e.isComposing) return;
            if (['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                clearTimeout(_debounceTimer);
                _debounceTimer = setTimeout(() => QuoteReply.handleSelectionChange(), 250);
            }
        });

        document.addEventListener('selectionchange', () => {
            clearTimeout(_debounceTimer);
            _debounceTimer = setTimeout(() => QuoteReply.handleSelectionChange(), 250);
        });

        document.addEventListener('mousedown', (e) => {
            if (_btnEl && !_btnEl.contains(e.target)) QuoteReply.hideButton();
        });
    },
};

let _btnEl = null;
let _selectedText = '';
let _attachedScroll = false;
let _debounceTimer = null;

function _scrollHandler() {
    requestAnimationFrame(() => QuoteReply.handleSelectionChange());
}

function _resizeHandler() {
    requestAnimationFrame(() => QuoteReply.handleSelectionChange());
}

if (typeof window !== 'undefined' && !window.__DSS_QR_INITIALIZED__) {
    window.__DSS_QR_INITIALIZED__ = true;
    QuoteReply.init();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        handleSelectionChange: QuoteReply.handleSelectionChange,
        injectQuote: QuoteReply.injectQuote,
        unionClientRects: QuoteReply.unionClientRects,
        computeButtonPosition: QuoteReply.computeButtonPosition,
        isSelectionInScope: QuoteReply.isSelectionInScope,
        formatQuote: QuoteReply.formatQuote,
        showButton: QuoteReply.showButton,
        hideButton: QuoteReply.hideButton,
        getButtonEl: QuoteReply.getButtonEl,
        __resetState: () => {
            _btnEl = null;
            _selectedText = '';
            _attachedScroll = false;
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        },
        __setState: (s) => {
            if ('selectedText' in s) _selectedText = s.selectedText;
        },
        __getState: () => ({
            selectedText: _selectedText,
            attachedScroll: _attachedScroll,
        }),
    };
}
