/**
 * DS studio — 編輯器視窗常數（utils/editor-window-constants.js）
 *
 * 層級無關的 classic script：以顯式 globalThis 指派公開常數，
 * 讓 background、popup 皆能取用（頂層 const 不會成為 globalThis 屬性，
 * 故不可改用 const 宣告發布）。除該指派外無任何載入期副作用。
 */
(function () {
    'use strict';

    globalThis.DSS_EDITOR_WINDOW = {
        CLOSE_MESSAGE_TYPE: 'DSS_CLOSE_EDITOR_WINDOWS',
        STORAGE_KEYS: {
            global: 'dss-editor-window-id-global',
            preset: 'dss-editor-window-id-preset',
        },
    };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSS_EDITOR_WINDOW;
})();
