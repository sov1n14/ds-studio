/**
 * DS studio — Censor Reply Restore :: DOM Scan
 * 儲存記錄完整掃描復原子系統。由 censor-reply-restore.dom.js 以 Object.assign 合入。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const selectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {
        _tryRestoreFromStoredRecords() {
            // 進入時先偵測聊天切換
            this._checkSessionChange();

            // 1. 從 URL 解析當前 session ID；明確要求非 falsy，避免跨 session 誤配
            var currentSessionId = this._currentSessionId;

            // 明確規則：session ID 為 falsy → 禁止任何 storage 比對
            if (!currentSessionId) {
                return false;
            }

            // 2. 收集 DOM 中尚未復原且被審查的 assistant 訊息（按 DOM 順序）
            var msgEls = document.querySelectorAll(selectors.ASSISTANT_MESSAGE_SELECTOR);
            var unrestoredEls = [];
            for (var i = 0; i < msgEls.length; i++) {
                var el = msgEls[i];
                if (el.querySelector('.restored-content')) continue;
                var toolbar = this._getToolbarGroup(el);
                if (!toolbar || !this._isCensored(toolbar)) continue;
                unrestoredEls.push(el);
            }
            if (unrestoredEls.length === 0) {
                return false;
            }

            // 3. 建立 DOM 的 prompt_key 分組對應表
            var domByPrompt = {};
            for (var i = 0; i < unrestoredEls.length; i++) {
                var key = this._getPrecedingUserPromptKey(unrestoredEls[i]);
                if (!key) continue;
                if (!domByPrompt[key]) domByPrompt[key] = [];
                domByPrompt[key].push(unrestoredEls[i]);
            }
            if (Object.keys(domByPrompt).length === 0) {
                return false;
            }

            // 4. 過濾 records 至當前 session + censored
            // 遍歷 session-scoped key 格式的記錄，明確排除 falsy session ID 的記錄
            var sessionRecords = [];
            for (var storeKey in this._restoredMessages) {
                var rec = this._restoredMessages[storeKey];
                if (rec.censored !== true) continue;
                // 明確規則：記錄的 session ID 為 falsy → 禁止比對
                if (!rec.chat_session_id) continue;
                if (rec.chat_session_id !== currentSessionId) continue;
                if (!rec.prompt_key) continue;  // 無錨點的舊版記錄跳過
                sessionRecords.push(rec);
            }

            if (sessionRecords.length === 0) {
                return false;
            }

            // 5. 將 records 依 prompt_key 分組
            var recordsByPrompt = {};
            for (var i = 0; i < sessionRecords.length; i++) {
                var rec = sessionRecords[i];
                var key = rec.prompt_key;
                if (!recordsByPrompt[key]) recordsByPrompt[key] = [];
                recordsByPrompt[key].push(rec);
            }

            // 6. 對兩邊都存在的 prompt_key：將 records 依 message_id 排序後逐對匹配
            var hasMatchedAny = false;
            for (var promptKey in domByPrompt) {
                if (!recordsByPrompt[promptKey]) {
                    continue;
                }
                var domList = domByPrompt[promptKey];
                var recList = recordsByPrompt[promptKey];
                // 以 message_id 遞增排序（重複 prompt 的平局處理）
                recList.sort(function (a, b) { return String(a.message_id).localeCompare(String(b.message_id)); });
                var pairs = Math.min(domList.length, recList.length);
                for (var i = 0; i < pairs; i++) {
                    var virtualItem = domList[i].closest(selectors.VIRTUAL_ITEM_KEY_SELECTOR);
                    if (virtualItem) {
                        var key = virtualItem.getAttribute(selectors.VIRTUAL_ITEM_KEY_ATTR);
                        this._keyToMessageId.set(key, recList[i].message_id);
                    }
                    this._injectRestoredContent(domList[i], recList[i]);
                    hasMatchedAny = true;
                }
            }

            return hasMatchedAny;
        },
    };

    root.__DS_CensorReplyRestore_dom_scan = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(globalThis);
