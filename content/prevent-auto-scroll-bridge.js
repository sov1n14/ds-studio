/**
 * DS studio — Prevent Auto Scroll Bridge (content/isolated world)
 *
 * 此模組執行於 content script 的 isolated world，負責：
 *   1. 將 MAIN world patch 腳本（prevent-auto-scroll.js）注入頁面。
 *   2. 建立並管理 bridge element，透過 dataset.enabled 通知 MAIN world 啟停。
 *   3. 管理「永久鎖定」設定（dsPreventAutoScroll），使保護狀態不受
 *      呼叫端（如 harvest.js）在 finally 區塊呼叫 disable() 影響。
 *   4. 使用者放行窗口：使用者實際按下網站原生「捲到底部」按鈕（isTrusted 事件）時，
 *      將放行截止時間寫入 bridge 的 dataset.allowScrollUntil，使該次捲動不被攔截。
 *
 * 單一職責：僅管理注入、bridge 元素、永久鎖定設定與放行窗口。擷取邏輯由 harvest.js 負責。
 *
 * 設定來源：主開關與自身開關（dsPreventAutoScroll）的閘控委派
 * content/feature-toggle.js 的共用管線，初始值與變更廣播皆由其向 background 取得。
 * 注意：MAIN world 端（content/prevent-auto-scroll.js）無 chrome.runtime 可用，
 * 狀態一律透過本檔的 bridge element dataset 傳遞。
 */

(function () {
    'use strict';

    // ── 常數 ──────────────────────────────────────────────────────────

    /** Bridge element ID，與 prevent-auto-scroll.js 中的 BRIDGE_ID 對應 */
    const BRIDGE_ID = 'dss-prevent-auto-scroll-bridge';

    /** 注入腳本用的 <script> element ID（冪等保護） */
    const SCRIPT_INJECT_ID = 'dss-prevent-auto-scroll-script';

    /** 放行截止時間的 dataset 鍵，與 prevent-auto-scroll.js 中的 ALLOW_UNTIL_DATASET_KEY 對應 */
    const ALLOW_UNTIL_DATASET_KEY = 'allowScrollUntil';

    /** 使用者按下原生捲到底部按鈕後的放行時長（毫秒），涵蓋網站點擊後約 25 ms 內的多次重新量測捲動 */
    const USER_SCROLL_ALLOW_WINDOW_MS = 500;

    /** 視為使用者按壓的事件類型：pointerdown 與 click 任一皆可開啟放行窗口 */
    const USER_PRESS_EVENT_TYPES = ['pointerdown', 'click'];

    /** 本擴充自行注入的 GoTop 按鈕識別 class（複製自原生按鈕，必須排除） */
    const EXTENSION_GO_TOP_CLASS = 'dsw-gotop';

    // 瀏覽器：由 content/ds-selectors.js 於前載入選擇器全域；Node.js 測試：直接 require
    const __DSSelectorsBridge = globalThis.DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
    const GO_TOP_NATIVE_BUTTON_CLASS = __DSSelectorsBridge.GO_TOP_NATIVE_BUTTON_CLASS;

    // ── 私有函式 ──────────────────────────────────────────────────────

    /**
     * 取得（或建立）bridge element。
     * Bridge element 為隱藏 div，透過 dataset.enabled 傳遞狀態給 MAIN world，
     * 並透過 dataset.persistent 記錄永久鎖定狀態。
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

    /**
     * 判斷事件目標是否位於網站原生「捲到底部」按鈕內（排除本擴充的 GoTop 複製按鈕）。
     * @param {EventTarget|null} target
     * @returns {boolean}
     */
    function _isInsideNativeGoBottomButton(target) {
        if (!target || typeof target.closest !== 'function') return false;
        if (target.closest('.' + EXTENSION_GO_TOP_CLASS)) return false;
        return target.closest('.' + GO_TOP_NATIVE_BUTTON_CLASS) !== null;
    }

    /**
     * document capture 階段的按壓監聽：僅瀏覽器產生（isTrusted）且落在原生按鈕內的按壓
     * 才開啟放行窗口；程式觸發的 click() 或 dispatchEvent 一律不放行。
     * 以 capture 階段執行，確保在網站按鈕自身的 click handler 發起捲動前寫入截止時間。
     * @param {Event} event
     */
    function _onUserPress(event) {
        try {
            if (event.isTrusted !== true) return;
            if (!_isInsideNativeGoBottomButton(event.target)) return;
            _getBridgeElement().dataset[ALLOW_UNTIL_DATASET_KEY] = String(Date.now() + USER_SCROLL_ALLOW_WINDOW_MS);
        } catch (err) {
            console.error('[DSS] prevent-auto-scroll user press:', err);
        }
    }

    /**
     * 註冊使用者按壓監聽（冪等：同一函式參照重複註冊不會重複觸發）。
     */
    function _listenForUserPress() {
        USER_PRESS_EVENT_TYPES.forEach((type) => document.addEventListener(type, _onUserPress, true));
    }

    // ── 公開介面 ──────────────────────────────────────────────────────

    /**
     * 啟用頁面自動捲動攔截。
     * 會在首次呼叫時自動注入 MAIN world patch。冪等，且不影響永久鎖定狀態。
     */
    function enable() {
        _injectMainWorldPatch();
        const bridge = _getBridgeElement();
        bridge.dataset.enabled = 'true';
    }

    /**
     * 停用頁面自動捲動攔截，恢復頁面正常捲動行為。
     * 若目前處於永久鎖定狀態則為 no-op，保護狀態維持啟用，
     * 避免呼叫端（例如 harvest.js 的 finally 區塊）意外解除保護。
     */
    function disable() {
        if (isPersistent()) return;
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

    /**
     * 查詢目前是否處於永久鎖定狀態。
     * @returns {boolean}
     */
    function isPersistent() {
        const bridge = document.getElementById(BRIDGE_ID);
        return bridge !== null && bridge.dataset.persistent === 'true';
    }

    /**
     * 設定永久鎖定狀態。
     * 啟用時會同步啟動攔截保護（沿用 enable() 的注入與啟用路徑）；
     * 停用時則直接解除保護，不經過 disable() 的鎖定判斷。冪等：
     * 重複以相同值呼叫不會出錯或改變狀態。
     * @param {boolean} shouldPersist
     */
    function setPersistent(shouldPersist) {
        const bridge = _getBridgeElement();
        if (shouldPersist) {
            enable();
            bridge.dataset.persistent = 'true';
            return;
        }
        bridge.dataset.persistent = 'false';
        bridge.dataset.enabled = 'false';
    }

    /**
     * 設定訂閱進入點：註冊使用者按壓監聽，並把「主開關 + 自身開關（dsPreventAutoScroll）」
     * 的閘控交給共用管線，生效時鎖定捲動、失效時解除。初始設定讀取失敗時管線維持
     * 休眠，故不會在設定未知的情況下鎖定捲動。
     * @returns {Function} 解除註冊函式
     */
    function start() {
        // 瀏覽器：由 content/feature-toggle.js 於前載入設定全域；Node.js 測試：直接 require
        const featureToggle = globalThis.DSSFeatureToggle ||
            (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
        if (!featureToggle) {
            throw new Error('content/prevent-auto-scroll-bridge.js 需要 content/feature-toggle.js 先行載入');
        }
        if (typeof GO_TOP_NATIVE_BUTTON_CLASS !== 'string') {
            throw new Error('content/prevent-auto-scroll-bridge.js 需要 content/ds-selectors.js 先行載入');
        }

        _listenForUserPress();

        return featureToggle.registerFeatureToggle({
            ownKey: StorageManager.KEYS.PREVENT_AUTO_SCROLL,
            onEnable: () => setPersistent(true),
            onDisable: () => setPersistent(false),
        });
    }

    // ── 模組匯出 ──────────────────────────────────────────────────────

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { enable, disable, isEnabled, setPersistent, isPersistent, start };
    }

    // 透過 window.DSstudio 供同層模組（harvest.js 等）呼叫
    if (typeof window !== 'undefined') {
        window.DSstudio = window.DSstudio || {};
        window.DSstudio.PreventAutoScroll = { enable, disable, isEnabled, setPersistent, isPersistent, start };
    }

    // Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
    start();
})();
