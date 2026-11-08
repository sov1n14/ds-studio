/**
 * DS studio — Reply Notification（回覆完成通知）
 * 單一職責：新回覆完成（其訊息工具列新出現）且分頁不在前景時，請 background 顯示桌面通知。
 *
 * 行為：
 *   - 閘控：由 content/feature-toggle.js 以「總開關 isEnabled 且 isReplyNotificationEnabled」決定。本層不直讀儲存區。
 *   - 觀察：閘門開啟時以 MutationObserver（childList、subtree）觀察 document.body；關閉時中斷。
 *   - 判斷：每批次交由 DSstudio.ReplyCompletion.newToolbarsFromRecords 找出新出現的工具列（捲動重新掛載的舊工具列不計）；isStoppedReply 為真的工具列（被停止的回覆）不通知。
 *   - 前景：於回覆完成當下判斷，visibilityState 非 visible 或視窗未取得焦點即視為不在前景；前景時不通知。
 *   - 通知：每個完成的回覆送出一則 DSS_SHOW_NOTIFICATION（標題與內文取自 dsI18n）；sendMessage 同步拋錯或 Promise 拒絕皆記錄後吞下，不影響後續回覆。
 */
(function () {
    'use strict';

    // 儲存鍵常數：直接取 utils/storage-manager.keys.js 的鍵表（manifest 中先於本檔載入）
    const _Keys = globalThis.__DS_StorageManager_keys?.KEYS;

    const ReplyNotification = {
        // === 狀態 ===
        _isOn: false,
        _observer: null,
        _replyCompletion: null,

        // ─────────────────────────────
        //  Private: 判斷
        // ─────────────────────────────

        /**
         * 分頁是否在前景：可見且視窗取得焦點。
         * @returns {boolean}
         */
        _isTabInForeground() {
            return document.visibilityState === 'visible' && document.hasFocus();
        },

        /**
         * 一批 MutationRecord 中新完成（新出現且未被停止）的回覆工具列數量。
         * @param {MutationRecord[]} records
         * @returns {number}
         */
        _countCompletedReplies(records) {
            return this._replyCompletion.newToolbarsFromRecords(records)
                .filter((toolbar) => !this._replyCompletion.isStoppedReply(toolbar))
                .length;
        },

        // ─────────────────────────────
        //  Private: 通知
        // ─────────────────────────────

        /** 請 background 顯示一則回覆完成通知；同步拋錯與 Promise 拒絕皆記錄後吞下 */
        _sendNotification() {
            const message = {
                type: globalThis.DSS_SHOW_NOTIFICATION,
                title: globalThis.dsI18n.t('replyNotificationTitle'),
                body: globalThis.dsI18n.t('replyNotificationBody'),
            };
            try {
                const pending = chrome.runtime.sendMessage(message);
                if (pending && typeof pending.catch === 'function') {
                    pending.catch((error) => {
                        console.error('[DSS] reply-notification:送出通知訊息失敗:', error);
                    });
                }
            } catch (error) {
                console.error('[DSS] reply-notification:送出通知訊息失敗:', error);
            }
        },

        /**
         * 處理一批 MutationRecord：每個新完成的回覆在分頁不在前景時各通知一次。
         * @param {MutationRecord[]} records
         */
        _handleRecords(records) {
            if (!this._isOn) return;
            const completedCount = this._countCompletedReplies(records);
            if (completedCount === 0 || this._isTabInForeground()) return;
            for (let index = 0; index < completedCount; index++) {
                this._sendNotification();
            }
        },

        // ─────────────────────────────
        //  Private: 觀察器
        // ─────────────────────────────

        /**
         * 設定閘門並啟動或中斷唯一的 MutationObserver。
         * @param {boolean} isOn
         */
        _setGate(isOn) {
            this._isOn = isOn;
            if (isOn && !this._observer) {
                this._observer = new MutationObserver((records) => {
                    // MutationObserver 回呼邊界：拋錯無人可接，記錄後維持觀察
                    try {
                        this._handleRecords(records);
                    } catch (error) {
                        console.error('[DSS] reply-notification:處理新工具列失敗:', error);
                    }
                });
                this._observer.observe(document.body, { childList: true, subtree: true });
                return;
            }
            if (!isOn && this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
        },

        // ─────────────────────────────
        //  Public: Lifecycle
        // ─────────────────────────────

        /**
         * 初始化模組：向共用 registerFeatureToggle 註冊一次，初始值與後續變更皆由 background 透過訊息提供。
         */
        start() {
            const featureToggle = globalThis.DSSFeatureToggle
                || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
            if (!featureToggle) {
                throw new Error('content/reply-notification.js 需要 content/feature-toggle.js 先行載入');
            }
            const replyCompletion = globalThis.DSstudio?.ReplyCompletion;
            if (!replyCompletion) {
                throw new Error('content/reply-notification.js 需要 content/reply-completion.js 先行載入');
            }
            if (!_Keys) {
                throw new Error('content/reply-notification.js 需要 utils/storage-manager.keys.js 先行載入');
            }
            this._replyCompletion = replyCompletion;

            featureToggle.registerFeatureToggle({
                ownKey: _Keys.REPLY_NOTIFICATION,
                onEnable: () => this._setGate(true),
                onDisable: () => this._setGate(false),
            });
        },
    };

    // Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
    ReplyNotification.start();

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ReplyNotification;
    }

    // Expose on window for cross-module access
    if (typeof window !== 'undefined') {
        window.DSstudio = window.DSstudio || {};
        window.DSstudio.ReplyNotification = ReplyNotification;
    }
})();
