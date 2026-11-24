/**
 * DS studio — Auto Copy Relay（失焦自動複製的文字轉交）
 * 單一職責：把 MAIN world 擷取到的自動複製文字轉交 service worker 寫入剪貼簿。
 *
 * 行為：
 *   - 登記：content/auto-copy.js 每次派送 dss:react-click 前呼叫 notePending()，登記一筆待轉交項目（事件名稱與存活時間取自 content/react-click-bridge.shared.js，與 MAIN world 橋接器相同）。
 *   - 接收：監聽 document 上的 dss:auto-copy-captured（由 MAIN world 橋接器於網站的 writeText 被拒絕時派送）；僅接受字串 detail，且必須消耗到一筆存活的待轉交項目，藉此擋下頁面偽造的事件。
 *   - 轉交：每筆接受的文字送出一則 DSS_COPY_TO_CLIPBOARD；項目先進先出，送出順序即自動複製的派送順序。送出由 content/runtime-send.js 防護：sendMessage 同步拋錯或 Promise 拒絕皆記錄後吞下。
 *
 * 相依：utils/message-constants.js、content/react-click-bridge.shared.js 與 content/runtime-send.js 須先載入。
 */
(function () {
    'use strict';

    const AutoCopyRelay = {
        // === 狀態 ===
        _pending: null,
        _isStarted: false,

        // ─────────────────────────────
        //  Private: 轉交
        // ─────────────────────────────

        /**
         * 請 background 把文字寫入剪貼簿；同步拋錯與 Promise 拒絕皆記錄後吞下。
         * @param {string} text
         */
        _sendCopyRequest(text) {
            globalThis.DSSRuntimeSend.sendAndLogFailure(
                { type: globalThis.DSS_COPY_TO_CLIPBOARD, text },
                'auto-copy-relay:送出剪貼簿訊息失敗',
            );
        },

        /**
         * 處理一次擷取事件：僅字串 detail 且有存活待轉交項目時轉交。
         * @param {CustomEvent} event
         */
        _handleCaptured(event) {
            const text = event.detail;
            if (typeof text !== 'string') return;
            if (!this._pending.consume()) return;
            this._sendCopyRequest(text);
        },

        // ─────────────────────────────
        //  Public
        // ─────────────────────────────

        /** 登記一筆自動複製的待轉交項目；content/auto-copy.js 於每次派送前呼叫 */
        notePending() {
            this._pending.note();
        },

        /** 初始化模組：註冊唯一的擷取事件監聽器；重複呼叫不重複註冊 */
        start() {
            if (this._isStarted) return;
            if (!globalThis.DSS_COPY_TO_CLIPBOARD) {
                throw new Error('content/auto-copy.relay.js 需要 utils/message-constants.js 先行載入');
            }
            const shared = globalThis.DSSReactClickBridgeShared;
            if (!shared) {
                throw new Error('content/auto-copy.relay.js 需要 content/react-click-bridge.shared.js 先行載入');
            }
            if (!globalThis.DSSRuntimeSend) {
                throw new Error('content/auto-copy.relay.js 需要 content/runtime-send.js 先行載入');
            }
            this._isStarted = true;
            this._pending = shared.createPendingQueue();
            document.addEventListener(shared.AUTO_COPY_CAPTURED_EVENT, (event) => {
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
