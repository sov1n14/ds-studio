/**
 * DS studio — Auto Click（重試／繼續生成）
 * 單一 setTimeout 鏈共用於「重試」與「繼續生成」兩顆按鈕。
 *
 * 行為：
 *   - 閘控：各按鈕由 content/feature-toggle.js 以「總開關 isEnabled 且自身鍵」決定；
 *     重試為 isAutoRetryEnabled，繼續生成為 isAutoContinueEnabled。本層不直讀儲存區。
 *   - 輪次：任一閘門開啟時，等待 DSSAutoClickDelay.nextDelayMs() 後，
 *     對每個閘門開啟且存在於頁面的按鈕各點擊一次，再以新的隨機延遲排下一輪；無點擊上限。
 *   - 計時器：任何時刻至多一個；由全關轉為有閘門開啟時以新延遲起跑，全關時清除。
 *   - 定位：僅透過 content/ds-selectors.js 的選擇器（主要優先、備援其次），絕不以按鈕文字定位。
 */

// 共用 DOM 選擇器常數
const __DS_AutoRetrySelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
// 儲存鍵常數：直接取 utils/storage-manager.keys.js 的鍵表（manifest 中先於本檔載入），不依賴 StorageManager 入口
const __DS_AutoRetryKeys = globalThis.__DS_StorageManager_keys.KEYS;
const AutoRetry = {
    // === 常數 ===
    // 每顆按鈕：閘門鍵與依序嘗試的選擇器（主要 → 備援）
    BUTTONS: {
        retry: {
            ownKey: __DS_AutoRetryKeys.AUTO_RETRY,
            selectors: [
                __DS_AutoRetrySelectors.RETRY_BUTTON_SELECTOR,
                __DS_AutoRetrySelectors.RETRY_BUTTON_FALLBACK_SELECTOR,
            ],
        },
        continue: {
            ownKey: __DS_AutoRetryKeys.AUTO_CONTINUE,
            selectors: [
                __DS_AutoRetrySelectors.CONTINUE_BUTTON_SELECTOR,
                __DS_AutoRetrySelectors.CONTINUE_BUTTON_FALLBACK_SELECTOR,
            ],
        },
    },

    // === 狀態 ===
    // 目前閘門開啟的按鈕名稱集合
    _openGates: new Set(),
    _timer: null,

    // ─────────────────────────────
    //  Private: Helpers
    // ─────────────────────────────

    /**
     * 依選擇器順序尋找按鈕，主要選擇器命中時不看備援。
     * @param {string[]} selectors
     * @returns {Element|null}
     */
    _findButton(selectors) {
        for (const selector of selectors) {
            const button = document.querySelector(selector);
            if (button) return button;
        }
        return null;
    },

    /**
     * 單一輪次：點擊每個閘門開啟且存在的按鈕各一次，再排下一輪。
     */
    _runRound() {
        this._timer = null;
        this._openGates.forEach((name) => {
            // 每顆按鈕各自隔離：一顆點擊拋錯不影響同輪其他按鈕，記錄後仍繼續下一輪
            try {
                const button = this._findButton(this.BUTTONS[name].selectors);
                if (button) button.click();
            } catch (error) {
                console.error(`[DSS] auto-retry:${name} 按鈕點擊失敗:`, error);
            }
        });
        this._scheduleRound();
    },

    // ─────────────────────────────
    //  Private: Timer
    // ─────────────────────────────

    /**
     * 以新的隨機延遲排下一輪。無閘門開啟或已有計時器時直接返回。
     */
    _scheduleRound() {
        if (this._openGates.size === 0 || this._timer) return;
        const delayMs = globalThis.DSSAutoClickDelay.nextDelayMs();
        this._timer = setTimeout(() => this._runRound(), delayMs);
    },

    /**
     * 停止並清除輪次計時器。若不存在則直接返回。
     */
    _stopTimer() {
        if (!this._timer) return;
        clearTimeout(this._timer);
        this._timer = null;
    },

    // ─────────────────────────────
    //  Public: Lifecycle methods
    // ─────────────────────────────

    /**
     * 開啟指定按鈕的閘門；由全關轉開時以新延遲起跑。
     * @param {string} name BUTTONS 的鍵
     */
    enable(name) {
        this._openGates.add(name);
        this._scheduleRound();
    },

    /**
     * 關閉指定按鈕的閘門；全數關閉時清除計時器。
     * @param {string} name BUTTONS 的鍵
     */
    disable(name) {
        this._openGates.delete(name);
        if (this._openGates.size === 0) this._stopTimer();
    },

    /**
     * 初始化模組：每顆按鈕各向共用 registerFeatureToggle 註冊一次，
     * 初始值與後續變更皆由 background 透過訊息提供。
     */
    start() {
        const featureToggle = globalThis.DSSFeatureToggle
            || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
        if (!featureToggle) {
            throw new Error('content/auto-retry.js 需要 content/feature-toggle.js 先行載入');
        }
        if (!globalThis.DSSAutoClickDelay) {
            throw new Error('content/auto-retry.js 需要 content/auto-click.delay.js 先行載入');
        }

        Object.entries(this.BUTTONS).forEach(([name, button]) => {
            featureToggle.registerFeatureToggle({
                ownKey: button.ownKey,
                onEnable: () => this.enable(name),
                onDisable: () => this.disable(name),
            });
        });
    }
};

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
AutoRetry.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AutoRetry;
}

// Expose on window for cross-module access
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.AutoRetry = AutoRetry;
}
