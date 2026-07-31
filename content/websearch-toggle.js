/**
 * DS studio — 連網搜索開關維持
 * 依「連網搜索」三態設定（開啟 / 關閉 / 預設）強制維持智能搜索按鈕的 aria-pressed 狀態。
 */
const WebSearchToggle = {
    STORAGE_KEY: 'dsWebSearchToggle', // 對應 StorageManager.KEYS.WEBSEARCH_TOGGLE
    CLICK_COOLDOWN_MS: 500, // 點擊冷卻：避免與頁面邏輯互相觸發造成連點

    enabled: false,
    mode: 'default',
    _masterEnabled: false,
    _targetOn: false,
    _observer: null,
    _lastClickAt: 0,

    // 在符合選擇器的元素中，優先挑選標籤文字含「搜索」者；找不到時退回第一個
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

    // 若按鈕目前狀態與目標不符，點擊一次（受冷卻時間限制）
    apply(btn) {
        if (!btn || !btn.isConnected) return;
        const isOn = btn.getAttribute('aria-pressed') === 'true';
        if (isOn === this._targetOn) return;
        if (Date.now() - this._lastClickAt < this.CLICK_COOLDOWN_MS) return;
        this._lastClickAt = Date.now();
        btn.click();
    },

    // 對目前頁面上既有的按鈕執行一次套用
    applyToExisting() {
        const btn = this.findButton();
        if (btn) this.apply(btn);
    },

    // 監看 body 的重新渲染，以及按鈕本身的 aria-pressed 變動
    _handleMutations() {
        if (!this.enabled) return;
        this._armObserver();
        const btn = this.findButton();
        if (btn) this.apply(btn);
    },

    // 掛載（或重新掛載）observer；屬性目標永遠指向重新渲染後的實體按鈕
    _armObserver() {
        if (!this._observer) {
            this._observer = new MutationObserver(() => this._handleMutations());
        } else {
            this._observer.disconnect();
        }
        this._observer.observe(document.body, { childList: true, subtree: true });
        const btn = this.findButton();
        if (btn && btn.isConnected) {
            this._observer.observe(btn, { attributes: true, attributeFilter: ['aria-pressed'] });
        }
    },

    _stopObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    },

    // 依主開關與模式重新計算：開啟/關閉時執行，預設或主開關關閉時停止
    _recompute() {
        this._targetOn = this.mode === 'on';
        if (this._masterEnabled && this.mode !== 'default') {
            if (this.enabled) {
                this.applyToExisting(); // 已啟用時僅重新套用（模式可能已切換）
            } else {
                this.enable();
            }
        } else {
            this.disable();
        }
    },

    // 啟用：套用既有按鈕並開始監看
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.applyToExisting();
        this._armObserver();
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
                this.mode = changes[this.STORAGE_KEY].newValue ?? 'default';
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
        this.mode = data[this.STORAGE_KEY] ?? 'default';
        this._masterEnabled = data[StorageManager.KEYS.IS_ENABLED] ?? false;
        this.setupStorageListener();
        this._recompute();
    }
};

WebSearchToggle.start();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSearchToggle;
}
