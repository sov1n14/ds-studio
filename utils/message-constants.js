/**
 * DS studio — 訊息與 URL 常數合併檔（utils/message-constants.js）
 *
 * 合併自 url-constants.js、editor-window-constants.js、settings-message-constants.js。
 * 層級無關的 classic script：以顯式 globalThis 指派公開常數，
 * 避免多處硬編碼重複字串。除該指派外無任何載入期副作用。
 */
(function () {
    'use strict';

    // DeepSeek 分頁比對條件，與 manifest.json host_permissions 一致
    globalThis.DEEPSEEK_TAB_URL = '*://chat.deepseek.com/*';

    // 編輯器視窗常數
    globalThis.DSS_EDITOR_WINDOW = {
        CLOSE_MESSAGE_TYPE: 'DSS_CLOSE_EDITOR_WINDOWS',
        STORAGE_KEYS: {
            global: 'dss-editor-window-id-global',
            preset: 'dss-editor-window-id-preset',
        },
    };

    // 設定訊息型別常數
    globalThis.DSS_SETTINGS_MSG = {
        GET_SETTINGS: 'DSS_GET_SETTINGS',
        SET_SETTINGS: 'DSS_SET_SETTINGS',
        SETTINGS_CHANGED: 'DSS_SETTINGS_CHANGED',
    };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            DEEPSEEK_TAB_URL: globalThis.DEEPSEEK_TAB_URL,
            DSS_EDITOR_WINDOW: globalThis.DSS_EDITOR_WINDOW,
            DSS_SETTINGS_MSG: globalThis.DSS_SETTINGS_MSG,
        };
    }
})();
