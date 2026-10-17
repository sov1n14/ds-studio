/**
 * DS studio — 訊息與 URL 常數合併檔（utils/message-constants.js）
 *
 * 層級無關的 classic script：以顯式 globalThis 指派公開常數，避免多處硬編碼重複字串。除該指派外無任何載入期副作用。
 */
(function () {
    'use strict';

    // DeepSeek 分頁比對條件，與 manifest.json host_permissions 一致
    globalThis.DSS_TAB_URL = '*://chat.deepseek.com/*';

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

    // chat-map 單一寫入者訊息型別常數（凍結，避免消費端改寫）
    globalThis.DSS_CHAT_MAP_MSG = Object.freeze({
        BIND: 'DSS_CHAT_MAP_BIND',
        UNBIND: 'DSS_CHAT_MAP_UNBIND',
        UNBIND_PRESETS: 'DSS_CHAT_MAP_UNBIND_PRESETS',
        PRUNE_ORPHANS: 'DSS_CHAT_MAP_PRUNE_ORPHANS',
        MERGE: 'DSS_CHAT_MAP_MERGE',
        MIGRATE_LEGACY: 'DSS_CHAT_MAP_MIGRATE_LEGACY',
        REPUBLISH_PARKED: 'DSS_CHAT_MAP_REPUBLISH_PARKED',
    });

    // 跨層內容腳本訊息型別常數
    globalThis.DSS_CONTENT_MSG = {
        ACTIVE_PRESET_CHANGED: 'ACTIVE_PRESET_CHANGED',
        CLEAR_RESTORED_MESSAGES: 'clearRestoredMessages',
        GET_PENDING_PRESET: 'GET_PENDING_PRESET',
        EXPORT_MARKDOWN: 'EXPORT_MARKDOWN',
    };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            DSS_TAB_URL: globalThis.DSS_TAB_URL,
            DSS_EDITOR_WINDOW: globalThis.DSS_EDITOR_WINDOW,
            DSS_SETTINGS_MSG: globalThis.DSS_SETTINGS_MSG,
            DSS_CHAT_MAP_MSG: globalThis.DSS_CHAT_MAP_MSG,
            DSS_CONTENT_MSG: globalThis.DSS_CONTENT_MSG,
        };
    }
})();
