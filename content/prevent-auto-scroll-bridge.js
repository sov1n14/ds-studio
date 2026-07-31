/**
 * DS studio — Prevent Auto Scroll Bridge (content/isolated world)
 *
 * 此模組執行於 content script 的 isolated world，負責：
 *   1. 將 MAIN world patch 腳本（prevent-auto-scroll.js）注入頁面。
 *   2. 建立並管理 bridge element，透過 dataset.enabled 通知 MAIN world 啟停。
 *   3. 管理「永久鎖定」設定（dsPreventAutoScroll），使保護狀態不受
 *      呼叫端（如 harvest.js）在 finally 區塊呼叫 disable() 影響。
 *
 * 單一職責：僅管理注入、bridge 元素與永久鎖定設定。擷取邏輯由 harvest.js 負責。
 */

(function () {
    'use strict';

    // ── 常數 ──────────────────────────────────────────────────────────

    /** Bridge element ID，與 prevent-auto-scroll.js 中的 BRIDGE_ID 對應 */
    const BRIDGE_ID = 'dss-prevent-auto-scroll-bridge';

    /** 注入腳本用的 <script> element ID（冪等保護） */
    const SCRIPT_INJECT_ID = 'dss-prevent-auto-scroll-script';

    /** 永久鎖定功能設定於 chrome.storage.local 的 key */
    const PERSISTENT_SETTING_KEY = 'dsPreventAutoScroll';

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
     * 依主開關與永久鎖定設定值套用永久鎖定狀態。
     * 決策規則：主開關（StorageManager.KEYS.IS_ENABLED）啟用，且
     * dsPreventAutoScroll 為 true 時，才視為永久鎖定啟用。
     * @param {boolean} isMasterEnabled
     * @param {boolean} isSettingEnabled
     */
    function _applyPersistentSetting(isMasterEnabled, isSettingEnabled) {
        setPersistent(isMasterEnabled && isSettingEnabled);
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
     * 設定訂閱進入點：讀取一次目前設定並套用，之後監聽
     * chrome.storage.onChanged 即時反映主開關或永久鎖定設定的變更。
     * 鏡射 content/hide-thinking.js 的 start() 慣例。
     * @returns {Promise<void>}
     */
    async function start() {
        const data = await chrome.storage.local.get([
            PERSISTENT_SETTING_KEY,
            StorageManager.KEYS.IS_ENABLED
        ]);
        _applyPersistentSetting(
            data[StorageManager.KEYS.IS_ENABLED] ?? false,
            data[PERSISTENT_SETTING_KEY] ?? false
        );

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            if (!changes[StorageManager.KEYS.IS_ENABLED] && !changes[PERSISTENT_SETTING_KEY]) return;

            chrome.storage.local.get(
                [PERSISTENT_SETTING_KEY, StorageManager.KEYS.IS_ENABLED],
                (latest) => {
                    _applyPersistentSetting(
                        latest[StorageManager.KEYS.IS_ENABLED] ?? false,
                        latest[PERSISTENT_SETTING_KEY] ?? false
                    );
                }
            );
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

    // 啟動設定訂閱：鏡射 hide-thinking.js 的 bootstrap 慣例（模組層級 side
    // effect 為此類 content script 功能模組的既有、刻意設計）。
    start();
})();
