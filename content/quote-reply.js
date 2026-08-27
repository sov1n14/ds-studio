/**
 * DS studio — 引用回覆（content/quote-reply.js）
 *
 * 選取對話區文字 → 浮出「引用回覆」按鈕 → 點擊後把引用文字寫入輸入框。
 * 生命週期交由 content/feature-toggle.js 的 registerFeatureToggle 閘控。
 *
 * 載入順序（manifest.json 中 bundle 必須先於 entry）：
 *   1. quote-reply.geometry.js → globalThis.__DS_QuoteReply_geometry
 *   2. quote-reply.button.js   → globalThis.__DS_QuoteReply_button
 *   3. quote-reply.js          （本檔，Object.assign 合入以上兩個 bundle）
 */

// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DS_QuoteReplySelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

/** 選取變更後的防抖間隔（ms） */
const QUOTE_REPLY_DEBOUNCE_MS = 250;

/** 於呼叫時解析開關管線 */
function __ds_resolveQuoteReplyToggle() {
    return globalThis.DSSFeatureToggle
        || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
}

const QuoteReply = {
    // === 狀態 ===
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

    // === 事件處理器：箭頭函式屬性，參考位址穩定 ===

    handleSelectionEvent: () => {
        clearTimeout(QuoteReply.debounceTimer);
        QuoteReply.debounceTimer = setTimeout(() => QuoteReply.handleSelectionChange(), QUOTE_REPLY_DEBOUNCE_MS);
    },

    handleDocumentMouseDown: (e) => {
        if (QuoteReply.btnEl && !QuoteReply.btnEl.contains(e.target)) QuoteReply.hideButton();
    },

    handleViewportChange: () => {
        requestAnimationFrame(() => QuoteReply.handleSelectionChange());
    },

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

// ── 合入 bundle ──
(function (root) {
    Object.assign(QuoteReply,
        root.__DS_QuoteReply_geometry || {},
        root.__DS_QuoteReply_button || {});
})(globalThis);

// 啟動點
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
    };
}
