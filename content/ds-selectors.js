/**
 * DS studio — Shared DOM Selector Constants
 *
 * 集中管理跨模組重複的 DOM 選擇器字串，避免多處各自維護造成不同步。
 * DeepSeek 為 React 應用，class 名稱帶有雜湊值（如 _6f2c522），
 * 一旦頁面改版，只需修改此檔一處，所有消費端
 *（go-top.js、go-top.locate.js、harvest.js）即同步生效。
 *
 * 單一職責：僅匯出常數字串，不含任何邏輯或副作用。
 */

(function () {
    'use strict';

    /** 虛擬列表容器（精確雜湊 class） */
    const VIRTUAL_LIST_SELECTOR = '.ds-virtual-list-items._6f2c522';

    /** 虛擬列表容器（class-substring 降級選擇器） */
    const VIRTUAL_LIST_FALLBACK = '[class*="ds-virtual-list-items"]';

    /** 訊息列表可滾動容器的穩定 class（無雜湊，故以 classList.contains 比對） */
    const SCROLL_AREA_CLASS = 'ds-scroll-area';

    const DSSelectors = { VIRTUAL_LIST_SELECTOR, VIRTUAL_LIST_FALLBACK, SCROLL_AREA_CLASS };

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DSSelectors;
    }

    // 透過 window.DSstudio 供同層模組（go-top.js、harvest.js 等）呼叫
    if (typeof window !== 'undefined') {
        window.DSstudio = window.DSstudio || {};
        window.DSstudio.Selectors = DSSelectors;
    }
})();
