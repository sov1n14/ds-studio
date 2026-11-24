/**
 * DS studio — Temporary Chat 的 MAIN world postMessage 型別（utils/temporary-chat-message-types.js）
 *
 * 單一職責：宣告 MAIN world 腳本（content/censor-xhr-hook.js、content/temporary-chat-history-hook.js、content/temporary-chat-fiber-delete.js）與 isolated world 之間 window.postMessage 的 type 字串，字串只在此處定義一次。
 * 載入：MAIN world 腳本看不到 isolated world 的全域，所以本檔同時由 content/main-world-injector.js 先於這些腳本注入 MAIN world（列入 web_accessible_resources），並由 utils/temporary-chat-constants.js 在 isolated world 與 service worker 讀取。
 * 無載入期副作用，僅指派全域；不依賴 document，任何 world 皆可載入。
 */
(function (root) {
    'use strict';

    root.DSS_TEMP_CHAT_MESSAGE_TYPES = Object.freeze({
        // main world XHR/fetch hook 讀到 chat_session/create 回應時發送；payload {createdSessionId: string}（回應的 data.biz_data.chat_session.id）
        CHAT_CREATE: 'DSS_CHAT_CREATE_DETECTED',
        // main world XHR/fetch hook 偵測到 /api/v0/chat/completion 請求時發送；payload {chatSessionId: string|null}（請求主體的 chat_session_id）
        CHAT_COMPLETION: 'DSS_CHAT_COMPLETION_DETECTED',
        // ISOLATED world 要求 MAIN world 透過 React Fiber 刪除對話
        FIBER_DELETE: 'DSS_FIBER_DELETE_SESSION',
        // MAIN world 回報 Fiber 刪除結果給 ISOLATED world
        FIBER_DELETE_RESULT: 'DSS_FIBER_DELETE_RESULT',
        // MAIN world XHR hook 攔截到 authorization 標頭時回傳給 ISOLATED world
        AUTH_CAPTURED: 'DSS_AUTH_CAPTURED',
        // MAIN world history hook 偵測到 SPA 導航（pushState/replaceState）時通知 ISOLATED world
        HISTORY_NAV: 'DSS_HISTORY_NAV',
        // MAIN world XHR hook 完成一段 SSE 片段組裝後回傳給 ISOLATED world
        FRAGMENT_COMPLETE: 'DSS_FRAGMENT_COMPLETE',
    });

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) module.exports = root.DSS_TEMP_CHAT_MESSAGE_TYPES;
})(globalThis);
