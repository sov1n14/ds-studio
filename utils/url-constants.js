/**
 * DS studio — URL 比對常數（utils/url-constants.js）
 *
 * 層級無關的 classic script：以顯式 globalThis 指派公開常數，
 * 避免多處硬編碼重複字串。
 */
(function () {
    'use strict';

    // DeepSeek 分頁比對條件，與 manifest.json host_permissions 一致
    globalThis.DEEPSEEK_TAB_URL = '*://chat.deepseek.com/*';

    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DEEPSEEK_TAB_URL;
})();
