/**
 * DS studio — 已合併至 utils/message-constants.js
 *
 * 此檔僅為測試相容性保留。瀏覽器環境由 message-constants.js 統一載入，
 * 此處重複指派確保測試中 import 此檔仍能正常設定 globalThis。
 */
(function () {
    'use strict';

    globalThis.DSS_TAB_URL = '*://chat.deepseek.com/*';

    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSS_TAB_URL;
})();
