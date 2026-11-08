/**
 * DS studio — 剪貼簿寫入訊息路由（background/clipboard-routes.js）
 *
 * 職責：background 層的訊息路由。install() 於呼叫時（非載入時）註冊單一 chrome.runtime.onMessage 監聽器；收到 DSS_COPY_TO_CLIPBOARD 時驗證 text 為字串，確保 reason CLIPBOARD 的 offscreen 文件存在，再以 DSS_OFFSCREEN_WRITE_CLIPBOARD 請該文件寫入剪貼簿，僅在 offscreen 回覆 { ok: true } 時回應成功。未知型別回傳 false 且不回應，讓既有的其他 onMessage 監聽器仍能處理。
 *
 * 不使用 chrome.runtime.getContexts／chrome.offscreen.hasDocument（Chrome 最低版本 111 不支援），改以「建立中 promise + 已建立旗標」追蹤文件，並把單一文件錯誤視為文件已存在。
 *
 * 相依：utils/message-constants.js 需先載入。
 */
(function () {
    'use strict';

    const OFFSCREEN_DOCUMENT_PATH = 'offscreen/clipboard-offscreen.html';
    const OFFSCREEN_JUSTIFICATION = 'Write chat reply text to the clipboard on behalf of the DeepSeek content script.';
    // Chrome 於文件已存在時 createDocument 拒絕的訊息片段
    const SINGLE_DOCUMENT_ERROR_FRAGMENT = 'Only a single offscreen document may be created';
    // offscreen 文件已關閉時 sendMessage 拒絕的訊息片段
    const NO_RECEIVER_ERROR_FRAGMENT = 'Receiving end does not exist';

    /**
     * 於呼叫時解析訊息型別常數，缺失即拋出並指名修法。
     * @param {string} name - globalThis 上的常數名稱
     * @returns {string}
     */
    function resolveMessageType(name) {
        const type = globalThis[name];
        if (!type) throw new Error(`[DSS] clipboard-routes 需要 utils/message-constants.js 先行載入（缺少 ${name}）`);
        return type;
    }

    /**
     * 判斷錯誤訊息是否含指定片段。
     * @param {unknown} err
     * @param {string} fragment
     * @returns {boolean}
     */
    function hasErrorFragment(err, fragment) {
        return String(err?.message ?? err).includes(fragment);
    }

    /** 建立 offscreen 文件；async 讓同步拋錯也轉為拒絕。單一文件錯誤代表文件已存在，視為成功。 */
    async function createOffscreenDocument() {
        // 未授予 offscreen 權限時 chrome.offscreen 不存在
        if (typeof chrome.offscreen?.createDocument !== 'function') throw new Error('chrome.offscreen 無法使用（未授予 offscreen 權限）');
        try {
            await chrome.offscreen.createDocument({
                url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
                reasons: ['CLIPBOARD'],
                justification: OFFSCREEN_JUSTIFICATION,
            });
        } catch (err) {
            if (!hasErrorFragment(err, SINGLE_DOCUMENT_ERROR_FRAGMENT)) throw err;
        }
    }

    /**
     * 建立剪貼簿寫入器；文件狀態與寫入佇列封裝於閉包，由 install() 持有。
     * @param {string} offscreenWriteType - 送往 offscreen 文件的訊息型別
     * @returns {{ copy: (message: { text?: unknown }) => Promise<void> }}
     */
    function createClipboardWriter(offscreenWriteType) {
        let isDocumentCreated = false;
        let pendingCreation = null;
        let writeQueue = Promise.resolve();

        /** 確保 offscreen 文件存在；同時間只有一個建立中的 promise。 */
        async function ensureOffscreenDocument() {
            if (isDocumentCreated) return;
            if (!pendingCreation) {
                pendingCreation = createOffscreenDocument()
                    .then(() => { isDocumentCreated = true; })
                    .finally(() => { pendingCreation = null; });
            }
            await pendingCreation;
        }

        /** 確保文件後送出寫入訊息，回傳 offscreen 的回覆。 */
        async function sendToOffscreen(text) {
            await ensureOffscreenDocument();
            return chrome.runtime.sendMessage({ type: offscreenWriteType, text });
        }

        /** 寫入一次；文件已消失（無接收端）時清除旗標、重建並僅重試一次。 */
        async function writeText(text) {
            let response;
            try {
                response = await sendToOffscreen(text);
            } catch (err) {
                if (!hasErrorFragment(err, NO_RECEIVER_ERROR_FRAGMENT)) throw err;
                isDocumentCreated = false;
                response = await sendToOffscreen(text);
            }
            if (response?.ok !== true) throw new Error('offscreen 文件未能寫入剪貼簿');
        }

        /**
         * 驗證後排入佇列序列化寫入；失敗不阻塞後續訊息。
         * @param {{ text?: unknown }} message
         */
        function copy(message) {
            const text = message?.text;
            if (typeof text !== 'string') return Promise.reject(new TypeError('剪貼簿內容 text 必須為字串'));
            const result = writeQueue.then(() => writeText(text));
            writeQueue = result.catch(() => {});
            return result;
        }

        return { copy };
    }

    /**
     * 建立 message.type → 處理函式的對照表。
     * @returns {Object<string, (message: object) => Promise<void>>}
     */
    function buildRouteTable() {
        const writer = createClipboardWriter(resolveMessageType('DSS_OFFSCREEN_WRITE_CLIPBOARD'));
        return {
            [resolveMessageType('DSS_COPY_TO_CLIPBOARD')]: writer.copy,
        };
    }

    /**
     * 執行單一路由並回應結果；失敗於此邊界攔截（onMessage 之外無人可攔）。
     * @param {(message: object) => Promise<void>} route
     * @param {object} message
     * @param {(response: object) => void} sendResponse
     */
    async function runRoute(route, message, sendResponse) {
        try {
            await route(message);
            sendResponse({ ok: true });
        } catch (err) {
            console.error(`[DSS] clipboard-routes ${message?.type}:`, err);
            sendResponse({ ok: false, error: String(err) });
        }
    }

    /**
     * 註冊剪貼簿寫入訊息路由監聽器。
     * 必須由 service worker 於頂層呼叫，確保 worker 重啟後仍能存活。
     */
    function install() {
        const routes = buildRouteTable();

        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            const route = routes[message?.type];
            if (!route) return false; // 交由其他監聽器處理
            runRoute(route, message, sendResponse);
            return true; // 非同步回應
        });
    }

    globalThis.DSSClipboardRoutes = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSClipboardRoutes;
})();
