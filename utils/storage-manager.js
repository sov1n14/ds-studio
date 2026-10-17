/**
 * DS studio v2.5.2 — Storage Manager（入口檔）
 * Wrapper for Chrome Storage API with Sync support and Local fallback.
 */

const StorageManager = {

    /**
     * 是否為 chatPresetMap 唯一寫入者（service worker）。非寫入者呼叫 mutateChatPresetMap 一律拒絕。
     */
    _isChatMapWriter: false,

    /**
     * 將本 context 設為 chatPresetMap 唯一寫入者；僅 service worker 應呼叫。
     */
    enableChatMapWriterMode() {
        this._isChatMapWriter = true;
    },

    /**
     * 內部 promise-chain 寫入佇列，用於序列化 chatPresetMap 的寫入操作，
     * 避免同 context 內的競爭條件（race condition）。
     */
    _chatPresetMapChainTail: Promise.resolve(),

    /**
     * 將 taskFn 加入 chatPresetMap 寫入佇列的尾部，確保依序執行。
     * 佇列中的任一任務失敗不會影響後續任務。
     * @param {Function} taskFn - 非同步函式，回傳 Promise
     * @returns {Promise} 該任務的 Promise
     */
    _enqueueChatPresetMapWrite(taskFn) {
        const next = this._chatPresetMapChainTail.then(taskFn, taskFn);
        this._chatPresetMapChainTail = next.catch(() => {}); // 隔離連鎖失敗
        return next;
    },

    // --- Helper methods ---

    /**
     * 網搜切換值正規化：舊版遺留的 'default' 已隨二態精簡，讀取時一律視為 'on'。
     * 純查詢，不寫回儲存；其他值原樣回傳（含 undefined，由呼叫端自行套用 DEFAULTS）。
     * @param {string|undefined} value 儲存中的原始值
     * @returns {string|undefined} 正規化後的值
     */
    normalizeWebsearchToggle(value) {
        return value === 'default' ? 'on' : value;
    },

    /**
     * 訂閱 local / sync 兩個儲存區的設定變更。
     * 讓 popup 等呼叫端無需直接觸碰 chrome.storage.onChanged，符合分層規則
     * （popup 一律經由 utils/ 存取擴充 API）。僅 namespace 為 local 或 sync 時回呼，
     * 其餘區域（如 managed）一律略過，回呼只收到 changes 物件。
     * @param {(changes: Object) => void} callback 每次設定變更時呼叫
     */
    subscribeToSettingChanges(callback) {
        if (typeof callback !== 'function') {
            throw new Error('[DSS] subscribeToSettingChanges: callback must be a function');
        }
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local' && namespace !== 'sync') return;
            callback(changes);
        });
    },

};

// === Bundle 合併：將各方法群組的方法 mixin 至 StorageManager ===
(function (root) {
    Object.assign(StorageManager,
        root.__DS_StorageManager_keys      || {},
        root.__DS_StorageManager_rw        || {},
        root.__DS_StorageManager_sync      || {},
        root.__DS_StorageManager_sync_retry || {},
        root.__DS_StorageManager_presets   || {},
        root.__DS_StorageManager_tombstone      || {},
        root.__DS_StorageManager_preset_merge   || {},
        root.__DS_StorageManager_preset_recency  || {},
        root.__DS_StorageManager_chatmap_diff || {},
        root.__DS_StorageManager_chatmap   || {},
        root.__DS_StorageManager_chatmap_client || {},
        root.__DS_StorageManager_local     || {},
        root.__DS_StorageManager_init      || {},
        root.__DS_StorageManager_setters   || {},
        root.__DS_StorageManager_settingsRead || {},
        root.__DS_StorageManager_restore    || {}
    );
})(globalThis);

// Make it available globally depending on context
if (typeof window !== 'undefined') {
    window.StorageManager = StorageManager;
}

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
}
