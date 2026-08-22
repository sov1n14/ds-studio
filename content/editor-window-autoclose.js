/**
 * DS studio — Editor Window Autoclose
 * chat.deepseek.com 分頁重新取得焦點時，關閉任何開啟中的編輯器視窗
 * （由 popup 鉛筆按鈕開啟的全域／提示詞組編輯器單例視窗）。
 *
 * 架構決策：
 *   - 純事件轉發：僅送出訊息給 background/editor-window-routes.js，
 *     實際的視窗關閉與 storage 讀寫皆由 background 層負責（層級界線）。
 *   - service worker 可能已休眠而無接收者，屬預期情境，靜默吞掉即可。
 */
(function () {
    'use strict';

    /** 於呼叫時解析訊息常數，缺失即拋出並指名修法。 */
    function resolveConstants() {
        const constants = globalThis.DSS_EDITOR_WINDOW;
        if (!constants) throw new Error('[DSS] editor-window-autoclose 需要 utils/editor-window-constants.js 先行載入');
        return constants;
    }

    /** window 取得焦點時，請求 background 關閉所有追蹤中的編輯器視窗。 */
    function onWindowFocus() {
        const { CLOSE_MESSAGE_TYPE } = resolveConstants();
        chrome.runtime.sendMessage({ type: CLOSE_MESSAGE_TYPE }).catch(() => {});
    }

    /** 模組啟動入口：註冊 window focus 監聽。 */
    function start() {
        window.addEventListener('focus', onWindowFocus);
    }

    globalThis.__DS_EditorWindowAutoclose = { start, onWindowFocus };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.__DS_EditorWindowAutoclose;
})();

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
if (typeof window !== 'undefined') {
    globalThis.__DS_EditorWindowAutoclose.start();
}
