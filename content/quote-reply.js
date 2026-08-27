/**
 * DS studio — 引用回覆（content/quote-reply.js）
 *
 * 選取對話區文字 → 浮出「引用回覆」按鈕 → 點擊後把引用文字寫入輸入框。
 * 生命週期交由 content/feature-toggle.js 的 registerFeatureToggle 閘控：
 * ownKey 為 null，代表僅跟隨總開關；關閉時拆除所有 document 監聽器、
 * 清掉待執行的防抖計時器並移除按鈕，開啟時重新掛上。
 */

// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DS_QuoteReplySelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

/** 選取變更後的防抖間隔（ms）：selectionchange 於拖曳選取期間會連續觸發 */
const QUOTE_REPLY_DEBOUNCE_MS = 250;

/** 於呼叫時解析開關管線，同時支援瀏覽器全域與單元測試的 require。 */
function __ds_resolveQuoteReplyToggle() {
    return globalThis.DSSFeatureToggle
        || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
}

const QuoteReply = {
    // === 狀態：集中於功能物件，不使用模組層級 let ===
    btnEl: null,
    selectedText: '',
    isScrollAttached: false,
    debounceTimer: null,
    unregisterToggle: null,
    hasLocaleSubscription: false,

    isSelectionInScope(node) {
        if (!node) return false;
        const el = node.nodeType === 3 ? node.parentElement : node;
        return !!el.closest('div' + __DS_QuoteReplySelectors.VISIBLE_ITEMS_SELECTOR);
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
        if (!QuoteReply.btnEl) {
            const btn = document.createElement('div');
            btn.className = 'dss-quote-btn';
            btn.style.display = 'none';
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"></path></svg><span>${dsI18n.t('quoteReplyBtnLabel')}</span>`;

            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });

            btn.addEventListener('click', () => {
                const textarea = document.querySelector(__DS_QuoteReplySelectors.INPUT_TEXTAREA_SELECTOR);
                if (textarea) {
                    QuoteReply.injectQuote(textarea, QuoteReply.selectedText);
                }
                QuoteReply.hideButton();
            });

            QuoteReply.btnEl = btn;
            document.body.appendChild(btn);
        }

        return QuoteReply.btnEl;
    },

    showButton(top, left) {
        QuoteReply.btnEl.style.top = top + 'px';
        QuoteReply.btnEl.style.left = left + 'px';
        QuoteReply.btnEl.style.display = 'flex';

        if (!QuoteReply.isScrollAttached) {
            window.addEventListener('scroll', QuoteReply.handleViewportChange, { capture: true, passive: true });
            window.addEventListener('resize', QuoteReply.handleViewportChange);
            QuoteReply.isScrollAttached = true;
        }
    },

    hideButton() {
        if (QuoteReply.btnEl) {
            QuoteReply.btnEl.style.display = 'none';
        }

        if (QuoteReply.isScrollAttached) {
            window.removeEventListener('scroll', QuoteReply.handleViewportChange, { capture: true });
            window.removeEventListener('resize', QuoteReply.handleViewportChange);
            QuoteReply.isScrollAttached = false;
        }

        QuoteReply.selectedText = '';
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

        QuoteReply.selectedText = sel.toString();

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

    // === 事件處理器：箭頭函式屬性，參考位址穩定，removeEventListener 才拆得掉 ===

    /** 唯一的防抖排程入口：selectionchange 已涵蓋滑鼠與鍵盤造成的選取變化。 */
    handleSelectionEvent: () => {
        clearTimeout(QuoteReply.debounceTimer);
        QuoteReply.debounceTimer = setTimeout(() => QuoteReply.handleSelectionChange(), QUOTE_REPLY_DEBOUNCE_MS);
    },

    /** 點擊按鈕以外的區域即收起按鈕。 */
    handleDocumentMouseDown: (e) => {
        if (QuoteReply.btnEl && !QuoteReply.btnEl.contains(e.target)) QuoteReply.hideButton();
    },

    /** 捲動或縮放後重新定位；僅在按鈕顯示期間掛載。 */
    handleViewportChange: () => {
        requestAnimationFrame(() => QuoteReply.handleSelectionChange());
    },

    /** 即時語系切換：更新已存在的按鈕文字。 */
    handleLocaleChanged: () => {
        if (!QuoteReply.btnEl) return;
        const svg = QuoteReply.btnEl.querySelector('svg');
        QuoteReply.btnEl.innerHTML = '';
        if (svg) QuoteReply.btnEl.appendChild(svg);
        const span = document.createElement('span');
        span.textContent = dsI18n.t('quoteReplyBtnLabel');
        QuoteReply.btnEl.appendChild(span);
    },

    // === 生命週期 ===

    enable() {
        QuoteReply.getButtonEl();
        document.addEventListener('selectionchange', QuoteReply.handleSelectionEvent);
        document.addEventListener('mousedown', QuoteReply.handleDocumentMouseDown);
        // dsI18n 訂閱無退訂機制，故只訂閱一次並常駐；
        // 關閉期間 disable() 已把 btnEl 清為 null，handleLocaleChanged 自然成為無操作。
        if (!QuoteReply.hasLocaleSubscription) {
            QuoteReply.hasLocaleSubscription = true;
            dsI18n.onLocaleChanged(QuoteReply.handleLocaleChanged);
        }
    },

    disable() {
        document.removeEventListener('selectionchange', QuoteReply.handleSelectionEvent);
        document.removeEventListener('mousedown', QuoteReply.handleDocumentMouseDown);

        clearTimeout(QuoteReply.debounceTimer);
        QuoteReply.debounceTimer = null;

        // hideButton 一併拆掉 scroll / resize 監聽器
        QuoteReply.hideButton();
        if (QuoteReply.btnEl) {
            QuoteReply.btnEl.remove();
            QuoteReply.btnEl = null;
        }
    },

    init() {
        const featureToggle = __ds_resolveQuoteReplyToggle();
        if (!featureToggle) {
            throw new Error('content/quote-reply.js 需要 content/feature-toggle.js 先行載入');
        }

        QuoteReply.unregisterToggle = featureToggle.registerFeatureToggle({
            ownKey: null,
            onEnable: QuoteReply.enable,
            onDisable: QuoteReply.disable,
        });
    },
};

// 啟動點：沿用 content 層功能模組的 bootstrap 慣例（模組層級 side effect 為此類
// 功能模組既有、刻意的設計，見 prevent-auto-scroll-bridge.js）。
// init 只註冊開關，監聽器掛載延後至總開關判定為開啟時才發生。
if (typeof window !== 'undefined' && !window.__DSS_QR_INITIALIZED__) {
    window.__DSS_QR_INITIALIZED__ = true;
    QuoteReply.init();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        state: QuoteReply,
        handleSelectionChange: QuoteReply.handleSelectionChange,
        injectQuote: QuoteReply.injectQuote,
        unionClientRects: QuoteReply.unionClientRects,
        computeButtonPosition: QuoteReply.computeButtonPosition,
        isSelectionInScope: QuoteReply.isSelectionInScope,
        formatQuote: QuoteReply.formatQuote,
        showButton: QuoteReply.showButton,
        hideButton: QuoteReply.hideButton,
        getButtonEl: QuoteReply.getButtonEl,
        enable: QuoteReply.enable,
        disable: QuoteReply.disable,
        __resetState: () => {
            QuoteReply.btnEl = null;
            QuoteReply.selectedText = '';
            QuoteReply.isScrollAttached = false;
            clearTimeout(QuoteReply.debounceTimer);
            QuoteReply.debounceTimer = null;
        },
        __setState: (s) => {
            if ('selectedText' in s) QuoteReply.selectedText = s.selectedText;
        },
        __getState: () => ({
            selectedText: QuoteReply.selectedText,
            attachedScroll: QuoteReply.isScrollAttached,
        }),
    };
}
