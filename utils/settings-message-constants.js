/**
 * DS studio — 設定訊息型別常數（utils/settings-message-constants.js）
 *
 * 層級無關的 classic script：以顯式 globalThis 指派公開常數，
 * 讓經 importScripts 載入的 service worker 與 content script 皆能取用
 * （頂層 const 不會成為 globalThis 屬性，故不可改用 const 宣告發布）。
 * 除該指派外無任何載入期副作用。
 */
(function () {
    'use strict';

    globalThis.DSS_SETTINGS_MSG = {
        GET_SETTINGS: 'DSS_GET_SETTINGS',
        SET_SETTINGS: 'DSS_SET_SETTINGS',
        SETTINGS_CHANGED: 'DSS_SETTINGS_CHANGED',
    };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSS_SETTINGS_MSG;
})();
