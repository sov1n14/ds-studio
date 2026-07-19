/**
 * DS studio — Temporary Chat Toggle
 * 僅在首頁（pathname === '/'）注入切換開關 UI。
 * 單一職責：管理 UI 注入、使用者互動、chrome.storage.session 讀寫與事件 dispatch。
 * 常數由 temporary-chat-constants.js 在前載入提供。
 *
 * SPA-aware: listens to Navigation API (navigate) and popstate to inject/remove
 * the toggle row whenever the pathname changes. The MutationObserver handles the
 * case where the anchor element appears asynchronously after the route settles.
 *
 * Cross-tab sync: uses chrome.storage.session for the enabled flag so all tabs
 * reflect changes made in any single tab. An in-memory cache (_enabledFlagCache)
 * keeps readEnabledFlag() synchronous after async initialisation.
 */

const TemporaryChatToggle = (() => {
    'use strict';

    // ── 常數參照（由 temporary-chat-constants.js 在前載入） ──────────────────
    // 瀏覽器環境下已為全域變數；Node.js 測試環境下由外部注入
    const _getConst = (name, fallback) =>
        (typeof globalThis !== 'undefined' && globalThis[name] !== undefined)
            ? globalThis[name]
            : (typeof window !== 'undefined' && window[name] !== undefined)
                ? window[name]
                : fallback;

    // ── 私有狀態 ──────────────────────────────────────────────────────────────
    let _mutationObserver = null;
    let _injectedRow = null;
    // chrome.storage.session 的本地快取，使 readEnabledFlag() 保持同步
    let _enabledFlagCache = false;
    // 擴充功能主開關狀態；於 init() 中從 StorageManager.KEYS.IS_ENABLED 讀取
    let _masterEnabled = false;

    // ── 純工具函式（可供測試匯出） ───────────────────────────────────────────

    /**
     * 從 chrome.storage.session 非同步讀取啟用旗標並更新快取。
     * 必須在 init() 最前方 await，以確保 readEnabledFlag() 可同步使用。
     * @returns {Promise<void>}
     */
    async function initEnabledFlagFromStorage() {
        const key = _getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled');
        try {
            const result = await chrome.storage.local.get([key]);
            _enabledFlagCache = result[key] === true;
        } catch {
            // storage 不可用時以 false 為預設值
            _enabledFlagCache = false;
        }
    }

    /**
     * 從快取讀取啟用旗標（同步）。
     * 快取由 initEnabledFlagFromStorage() 初始化、writeEnabledFlag() 維護。
     * @returns {boolean}
     */
    function readEnabledFlag() {
        return _enabledFlagCache;
    }

    /**
     * 同步更新快取並非同步寫入 chrome.storage.session（fire-and-forget）。
     * @param {boolean} isEnabled
     */
    function writeEnabledFlag(isEnabled) {
        // 先更新快取，確保同頁面行為立即生效
        _enabledFlagCache = isEnabled;
        const key = _getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled');
        try {
            chrome.storage.local.set({ [key]: isEnabled });
        } catch {
            // storage 不可用時靜默忽略；快取已更新，同分頁行為仍正常
        }
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
        const EVENT_NAME = _getConst('DSS_TEMP_CHAT_CHANGED_EVENT', 'dss-temporary-chat-changed');
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

        const anchor = document.querySelector('div.aaff8b8f');

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

    // ── 公開 API ─────────────────────────────────────────────────────────────

    /**
     * 初始化模組：先從 chrome.storage.session 載入旗標快取，
     * 再啟動 observer 與 navigation 監聽，最後在首頁立即注入。
     * @returns {Promise<void>}
     */
    async function init() {
        // 先等待快取初始化，確保 readEnabledFlag() 有正確值
        await initEnabledFlagFromStorage();

        // 讀取擴充功能主開關狀態，決定是否允許注入切換列
        try {
            const result = await chrome.storage.local.get([StorageManager.KEYS.IS_ENABLED]);
            _masterEnabled = result[StorageManager.KEYS.IS_ENABLED] ?? false;
        } catch {
            _masterEnabled = false;
        }

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
        /**
         * 供跨分頁同步監聽器與單元測試使用：直接更新快取並同步 UI。
         * @param {boolean} newValue
         */
        __setCacheForCrossTabSync(newValue) {
            _enabledFlagCache = newValue;
            if (_injectedRow) {
                applyVisualState(_injectedRow, newValue);
            }
            // 通知 TemporaryChatDelete 等其他監聽者
            dispatchToggleEvent(newValue);
        },
        /**
         * 供主開關 storage 監聽器使用：更新 _masterEnabled 並同步顯示/隱藏切換列。
         * @param {boolean} isMasterEnabled
         */
        __setMasterEnabled(isMasterEnabled) {
            _masterEnabled = isMasterEnabled;
            if (!_masterEnabled) {
                removeToggleRow();
            } else if (window.location.pathname === '/') {
                tryInject();
            }
        },
    };
})();

// ── 跨分頁同步監聽器 ───────────────────────────────────────────────────────
// 當其他分頁透過 chrome.storage.session 改變啟用旗標時，同步本分頁的快取與 UI。
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // 擴充功能主開關：控制切換列的顯示/隱藏
    if (changes[StorageManager.KEYS.IS_ENABLED]) {
        const isMasterEnabled = changes[StorageManager.KEYS.IS_ENABLED].newValue;
        TemporaryChatToggle.__setMasterEnabled(isMasterEnabled);
    }

    const key =
        (typeof globalThis !== 'undefined' && globalThis['DSS_TEMP_CHAT_STORAGE_KEY']) ||
        (typeof window !== 'undefined' && window['DSS_TEMP_CHAT_STORAGE_KEY']) ||
        'dss-temporary-chat-enabled';
    if (!(key in changes)) return;
    const newValue = changes[key].newValue === true;
    // 透過公開方法更新快取（利用 IIFE 閉包）
    TemporaryChatToggle.__setCacheForCrossTabSync(newValue);
});

// Auto-start（與 sidebar-auto-hide.js 相同的啟動模式）
TemporaryChatToggle.init();

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatToggle;
}
