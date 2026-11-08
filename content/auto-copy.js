/**
 * DS studio — Auto Copy（自動複製回覆／程式碼區塊）
 * 單一職責：新回覆完成（其訊息工具列新出現）時，依開關自動觸發該回覆的程式碼區塊複製按鈕與回覆複製按鈕。
 *
 * 行為：
 *   - 閘控：由 content/feature-toggle.js 以「總開關 isEnabled 且自身鍵」決定；回覆為 isAutoCopyReplyEnabled，程式碼區塊為 isAutoCopyCodeEnabled。本層不直讀儲存區。
 *   - 觀察：任一閘門開啟時以單一 MutationObserver（childList、subtree）觀察 document.body；全關時中斷。以 body 為根是因為新對話頁尚無訊息列表、切換對話時列表可能整個重新掛載，而「新出現」的判斷已由 ReplyCompletion 限定於虛擬列表項目內。
 *   - 判斷：每批次交由 DSstudio.ReplyCompletion.newToolbarsFromRecords 找出新出現的工具列（捲動重新掛載的舊工具列不計）；isStoppedReply 為真的工具列（被停止的回覆）整個略過。
 *   - 觸發：DeepSeek 的 React onClick 只接受受信任事件，故不呼叫 button.click()，改在按鈕上派送冒泡的 dss:react-click 事件，由 MAIN world 的 content/react-click-bridge.main.js 呼叫 React onClick。
 *   - 順序：每個工具列先依文件順序複製該工具列所屬項目內每個程式碼區塊的複製按鈕（banner 的第一個按鈕，非下載），最後複製回覆（工具列第一個按鈕），使兩個開關皆開啟時剪貼簿最終保留完整回覆；任一按鈕派送失敗只記錄錯誤，不影響其後目標。
 *   - 失焦補寫（決策 U6-14）：派送的事件帶字串 detail 'auto-copy'，讓 MAIN world 橋接器只擷取本模組觸發的寫入；每次派送前呼叫 DSSAutoCopyRelay.notePending() 登記待轉交項目（content/auto-copy.relay.js 未載入時略過，聚焦時的複製不受影響）。
 */
(function () {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 DSstudio；Node.js 測試：直接 require）
    const _Selectors = globalThis.DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
    // 儲存鍵常數：直接取 utils/storage-manager.keys.js 的鍵表（manifest 中先於本檔載入）
    const _Keys = globalThis.__DS_StorageManager_keys?.KEYS;

    // 程式碼區塊複製按鈕：banner 內的第一個 role="button" div（第二個為下載），由既有常數組合
    const CODE_COPY_BUTTON_SELECTOR = '.' + _Selectors.CODE_BLOCK_CLASS + '-banner '
        + _Selectors.ROLE_BUTTON_DIV_SELECTOR + ':first-of-type';

    // 事件名稱與 detail 標記與 content/react-click-bridge.main.js 一致（跨 world 無共用載入器）
    const REACT_CLICK_EVENT = 'dss:react-click';
    const AUTO_COPY_DETAIL = 'auto-copy';

    const AutoCopy = {
        // === 狀態 ===
        _isReplyOn: false,
        _isCodeOn: false,
        _observer: null,
        _replyCompletion: null,

        // ─────────────────────────────
        //  Private: 目標按鈕
        // ─────────────────────────────

        /**
         * 工具列的回覆複製按鈕：第一個直接子層的 role="button"。
         * @param {Element} toolbar
         * @returns {Element|null}
         */
        _findReplyCopyButton(toolbar) {
            return Array.from(toolbar.children)
                .find((child) => child.matches(_Selectors.ROLE_BUTTON_DIV_SELECTOR)) || null;
        },

        /**
         * 工具列所屬虛擬列表項目內所有程式碼區塊的複製按鈕（文件順序）。
         * @param {Element} toolbar
         * @returns {Element[]}
         */
        _findCodeCopyButtons(toolbar) {
            const item = toolbar.closest(_Selectors.VIRTUAL_ITEM_KEY_SELECTOR);
            if (!item) return [];
            return Array.from(item.querySelectorAll(CODE_COPY_BUTTON_SELECTOR));
        },

        /**
         * 依目前閘門組出單一工具列的觸發目標：先程式碼區塊、最後回覆（剪貼簿最終保留完整回覆）。
         * @param {Element} toolbar
         * @returns {Element[]}
         */
        _collectTargets(toolbar) {
            const targets = [];
            if (this._isCodeOn) targets.push(...this._findCodeCopyButtons(toolbar));
            if (this._isReplyOn) {
                const replyButton = this._findReplyCopyButton(toolbar);
                if (replyButton) targets.push(replyButton);
            }
            return targets;
        },

        // ─────────────────────────────
        //  Private: 觀察與觸發
        // ─────────────────────────────

        /**
         * 處理一批 MutationRecord：對每個新出現且未被停止的工具列觸發其目標按鈕。
         * @param {MutationRecord[]} records
         */
        _handleRecords(records) {
            if (!this._isReplyOn && !this._isCodeOn) return;
            const toolbars = this._replyCompletion.newToolbarsFromRecords(records);
            toolbars
                .filter((toolbar) => !this._replyCompletion.isStoppedReply(toolbar))
                .forEach((toolbar) => {
                    this._collectTargets(toolbar).forEach((button) => this._dispatchCopyClickSafely(button));
                });
        },

        /**
         * 派送單一按鈕並隔離其失敗：記錄錯誤後繼續，確保最後的回覆複製仍會執行。
         * @param {Element} button
         */
        _dispatchCopyClickSafely(button) {
            try {
                this._dispatchCopyClick(button);
            } catch (error) {
                console.error('[DSS] auto-copy:處理新工具列失敗:', error);
            }
        },

        /**
         * 先向轉交模組登記待轉交項目，再於按鈕上派送帶自動複製標記的 dss:react-click。
         * @param {Element} button
         */
        _dispatchCopyClick(button) {
            globalThis.DSSAutoCopyRelay?.notePending();
            button.dispatchEvent(new CustomEvent(REACT_CLICK_EVENT, { bubbles: true, detail: AUTO_COPY_DETAIL }));
        },

        /** 依閘門狀態啟動或中斷唯一的 MutationObserver */
        _syncObserver() {
            const hasOpenGate = this._isReplyOn || this._isCodeOn;
            if (hasOpenGate && !this._observer) {
                this._observer = new MutationObserver((records) => {
                    // MutationObserver 回呼邊界：拋錯無人可接，記錄後維持觀察
                    try {
                        this._handleRecords(records);
                    } catch (error) {
                        console.error('[DSS] auto-copy:處理新工具列失敗:', error);
                    }
                });
                this._observer.observe(document.body, { childList: true, subtree: true });
                return;
            }
            if (!hasOpenGate && this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
        },

        /**
         * 設定指定閘門並同步觀察器。
         * @param {'_isReplyOn'|'_isCodeOn'} gateField
         * @param {boolean} isOn
         */
        _setGate(gateField, isOn) {
            this[gateField] = isOn;
            this._syncObserver();
        },

        // ─────────────────────────────
        //  Public: Lifecycle
        // ─────────────────────────────

        /**
         * 初始化模組：回覆與程式碼區塊各向共用 registerFeatureToggle 註冊一次，
         * 初始值與後續變更皆由 background 透過訊息提供。
         */
        start() {
            const featureToggle = globalThis.DSSFeatureToggle
                || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
            if (!featureToggle) {
                throw new Error('content/auto-copy.js 需要 content/feature-toggle.js 先行載入');
            }
            const replyCompletion = globalThis.DSstudio?.ReplyCompletion;
            if (!replyCompletion) {
                throw new Error('content/auto-copy.js 需要 content/reply-completion.js 先行載入');
            }
            if (!_Keys) {
                throw new Error('content/auto-copy.js 需要 utils/storage-manager.keys.js 先行載入');
            }
            this._replyCompletion = replyCompletion;

            featureToggle.registerFeatureToggle({
                ownKey: _Keys.AUTO_COPY_REPLY,
                onEnable: () => this._setGate('_isReplyOn', true),
                onDisable: () => this._setGate('_isReplyOn', false),
            });
            featureToggle.registerFeatureToggle({
                ownKey: _Keys.AUTO_COPY_CODE,
                onEnable: () => this._setGate('_isCodeOn', true),
                onDisable: () => this._setGate('_isCodeOn', false),
            });
        },
    };

    // Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
    AutoCopy.start();

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoCopy;
    }

    // Expose on window for cross-module access
    if (typeof window !== 'undefined') {
        window.DSstudio = window.DSstudio || {};
        window.DSstudio.AutoCopy = AutoCopy;
    }
})();
