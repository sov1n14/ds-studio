/**
 * DS studio — 臨時對話啟用旗標
 * 單一職責：集中管理啟用旗標的記憶體快取、讀寫與跨情境同步。
 * 設定不由本層直讀儲存區：初始值以 DSS_GET_SETTINGS 向 background 索取、
 * 寫入以 DSS_SET_SETTINGS 交由 background 落盤、變更則透過 background 廣播的
 * DSS_SETTINGS_CHANGED 收斂；DSS_SETTINGS_MSG 由 utils/settings-message-constants.js 於前載入提供。
 * 常數由 temporary-chat-constants.js 在前載入提供（classic script，無 ESM import）。
 * 無載入期副作用：呼叫端須自行呼叫 initFromStorage() 與 startSync()。
 */

const TemporaryChatEnabledFlag = (() => {
    'use strict';

    // 常數由 temporary-chat-constants.js 在前載入時掛上 globalThis，三個執行環境（manifest content_scripts、service-worker importScripts、Vitest 前載）皆保證其載入順序在本檔之前
    const ENABLED_KEY = globalThis.DSS_TEMP_CHAT_STORAGE_KEY;

    let _isEnabledCache = false;
    // 世代計數：每次寫入快取即遞增，供 write() 判斷回滾時快取是否已被更新的寫入取代
    let _cacheGeneration = 0;
    let _hasSyncStarted = false;
    const _subscribers = new Set();

    // 嚴格布林：僅 boolean true 視為啟用，字串 'true' 等真值一律為停用
    const _coerce = (value) => value === true;

    /**
     * 唯一的快取寫入點：同時落值與遞增世代，回傳本次產生的世代編號。
     * 所有指派快取的路徑都必須經由此處，回滾守衛才不會出現漏洞。
     * @param {boolean} isEnabledValue 已完成嚴格布林化的值
     * @returns {number} 本次寫入所產生的世代編號
     */
    function _setCache(isEnabledValue) {
        _isEnabledCache = isEnabledValue;
        _cacheGeneration += 1;
        return _cacheGeneration;
    }

    /** 於呼叫時解析訊息型別常數，缺失即拋出並指名修法。 */
    const _messageTypes = () => globalThis.getSettingsMessageTypes();

    function isEnabled() {
        return _isEnabledCache;
    }

    async function initFromStorage() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: _messageTypes().GET_SETTINGS,
                keys: [ENABLED_KEY],
            });
            if (!response || response.ok !== true) {
                throw new Error(response?.error || 'GET_SETTINGS 未回傳有效結果');
            }
            _setCache(_coerce(response.values?.[ENABLED_KEY]));
        } catch (error) {
            // 讀取失敗時維持停用預設，不向呼叫端拋出
            _setCache(false);
        }
    }

    function write(isEnabledNext) {
        const isEnabledValue = _coerce(isEnabledNext);
        // 保留寫入前的值，供落盤失敗時回滾
        const previousValue = _isEnabledCache;
        // 先同步更新快取，呼叫端在 await 前即可讀到新值；記下本次寫入的世代
        const writeGeneration = _setCache(isEnabledValue);
        // 回滾判斷以世代而非值比對：R3.8 中較新的寫入可能與被拒值相同，
        // 值比對無法區分「無人接手」與「同值的新寫入」，唯世代能精準辨識
        const rollback = () => {
            if (_cacheGeneration === writeGeneration) {
                _isEnabledCache = previousValue;
            }
        };
        Promise.resolve(chrome.runtime.sendMessage({
            type: _messageTypes().SET_SETTINGS,
            values: { [ENABLED_KEY]: isEnabledValue },
        }))
            .then((response) => {
                if (!response || response.ok !== true) {
                    throw new Error(response?.error || 'SET_SETTINGS 未回傳有效結果');
                }
            })
            .catch((error) => {
                // 落盤失敗且期間無更新的寫入接手時，將快取回滾至寫入前的值
                rollback();
                console.error('[DSS] enabled-flag:write:', error);
            });
    }

    /**
     * 處理 background 廣播的設定變更：僅收斂本模組持有的啟用鍵。
     * @param {{type?: string, area?: string, changes?: Object}} message
     */
    function _handleSettingsChanged(message) {
        if (!message || message.type !== globalThis.getSettingsMessageTypes().SETTINGS_CHANGED) return;
        if (message.area !== 'local') return;

        const changes = message.changes;
        if (!changes || !(ENABLED_KEY in changes)) return;

        _setCache(_coerce(changes[ENABLED_KEY]?.newValue));
        _subscribers.forEach((subscriber) => {
            try {
                subscriber(_isEnabledCache);
            } catch (error) {
                // 監聽回呼邊界：訂閱者拋錯不得中斷其他訂閱者
                console.error('[DSS] enabled-flag:subscriber:', error);
            }
        });
    }

    function startSync() {
        if (_hasSyncStarted) return;
        _hasSyncStarted = true;
        chrome.runtime.onMessage.addListener(_handleSettingsChanged);
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') return;
        _subscribers.add(fn);
    }

    /**
     * 僅更新快取，不通知 background（供切換事件即時同步與單元測試使用）。
     * @param {boolean} isEnabledNext
     */
    function __setCache(isEnabledNext) {
        _setCache(_coerce(isEnabledNext));
    }

    return { isEnabled, initFromStorage, write, startSync, subscribe, __setCache };
})();

globalThis.TemporaryChatEnabledFlag = TemporaryChatEnabledFlag;

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatEnabledFlag;
}
