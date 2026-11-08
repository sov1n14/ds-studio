/**
 * DS studio — Auto Copy Relay（失焦自動複製的文字轉交）
 * 單一職責：把 MAIN world 擷取到的自動複製文字轉交 service worker 寫入剪貼簿（決策 U6-14）。
 *
 * 行為：
 *   - 登記：content/auto-copy.js 每次派送 dss:react-click 前呼叫 notePending()，登記一筆約 1500 ms 後失效的待轉交項目（與 content/react-click-bridge.main.js 的待擷取窗口相同）。
 *   - 接收：監聽 document 上的 dss:auto-copy-captured（由 MAIN world 橋接器於網站的 writeText 被拒絕時派送）；僅接受字串 detail，且必須消耗到一筆存活的待轉交項目，藉此擋下頁面偽造的事件。
 *   - 轉交：每筆接受的文字送出一則 DSS_COPY_TO_CLIPBOARD；項目先進先出，送出順序即自動複製的派送順序。sendMessage 同步拋錯或 Promise 拒絕皆記錄後吞下。
 */
(function () {
    'use strict';

    // 與 content/react-click-bridge.main.js 一致的擷取事件名稱（跨 world 無共用載入器）
    const AUTO_COPY_CAPTURED_EVENT = 'dss:auto-copy-captured';
    // 待轉交項目的存活時間，與 MAIN world 橋接器的待擷取窗口相同
    const PENDING_WINDOW_MS = 1500;

    const AutoCopyRelay = {
        // === 狀態 ===
        _pendingExpiries: [],
        _isStarted: false,

        // ─────────────────────────────
        //  Private: 待轉交項目
        // ─────────────────────────────

        /**
         * 丟棄已失效的項目後消耗最早的一筆存活項目。
         * @returns {boolean} 是否消耗到存活項目
         */
        _consumePending() {
            const now = Date.now();
            while (this._pendingExpiries.length > 0 && this._pendingExpiries[0] <= now) {
                this._pendingExpiries.shift();
            }
            if (this._pendingExpiries.length === 0) return false;
            this._pendingExpiries.shift();
            return true;
        },

        // ─────────────────────────────
        //  Private: 轉交
        // ─────────────────────────────

        /**
         * 請 background 把文字寫入剪貼簿；同步拋錯與 Promise 拒絕皆記錄後吞下。
         * @param {string} text
         */
        _sendCopyRequest(text) {
            const message = { type: globalThis.DSS_COPY_TO_CLIPBOARD, text };
            try {
                const pending = chrome.runtime.sendMessage(message);
                if (pending && typeof pending.catch === 'function') {
                    pending.catch((error) => {
                        console.error('[DSS] auto-copy-relay:送出剪貼簿訊息失敗:', error);
                    });
                }
            } catch (error) {
                console.error('[DSS] auto-copy-relay:送出剪貼簿訊息失敗:', error);
            }
        },

        /**
         * 處理一次擷取事件：僅字串 detail 且有存活待轉交項目時轉交。
         * @param {CustomEvent} event
         */
        _handleCaptured(event) {
            const text = event.detail;
            if (typeof text !== 'string') return;
            if (!this._consumePending()) return;
            this._sendCopyRequest(text);
        },

        // ─────────────────────────────
        //  Public
        // ─────────────────────────────

        /** 登記一筆自動複製的待轉交項目；content/auto-copy.js 於每次派送前呼叫 */
        notePending() {
            this._pendingExpiries.push(Date.now() + PENDING_WINDOW_MS);
        },

        /** 初始化模組：註冊唯一的擷取事件監聽器；重複呼叫不重複註冊 */
        start() {
            if (this._isStarted) return;
            if (!globalThis.DSS_COPY_TO_CLIPBOARD) {
                throw new Error('content/auto-copy.relay.js 需要 utils/message-constants.js 先行載入');
            }
            this._isStarted = true;
            document.addEventListener(AUTO_COPY_CAPTURED_EVENT, (event) => {
                // DOM 事件監聽器為無人可攔截的邊界：拋錯時記錄而非外拋
                try {
                    this._handleCaptured(event);
                } catch (error) {
                    console.error('[DSS] auto-copy-relay:處理擷取事件失敗:', error);
                }
            });
        },
    };

    // Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
    AutoCopyRelay.start();

    // 供 content/auto-copy.js 登記待轉交項目
    globalThis.DSSAutoCopyRelay = AutoCopyRelay;

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoCopyRelay;
    }
})();
