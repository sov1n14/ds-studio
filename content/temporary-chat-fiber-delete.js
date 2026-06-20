/**
 * DS studio — Temporary Chat Fiber Delete (MAIN world script)
 * 單一職責：接收來自 ISOLATED world 的刪除請求，透過 React Fiber 尋找並呼叫 onDeleteSession。
 * 注入於 MAIN world，擁有存取頁面 React 實例的權限。
 */
(function () {
    'use strict';

    const SIDEBAR_SELECTOR = 'div.dc04ec1d';

    /**
     * 處理來自 ISOLATED world 的刪除請求
     */
    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        if (e.data?.type !== 'DSS_FIBER_DELETE_SESSION') return;

        const sessionId = e.data.sessionId;
        if (!sessionId) {
            postResult(sessionId, false);
            return;
        }

        const success = attemptFiberDelete(sessionId);
        postResult(sessionId, success);
    });

    /**
     * 回報結果給 ISOLATED world
     */
    function postResult(sessionId, success) {
        window.postMessage({
            type: 'DSS_FIBER_DELETE_RESULT',
            sessionId: sessionId,
            success: success
        }, '*');
    }

    /**
     * 嘗試透過 React Fiber 刪除對話
     * @param {string} sessionId
     * @returns {boolean} 是否成功找到並呼叫 onDeleteSession
     */
    function attemptFiberDelete(sessionId) {
        try {
            const sidebar = document.querySelector(SIDEBAR_SELECTOR);
            if (!sidebar) return false;

            const anchor = Array.from(sidebar.querySelectorAll('a')).find(a => a.href && a.href.includes(sessionId));
            if (!anchor) return false;

            const fiberKey = Object.keys(anchor).find(k => k.startsWith('__reactFiber$'));
            if (!fiberKey) return false;

            let f = anchor[fiberKey];
            let steps = 0;
            
            while (f && steps < 20) {
                if (f.memoizedProps && typeof f.memoizedProps.onDeleteSession === 'function') {
                    f.memoizedProps.onDeleteSession(sessionId);
                    return true;
                }
                f = f.return;
                steps++;
            }
            return false;
        } catch (err) {
            console.error('[DSS] Fiber delete error:', err);
            return false;
        }
    }
})();
