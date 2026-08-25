/**
 * DS studio — Temporary Chat Toggle
 * 僅在首頁（pathname === '/'）注入切換開關 UI。
 * 單一職責：管理 UI 注入、使用者互動與事件 dispatch。
 * 常數由 temporary-chat-constants.js 在前載入提供。
 * 啟用旗標由 temporary-chat-enabled-flag.js（TemporaryChatEnabledFlag）集中持有。
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
    const _selectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // ── 私有狀態 ──────────────────────────────────────────────────────────────
    let _mutationObserver = null;
    let _injectedRow = null;
    // 擴充功能主開關狀態；由 feature-toggle 依 background 提供的設定驅動
    let _masterEnabled = false;
    // 主開關僅需註冊一次：init() 可能被重複呼叫，避免累積註冊
    let _hasMasterToggleRegistered = false;

    // ── 純工具函式（可供測試匯出） ───────────────────────────────────────────

    /**
     * 取得共享啟用旗標模組（temporary-chat-enabled-flag.js 在前載入提供）。
     */
    function _flag() {
        const flag = (typeof globalThis !== 'undefined' && globalThis.TemporaryChatEnabledFlag)
            || (typeof window !== 'undefined' && window.TemporaryChatEnabledFlag);
        if (!flag) {
            throw new Error('[DSS] temporary-chat-toggle: TemporaryChatEnabledFlag is missing — load content/temporary-chat-enabled-flag.js before this file');
        }
        return flag;
    }

    /**
     * 取得共用功能開關管線（content/feature-toggle.js 在前載入提供）。
     */
    function _featureToggle() {
        const featureToggle = globalThis.DSSFeatureToggle
            || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
        if (!featureToggle) {
            throw new Error('[DSS] temporary-chat-toggle: DSSFeatureToggle is missing — load content/feature-toggle.js before this file');
        }
        return featureToggle;
    }

    /**
     * 從共享快取讀取啟用旗標（同步）。
     * @returns {boolean}
     */
    function readEnabledFlag() {
        return _flag().isEnabled();
    }

    /**
     * 同步更新共享快取並非同步請 background 寫入（fire-and-forget）。
     * @param {boolean} isEnabled
     */
    function writeEnabledFlag(isEnabled) {
        _flag().write(isEnabled);
    }

    /**
     * 根據啟用狀態更新 UI 視覺（標籤文字色、checkbox 狀態）。
     * @param {HTMLElement} row - 已注入的容器列
     * @param {boolean} isEnabled
     */
    function applyVisualState(row, isEnabled) {
        if (!row) return;
        const label = row.querySelector('.dss-temp-chat-label');
        const input = row.querySelector('.dss-temp-chat-switch__input');
        if (!label || !input) return;

        if (isEnabled) {
            label.classList.add('dss-temp-chat-label--on');
        } else {
            label.classList.remove('dss-temp-chat-label--on');
        }
        input.checked = isEnabled;
    }

    /**
     * 建立並回傳切換列 DOM 元素（未附加至文件）。
     * @param {boolean} isEnabled - 初始狀態
     * @returns {HTMLElement}
     */
    function createToggleRow(isEnabled) {
        const row = document.createElement('div');
        row.id = 'dss-temp-chat-toggle-row';
        row.className = 'dss-temp-chat-row';

        // 開關（左側）
        const switchLabel = document.createElement('label');
        switchLabel.className = 'dss-temp-chat-switch';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'dss-temp-chat-switch__input';
        input.checked = isEnabled;
        input.setAttribute('aria-label', '臨時對話');
        // 停用瀏覽器表單狀態自動還原：Chromium 會在重新整理後對動態注入的表單控制項
        // 還原先前狀態並觸發真實的 change 事件，若不關閉會被 writeEnabledFlag() 誤判為使用者操作而寫回 true
        input.setAttribute('autocomplete', 'off');

        const track = document.createElement('span');
        track.className = 'dss-temp-chat-switch__track';

        switchLabel.appendChild(input);
        switchLabel.appendChild(track);

        // 文字標籤（右側）
        const textLabel = document.createElement('span');
        textLabel.className = isEnabled
            ? 'dss-temp-chat-label dss-temp-chat-label--on'
            : 'dss-temp-chat-label';
        textLabel.textContent = '臨時對話';

        row.appendChild(switchLabel);
        row.appendChild(textLabel);

        // 切換事件
        input.addEventListener('change', () => {
            const newIsEnabled = input.checked;
            writeEnabledFlag(newIsEnabled);
            applyVisualState(row, newIsEnabled);
            dispatchToggleEvent(newIsEnabled);
        });

        return row;
    }

    /**
     * 派發 dss-temporary-chat-changed CustomEvent。
     * @param {boolean} isEnabled
     */
    function dispatchToggleEvent(isEnabled) {
        // 常數由 temporary-chat-constants.js 在前載入時掛上 globalThis
        const EVENT_NAME = globalThis.DSS_TEMP_CHAT_CHANGED_EVENT;
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { isEnabled } }));
    }

    /**
     * 將開關列注入至 div.aaff8b8f 之後（作為相鄰兄弟元素）。
     * 若已注入（id 存在）則跳過。
     * @param {Element} anchorEl - div.aaff8b8f 元素
     */
    function injectToggleRow(anchorEl) {
        // Dedupe guard: skip if the row already exists in the DOM
        if (document.getElementById('dss-temp-chat-toggle-row')) return;

        const isEnabled = readEnabledFlag();
        const row = createToggleRow(isEnabled);

        // insertAfter: place immediately after the anchor element
        anchorEl.parentNode.insertBefore(row, anchorEl.nextSibling);
        _injectedRow = row;
    }

    /**
     * Removes the injected toggle row from the DOM.
     * Does NOT touch sessionStorage — persisted flag is preserved.
     */
    function removeToggleRow() {
        const existing = document.getElementById('dss-temp-chat-toggle-row');
        if (!existing) return;

        existing.remove();
        _injectedRow = null;
    }

    /**
     * Attempts to find the anchor element and inject the row.
     * Silently returns when the anchor is absent — the MutationObserver will retry.
     */
    function tryInject() {
        if (!_masterEnabled) return;

        const anchor = document.querySelector(_selectors.FLOATING_BUTTON_BAR_DIV_SELECTOR);

        if (!anchor) return;
        injectToggleRow(anchor);
    }

    /**
     * Central inject-vs-remove decision point called on every SPA navigation.
     * @param {string} newPathname - the pathname after navigation
     * @param {string} [oldPathname] - the pathname before navigation (for logging)
     */
    function handleNavigation(newPathname, oldPathname) {
        const isHomepage = newPathname === '/';

        if (!isHomepage) {
            removeToggleRow();
        }
        // 注入首頁交由 MutationObserver 負責，避免在導航完成前注入至舊頁面 DOM
    }

    /**
     * Wires up SPA navigation listeners (Navigation API + popstate fallback)
     * and starts the MutationObserver that handles async anchor appearance.
     */
    function startObserver() {
        if (_mutationObserver) return;

        // MutationObserver: handles async anchor appearance and re-injection
        // after React re-renders the homepage subtree
        _mutationObserver = new MutationObserver(() => {
            // If the injected row was disconnected by a React re-render, clear the ref
            if (_injectedRow && !_injectedRow.isConnected) {
                _injectedRow = null;
            }

            // Only attempt re-injection when on the homepage
            if (window.location.pathname === '/') {
                if (_injectedRow && _injectedRow.isConnected) return;   // 已注入且連接中，跳過
                tryInject();
            }
        });

        _mutationObserver.observe(document.body, { childList: true, subtree: true });

        // Navigation API (preferred): fires on every SPA route change
        if (typeof window !== 'undefined' && window.navigation) {
            window.navigation.addEventListener('navigate', (event) => {
                const newPathname = new URL(event.destination.url).pathname;
                const oldPathname = window.location.pathname;
                handleNavigation(newPathname, oldPathname);
            });
        } else {
            // Fallback: popstate fires on back/forward; hashchange for hash-based routing
            window.addEventListener('popstate', () => {
                handleNavigation(window.location.pathname, undefined);
            });
        }
    }

    /**
     * 啟用旗標變更時同步本分頁：更新快取、UI 與通知其他監聽者。
     * @param {boolean} newValue
     */
    function setCacheForCrossTabSync(newValue) {
        _flag().__setCache(newValue);
        if (_injectedRow) {
            applyVisualState(_injectedRow, newValue);
        }
        // 通知 TemporaryChatDelete 等其他監聽者
        dispatchToggleEvent(newValue);
    }

    /**
     * 更新主開關狀態並同步顯示／隱藏切換列。
     * @param {boolean} isMasterEnabled
     */
    function setMasterEnabled(isMasterEnabled) {
        _masterEnabled = isMasterEnabled;
        if (!_masterEnabled) {
            removeToggleRow();
        } else if (window.location.pathname === '/') {
            tryInject();
        }
    }

    /**
     * 把主開關閘控交給共用管線：初始值與後續變更皆由 background 提供。
     * 本功能無自身開關鍵，故 ownKey 為 null（僅受主開關控制）。
     */
    function registerMasterToggle() {
        if (_hasMasterToggleRegistered) return;
        _hasMasterToggleRegistered = true;

        _featureToggle().registerFeatureToggle({
            ownKey: null,
            onEnable: () => setMasterEnabled(true),
            onDisable: () => setMasterEnabled(false),
        });
    }

    // ── 公開 API ─────────────────────────────────────────────────────────────

    /**
     * 初始化模組：先載入旗標快取並訂閱跨分頁變更、註冊主開關閘控，
     * 再啟動 observer 與 navigation 監聽，最後在首頁立即注入。
     * @returns {Promise<void>}
     */
    async function init() {
        // 先等待共享快取初始化，確保 readEnabledFlag() 有正確值
        const flag = _flag();
        flag.startSync();
        flag.subscribe(setCacheForCrossTabSync);
        await flag.initFromStorage();

        // 主開關決定是否允許注入切換列
        registerMasterToggle();

        // Start observer and navigation listeners regardless of current path,
        // so SPA navigations back to '/' are handled correctly
        startObserver();

        // Attempt initial injection if already on homepage
        if (window.location.pathname === '/') {
            tryInject();
        }
    }

    return {
        init,
        // Pure utility exports for unit tests
        readEnabledFlag,
        writeEnabledFlag,
        applyVisualState,
        createToggleRow,
        dispatchToggleEvent,
        injectToggleRow,
        // New exports for unit tests (SPA-aware behavior)
        removeToggleRow,
        handleNavigation,
    };
})();

// Auto-start（與 sidebar-auto-hide.js 相同的啟動模式）
TemporaryChatToggle.init();

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatToggle;
}
