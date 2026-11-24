/**
 * DS studio — History Navigation Hook (main world script)
 * Injected into the page's main world via <script src="..."> to bypass CSP.
 * 攔截 history.pushState 與 history.replaceState，補強 Navigation API 不穩定的問題。
 * 每次呼叫時發送 DSS_HISTORY_NAV postMessage 通知 isolated world。
 * 相依：DSS_TEMP_CHAT_MESSAGE_TYPES（utils/temporary-chat-message-types.js）須先注入同一個 MAIN world。
 */
(function () {
    'use strict';

    // postMessage 型別取自 MAIN world 共用型別表（本檔看不到 isolated world 常數，由 content/main-world-injector.js 先行注入該表）
    var MESSAGE_TYPES = globalThis.DSS_TEMP_CHAT_MESSAGE_TYPES;
    if (!MESSAGE_TYPES) { throw new Error('[DSS] temporary-chat-history-hook needs utils/temporary-chat-message-types.js injected first'); }

    // 保存原始方法以供後續呼叫
    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;

    /**
     * 將 url 參數解析為絕對 URL 字串。
     * 若 url 為 falsy 則回傳 null。
     * @param {string|URL|null|undefined} url
     * @param {string} baseHref - 呼叫前擷取的 window.location.href
     * @returns {string|null}
     */
    function resolveAbsoluteUrl(url, baseHref) {
        if (!url) { return null; }
        try {
            return new URL(url, baseHref).href;
        } catch (e) {
            return null;
        }
    }

    /**
     * 發送 DSS_HISTORY_NAV postMessage 至 isolated world。
     * @param {string} absoluteUrl
     */
    function postHistoryNav(absoluteUrl) {
        window.postMessage({ type: MESSAGE_TYPES.HISTORY_NAV, url: absoluteUrl }, '*');
    }

    // 攔截 history.pushState
    history.pushState = function (state, unused, url) {
        // 必須在呼叫原始方法前擷取 href，以取得導航前的來源 URL
        var capturedLocationBeforePush = window.location.href;
        var absoluteUrl = resolveAbsoluteUrl(url, capturedLocationBeforePush);
        if (absoluteUrl) {
            postHistoryNav(absoluteUrl);
        }
        return originalPushState.apply(this, arguments);
    };

    // 攔截 history.replaceState
    history.replaceState = function (state, unused, url) {
        // 必須在呼叫原始方法前擷取 href，以取得導航前的來源 URL
        var capturedLocationBeforePush = window.location.href;
        var absoluteUrl = resolveAbsoluteUrl(url, capturedLocationBeforePush);
        if (absoluteUrl) {
            postHistoryNav(absoluteUrl);
        }
        return originalReplaceState.apply(this, arguments);
    };
})();
