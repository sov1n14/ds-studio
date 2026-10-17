/**
 * DS Studio — StorageManager ChatPresetMap 公開操作與分派方法群組
 * 公開的綁定操作皆轉為 DSS_CHAT_MAP_MSG 訊息：寫入者（service worker）直接交給引擎 applyChatMapOp；
 * 其他 context（content script、popup、editor）經 chrome.runtime.sendMessage 交由 service worker 單一寫入。
 * 客戶端不驗證酬載，一律轉送，由 service worker 以 { ok: false, error } 回覆不合法的操作。
 */
(function (root) {
    'use strict';

    // 單次傳送的回應逾時
    const SEND_TIMEOUT_MS = 10000;
    // service worker 尚未就緒（無接收端）時的單次重試延遲
    const NO_RECEIVER_RETRY_DELAY_MS = 100;

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // 於呼叫時讀取訊息型別常數（message-constants.js 在 storage manager 之後載入）
    function getMessageTypes() {
        const types = root.DSS_CHAT_MAP_MSG;
        if (!types) throw new Error('[DSS] StorageManager chat-map：globalThis.DSS_CHAT_MAP_MSG 未定義，請先載入 utils/message-constants.js');
        return types;
    }

    const isNoReceiverError = (err) => /Receiving end does not exist/i.test(String(err?.message ?? err));

    /**
     * 傳送一次訊息；同步拋出轉為 rejection，逾時亦 reject。
     * @param {Object} msg
     * @returns {Promise<*>} service worker 的回應
     */
    function sendOnce(msg) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`[DSS] chat-map ${msg.type}：${SEND_TIMEOUT_MS} ms 內未收到回應`)), SEND_TIMEOUT_MS);
            let pending;
            try {
                pending = Promise.resolve(chrome.runtime.sendMessage(msg));
            } catch (err) {
                pending = Promise.reject(err);
            }
            pending.then(resolve, reject).finally(() => clearTimeout(timer));
        });
    }

    const bundle = {
        /**
         * 將指定 uuid 的 chat 綁定至 preset。
         * @param {string} uuid
         * @param {string} presetId
         * @returns {Promise<true>}
         */
        async bindChatToPreset(uuid, presetId) {
            await this._dispatchChatMapOp({ type: getMessageTypes().BIND, uuid, presetId });
            return true;
        },

        /**
         * 解除指定 uuid 的 chat 綁定。
         * @param {string} uuid
         * @returns {Promise<true>}
         */
        async unbindChat(uuid) {
            await this._dispatchChatMapOp({ type: getMessageTypes().UNBIND, uuid });
            return true;
        },

        /**
         * 清除指向已不存在提示詞組的綁定；service worker 於佇列內讀取最新索引，索引為空時不修剪。
         * @returns {Promise<Object>} 修剪後的 chatPresetMap
         */
        async pruneOrphanChatBindings() {
            return this._dispatchChatMapOp({ type: getMessageTypes().PRUNE_ORPHANS });
        },

        /**
         * 解除所有綁定至指定提示詞組的 chat。
         * @param {string[]} presetIds
         * @returns {Promise<Object>} 變更後的 chatPresetMap
         */
        async unbindChatsForPresets(presetIds) {
            return this._dispatchChatMapOp({ type: getMessageTypes().UNBIND_PRESETS, presetIds });
        },

        /**
         * 將多筆 uuid → presetId 綁定合併進 chatPresetMap（同 uuid 以 entries 為準）。
         * @param {Object<string, string>} entries
         * @returns {Promise<Object>} 變更後的 chatPresetMap
         */
        async mergeChatPresetBindings(entries) {
            return this._dispatchChatMapOp({ type: getMessageTypes().MERGE, entries });
        },

        /**
         * 將 legacy chatPresetMap 遷移為分塊佈局（service worker 於單一佇列任務內完成，可重複呼叫）。
         * @returns {Promise<Object>} 遷移後的 chatPresetMap
         */
        async migrateLegacyChatPresetMap() {
            return this._dispatchChatMapOp({ type: getMessageTypes().MIGRATE_LEGACY });
        },

        /**
         * 是否為 chat-map 金鑰（meta、chunk 或 legacy chatPresetMap）；這些金鑰只能由單一寫入者寫入。
         * @param {string} key
         * @returns {boolean}
         */
        _isChatMapKey(key) {
            const { CHAT_PRESET_MAP, CHAT_PRESET_MAP_META, CHAT_PRESET_MAP_CHUNK_PREFIX } = this.KEYS;
            return key === CHAT_PRESET_MAP || key === CHAT_PRESET_MAP_META || key.startsWith(CHAT_PRESET_MAP_CHUNK_PREFIX);
        },

        /**
         * 依模式分派 chat-map 操作。寫入者直接呼叫引擎（引擎自行排隊，外包佇列會自我等待而死結）；
         * 客戶端排入本 context 的佇列後傳送，確保同 context 的讀取看得到先前的寫入。
         * @param {Object} msg
         * @returns {Promise<Object>} 變更後的 chatPresetMap
         */
        _dispatchChatMapOp(msg) {
            if (this._isChatMapWriter) return this.applyChatMapOp(msg);
            return this._enqueueChatPresetMapWrite(() => this._sendChatMapMessage(msg));
        },

        /**
         * 傳送 chat-map 訊息給 service worker 並解析回應。
         * 無接收端時於短暫延遲後重試恰好一次；port 關閉等其他傳輸錯誤直接 reject（訊息可能已送達，重送有重複套用之虞）。
         * @param {Object} msg
         * @returns {Promise<Object>} service worker 回覆的 map
         */
        async _sendChatMapMessage(msg) {
            let response;
            try {
                response = await sendOnce(msg);
            } catch (err) {
                if (!isNoReceiverError(err)) throw err;
                await delay(NO_RECEIVER_RETRY_DELAY_MS);
                response = await sendOnce(msg);
            }
            if (!response?.ok) {
                throw new this.errors.ChatMapDispatchError(`[DSS] chat-map ${msg.type} 失敗：${response?.error ?? '未收到回應'}`);
            }
            return response.map;
        },
    };

    root.__DS_StorageManager_chatmap_client = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
