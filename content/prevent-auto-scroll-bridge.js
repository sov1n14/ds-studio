/**
 * DS studio — Prevent Auto Scroll Bridge (content/isolated world)
 *
 * 此模組執行於 content script 的 isolated world，負責：
 *   1. 將 MAIN world patch 腳本（prevent-auto-scroll.js）注入頁面。
 *   2. 建立並管理 bridge element，透過 dataset.enabled 通知 MAIN world 啟停。
 *
 * 單一職責：僅管理注入與 bridge 元素。擷取邏輯由 harvest.js 負責。
 * 不呼叫 chrome.storage（遵循 coding-guidelines content 層限制）。
 */

(function () {
    'use strict';

    // ── 常數 ──────────────────────────────────────────────────────────

    /** Bridge element ID，與 prevent-auto-scroll.js 中的 BRIDGE_ID 對應 */
    const BRIDGE_ID = 'dss-prevent-auto-scroll-bridge';

    /** 注入腳本用的 <script> element ID（冪等保護） */
    const SCRIPT_INJECT_ID = 'dss-prevent-auto-scroll-script';

    // ── 私有函式 ──────────────────────────────────────────────────────

    /**
     * 取得（或建立）bridge element。
     * Bridge element 為隱藏 div，透過 dataset.enabled 傳遞狀態給 MAIN world。
     * @returns {HTMLElement}
     */
    function _getBridgeElement() {
        let bridge = document.getElementById(BRIDGE_ID);
        if (!bridge) {
            bridge = document.createElement('div');
            bridge.id = BRIDGE_ID;
            bridge.style.display = 'none';
            document.documentElement.appendChild(bridge);
        }
        return bridge;
    }

    /**
     * 將 prevent-auto-scroll.js 注入至頁面 MAIN world（冪等）。
     * 需要 prevent-auto-scroll.js 已列入 manifest web_accessible_resources。
     */
    function _injectMainWorldPatch() {
        // Guard：已注入過則跳過
        if (document.getElementById(SCRIPT_INJECT_ID)) return;

        const script = document.createElement('script');
        script.id = SCRIPT_INJECT_ID;
        script.src = chrome.runtime.getURL('content/prevent-auto-scroll.js');
        script.onload = function () {
            // 注入完成後移除 <script> 標籤，保持 DOM 乾淨
            script.remove();
        };
        document.documentElement.appendChild(script);
    }

    // ── 公開介面 ──────────────────────────────────────────────────────

    /**
     * 啟用頁面自動捲動攔截。
     * 會在首次呼叫時自動注入 MAIN world patch。
     */
    function enable() {
        _injectMainWorldPatch();
        const bridge = _getBridgeElement();
        bridge.dataset.enabled = 'true';
    }

    /**
     * 停用頁面自動捲動攔截，恢復頁面正常捲動行為。
     */
    function disable() {
        const bridge = _getBridgeElement();
        bridge.dataset.enabled = 'false';
    }

    /**
     * 查詢目前是否處於攔截啟用狀態。
     * @returns {boolean}
     */
    function isEnabled() {
        const bridge = document.getElementById(BRIDGE_ID);
        return bridge !== null && bridge.dataset.enabled === 'true';
    }

    // ── 模組匯出 ──────────────────────────────────────────────────────

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { enable, disable, isEnabled };
    }

    // 透過 window.DSstudio 供同層模組（harvest.js 等）呼叫
    if (typeof window !== 'undefined') {
        window.DSstudio = window.DSstudio || {};
        window.DSstudio.PreventAutoScroll = { enable, disable, isEnabled };
    }
})();
