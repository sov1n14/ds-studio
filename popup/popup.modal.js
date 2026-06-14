/**
 * DS studio — Popup Modal & Toast 模組
 * 提供自訂 Modal 對話框（替代瀏覽器原生 prompt/confirm/alert）
 * 以及 Toast 通知元件。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

// ────────────────────────────────────────────
// Custom Modal controller
// ────────────────────────────────────────────

const Modal = {
    overlay: null,
    titleEl: null,
    messageEl: null,
    inputEl: null,
    requiredEl: null,
    actionsEl: null,

    init() {
        this.overlay = document.getElementById('modalOverlay');
        this.titleEl = document.getElementById('modalTitle');
        this.messageEl = document.getElementById('modalMessage');
        this.inputEl = document.getElementById('modalInput');
        this.requiredEl = document.getElementById('modalRequired');
        this.actionsEl = document.getElementById('modalActions');
    },

    /** 顯示前的共用初始化 */
    _setup() {
        this.overlay.hidden = false;
        this._keyHandler = (e) => {
            if (e.key === 'Escape') this._dismiss();
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    /** 關閉後的共用清理 */
    _cleanup() {
        this.overlay.hidden = true;
        this.requiredEl.hidden = true;
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        this.actionsEl.innerHTML = '';
        this.inputEl.onkeydown = null;
        this.inputEl.oninput = null;
        this.inputEl.style.display = '';
    },

    /** 預設關閉行為，由各呼叫端覆寫 */
    _dismiss() {},

    /** 若 overlay 可見則關閉目前的 modal */
    dismissActive() {
        if (this.overlay && !this.overlay.hidden) {
            this._dismiss();
        }
    },

    /** 建立按鈕並加入 actions 容器 */
    _buildButton(text, className, onClick) {
        const btn = document.createElement('button');
        btn.className = 'modal-btn' + (className ? ' ' + className : '');
        btn.textContent = text;
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        this.actionsEl.appendChild(btn);
        return btn;
    },

    /**
     * 顯示帶有輸入欄位的 prompt modal。
     * 名稱為必填 — 空白時確認按鈕停用並顯示「必填」提示。
     * 點擊 overlay 不關閉；只能透過取消或 Escape 關閉。
     * @param {Object} options
     * @param {string} options.title - 對話框標題
     * @param {string} [options.value] - 預填值
     * @param {string} [options.placeholder] - 輸入框佔位文字
     * @returns {Promise<string|null>} 修剪後的輸入值，取消則為 null
     */
    prompt({ title, value, placeholder } = {}) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (result) => { if (!settled) { settled = true; this._cleanup(); resolve(result); } };

            this._dismiss = () => finish(null);
            this.titleEl.textContent = title || '';
            this.messageEl.style.display = 'none';
            this.requiredEl.hidden = true;
            this.inputEl.style.display = '';
            this.inputEl.value = value || '';
            this.inputEl.placeholder = placeholder || '';

            this.actionsEl.innerHTML = '';
            const cancelBtn = this._buildButton(dsI18n.t('cancelButton'), '', () => finish(null));
            const confirmBtn = this._buildButton(dsI18n.t('confirmButtonDefault'), 'modal-btn--primary', () => {
                const val = this.inputEl.value.trim();
                if (val) finish(val);
            });

            // 驗證輸入：空白時停用確認鈕並顯示必填提示
            function validate() {
                const isEmpty = !this.inputEl.value.trim();
                confirmBtn.disabled = isEmpty;
                this.requiredEl.hidden = !isEmpty;
            }
            this.inputEl.oninput = validate.bind(this);

            // Enter 鍵只在有輸入時確認
            this.inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const val = this.inputEl.value.trim();
                    if (val) finish(val);
                }
            };

            // 初始驗證狀態
            if (!value) {
                confirmBtn.disabled = true;
                this.requiredEl.hidden = false;
            }

            this._setup();
            setTimeout(() => { this.inputEl.focus(); this.inputEl.select(); }, 50);
        });
    },

    /**
     * 顯示確認或提示 modal。
     * @param {Object} options
     * @param {string} options.title - 對話框標題
     * @param {string} [options.message] - 內文
     * @param {string} [options.confirmText='確認'] - 確認按鈕文字
     * @param {string|null} [options.cancelText='取消'] - 取消按鈕文字；傳 null 為單按鈕模式
     * @param {string} [options.variant] - 'danger' 顯示紅色確認鈕
     * @returns {Promise<boolean>} 確認為 true，取消為 false
     */
    confirm({ title, message, confirmText, cancelText, variant } = {}) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (result) => { if (!settled) { settled = true; this._cleanup(); resolve(result); } };

            this._dismiss = () => finish(false);
            this.titleEl.textContent = title || '';
            this.messageEl.textContent = message || '';
            this.messageEl.style.display = '';
            this.inputEl.style.display = 'none';

            this.actionsEl.innerHTML = '';
            // 單按鈕模式時省略取消鈕
            if (cancelText !== null) {
                this._buildButton(cancelText || dsI18n.t('cancelButton'), '', () => finish(false));
            }

            const btnClass = variant === 'danger' ? 'modal-btn--danger' : 'modal-btn--primary';
            this._buildButton(confirmText || dsI18n.t('confirmButtonDefault'), btnClass, () => finish(true));

            this._setup();
        });
    }
};

// ────────────────────────────────────────────
// Toast notification utility
// ────────────────────────────────────────────

const Toast = {
    el: null,

    init() {
        this.el = document.getElementById('toast');
    },

    show(message, duration = 2000) {
        if (!this.el) return;
        this.el.textContent = message;
        this.el.hidden = false;
        // 強制 reflow，使瀏覽器能從 hidden→visible 觸發過渡動畫
        this.el.offsetHeight;
        this.el.style.opacity = '1';

        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => {
            this.el.style.opacity = '0';
            this._timer = setTimeout(() => {
                this.el.hidden = true;
            }, 400); // 對應 CSS transition 時間
        }, duration);
    }
};

// 將 Modal 與 Toast 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupModal = { Modal, Toast };
}
