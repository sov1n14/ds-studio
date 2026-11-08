/**
 * DeepSeek page simulator for temporary-chat scenario tests.
 *
 * Runs the REAL main-world hook (content/sse-parser.js + content/censor-xhr-hook.js) in a vm
 * sandbox whose only fakes are the network trust boundary: a FakeXHR standing in for the
 * browser XMLHttpRequest, and a cross-world postMessage bridge that delivers what the hook
 * posts to the isolated-world window asynchronously, structured-cloned, with source: window
 * (the shape real Chrome delivers to a content script).
 *
 * The real history hook (content/temporary-chat-history-hook.js) runs in the same sandbox, so a
 * DeepSeek pushState reaches the content side the way it does in Chrome: the Navigation API
 * navigate event (synchronous, before the URL commits) and the hook DSS_HISTORY_NAV message
 * (a queued task, delivered after the commit).
 *
 * The page side (what DeepSeek itself does) is driven through createSession(), sendCompletion(),
 * pushState() and fetch() (the page's own window.fetch, routed through the hook; the caller supplies
 * the network behind it as options.fetch). Request and response shapes come from a live capture (2026-11-08, POC log
 * scenarios S-A and S-B): both create and completion are XHR (resourceType "xhr"); create sends
 * body "{}" and answers {code:0,data:{biz_data:{chat_session:{id}}}}; completion sends a JSON
 * body carrying chat_session_id and answers an SSE stream.
 */
import vm from 'vm';
import { loadClassicScript } from './load-classic-script.js';

export const CREATE_URL = 'https://chat.deepseek.com/api/v0/chat_session/create';
export const COMPLETION_URL = 'https://chat.deepseek.com/api/v0/chat/completion';
export const AUTH_TOKEN = 'Bearer live-shaped-token';

/** Create-session response envelope, copied from the live capture. */
export function createResponseBody(createdId) {
    return JSON.stringify({
        code: 0,
        msg: '',
        data: {
            biz_code: 0,
            biz_msg: '',
            biz_data: {
                chat_session: {
                    id: createdId,
                    title: null,
                    title_type: 'WIP',
                    model_type: 'default',
                    pinned: false,
                    updated_at: 1794132278.437,
                    seq_id: 216295478,
                    agent: 'chat',
                    version: 0,
                    is_empty: true,
                    current_message_id: null,
                    inserted_at: 1794132278.437,
                },
                ttl_seconds: 259200,
            },
        },
    });
}

/** Completion request body; key set copied from the live capture. */
export function completionRequestBody(chatSessionId) {
    return JSON.stringify({
        chat_session_id: chatSessionId,
        parent_message_id: null,
        model_type: null,
        prompt: 'hello',
        ref_file_ids: [],
        thinking_enabled: false,
        search_enabled: false,
        action: null,
        preempt: false,
        shumei_device_id: 'device-id',
    });
}

/** Minimal finished SSE stream in the DeepSeek completion format. */
export function completionSse() {
    return [
        'event: ready',
        'data: {"request_message_id":1,"response_message_id":2}',
        '',
        'data: {"v":{"response":{"message_id":2,"parent_id":1,"role":"ASSISTANT","status":"WIP","fragments":[{"id":1,"type":"RESPONSE","content":"Hi"}]}}}',
        '',
        'data: {"p":"response/fragments/-1/content","o":"APPEND","v":" there"}',
        '',
        'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
        '',
        'event: close',
        'data: {"click_behavior":"none"}',
        '',
    ].join('\n');
}

/**
 * Browser XMLHttpRequest stand-in. Supports both listener styles (addEventListener and
 * on<event> properties) and both read styles (responseText and response), so the hook may
 * observe the response through any of them. responseType follows the XHR spec: '' or 'text'
 * exposes the body as text through both properties; 'json' exposes the parsed body (null when
 * it is not JSON) through response, and reading responseText throws InvalidStateError.
 */
function makeFakeXhrClass(requestLog) {
    return class FakeXHR {
        constructor() {
            this.readyState = 0;
            this.status = 0;
            this.statusText = '';
            this._text = '';
            this.responseType = '';
            this.responseURL = '';
            this.onreadystatechange = null;
            this.onload = null;
            this.onloadend = null;
            this._listeners = {};
            this._requestHeaders = {};
            this._contentType = null;
        }

        get responseText() {
            if (this.responseType !== '' && this.responseType !== 'text') {
                throw new DOMException("Failed to read the 'responseText' property: the value is only accessible if responseType is '' or 'text'", 'InvalidStateError');
            }
            return this._text;
        }

        get response() {
            if (this.responseType !== 'json') return this._text;
            if (this.readyState !== 4) return null;
            try {
                return JSON.parse(this._text);
            } catch {
                return null;
            }
        }

        open(method, url) {
            this._method = method;
            this._url = String(url);
            this.readyState = 1;
            this._fire('readystatechange');
        }

        setRequestHeader(name, value) {
            this._requestHeaders[String(name).toLowerCase()] = value;
        }

        getResponseHeader(name) {
            return String(name).toLowerCase() === 'content-type' ? this._contentType : null;
        }

        getAllResponseHeaders() {
            return this._contentType ? 'content-type: ' + this._contentType + '\r\n' : '';
        }

        addEventListener(type, fn) {
            if (!this._listeners[type]) this._listeners[type] = [];
            this._listeners[type].push(fn);
        }

        removeEventListener(type, fn) {
            this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
        }

        send(body) {
            this._body = body;
            requestLog.push({ method: this._method, url: this._url, body });
        }

        abort() {}

        /** Deliver the response the way a browser does: headers, loading, done, load, loadend. */
        respond(status, text, contentType) {
            this.status = status;
            this.statusText = status === 200 ? 'OK' : '';
            this.responseURL = this._url;
            this._contentType = contentType;
            this.readyState = 2;
            this._fire('readystatechange');
            this.readyState = 3;
            this._text = text;
            this._fire('readystatechange');
            this.readyState = 4;
            this._fire('readystatechange');
            this._fire('load');
            this._fire('loadend');
        }

        _fire(type) {
            const event = { type, target: this, currentTarget: this };
            const handler = this['on' + type];
            if (typeof handler === 'function') handler.call(this, event);
            (this._listeners[type] || []).slice().forEach((fn) => fn.call(this, event));
        }
    };
}

/**
 * Boot the real hook against a fake network. isolatedWindow is the content-script window
 * (the happy-dom window) that receives the hook messages.
 * @param {Window} isolatedWindow
 * @param {object} [options]
 * @param {(resource: any, init?: object) => Promise<Response>} [options.fetch] - the network
 *   behind the page's window.fetch; without it a page fetch rejects (live DeepSeek uses XHR).
 */
export function bootDeepSeekPage(isolatedWindow, options = {}) {
    const requestLog = [];
    const FakeXHR = makeFakeXhrClass(requestLog);

    // The page and the hook share one realm in Chrome, so the promise the page fetch returns must be
    // a page-realm Promise: a test-realm promise would make Promise.resolve inside the hook wrap it
    // and add ticks that no browser has. Resolved once the sandbox context exists.
    let PagePromise = null;
    const pageFetch = options.fetch
        ? (...args) => new PagePromise((resolve, reject) => { options.fetch(...args).then(resolve, reject); })
        : () => Promise.reject(new Error('page fetch is unused: DeepSeek sends create and completion over XHR'));

    // Cross-world postMessage bridge: async task, structured clone, source === content window.
    const pageWindow = {
        postMessage(data) {
            const copy = structuredClone(data);
            setTimeout(() => {
                isolatedWindow.dispatchEvent(new MessageEvent('message', { data: copy, source: isolatedWindow }));
            }, 0);
        },
        fetch: pageFetch,
    };

    Object.defineProperty(pageWindow, 'location', { get: () => isolatedWindow.location });

    // Browser history: the Navigation API fires navigate before the URL commits (HTML spec,
    // URL and history update steps), then the same-document URL changes.
    function commit(navigationType, method, state, url) {
        const destinationUrl = new URL(url, isolatedWindow.location.href).href;
        if (isolatedWindow.navigation) {
            const event = Object.assign(new Event('navigate', { cancelable: true }), {
                destination: { url: destinationUrl },
                navigationType,
                hashChange: false,
                canIntercept: true,
                userInitiated: false,
            });
            isolatedWindow.navigation.dispatchEvent(event);
        }
        isolatedWindow.history[method](state, '', destinationUrl);
    }
    const pageHistory = {
        pushState: (state, unused, url) => commit('push', 'pushState', state, url),
        replaceState: (state, unused, url) => commit('replace', 'replaceState', state, url),
    };

    const sandbox = { window: pageWindow, history: pageHistory, XMLHttpRequest: FakeXHR, URL, console };
    loadClassicScript('content/sse-parser.js', sandbox);
    loadClassicScript('content/censor-xhr-hook.js', sandbox);
    loadClassicScript('content/temporary-chat-history-hook.js', sandbox);
    PagePromise = vm.runInContext('Promise', sandbox);

    function openXhr(url, body, responseType = '') {
        const xhr = new sandbox.XMLHttpRequest();
        xhr.open('POST', url);
        xhr.responseType = responseType;
        xhr.setRequestHeader('authorization', AUTH_TOKEN);
        xhr.setRequestHeader('content-type', 'application/json');
        xhr.send(body);
        return xhr;
    }

    return {
        requestLog,

        /**
         * DeepSeek POST /api/v0/chat_session/create (fires on every page load and route change).
         * Returns a handle whose respond() delivers the created session id; respond(text) delivers
         * text as the response body instead. xhr is the page's own request object.
         * @param {string} createdId
         * @param {{responseType?: string}} [requestOptions] - the XHR responseType the page sets
         */
        createSession(createdId, requestOptions = {}) {
            const xhr = openXhr(CREATE_URL, '{}', requestOptions.responseType);
            return {
                xhr,
                respond: (text = createResponseBody(createdId)) => xhr.respond(200, text, 'application/json'),
            };
        },

        /** DeepSeek client-side route change (a history-list click, a new chat committing its URL). */
        pushState(path) {
            sandbox.history.pushState(null, '', path);
        },

        /** The page calls its own window.fetch, which the hook has wrapped. */
        fetch(resource, init) {
            return sandbox.window.fetch(resource, init);
        },

        /** DeepSeek POST /api/v0/chat/completion for chatSessionId. */
        sendCompletion(chatSessionId) {
            const xhr = openXhr(COMPLETION_URL, completionRequestBody(chatSessionId));
            return { respond: () => xhr.respond(200, completionSse(), 'text/event-stream; charset=utf-8') };
        },
    };
}
