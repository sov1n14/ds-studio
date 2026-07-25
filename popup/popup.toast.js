/**
 * DS studio — Popup Toast 模組
 * 提供 Toast 通知元件。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

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

// 將 Toast 掛載至全域，供 popup.js 存取（classic script 環境）
// 使用 Object.assign 合併，避免與 popup.modal.js 的載入順序互相覆蓋彼此的鍵值
if (typeof window !== 'undefined') {
    window.__DS_PopupModal = Object.assign(window.__DS_PopupModal || {}, { Toast });
}
