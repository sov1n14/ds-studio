/**
 * DS studio v2.5.2 — Storage Manager（入口檔）
 * Wrapper for Chrome Storage API with Sync support and Local fallback.
 *
 * 載入順序（manifest.json / popup.html / editor.html 必須依此順序）：
 *   1. storage-manager.keys.js
 *   2. storage-manager.chunk-lock.js
 *   3. storage-manager.rw.js
 *   4. storage-manager.sync.js
 *   5. storage-manager.presets.js
 *   6. storage-manager.chatmap.js
 *   7. storage-manager.local.js
 *   8. storage-manager.init.js
 *   9. storage-manager.setters.js
 *  10. storage-manager.settings-read.js
 *  11. storage-manager.js  （本檔）
 */

const StorageManager = {

    /**
     * chatPresetMap 分塊索引快取。Map<uuid, chunkIdx> | null 表示需重新載入。
     * 由 bundle 方法透過 this._chunkIndexCache 存取。
     */
    _chunkIndexCache: null,

    /**
     * chatPresetMap meta 快取。{ version, chunkCount, chunkSizes[] } | null 表示需重新載入。
     * 由 bundle 方法透過 this._metaCache 存取。
     */
    _metaCache: null,

    /**
     * 本 context 已註冊的 chunk 快取失效監聽器。initialize() 重複執行時，
     * _installChunkCacheInvalidator() 依此參照先移除舊監聽器再註冊，維持恰好一個。
     */
    _chunkCacheInvalidator: null,


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
        root.__DS_StorageManager_chunklock || {},
        root.__DS_StorageManager_sync      || {},
        root.__DS_StorageManager_presets   || {},
        root.__DS_StorageManager_chatmap   || {},
        root.__DS_StorageManager_local     || {},
        root.__DS_StorageManager_init      || {},
        root.__DS_StorageManager_setters   || {},
        root.__DS_StorageManager_settingsRead || {}
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
