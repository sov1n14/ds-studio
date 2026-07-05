/**
 * DS Studio — 診斷記錄器（utils/logger.js）
 *
 * 載入時副作用說明：
 *   1. 將 __DS_Logger 物件掛載至 window（標準 util 自附模式）。
 *   2. 嘗試從 chrome.storage.local 讀取一次 dsDebugSync 旗標並快取。
 *   3. 訂閱 chrome.storage.onChanged（area='local'）以在旗標變更時更新快取。
 *   以上是本模組唯一的模組層級副作用，且均使用 fail-safe 防護。
 *
 * 啟用診斷記錄（在任何 DevTools console 執行）：
 *   chrome.storage.local.set({ dsDebugSync: true })
 * 停用：
 *   chrome.storage.local.set({ dsDebugSync: false })
 *
 * 啟用後，所有 sync() 記錄均會轉發至 Service Worker console，在同一處統一檢視：
 *   chrome://extensions → DS Studio → 背景服務工作站 → Console
 *   dsDebugSync 僅存於 chrome.storage.local，永遠不會進入 sync 管道。
 */
(function (root) {
    'use strict';

    // === 旗標快取（預設 false，確保靜默） ===
    let _isEnabled = false;

    // === 偵測目前執行情境，產生簡短來源標籤 ===
    function _detectSource() {
        // Service Worker 情境：無 window / document
        if (typeof window === 'undefined' || typeof document === 'undefined') return 'sw';
        // 內容腳本注入至 chat.deepseek.com
        if (typeof location !== 'undefined' && location.hostname === 'chat.deepseek.com') return 'page';
        // Popup
        if (typeof location !== 'undefined' && location.pathname.endsWith('popup.html')) return 'popup';
        // Preset Editor
        if (typeof location !== 'undefined' && location.pathname.includes('editor')) return 'editor';
        return 'unknown';
    }

    // 來源標籤於模組初始化時計算一次，後續不再重複偵測
    const _source = _detectSource();

    // === 轉發記錄至 Service Worker（fire-and-forget，完全 fail-safe） ===
    function _forward(level, event, data) {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
        try {
            const promise = chrome.runtime.sendMessage({
                __dsSyncLog: true,
                source: _source,
                level: level,
                event: event,
                data: data !== undefined ? data : '',
            });
            // 吞掉「Receiving end does not exist」等錯誤，避免未處理的 Promise rejection
            if (promise && typeof promise.catch === 'function') promise.catch(function () {});
        } catch (_) {
            // sendMessage 同步拋出時（如擴充功能情境不可用）靜默忽略
        }
    }

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
         * 啟用時將記錄轉發至 Service Worker console，不在本地輸出（避免重複）。
         * @param {string} event  - 事件名稱（簡短標籤）
         * @param {*}      [data] - 任意附加資料
         */
        sync(event, data) {
            if (!_isEnabled) return; // guard：disabled 時立即結束，無任何輸出
            _forward('log', event, data);
        },

        /**
         * 輸出警告記錄（不受 debug 旗標控制，供配額失敗等重要事件使用）。
         * 本地 console.warn 永遠執行；啟用時額外轉發至 Service Worker。
         * @param {string} event
         * @param {*}      [data]
         */
        warn(event, data) {
            // 永遠在本地輸出，確保生產環境配額失敗訊息可見
            console.warn('[DS-Sync]', event, data !== undefined ? data : '');
            // 啟用時額外轉發至 Service Worker console
            if (_isEnabled) _forward('warn', event, data);
        },
    };

    // === 模組層級初始化（唯一允許的副作用） ===
    _loadFlag();
    _subscribeFlag();

    // === 掛載至全域（標準 util 自附模式） ===
    root.__DS_Logger = __DS_Logger;
    if (typeof module !== 'undefined' && module.exports) module.exports = __DS_Logger;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
