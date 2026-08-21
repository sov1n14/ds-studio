/**
 * DS studio — 功能開關共用管線（content/feature-toggle.js）
 *
 * 單一職責：集中處理「總開關 + 各功能自身開關」的初始取值、變更廣播與啟停轉換。
 * 生效條件：總開關 isEnabled !== false 且該功能自身鍵 !== false（未儲存視為開啟）。
 * 初始設定向 background 索取；DSS_SETTINGS_MSG 由 utils/settings-message-constants.js 於前載入提供。
 * 全體功能共用單一 chrome.runtime.onMessage 監聽器，於第一次註冊時才掛上。
 * 無載入期副作用：載入僅完成 globalThis 指派，不註冊任何監聽器。
 */
(function () {
    'use strict';

    const MASTER_KEY = 'isEnabled';

    // 註冊表：每筆保存自身鍵、回呼、最新設定值與目前生效狀態
    const _features = new Set();
    let _hasSharedListener = false;

    // 未儲存（undefined）視為開啟，僅明確的 false 才是關閉
    const _isKeyOn = (value) => value !== false;

    const _hasKey = (changes, key) =>
        Boolean(key) && Object.prototype.hasOwnProperty.call(changes, key);

    function _computeIsOn(feature) {
        if (!_isKeyOn(feature.masterValue)) return false;
        if (!feature.ownKey) return true;
        return _isKeyOn(feature.ownValue);
    }

    /**
     * 套用新的生效狀態；狀態未轉換則不呼叫任何回呼。
     * 狀態先行更新，故回呼拋錯的功能仍計為已啟用，下一次關閉才能正確拆除。
     */
    function _applyState(feature, isOnNext) {
        if (feature.isOn === isOnNext) return;
        feature.isOn = isOnNext;

        const handler = isOnNext ? feature.onEnable : feature.onDisable;
        if (typeof handler !== 'function') return;
        try {
            handler();
        } catch (error) {
            // 回呼邊界：單一功能拋錯不得中斷其他功能的通知
            console.error('[DSS] feature-toggle:回呼失敗:', error);
        }
    }

    async function _loadInitialState(feature) {
        const keys = feature.ownKey ? [MASTER_KEY, feature.ownKey] : [MASTER_KEY];
        try {
            const response = await chrome.runtime.sendMessage({
                type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS,
                keys,
            });
            if (!response || response.ok !== true) {
                throw new Error(response?.error || 'GET_SETTINGS 未回傳有效結果');
            }

            const values = response.values || {};
            feature.masterValue = values[MASTER_KEY];
            if (feature.ownKey) feature.ownValue = values[feature.ownKey];

            // 等待回應期間可能已解除註冊
            if (!_features.has(feature)) return;
            _applyState(feature, _computeIsOn(feature));
        } catch (error) {
            // 讀取失敗時維持休眠，避免在設定未知的情況下啟用功能
            feature.masterValue = false;
            console.error('[DSS] feature-toggle:初始設定讀取失敗:', error);
        }
    }

    function _handleMessage(message) {
        if (!message || message.type !== globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED) return;
        if (message.area !== 'local') return;

        const changes = message.changes;
        if (!changes) return;

        const isMasterChanged = _hasKey(changes, MASTER_KEY);
        _features.forEach((feature) => {
            const isOwnChanged = _hasKey(changes, feature.ownKey);
            if (!isMasterChanged && !isOwnChanged) return;

            if (isMasterChanged) feature.masterValue = changes[MASTER_KEY]?.newValue;
            if (isOwnChanged) feature.ownValue = changes[feature.ownKey]?.newValue;
            _applyState(feature, _computeIsOn(feature));
        });
    }

    function _ensureSharedListener() {
        if (_hasSharedListener) return;
        _hasSharedListener = true;
        chrome.runtime.onMessage.addListener(_handleMessage);
    }

    /**
     * 註冊一個受總開關與自身開關控制的功能。
     * @param {{ownKey?: string|null, onEnable: Function, onDisable?: Function}} options
     * @returns {Function} 解除註冊函式（可重複呼叫）
     */
    function registerFeatureToggle(options) {
        if (!options || typeof options !== 'object') {
            throw new Error('registerFeatureToggle 需要 { ownKey, onEnable, onDisable } 物件');
        }
        if (typeof options.onEnable !== 'function') {
            throw new Error('registerFeatureToggle 需要 onEnable 函式');
        }

        const feature = {
            ownKey: options.ownKey || null,
            onEnable: options.onEnable,
            onDisable: options.onDisable,
            masterValue: undefined,
            ownValue: undefined,
            isOn: false,
        };

        _features.add(feature);
        _ensureSharedListener();
        _loadInitialState(feature);

        let isUnregistered = false;
        return function unregister() {
            if (isUnregistered) return;
            isUnregistered = true;
            _features.delete(feature);
        };
    }

    globalThis.DSSFeatureToggle = { registerFeatureToggle };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSFeatureToggle;
})();
