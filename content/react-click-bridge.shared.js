/**
 * DS studio — React Click Bridge 共用定義（isolated 與 MAIN world 皆載入）
 *
 * 單一職責：宣告 isolated world（content/auto-copy.js、content/auto-retry.js、content/auto-copy.relay.js）與 MAIN world（content/react-click-bridge.main.js）兩端共用的橋接約定，並提供兩端共用的待處理項目佇列。
 * 約定：點擊事件名稱 dss:react-click、自動複製派送的 detail 標記 auto-copy、擷取事件名稱 dss:auto-copy-captured、待處理項目的存活時間 1500 ms。
 * 佇列：createPendingQueue() 回傳先進先出的失效時間戳佇列；note() 登記一筆，consume() 丟棄已失效項目後消耗最早的一筆存活項目。每次呼叫建立獨立佇列，兩個 world 各持有自己的實例。
 * 載入：manifest 的 isolated 與 "world": "MAIN" 兩個 content_scripts 項目皆須在使用端之前載入本檔。無載入期副作用，僅指派全域；注意：本檔不得包含 chrome.* API 呼叫。
 */
(function (root) {
    'use strict';

    /** 對按鈕派送以觸發 React onClick 的事件名稱 */
    const REACT_CLICK_EVENT = 'dss:react-click';
    /** 自動複製派送的 detail 標記：僅此標記的點擊會登記待擷取項目 */
    const AUTO_COPY_DETAIL = 'auto-copy';
    /** MAIN world 於網站寫入剪貼簿被拒絕時，向 isolated world 回報文字的事件名稱 */
    const AUTO_COPY_CAPTURED_EVENT = 'dss:auto-copy-captured';
    /** 待處理項目的存活時間：涵蓋網站於 onClick 內同步或稍後非同步呼叫 writeText 的情況 */
    const PENDING_WINDOW_MS = 1500;

    /**
     * 建立先進先出的待處理佇列，項目以失效時間戳表示。
     * @returns {{ note: () => void, consume: () => boolean }}
     */
    function createPendingQueue() {
        const expiries = [];
        return {
            /** 登記一筆自現在起 PENDING_WINDOW_MS 後失效的項目 */
            note() {
                expiries.push(Date.now() + PENDING_WINDOW_MS);
            },
            /**
             * 丟棄已失效的項目後消耗最早的一筆存活項目。
             * @returns {boolean} 是否消耗到存活項目
             */
            consume() {
                const now = Date.now();
                const firstLive = expiries.findIndex((expiry) => expiry > now);
                if (firstLive === -1) {
                    expiries.length = 0;
                    return false;
                }
                expiries.splice(0, firstLive + 1);
                return true;
            },
        };
    }

    root.DSSReactClickBridgeShared = Object.freeze({
        REACT_CLICK_EVENT,
        AUTO_COPY_DETAIL,
        AUTO_COPY_CAPTURED_EVENT,
        PENDING_WINDOW_MS,
        createPendingQueue,
    });

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) module.exports = root.DSSReactClickBridgeShared;
})(globalThis);
