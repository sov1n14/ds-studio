/**
 * DS studio — 連網搜索開關維持
 * 依「連網搜索」二態設定（開啟 / 關閉），在頁面進入時一次性套用智能搜索按鈕的 aria-pressed 狀態。
 * 套用僅發生一次（one-shot）：套用之後即使使用者手動翻轉按鈕、設定變更或主開關重開，皆不再回點。
 */
const WebSearchToggle = {
    STORAGE_KEY: 'dsWebSearchToggle', // 對應 StorageManager.KEYS.WEBSEARCH_TOGGLE

    enabled: false,
    mode: 'on',
    _masterEnabled: false,
    _isSpent: false, // 一次性套用是否已完成（完成後永不再點擊）
    _observer: null,

    // 在符合選擇器的元素中，優先挑選標籤文字含「搜索」者；找不到時回傳 null（避免誤點深度思考按鈕）
    _pickByLabel(selector) {
        const matches = document.querySelectorAll(selector);
        if (!matches.length) return null;
        for (const el of matches) {
            if (el.textContent.includes('搜索')) return el;
        }
        return null;
    },

    // 尋找智能搜索切換按鈕；主要選擇器之後接通用備援（不使用建置版雜湊類別）
    findButton() {
        return (
            this._pickByLabel('.ds-toggle-button[aria-pressed]') ||
            this._pickByLabel('[aria-pressed="true"], [aria-pressed="false"]')
        );
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
        if (!this._isSpent) this._armObserver();
    },

    // 停用：僅停止監看，不還原按鈕狀態（我們不擁有狀態）
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this._stopObserver();
    },

    // 監聽儲存變更（僅 local；專案的 _set() 會同步寫入 local）
    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            if (changes[StorageManager.KEYS.IS_ENABLED]) {
                this._masterEnabled = !!changes[StorageManager.KEYS.IS_ENABLED].newValue;
                this._recompute();
            }

            if (changes[this.STORAGE_KEY]) {
                this.mode = this._normalizeMode(changes[this.STORAGE_KEY].newValue);
                this._recompute();
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
