/**
 * DS studio — 寬度功能共用工廠（content/width-feature.js）
 *
 * 單一職責：提供「以 vw 百分比注入 CSS」類功能的共用生命週期。
 * 工廠負責樣式標籤注入／移除、MutationObserver 的啟用重建與停用拆除、
 * 百分比變更後的重新注入，以及透過 registerFeatureToggle 的總開關＋自身開關閘控。
 *
 * 初始值以 DSS_GET_SETTINGS 訊息向 background 索取，
 * 後續變更由 background 廣播的 DSS_SETTINGS_CHANGED 訊息驅動。
 * 無載入期副作用：載入僅完成 globalThis 指派。
 *
 * 設定物件（create 的參數）欄位：
 *   STYLE_ID              必填，注入樣式標籤的 id
 *   ENABLED_KEY           必填，自身開關的儲存鍵（交給 registerFeatureToggle）
 *   PERCENT_KEY           必填，寬度數值的儲存鍵
 *   getCSS(percent)       必填，以 this 為功能物件產生 CSS 字串
 *   WATCH_KEYS            選填，除 PERCENT_KEY 外還需追蹤的儲存鍵陣列
 *   onValues(values)      選填，追蹤 WATCH_KEYS 的最新值（初始取值與變更廣播共用）
 *   getEffectivePercent() 選填，實際注入用的百分比，預設回傳 this.percent
 *   OBSERVER_OPTIONS      選填，MutationObserver.observe 的選項
 *   MIN / MAX             選填，getCSS 夾限用邊界，預設 30 / 100
 */
(function () {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const selectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // 重新注入的防抖間隔：React 重繪會連續觸發 observer
    const REAPPLY_DEBOUNCE_MS = 200;

    const _hasKey = (object, key) =>
        Boolean(key) && Object.prototype.hasOwnProperty.call(object, key);

    /** 於呼叫時解析相依模組，同時支援瀏覽器全域與單元測試的 require。 */
    function _resolveSettingsMessageTypes() {
        return globalThis.DSS_SETTINGS_MSG
            || (typeof require !== 'undefined' ? require('../utils/settings-message-constants.js') : null);
    }

    function _resolveFeatureToggle() {
        return globalThis.DSSFeatureToggle
            || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
    }

    const _sharedBehavior = {
        MIN: 30,
        MAX: 100,
        // DeepSeek 主內容區；缺失時退回 document.body
        OBSERVE_ROOT_SELECTOR: selectors.SCROLL_ROOT_SELECTOR,
        OBSERVER_OPTIONS: { childList: true, subtree: true },
        WATCH_KEYS: [],

        enabled: false,
        percent: 70,
        mutationObserver: null,
        applyTimer: null,
        _unregisterToggle: null,
        _messageListener: null,

        /** 預設無跨功能夾限，實際注入值即自身百分比。 */
        getEffectivePercent() {
            return this.percent;
        },

        injectStyles(percent) {
            let style = document.getElementById(this.STYLE_ID);
            if (!style) {
                style = document.createElement('style');
                style.id = this.STYLE_ID;
                document.head.appendChild(style);
            }
            style.textContent = this.getCSS(percent);
        },

        removeStyles() {
            const style = document.getElementById(this.STYLE_ID);
            if (style) style.remove();
        },

        applyWidth(percent) {
            this.percent = percent;
            if (this.enabled) {
                this.injectStyles(this.getEffectivePercent());
            } else {
                this.removeStyles();
            }
        },

        setupMutationObserver() {
            if (this.mutationObserver) this.mutationObserver.disconnect();

            this.mutationObserver = new MutationObserver(() => {
                if (this.applyTimer) clearTimeout(this.applyTimer);
                this.applyTimer = setTimeout(() => {
                    if (this.enabled) {
                        this.injectStyles(this.getEffectivePercent());
                    }
                }, REAPPLY_DEBOUNCE_MS);
            });

            const mainArea = document.querySelector(this.OBSERVE_ROOT_SELECTOR) || document.body;
            this.mutationObserver.observe(mainArea, this.OBSERVER_OPTIONS);
        },

        enable(percent) {
            this.enabled = true;
            this.percent = percent || this.percent;
            this.injectStyles(this.getEffectivePercent());
            this.setupMutationObserver();
        },

        disable() {
            this.enabled = false;
            this.removeStyles();
            // 停用時必須拆掉 observer，否則背景仍每 200ms 重排計時器；enable() 會重建
            if (this.mutationObserver) {
                this.mutationObserver.disconnect();
                this.mutationObserver = null;
            }
            if (this.applyTimer) {
                clearTimeout(this.applyTimer);
                this.applyTimer = null;
            }
        },

        destroy() {
            this.disable();
            if (this._unregisterToggle) {
                this._unregisterToggle();
                this._unregisterToggle = null;
            }
            if (this._messageListener) {
                chrome.runtime.onMessage.removeListener(this._messageListener);
                this._messageListener = null;
            }
        },

        /** 本功能關注的所有儲存鍵：自身寬度值加上設定宣告的額外鍵。 */
        getWatchedKeys() {
            return [this.PERCENT_KEY, ...this.WATCH_KEYS];
        },

        /** 以「鍵→值」的扁平物件更新追蹤狀態，初始取值與變更廣播共用同一條路徑。 */
        _applyValues(values) {
            if (_hasKey(values, this.PERCENT_KEY) && typeof values[this.PERCENT_KEY] === 'number') {
                this.percent = values[this.PERCENT_KEY];
            }
            if (typeof this.onValues === 'function') this.onValues(values);
        },

        _handleSettingsChanged(message) {
            const messageTypes = _resolveSettingsMessageTypes();
            if (!messageTypes || !message || message.type !== messageTypes.SETTINGS_CHANGED) return;
            if (message.area !== 'local') return;

            const changes = message.changes || {};
            const values = {};
            let hasWatchedChange = false;
            this.getWatchedKeys().forEach((key) => {
                if (!_hasKey(changes, key)) return;
                values[key] = changes[key]?.newValue;
                hasWatchedChange = true;
            });
            if (!hasWatchedChange) return;

            this._applyValues(values);
            if (this.enabled) this.applyWidth(this.percent);
        },

        /**
         * 取得初始寬度值後才註冊開關，確保 onEnable 時已握有正確百分比。
         * 讀取失敗即維持休眠，不在設定未知的情況下注入樣式。
         */
        async start() {
            try {
                const messageTypes = _resolveSettingsMessageTypes();
                const featureToggle = _resolveFeatureToggle();
                if (!messageTypes || !featureToggle) {
                    throw new Error('width-feature 需要 utils/settings-message-constants.js 與 content/feature-toggle.js 先行載入');
                }

                this._messageListener = (message) => {
                    // 訊息回呼邊界：拋錯無人可接，攔下並記錄
                    try {
                        this._handleSettingsChanged(message);
                    } catch (error) {
                        console.error('[DSS] width-feature 設定廣播處理失敗:', error);
                    }
                };
                chrome.runtime.onMessage.addListener(this._messageListener);

                const response = await chrome.runtime.sendMessage({
                    type: messageTypes.GET_SETTINGS,
                    keys: this.getWatchedKeys(),
                });
                if (!response || response.ok !== true) {
                    throw new Error(response?.error || 'GET_SETTINGS 未回傳有效結果');
                }
                this._applyValues(response.values || {});

                this._unregisterToggle = featureToggle.registerFeatureToggle({
                    ownKey: this.ENABLED_KEY,
                    onEnable: () => this.enable(this.percent),
                    onDisable: () => this.disable(),
                });
            } catch (error) {
                console.error('[DSS] width-feature 啟動失敗:', error);
            }
        },
    };

    /**
     * 以設定物件組出一個寬度功能實例。
     * @param {Object} config 見檔頭欄位說明
     * @returns {Object} 功能物件（start / enable / disable / destroy）
     */
    function create(config) {
        if (!config || typeof config !== 'object') {
            throw new Error('DSSWidthFeature.create 需要設定物件');
        }
        if (typeof config.STYLE_ID !== 'string' || !config.STYLE_ID) {
            throw new Error('DSSWidthFeature.create 需要 STYLE_ID 字串');
        }
        if (typeof config.ENABLED_KEY !== 'string' || !config.ENABLED_KEY) {
            throw new Error('DSSWidthFeature.create 需要 ENABLED_KEY 字串');
        }
        if (typeof config.PERCENT_KEY !== 'string' || !config.PERCENT_KEY) {
            throw new Error('DSSWidthFeature.create 需要 PERCENT_KEY 字串');
        }
        if (typeof config.getCSS !== 'function') {
            throw new Error('DSSWidthFeature.create 需要 getCSS 函式');
        }

        return Object.assign({}, _sharedBehavior, config);
    }

    globalThis.DSSWidthFeature = { create };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSWidthFeature;
})();
