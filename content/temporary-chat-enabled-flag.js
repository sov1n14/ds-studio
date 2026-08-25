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

    // 常數參照：classic script 的 top-level const 不會掛上 globalThis，故保留硬編碼 fallback
    const _getConst = (name, fallback) =>
        (typeof globalThis !== 'undefined' && globalThis[name] !== undefined)
            ? globalThis[name]
            : (typeof window !== 'undefined' && window[name] !== undefined)
                ? window[name]
                : fallback;

    const ENABLED_KEY = _getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled');

    let _isEnabledCache = false;
    let _hasSyncStarted = false;
    const _subscribers = new Set();

    // 嚴格布林：僅 boolean true 視為啟用，字串 'true' 等真值一律為停用
    const _coerce = (value) => value === true;

    /** 於呼叫時解析訊息型別常數，缺失即拋出並指名修法。 */
    function _messageTypes() {
        const types = globalThis.DSS_SETTINGS_MSG;
        if (!types) {
            throw new Error('[DSS] temporary-chat-enabled-flag 需要 utils/settings-message-constants.js 先行載入');
        }
        return types;
    }

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
            _isEnabledCache = _coerce(response.values?.[ENABLED_KEY]);
        } catch (error) {
            // 讀取失敗時維持停用預設，不向呼叫端拋出
            _isEnabledCache = false;
        }
    }

    function write(isEnabledNext) {
        const isEnabledValue = _coerce(isEnabledNext);
        // 先同步更新快取，呼叫端在 await 前即可讀到新值
        // 已知並接受的技術債：background 拒絕寫入時快取不回滾
        _isEnabledCache = isEnabledValue;
        Promise.resolve(chrome.runtime.sendMessage({
            type: _messageTypes().SET_SETTINGS,
            values: { [ENABLED_KEY]: isEnabledValue },
        }))
            .then((response) => {
                if (!response || response.ok !== true) {
                    throw new Error(response?.error || 'SET_SETTINGS 未回傳有效結果');
                }
            })
            .catch((error) => console.error('[DSS] enabled-flag:write:', error));
    }

    /**
     * 處理 background 廣播的設定變更：僅收斂本模組持有的啟用鍵。
     * @param {{type?: string, area?: string, changes?: Object}} message
     */
    function _handleSettingsChanged(message) {
        if (!message || message.type !== globalThis.DSS_SETTINGS_MSG?.SETTINGS_CHANGED) return;
        if (message.area !== 'local') return;

        const changes = message.changes;
        if (!changes || !(ENABLED_KEY in changes)) return;

        _isEnabledCache = _coerce(changes[ENABLED_KEY]?.newValue);
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
        _isEnabledCache = _coerce(isEnabledNext);
    }

    return { isEnabled, initFromStorage, write, startSync, subscribe, __setCache };
})();

globalThis.TemporaryChatEnabledFlag = TemporaryChatEnabledFlag;

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatEnabledFlag;
}
