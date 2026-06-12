/**
 * DS studio — XHR Hook (main world script)
 * Injected into the page's main world via <script src="..."> to bypass CSP.
 * Intercepts /api/v0/chat/completion and /api/v0/chat/edit_message XHR requests and parses SSE fragments.
 * Depends on SseParser (sse-parser.js) loaded in the same scope.
 */
(function () {
    'use strict';

    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;
    var pendingStates = new Map();

    // 需攔截的端點路徑清單：一般補全與訊息編輯均使用相同的 SSE 回應格式
    var INTERCEPTED_ENDPOINTS = ['/api/v0/chat/completion', '/api/v0/chat/edit_message'];

    /** 回傳 URL 所對應的端點名稱，若不在攔截清單中則回傳 null */
    function getMatchedEndpoint(url) {
        if (!url) { return null; }
        for (var i = 0; i < INTERCEPTED_ENDPOINTS.length; i++) {
            if (url.includes(INTERCEPTED_ENDPOINTS[i])) {
                return INTERCEPTED_ENDPOINTS[i];
            }
        }
        return null;
    }

    XMLHttpRequest.prototype.open = function (method, url) {
        this._dssUrl = typeof url === 'string' ? url : (url ? url.toString() : '');
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        var xhr = this;
        // 僅攔截列於 INTERCEPTED_ENDPOINTS 的端點，其餘請求直接放行
        var matchedEndpoint = getMatchedEndpoint(xhr._dssUrl);
        if (!matchedEndpoint) {
            return originalSend.apply(xhr, arguments);
        }

        var state = SseParser.createState();
        var buffer = '';
        pendingStates.set(xhr, state);

        // 剖析請求主體以取得 chat_session_id 與 prompt，作為重新整理定位锚點
        var reqChatSessionId = null, reqPromptText = null;
        try {
            var parsedBody = JSON.parse(typeof body === 'string' ? body : '{}');
            reqChatSessionId = parsedBody.chat_session_id || null;
            reqPromptText = typeof parsedBody.prompt === 'string' ? parsedBody.prompt : null;
        } catch (e) { /* 非 JSON 主體 — 保留 null */ }

        xhr.addEventListener('readystatechange', function () {
            if (xhr.readyState >= 3 && xhr.responseText) {
                var newData = xhr.responseText.substring(buffer.length);
                buffer = xhr.responseText;

                var lines = newData.split('\n');
                for (var i = 0; i < lines.length; i++) {
                    SseParser.parseLine(state, lines[i]);
                }

                var shouldDispatch =
                    xhr.readyState === 4 &&
                    state.messageId &&
                    state.fragments &&
                    state.started;

                if (shouldDispatch) {
                    window.postMessage({
                        type: 'DSS_FRAGMENT_COMPLETE',
                        messageId: state.messageId,
                        fragments: state.fragments,
                        thinkingElapsedSecs: state.thinkingElapsedSecs,
                        censored: state.censored,
                        aborted: !state.finished,
                        chatSessionId: reqChatSessionId,
                        promptText: reqPromptText,
                    }, '*');
                    state.messageId = null;
                    pendingStates.delete(xhr);
                }
            }
        });

        return originalSend.apply(xhr, arguments);
    };
})();
