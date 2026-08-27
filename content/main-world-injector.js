/**
 * DS studio — Main World Injector (Entry)
 *
 * 於 content script（isolated world）啟動時，將所有需要在頁面 MAIN world 執行的
 * 腳本一次注入完畢。這些腳本無法用 content script 載入，因為它們必須改寫頁面自身的
 * XMLHttpRequest / history / React fiber。
 *
 * 注入順序即 MAIN_WORLD_SCRIPTS 的陣列順序：sse-parser.js 是 censor-xhr-hook.js 的
 * 相依，必須在其之前執行。
 *
 * 每個腳本皆須列入 manifest.json 的 web_accessible_resources 才能取得 URL。
 */
(function (root) {
    'use strict';

    /** 依序注入的 MAIN world 腳本（前者為後者的相依） */
    const MAIN_WORLD_SCRIPTS = [
        'content/sse-parser.js',
        'content/censor-xhr-hook.js',
        'content/temporary-chat-history-hook.js',
        'content/temporary-chat-fiber-delete.js',
    ];

    let isInjected = false;

    /**
     * 將單一腳本以 <script src> 注入 MAIN world，載入觸發後隨即移除標籤保持 DOM 乾淨。
     * @param {string} resourcePath 相對於擴充功能根目錄的路徑
     */
    function injectScript(resourcePath) {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(resourcePath);
        document.documentElement.appendChild(script);
        script.remove();
    }

    /**
     * 注入全部 MAIN world 腳本（冪等；重複呼叫不會二次注入）。
     * @returns {boolean} 是否完成注入
     */
    function inject() {
        if (isInjected) return false;
        if (typeof document === 'undefined' || !document.documentElement) return false;

        isInjected = true;
        try {
            MAIN_WORLD_SCRIPTS.forEach(injectScript);
        } catch (e) {
            // 擴充功能 context 失效等情況無法補救，僅記錄後放行讓其餘功能繼續運作
            console.error('[DSS] main-world-injector 注入失敗:', e);
            return false;
        }
        return true;
    }

    root.DSSMainWorldInjector = { inject, MAIN_WORLD_SCRIPTS };

    // Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
    inject();

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.DSSMainWorldInjector;
    }
})(globalThis);
