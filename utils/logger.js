/**
 * DS Studio — 診斷記錄器（utils/logger.js）
 *
 * 載入時副作用說明：
 *   1. 將 __DS_Logger 物件掛載至 window（標準 util 自附模式）。
 *   2. 嘗試從 chrome.storage.local 讀取一次 dsDebugSync 旗標並快取。
 *   3. 訂閱 chrome.storage.onChanged（area='local'）以在旗標變更時更新快取。
 *   以上是本模組唯一的模組層級副作用，且均使用 fail-safe 防護。
 *
 * 啟用診斷記錄（在目標 DevTools console 執行）：
 *   chrome.storage.local.set({ dsDebugSync: true })
 * 停用：
 *   chrome.storage.local.set({ dsDebugSync: false })
 *
 * 適用 console：
 *   - 內容腳本頁面：開啟目標頁面的 DevTools → Console（context 選 deepseek 頁面）
 *   - Popup：右鍵 popup → 「檢查」→ Console
 *   - Service Worker：chrome://extensions → 背景服務工作站 → Console
 *   dsDebugSync 僅存於 chrome.storage.local，永遠不會進入 sync 管道。
 */
(function (root) {
    'use strict';

    // === 旗標快取（預設 false，確保靜默） ===
    let _isEnabled = false;

    // === 從 chrome.storage.local 讀取旗標（fail-safe） ===
    function _loadFlag() {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        try {
            chrome.storage.local.get('dsDebugSync', function (result) {
                if (chrome.runtime && chrome.runtime.lastError) return;
                _isEnabled = result && result.dsDebugSync === true;
            });
        } catch (_) {
            // chrome.storage 不可用時維持 false
        }
    }

    // === 訂閱旗標變更（fail-safe） ===
    function _subscribeFlag() {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
        try {
            chrome.storage.onChanged.addListener(function (changes, area) {
                if (area !== 'local') return;
                if (!changes.dsDebugSync) return;
                _isEnabled = changes.dsDebugSync.newValue === true;
            });
        } catch (_) {
            // 訂閱失敗時不拋出，維持現有快取值
        }
    }

    // === 公開 API ===
    const __DS_Logger = {
        /**
         * 回傳目前診斷記錄是否已啟用。
         * @returns {boolean}
         */
        isEnabled() {
            return _isEnabled;
        },

        /**
         * 輸出同步診斷記錄（disabled 時為 no-op）。
         * @param {string} event  - 事件名稱（簡短標籤）
         * @param {*}      [data] - 任意附加資料
         */
        sync(event, data) {
            if (!_isEnabled) return; // guard：disabled 時立即結束
            console.log('[DS-Sync]', event, data !== undefined ? data : '');
        },

        /**
         * 輸出警告記錄（不受 debug 旗標控制，供配額失敗等重要事件使用）。
         * @param {string} event
         * @param {*}      [data]
         */
        warn(event, data) {
            console.warn('[DS-Sync]', event, data !== undefined ? data : '');
        },
    };

    // === 模組層級初始化（唯一允許的副作用） ===
    _loadFlag();
    _subscribeFlag();

    // === 掛載至全域（標準 util 自附模式） ===
    root.__DS_Logger = __DS_Logger;
    if (typeof module !== 'undefined' && module.exports) module.exports = __DS_Logger;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
