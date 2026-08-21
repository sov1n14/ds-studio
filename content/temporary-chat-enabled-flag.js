/**
 * DS studio — 臨時對話啟用旗標
 * 單一職責：集中管理 chrome.storage.local 中的啟用旗標快取、讀寫與跨情境同步。
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

    function isEnabled() {
        return _isEnabledCache;
    }

    async function initFromStorage() {
        try {
            const result = await chrome.storage.local.get([ENABLED_KEY]);
            _isEnabledCache = _coerce(result?.[ENABLED_KEY]);
        } catch (error) {
            // 讀取失敗時維持停用預設，不向呼叫端拋出
            _isEnabledCache = false;
        }
    }

    function write(isEnabledNext) {
        const isEnabledValue = _coerce(isEnabledNext);
        // 先同步更新快取，呼叫端在 await 前即可讀到新值
        _isEnabledCache = isEnabledValue;
        Promise.resolve(chrome.storage.local.set({ [ENABLED_KEY]: isEnabledValue }))
            .catch((error) => console.error('[DSS] enabled-flag:write:', error));
    }

    function startSync() {
        if (_hasSyncStarted) return;
        _hasSyncStarted = true;
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
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
        });
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') return;
        _subscribers.add(fn);
    }

    return { isEnabled, initFromStorage, write, startSync, subscribe };
})();

globalThis.TemporaryChatEnabledFlag = TemporaryChatEnabledFlag;

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatEnabledFlag;
}
