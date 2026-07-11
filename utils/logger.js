/**
 * DS Studio — 診斷記錄器（utils/logger.js）
 *
 * 載入時副作用說明：
 *   將 __DS_Logger 物件掛載至 window（標準 util 自附模式）。
 *
 * 檢視診斷記錄：
 *   本模組僅保留本地 console.warn 輸出，用於配額失敗等重要事件的可見性；
 *   純診斷用的跨情境記錄轉發子系統已移除。
 */
(function (root) {
    'use strict';

    // === 公開 API ===
    const __DS_Logger = {
        /**
         * 輸出警告記錄，供配額失敗等重要事件使用。
         * 僅於本地 console.warn 輸出，確保生產環境配額失敗訊息可見。
         * @param {string} event
         * @param {*}      [data]
         */
        warn(event, data) {
            console.warn('[DS-Sync]', event, data ?? '');
        },
    };

    // === 掛載至全域（標準 util 自附模式） ===
    root.__DS_Logger = __DS_Logger;
    if (typeof module !== 'undefined' && module.exports) module.exports = __DS_Logger;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
