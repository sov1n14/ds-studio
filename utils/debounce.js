/**
 * DS studio — 防抖共用工具（utils/debounce.js）
 *
 * 單一職責：把連續呼叫收斂成最後一次呼叫後 delayMs 的單次執行（trailing edge）。
 * 每次呼叫重設計時器；視窗結束後的下一次呼叫開啟新視窗。
 * 最後一次呼叫的引數與 this 生效，回傳值為 undefined（fn 於非同步時機執行）。
 * 無載入期副作用：載入僅完成 globalThis 指派。
 */
(function () {
    'use strict';

    /**
     * 建立防抖包裝函式。
     * @param {Function} fn - 要延遲執行的函式
     * @param {number} delayMs - 延遲毫秒數
     * @returns {Function} 防抖後的函式
     */
    function debounce(fn, delayMs) {
        let timer = null;
        return function (...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                fn.apply(this, args);
            }, delayMs);
        };
    }

    globalThis.DSSDebounce = debounce;

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = debounce;
})();
