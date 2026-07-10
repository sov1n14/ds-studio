/**
 * DS Studio — StorageManager 統一同步進入點
 * 提供 syncNow()：整合既有的推送重試與遠端拉取邏輯，作為單一同步進入點，
 * 供 popup 開啟與 chat.deepseek.com 載入時呼叫，取代各自獨立的一次性讀取。
 *
 * 設計原則：不重新實作任何比較邏輯，僅重用既有的 retrySync() / getSettings()
 * （其內部已透過 _pickNewerPreset、_pickPresetOrderByRecency、_shouldPushPreset
 * 等純函式完成逐項 updatedAt 比較），避免與既有 tie-break 語意產生分歧。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * 統一同步進入點。
         *
         * 流程：
         *   1. 推送任何因先前暫時性失敗而擱置於 dsLocalAuth 的本機較新項目
         *      （retrySync() 內部已依 _shouldPushPreset / orderUpdatedAt 逐項判斷，
         *      並尊重既有的同步寫入配額守衛）。
         *   2. 從雲端拉取最新設定（getSettings() → _get()，內部已完成
         *      sync-wins 合併 + 逐項 updatedAt 收斂 + dsLocalAuth pin）。
         *
         * 每個項目的決策彼此獨立：同一次呼叫中，項目 A 可能判定為「遠端較新」，
         * 項目 B 可能同時判定為「本機較新並已推送」。
         *
         * @returns {Promise<Object>} 收斂後的最新設定物件（結構同 getSettings()）
         */
        async syncNow() {
            await this.retrySync();
            return this.getSettings();
        },
    };

    root.__DS_StorageManager_syncnow = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
