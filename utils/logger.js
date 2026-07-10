/**
 * DS Studio — 診斷記錄器（utils/logger.js）
 *
 * 載入時副作用說明：
 *   將 __DS_Logger 物件掛載至 window（標準 util 自附模式）。
 *   本模組不再讀取任何旗標——診斷記錄一律啟用並轉發至 Service Worker console，
 *   毋須手動開關。
 *
 * 檢視診斷記錄（集中於單一處）：
 *   chrome://extensions → DS Studio → 背景服務工作站（Service Worker） → Console
 *   所有 sync() / warn() 記錄均會轉發至 Service Worker console 統一輸出。
 */
(function (root) {
    'use strict';

    // === 偵測目前執行情境，產生簡短來源標籤 ===
    function _detectSource() {
        // Service Worker 情境：無 window / document
        if (typeof window === 'undefined' || typeof document === 'undefined') return 'sw';
        // 內容腳本注入至 chat.deepseek.com
        if (typeof location !== 'undefined' && location.hostname === 'chat.deepseek.com') return 'page';
        // Popup
        if (typeof location !== 'undefined' && location.pathname.endsWith('popup.html')) return 'popup';
        // Preset Editor
        if (typeof location !== 'undefined' && location.pathname.includes('editor')) return 'editor';
        return 'unknown';
    }

    // 來源標籤於模組初始化時計算一次，後續不再重複偵測
    const _source = _detectSource();

    // === 轉發記錄至 Service Worker（fire-and-forget，完全 fail-safe） ===
    function _forward(level, event, data) {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
        try {
            const promise = chrome.runtime.sendMessage({
                __dsSyncLog: true,
                source: _source,
                level: level,
                event: event,
                data: data !== undefined ? data : '',
            });
            // 吞掉「Receiving end does not exist」等錯誤，避免未處理的 Promise rejection
            if (promise && typeof promise.catch === 'function') promise.catch(function () {});
        } catch (_) {
            // sendMessage 同步拋出時（如擴充功能情境不可用）靜默忽略
        }
    }

    // === 公開 API ===
    const __DS_Logger = {
        /**
         * 輸出同步診斷記錄，轉發至 Service Worker console。
         * @param {string} event  - 事件名稱（簡短標籤）
         * @param {*}      [data] - 任意附加資料
         */
        sync(event, data) {
            _forward('log', event, data);
        },

        /**
         * 輸出警告記錄，供配額失敗等重要事件使用。
         * 本地 console.warn 永遠執行，並額外轉發至 Service Worker console。
         * @param {string} event
         * @param {*}      [data]
         */
        warn(event, data) {
            // 永遠在本地輸出，確保生產環境配額失敗訊息可見
            console.warn('[DS-Sync]', event, data !== undefined ? data : '');
            // 額外轉發至 Service Worker console 統一檢視
            _forward('warn', event, data);
        },
    };

    // === 掛載至全域（標準 util 自附模式） ===
    root.__DS_Logger = __DS_Logger;
    if (typeof module !== 'undefined' && module.exports) module.exports = __DS_Logger;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
