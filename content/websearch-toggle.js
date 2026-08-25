/**
 * DS studio — 連網搜尋開關維持
 * 依「連網搜尋」二態設定（開啟 / 關閉），在頁面進入時一次性套用智能搜尋按鈕的 aria-pressed 狀態。
 * 套用為一次性（one-shot）：套用完成後即釋放控制權，讓使用者手動翻轉按鈕不會被回點。
 * 但每次「啟用事件」發生時會重新武裝一次性旗標，再次套用一次後繼續釋放控制權：
 *   (A) start() 時主開關為開啟
 *   (B) 主開關開啟期間，dsWebSearchToggle 模式值經 DSS_SETTINGS_CHANGED 廣播變更
 *   (C) 主開關經 registerFeatureToggle 轉為開啟
 *
 * 設定來源：主開關閘控交由 content/feature-toggle.js；模式值以 DSS_GET_SETTINGS
 * 向 background 索取初始值，後續變更由 DSS_SETTINGS_CHANGED 廣播驅動。
 */
// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DS_WebsearchSelectors = (globalThis.DSstudio && globalThis.DSstudio.Selectors) || (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
// 定位放棄期限（毫秒）：持續定位失敗超過此時長才提出唯一一次警告
const LOCATE_GIVE_UP_MS = 15000;

const WebSearchToggle = {
    STORAGE_KEY: StorageManager.KEYS.WEBSEARCH_TOGGLE,
    LOCATE_GIVE_UP_MS,

    enabled: false,
    mode: 'on',
    _masterEnabled: false,
    _isSpent: false, // 一次性套用是否已完成（完成後直到下次重新武裝前不再點擊）
    _observer: null,
    _giveUpTimer: null, // 定位放棄期限的計時器控制代碼

    // 在候選元素中，回傳第一個含搜尋圖示（path[d] 去除前導空白後與前綴相符）者；找不到時回傳 null
    _pickByIcon(candidates) {
        for (const el of candidates) {
            const path = el.querySelector('path[d]');
            if (path && path.getAttribute('d').trim().startsWith(__DS_WebsearchSelectors.SEARCH_ICON_PATH_PREFIX)) return el;
        }
        return null;
    },

    // 尋找智能搜尋切換按鈕（語言無關，不使用建置版雜湊類別）：
    //   第一層：合併兩組選擇器候選（去重）後，依搜尋圖示 path 前綴比對
    //   第二層：位置備援 — 僅在開關群組內取第二個按鈕（深度思考之後即為搜尋）
    findButton() {
        const toggleButtons = Array.from(document.querySelectorAll(__DS_WebsearchSelectors.TOGGLE_BUTTON_SELECTOR));
        const genericCandidates = Array.from(document.querySelectorAll(__DS_WebsearchSelectors.TOGGLE_BUTTON_FALLBACK_SELECTOR));
        const iconMatch = this._pickByIcon(new Set([...toggleButtons, ...genericCandidates]));
        if (iconMatch) return iconMatch;
        if (toggleButtons.length >= 2) return toggleButtons[1];
        return null;
    },

    // 將儲存值正規化為 'on' / 'off'：未設定或舊版 'default' 值一律視為 'on'
    _normalizeMode(value) {
        return value === 'off' ? 'off' : 'on';
    },

    // 若按鈕目前狀態與目前 mode 目標不符，點擊一次
    apply(btn) {
        if (!btn || !btn.isConnected) return;
        const isOn = btn.getAttribute('aria-pressed') === 'true';
        const targetOn = this.mode === 'on';
        if (isOn === targetOn) return;
        btn.click();
    },

    // 對目前頁面上既有的按鈕執行一次性套用；套用後（無論是否點擊）即標記為已完成並停止監看
    applyToExisting() {
        if (this._isSpent) return;
        const btn = this.findButton();
        if (!btn) return;
        this.apply(btn);
        this._isSpent = true;
        this._cancelGiveUp();
        this._stopObserver();
    },

    // 掛載 observer，等待按鈕出現後執行一次性套用
    _armObserver() {
        if (this._observer) return;
        this._observer = new MutationObserver(() => {
            if (this._isSpent) {
                this._stopObserver();
                return;
            }
            this.applyToExisting();
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
    },

    _stopObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    },
    // 武裝定位放棄期限：期限到期時若仍未套用（_isSpent 仍為 false）才提出唯一一次警告
    _armGiveUp() {
        this._cancelGiveUp();
        this._giveUpTimer = setTimeout(() => {
            this._giveUpTimer = null;
            if (this._isSpent) return;
            console.warn('[DSS] websearch-toggle: failed to locate the web-search button');
        }, this.LOCATE_GIVE_UP_MS);
    },

    // 取消尚未到期的定位放棄計時器（套用成功、停用或重新武裝時呼叫）
    _cancelGiveUp() {
        if (this._giveUpTimer) {
            clearTimeout(this._giveUpTimer);
            this._giveUpTimer = null;
        }
    },

    // 依主開關與一次性套用是否已完成重新計算：僅在主開關開啟且尚未套用時啟用
    _recompute() {
        if (this._masterEnabled && !this._isSpent) {
            this.enable();
        } else {
            this.disable();
        }
    },

    // 啟用：嘗試對既有按鈕套用一次；若按鈕尚未出現則開始監看
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.applyToExisting();
        if (!this._isSpent) {
            this._armObserver();
            this._armGiveUp();
        }
    },

    // 停用：僅停止監看，不還原按鈕狀態（我們不擁有狀態）
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this._stopObserver();
        this._cancelGiveUp();
    },

    // 重新武裝一次性旗標：先在 enabled 仍誠實反映狀態時執行 disable() 卸除監看，
    // 避免 disable() 因 enabled 提前被設為 false 而提早 return 導致 observer 洩漏，
    // 再重置 _isSpent 並重新計算，讓下一次啟用事件能再套用一次。
    _rearm() {
        this.disable();
        this._isSpent = false;
        this._recompute();
    },

    /** 於呼叫時解析相依模組，同時支援瀏覽器全域與單元測試的 require。 */
    _resolveDeps() {
        return {
            messageTypes: globalThis.getSettingsMessageTypes(),
            featureToggle: globalThis.DSSFeatureToggle
                || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null),
        };
    },

    // 處理 background 廣播的設定變更：僅關心自身模式值，變更後重新武裝一次性套用
    _handleSettingsChanged(message) {
        const { messageTypes } = this._resolveDeps();
        if (!messageTypes || !message || message.type !== messageTypes.SETTINGS_CHANGED) return;
        if (message.area !== 'local') return;

        const change = message.changes?.[this.STORAGE_KEY];
        if (!change) return;

        this.mode = this._normalizeMode(change.newValue);
        this._rearm();
    },

    // 訂閱設定廣播（模式值變更）
    _setupSettingsListener() {
        chrome.runtime.onMessage.addListener((message) => {
            // 訊息回呼邊界：拋錯無人可接，攔下並記錄
            try {
                this._handleSettingsChanged(message);
            } catch (error) {
                console.error('[DSS] websearch-toggle 設定廣播處理失敗:', error);
            }
        });
    },

    // 啟動：先取得模式值，再把主開關閘控交給共用 registerFeatureToggle
    async start() {
        try {
            const { messageTypes, featureToggle } = this._resolveDeps();
            if (!messageTypes || !featureToggle) {
                throw new Error('content/websearch-toggle.js 需要 utils/settings-message-constants.js 與 content/feature-toggle.js 先行載入');
            }

            this._setupSettingsListener();

            const response = await chrome.runtime.sendMessage({
                type: messageTypes.GET_SETTINGS,
                keys: [this.STORAGE_KEY],
            });
            if (!response || response.ok !== true) {
                throw new Error(response?.error || 'GET_SETTINGS 未回傳有效結果');
            }
            this.mode = this._normalizeMode((response.values || {})[this.STORAGE_KEY]);

            featureToggle.registerFeatureToggle({
                onEnable: () => {
                    this._masterEnabled = true;
                    this._rearm();
                },
                onDisable: () => {
                    this._masterEnabled = false;
                    this._rearm();
                },
            });
        } catch (error) {
            // 讀取失敗即維持休眠，不在設定未知的情況下點擊頁面按鈕
            console.error('[DSS] websearch-toggle 啟動失敗:', error);
        }
    }
};

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
WebSearchToggle.start();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSearchToggle;
}
