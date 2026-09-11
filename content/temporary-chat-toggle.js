/**
 * DS studio — Temporary Chat Toggle
 * 僅在首頁（pathname === '/'）注入切換開關 UI。
 * 單一職責：管理 UI 注入、使用者互動與事件 dispatch。
 * 常數由 temporary-chat-constants.js 在前載入提供。
 * 啟用旗標由 temporary-chat-enabled-flag.js（TemporaryChatEnabledFlag）集中持有。
 * UI DOM 建構由 temporary-chat-toggle.ui.js 提供。
 *
 * SPA-aware: listens to Navigation API (navigate) and popstate to inject/remove
 * the toggle row whenever the pathname changes. The MutationObserver handles the
 * case where the anchor element appears asynchronously after the route settles.
 *
 * 設定不由本層直讀儲存區：主開關（isEnabled）的閘控交由 content/feature-toggle.js
 * 向 background 索取並訂閱變更；臨時對話啟用旗標則由 TemporaryChatEnabledFlag
 * 經 background 同步至每個分頁，並快取於記憶體使 readEnabledFlag() 維持同步呼叫。
 */

const TemporaryChatToggle = (() => {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const _selectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // UI 層（瀏覽器：由 temporary-chat-toggle.ui.js 於前載入；Node.js 測試：直接 require）
    const _ui = globalThis.__DS_TemporaryChatToggleUI ||
        (typeof require !== 'undefined' ? require('./temporary-chat-toggle.ui.js') : null);

    if (!_ui) {
        throw new Error('[DSS] temporary-chat-toggle: __DS_TemporaryChatToggleUI is missing — load content/temporary-chat-toggle.ui.js before this file');
    }

    // ── 私有狀態 ──────────────────────────────────────────────────────────────
    let _mutationObserver = null;
    let _injectedRow = null;
    // 擴充功能主開關狀態；由 feature-toggle 依 background 提供的設定驅動
    let _masterEnabled = false;
    // 主開關僅需註冊一次：init() 可能被重複呼叫，避免累積註冊
    let _hasMasterToggleRegistered = false;

    // ── 純工具函式（可供測試匯出） ───────────────────────────────────────────

    function _flag() {
        const flag = globalThis.TemporaryChatEnabledFlag
            || (typeof window !== 'undefined' && window.TemporaryChatEnabledFlag);
        if (!flag) {
            throw new Error('[DSS] temporary-chat-toggle: TemporaryChatEnabledFlag is missing — load content/temporary-chat-enabled-flag.js before this file');
        }
        return flag;
    }

    function _featureToggle() {
        const featureToggle = globalThis.DSSFeatureToggle
            || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
        if (!featureToggle) {
            throw new Error('[DSS] temporary-chat-toggle: DSSFeatureToggle is missing — load content/feature-toggle.js before this file');
        }
        return featureToggle;
    }

    function readEnabledFlag() {
        return _flag().isEnabled();
    }

    function writeEnabledFlag(isEnabled) {
        _flag().write(isEnabled);
    }

    function applyVisualState(row, isEnabled) {
        _ui.applyVisualState(row, isEnabled);
    }

    function createToggleRow(isEnabled) {
        return _ui.createToggleRow(isEnabled, (newIsEnabled) => {
            writeEnabledFlag(newIsEnabled);
            dispatchToggleEvent(newIsEnabled);
        });
    }

    function dispatchToggleEvent(isEnabled) {
        const EVENT_NAME = globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_CHANGED_EVENT;
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { isEnabled } }));
    }

    function injectToggleRow(anchorEl) {
        if (_ui.isRowPresent()) return;
        const isEnabled = readEnabledFlag();
        const row = createToggleRow(isEnabled);
        anchorEl.parentNode.insertBefore(row, anchorEl.nextSibling);
        _injectedRow = row;
    }

    function removeToggleRow() {
        _ui.removeToggleRow();
        _injectedRow = null;
    }

    function tryInject() {
        if (!_masterEnabled) return;
        const anchor = document.querySelector(_selectors.FLOATING_BUTTON_BAR_DIV_SELECTOR);
        if (!anchor) return;
        injectToggleRow(anchor);
    }

    function handleNavigation(newPathname, oldPathname) {
        const isHomepage = newPathname === '/';
        if (!isHomepage) {
            removeToggleRow();
        }
    }

    function startObserver() {
        if (_mutationObserver) return;

        _mutationObserver = new MutationObserver(() => {
            if (_injectedRow && !_injectedRow.isConnected) {
                _injectedRow = null;
            }
            if (window.location.pathname === '/') {
                if (_injectedRow && _injectedRow.isConnected) return;
                tryInject();
            }
        });

        _mutationObserver.observe(document.body, { childList: true, subtree: true });

        if (typeof window !== 'undefined' && window.navigation) {
            window.navigation.addEventListener('navigate', (event) => {
                const newPathname = new URL(event.destination.url).pathname;
                const oldPathname = window.location.pathname;
                handleNavigation(newPathname, oldPathname);
            });
        } else {
            window.addEventListener('popstate', () => {
                handleNavigation(window.location.pathname, undefined);
            });
        }
    }

    function setCacheForCrossTabSync(newValue) {
        _flag().__setCache(newValue);
        if (_injectedRow) {
            applyVisualState(_injectedRow, newValue);
        }
        dispatchToggleEvent(newValue);
    }

    function setMasterEnabled(isMasterEnabled) {
        _masterEnabled = isMasterEnabled;
        if (!_masterEnabled) {
            removeToggleRow();
        } else if (window.location.pathname === '/') {
            tryInject();
        }
    }

    function registerMasterToggle() {
        if (_hasMasterToggleRegistered) return;
        _hasMasterToggleRegistered = true;

        _featureToggle().registerFeatureToggle({
            ownKey: null,
            onEnable: () => setMasterEnabled(true),
            onDisable: () => setMasterEnabled(false),
        });
    }

    async function init() {
        const flag = _flag();
        flag.startSync();
        flag.subscribe(setCacheForCrossTabSync);
        await flag.initFromStorage();
        registerMasterToggle();
        startObserver();
        if (window.location.pathname === '/') {
            tryInject();
        }
    }

    return {
        init,
        readEnabledFlag,
        writeEnabledFlag,
        applyVisualState,
        createToggleRow,
        dispatchToggleEvent,
        injectToggleRow,
        removeToggleRow,
        handleNavigation,
    };
})();

TemporaryChatToggle.init();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatToggle;
}
