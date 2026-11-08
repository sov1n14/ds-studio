/**
 * DS studio — XHR Hook (main world script)
 * Injected into the page's main world via <script src="..."> to bypass CSP.
 * Intercepts /api/v0/chat/completion and /api/v0/chat/edit_message XHR requests and parses SSE fragments.
 * Reads the /api/v0/chat_session/create response (XHR and fetch) and posts DSS_CHAT_CREATE_DETECTED { createdSessionId }.
 * Reads the /api/v0/chat/completion request body (XHR and fetch) and posts DSS_CHAT_COMPLETION_DETECTED { chatSessionId }.
 * Depends on SseParser (sse-parser.js) loaded in the same scope.
 */
(function () {
    'use strict';

    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;
    var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    var lastCapturedAuth = null;

    // 需攔截的端點路徑清單：一般補全與訊息編輯均使用相同的 SSE 回應格式
    var INTERCEPTED_ENDPOINTS = ['/api/v0/chat/completion', '/api/v0/chat/edit_message'];

    // 新對話建立 API 端點（必須與 temporary-chat-constants.js 中的值一致）
    var CREATE_ENDPOINT = '/api/v0/chat_session/create';

    // 補全 API 端點：請求主體的 chat_session_id 標示訊息所屬的對話
    var COMPLETION_ENDPOINT = '/api/v0/chat/completion';

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

    function isCreateUrl(url) { return !!url && url.includes(CREATE_ENDPOINT); }

    function isCompletionUrl(url) { return !!url && url.includes(COMPLETION_ENDPOINT); }

    /** 將字串請求主體剖析為物件；非字串或非 JSON 時回傳空物件 */
    function parseJsonBody(body) {
        try {
            var parsed = JSON.parse(typeof body === 'string' ? body : '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    /** 由補全請求主體取出所屬對話 id；缺少時回傳 null */
    function readChatSessionId(body) {
        var id = parseJsonBody(body).chat_session_id;
        return typeof id === 'string' && id ? id : null;
    }

    /** 由 create 回應物件取出新建立的 session id（data.biz_data.chat_session.id）；格式不符回傳 null */
    function extractCreatedSessionId(payload) {
        var session = payload && payload.data && payload.data.biz_data && payload.data.biz_data.chat_session;
        var id = session && session.id;
        return typeof id === 'string' && id ? id : null;
    }

    /** create 回應無法取得 session id：不通知（寧可漏標，也不可誤刪使用者資料） */
    function warnUnreadableCreate(err) {
        console.warn('[DSS] censor-xhr-hook: chat_session/create response carries no session id; the session will not be marked temporary', err === undefined ? '' : err);
    }

    /** 以 create 回應物件通知 isolated world 新建立的 session id */
    function notifyCreatedSession(payload) {
        var createdSessionId = extractCreatedSessionId(payload);
        if (!createdSessionId) { warnUnreadableCreate(); return; }
        window.postMessage({ type: 'DSS_CHAT_CREATE_DETECTED', createdSessionId: createdSessionId }, '*');
    }

    /** 通知 isolated world 補全請求所屬的對話 id */
    function notifyCompletion(chatSessionId) {
        window.postMessage({ type: 'DSS_CHAT_COMPLETION_DETECTED', chatSessionId: chatSessionId }, '*');
    }

    /** 讀取 XHR 的 JSON 回應（依 responseType 取 response 或 responseText），不影響頁面自身的讀取 */
    function readXhrJson(xhr) {
        if (xhr.responseType === 'json') { return xhr.response; }
        return JSON.parse(xhr.responseText);
    }

    /** 於同一個 XHR 物件的 load 事件讀取 create 回應 */
    function observeXhrCreate(xhr) {
        xhr.addEventListener('load', function () {
            try {
                notifyCreatedSession(readXhrJson(xhr));
            } catch (err) {
                warnUnreadableCreate(err);
            }
        });
    }

    /** 以 response.clone() 讀取 fetch 的 create 回應，頁面拿到的原始 response 主體不被消耗 */
    function observeFetchCreate(responsePromise) {
        Promise.resolve(responsePromise)
            .then(function (response) { return response.clone().json(); })
            .then(notifyCreatedSession, warnUnreadableCreate);
    }

    /** 由 fetch 參數取出補全請求主體並通知；主體位於 Request 物件時以 clone() 非同步讀取 */
    function notifyFetchCompletion(resource, init) {
        if (init && init.body !== undefined) {
            notifyCompletion(readChatSessionId(init.body));
            return;
        }
        if (resource && typeof resource.clone === 'function') {
            resource.clone().text()
                .then(function (text) { notifyCompletion(readChatSessionId(text)); })
                .catch(function () { notifyCompletion(null); });
            return;
        }
        notifyCompletion(null);
    }

    XMLHttpRequest.prototype.open = function (method, url) {
        this._dssUrl = typeof url === 'string' ? url : (url ? url.toString() : '');
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        var xhr = this;
        if (isCreateUrl(xhr._dssUrl)) { observeXhrCreate(xhr); }
        if (isCompletionUrl(xhr._dssUrl)) { notifyCompletion(readChatSessionId(body)); }

        // 僅攔截列於 INTERCEPTED_ENDPOINTS 的端點，其餘請求直接放行
        var matchedEndpoint = getMatchedEndpoint(xhr._dssUrl);
        if (!matchedEndpoint) {
            return originalSend.apply(xhr, arguments);
        }

        var state = SseParser.createState();
        var buffer = '';

        // 剖析請求主體以取得 chat_session_id 與 prompt，作為重新整理定位锚點
        var parsedBody = parseJsonBody(body);
        var reqChatSessionId = parsedBody.chat_session_id || null;
        var reqPromptText = typeof parsedBody.prompt === 'string' ? parsedBody.prompt : null;

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
                }
            }
        });

        return originalSend.apply(xhr, arguments);
    };

    // 攔截 setRequestHeader 以擷取 authorization token（適用於所有 XHR 請求）
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (name.toLowerCase() === 'authorization' && value !== lastCapturedAuth) {
            lastCapturedAuth = value;
            window.postMessage({ type: 'DSS_AUTH_CAPTURED', authorization: value }, '*');
        }
        return originalSetRequestHeader.apply(this, arguments);
    };


    // 攔截 window.fetch 以讀取建立回應與補全請求（DeepSeek 可能使用 fetch 而非 XHR）
    var originalFetch = window.fetch;
    window.fetch = function (resource, init) {
        var url = typeof resource === 'string'
            ? resource
            : (resource && typeof resource.url === 'string' ? resource.url : '');
        if (isCompletionUrl(url)) { notifyFetchCompletion(resource, init); }
        var responsePromise = originalFetch.apply(this, arguments);
        if (isCreateUrl(url)) { observeFetchCreate(responsePromise); }
        return responsePromise;
    };
})();
