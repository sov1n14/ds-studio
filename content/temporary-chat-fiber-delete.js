/**
 * DS studio — Temporary Chat Fiber Delete (MAIN world script)
 * 單一職責：接收來自 ISOLATED world 的刪除請求，透過 React Fiber 尋找並呼叫 onDeleteSession。
 * 注入於 MAIN world，擁有存取頁面 React 實例的權限。
 * 相依：DSS_TEMP_CHAT_MESSAGE_TYPES（utils/temporary-chat-message-types.js）須先注入同一個 MAIN world。
 */
(function () {
    'use strict';

    // postMessage 型別取自 MAIN world 共用型別表（本檔看不到 isolated world 常數，由 content/main-world-injector.js 先行注入該表）
    const MESSAGE_TYPES = globalThis.DSS_TEMP_CHAT_MESSAGE_TYPES;
    if (!MESSAGE_TYPES) throw new Error('[DSS] temporary-chat-fiber-delete needs utils/temporary-chat-message-types.js injected first');

    // Cross-ref: ds-selectors.js SIDEBAR_WRAPPER_SELECTOR — update both on DeepSeek rebuild（本檔於 MAIN world 執行，無法載入 ds-selectors.js，故保留同值副本）
    const SIDEBAR_SELECTOR = 'div:has(> div > .ds-scroll-area > .ds-scroll-area)';

    /**
     * 處理來自 ISOLATED world 的刪除請求
     */
    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        if (e.data?.type !== MESSAGE_TYPES.FIBER_DELETE) return;

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
            type: MESSAGE_TYPES.FIBER_DELETE_RESULT,
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
