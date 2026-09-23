/**
 * DS studio — Extension Invalidation Toast（content/invalidation-toast.js）
 * 單一職責：擴充重載後顯示不可關閉的 toast，引導使用者重新整理頁面。
 * 無載入期副作用：僅暴露 show()，由呼叫端觸發。
 */
(function (root) {
    'use strict';

    // 模組層級旗標：toast 僅顯示一次
    let isShown = false;

    /** 顯示「擴充已失效，請重新整理」的 toast；重複呼叫為 no-op。 */
    function show() {
        if (isShown) return;
        isShown = true;

        const toast = document.createElement('div');
        toast.className = 'ds-invalidation-toast';

        // 所有樣式行內設定，避免額外 CSS 檔案
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#4d6bfe',
            color: '#fff',
            fontSize: '14px',
            padding: '12px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            zIndex: '2147483647',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            opacity: '0',
            transition: 'opacity 300ms ease',
        });

        // 訊息文字
        const msg = document.createElement('span');
        msg.textContent = dsI18n.t('invalidationToast.message');
        toast.appendChild(msg);

        // 重新整理按鈕
        const btn = document.createElement('a');
        btn.href = '#';
        btn.textContent = dsI18n.t('invalidationToast.refresh');
        Object.assign(btn.style, {
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.6)',
            borderRadius: '100px',
            padding: '4px 14px',
            textDecoration: 'none',
            fontSize: '13px',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
        });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // 通知臨時對話刪除模組這是刻意刷新（不依賴已失效的 chrome API 或 Navigation API）
            window.dispatchEvent(new CustomEvent('dss-intentional-reload'));
            location.reload();
        });
        toast.appendChild(btn);

        document.body.appendChild(toast);

        // 觸發淡入動畫（需在下一幀才能啟動 transition）
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });
    }

    root.DSSInvalidationToast = { show };

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = root.DSSInvalidationToast;
})(globalThis);
