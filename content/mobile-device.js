/**
 * DS studio — 行動裝置判定共用工具（content/mobile-device.js）
 *
 * 單一職責：以裝置外型判定行動裝置，觸控能力本身不構成判定依據（觸控螢幕筆電屬於桌面裝置）。判定為行動裝置的條件：user-agent 帶有行動裝置標記（Mobi、Android、iPhone、iPad），或為桌面模式的 iPadOS（navigator.platform 為 MacIntel 且 maxTouchPoints 大於 1）。視窗尺寸不是判定輸入。
 * 無載入期副作用：載入僅完成 globalThis 指派。
 */
(function () {
    'use strict';

    const MOBILE_UA_PATTERN = /Mobi|Android|iPhone|iPad/i;

    // iPadOS 桌面模式會回報 Mac 的 user-agent 與 platform，僅能以多點觸控辨識
    function isIpadOsDesktopMode() {
        return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    }

    /** @returns {boolean} */
    function isMobileDevice() {
        return MOBILE_UA_PATTERN.test(navigator.userAgent) || isIpadOsDesktopMode();
    }

    globalThis.DSSMobileDevice = { isMobileDevice };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    // Stryker disable all: equivalent mutants — module type check is environment-dependent, untestable in Node
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSMobileDevice;
})();
// Stryker restore all
