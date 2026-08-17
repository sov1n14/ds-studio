/**
 * DS studio — 連網搜尋開關維持
 * 依「連網搜尋」二態設定（開啟 / 關閉），在頁面進入時一次性套用智能搜尋按鈕的 aria-pressed 狀態。
 * 套用為一次性（one-shot）：套用完成後即釋放控制權，讓使用者手動翻轉按鈕不會被回點。
 * 但每次「啟用事件」發生時會重新武裝一次性旗標，再次套用一次後繼續釋放控制權：
 *   (A) start() 時主開關為開啟
 *   (B) 主開關開啟期間，dsWebSearchToggle 設定透過 storage.onChanged 變更
 *   (C) 主開關透過 storage.onChanged 轉為開啟
 */
// 搜尋圖示的 path[d] 前綴（語言無關的定位基準；真實頁面資料帶前導空白，比對前需 trim）
const SEARCH_ICON_PATH_PREFIX = 'M7.9995999336';
// 定位放棄期限（毫秒）：持續定位失敗超過此時長才提出唯一一次警告
const LOCATE_GIVE_UP_MS = 15000;

const WebSearchToggle = {
    STORAGE_KEY: 'dsWebSearchToggle', // 對應 StorageManager.KEYS.WEBSEARCH_TOGGLE
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
            if (path && path.getAttribute('d').trim().startsWith(SEARCH_ICON_PATH_PREFIX)) return el;
        }
        return null;
    },

    // 尋找智能搜尋切換按鈕（語言無關，不使用建置版雜湊類別）：
    //   第一層：合併兩組選擇器候選（去重）後，依搜尋圖示 path 前綴比對
    //   第二層：位置備援 — 僅在開關群組內取第二個按鈕（深度思考之後即為搜尋）
    findButton() {
        const toggleButtons = Array.from(document.querySelectorAll('.ds-toggle-button[aria-pressed]'));
        const genericCandidates = Array.from(document.querySelectorAll('[aria-pressed="true"], [aria-pressed="false"]'));
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
            console.warn('[ds-studio] websearch-toggle: failed to locate the web-search button');
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

    // 監聽儲存變更（僅 local；專案的 _set() 會同步寫入 local）
    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            if (changes[StorageManager.KEYS.IS_ENABLED]) {
                this._masterEnabled = !!changes[StorageManager.KEYS.IS_ENABLED].newValue;
                this._rearm();
            }

            if (changes[this.STORAGE_KEY]) {
                this.mode = this._normalizeMode(changes[this.STORAGE_KEY].newValue);
                this._rearm();
            }
        });
    },

    // 啟動：讀取目前設定、註冊監聽並重新計算
    async start() {
        const data = await chrome.storage.local.get([
            this.STORAGE_KEY,
            StorageManager.KEYS.IS_ENABLED
        ]);
        this.mode = this._normalizeMode(data[this.STORAGE_KEY]);
        this._masterEnabled = !!data[StorageManager.KEYS.IS_ENABLED];
        this.setupStorageListener();
        this._recompute();
    }
};

WebSearchToggle.start();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSearchToggle;
}
