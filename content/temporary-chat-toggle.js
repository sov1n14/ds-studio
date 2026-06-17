/**
 * DS studio — Temporary Chat Toggle
 * 僅在首頁（pathname === '/'）注入切換開關 UI。
 * 單一職責：管理 UI 注入、使用者互動、sessionStorage 讀寫與事件 dispatch。
 * 常數由 temporary-chat-constants.js 在前載入提供。
 *
 * SPA-aware: listens to Navigation API (navigate) and popstate to inject/remove
 * the toggle row whenever the pathname changes. The MutationObserver handles the
 * case where the anchor element appears asynchronously after the route settles.
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

    // ── 純工具函式（可供測試匯出） ───────────────────────────────────────────

    /**
     * 讀取 sessionStorage 中的啟用旗標；缺少或無法解析時預設回傳 false。
     * @returns {boolean}
     */
    function readEnabledFlag() {
        try {
            const STORAGE_KEY = _getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled');
            return sessionStorage.getItem(STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

    /**
     * 將啟用旗標寫入 sessionStorage。
     * @param {boolean} isEnabled
     */
    function writeEnabledFlag(isEnabled) {
        try {
            const STORAGE_KEY = _getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled');
            sessionStorage.setItem(STORAGE_KEY, isEnabled ? 'true' : 'false');
        } catch {
            // sessionStorage 不可用時靜默忽略
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

        console.log('[DV:TempChatToggle] injected toggle row | pathname:', window.location.pathname, '| isEnabled:', isEnabled);
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

        console.log('[DV:TempChatToggle] removed toggle row | pathname:', window.location.pathname);
    }

    /**
     * Attempts to find the anchor element and inject the row.
     * Silently returns when the anchor is absent — the MutationObserver will retry.
     */
    function tryInject() {
        const anchor = document.querySelector('div.aaff8b8f');

        console.log('[DV:TempChatToggle] tryInject | pathname:', window.location.pathname, '| anchor found:', !!anchor);

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

        console.log('[DV:TempChatToggle] navigation | old:', oldPathname ?? '(unknown)', '→ new:', newPathname, '| decision:', isHomepage ? 'inject' : 'remove');

        if (isHomepage) {
            tryInject();
        } else {
            removeToggleRow();
        }
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
                console.log('[DV:TempChatToggle] observer: row was disconnected; clearing ref | pathname:', window.location.pathname);
                _injectedRow = null;
            }

            // Only attempt re-injection when on the homepage
            if (window.location.pathname === '/') {
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
     * 初始化模組：在首頁時立即注入；啟動 observer 與 navigation 監聽以處理 SPA 路由切換。
     */
    function init() {
        console.log('[DV:TempChatToggle] init | pathname:', window.location.pathname);

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
