/**
 * DS studio — 行動裝置判定共用工具（content/mobile-device.js）
 *
 * 單一職責：以「具觸控能力 或 行動裝置 user-agent 標記」判定行動裝置，
 * 與 mobile-homepage-cleanup、mobile-sidebar-swipe、prompt-injector 三處原有實作完全一致。
 * 視窗尺寸不是判定輸入。
 * 無載入期副作用：載入僅完成 globalThis 指派。
 */
(function () {
    'use strict';

    const MOBILE_UA_PATTERN = /Mobi|Android|iPhone|iPad/i;

    /** @returns {boolean} */
    function isMobileDevice() {
        return navigator.maxTouchPoints > 0 || MOBILE_UA_PATTERN.test(navigator.userAgent);
    }

    globalThis.DSSMobileDevice = { isMobileDevice };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSMobileDevice;
})();
