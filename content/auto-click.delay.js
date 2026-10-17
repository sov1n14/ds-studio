/**
 * DS studio — 自動點擊輪次隨機延遲（content/auto-click.delay.js）
 *
 * 單一職責：產生 0.0–3.0 秒、以 0.1 秒為級距的均勻隨機延遲（毫秒）。
 * 無載入期副作用：載入僅完成 globalThis 指派。
 */
(function () {
    'use strict';

    // 0, 100, ..., 3000 共 31 個等機率值
    const STEP_COUNT = 31;
    const STEP_MS = 100;

    /**
     * @param {Function} [random] 回傳 [0, 1) 的亂數來源，預設 Math.random
     * @returns {number} 延遲毫秒數
     */
    function nextDelayMs(random = Math.random) {
        return Math.floor(random() * STEP_COUNT) * STEP_MS;
    }

    const api = { nextDelayMs };
    globalThis.DSSAutoClickDelay = api;

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
