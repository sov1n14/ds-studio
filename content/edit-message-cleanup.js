/**
 * edit-message-cleanup.js
 *
 * Content 層腳本：DOM 互動專用，不使用 chrome.storage / alarms。
 *
 * 功能：
 *   當使用者點擊 DeepSeek 的「編輯訊息」按鈕時，
 *   自動剝除注入的 <system-prompt> / <user-input> 包裝，
 *   讓使用者只看到、編輯自己原本輸入的文字。
 *
 *   同時移除相關元素的 max-height 限制，確保編輯框可完整顯示。
 */

'use strict';

// ─────────────────────────────────────────────
// 常數
// ─────────────────────────────────────────────

/** 編輯按鈕的混淆 class 名稱 */
const EDIT_BUTTON_CLASS = 'd4910adc';

/** 需移除 max-height 的容器 class 清單 */
const MAX_HEIGHT_SELECTORS = ['.cc852ac5', '._646a522'];

/** 偵測編輯 textarea 的輪詢上限時間（毫秒） */
const DETECTION_TIMEOUT_MS = 2000;

/** 輪詢間隔（毫秒） */
const POLL_INTERVAL_MS = 50;

/** 包裝格式的正規表示式：擷取 <user-input>...</user-input> 內容 */
const USER_INPUT_REGEX = /<user-input>\n([\s\S]*)\n<\/user-input>$/;

// ─────────────────────────────────────────────
// 純函式（可測試）
// ─────────────────────────────────────────────

/**
 * 從包裝後的訊息文字中擷取原始使用者輸入。
 * 純查詢函式，不修改任何狀態。
 *
 * @param {string} text - textarea 的完整值
 * @returns {string|null} 擷取到的原始輸入；若無匹配則回傳 null
 */
function extractUserInput(text) {
    // Guard：非字串直接返回
    if (typeof text !== 'string') return null;

    const match = text.match(USER_INPUT_REGEX);
    return match ? match[1] : null;
}

/**
 * 移除指定根節點內所有 .cc852ac5 與 ._646a522 元素的 max-height 限制。
 * 使用 inline style 覆寫，不需還原。
 *
 * @param {Document|Element} root - 搜尋起點，預設為 document
 */
function removeMaxHeightConstraints(root) {
    // Guard：若未傳入則使用 document
    const searchRoot = root != null ? root : document;

    MAX_HEIGHT_SELECTORS.forEach((selector) => {
        const elements = searchRoot.querySelectorAll(selector);
        elements.forEach((el) => {
            el.style.maxHeight = 'none';
        });
    });
}

/**
 * 對給定的 textarea 執行條件式內容清理：
 *   - 若 value 符合包裝格式，以原生 setter + input 事件寫入擷取的原始文字。
 *   - 若不符合，完全不動 textarea 內容。
 *
 * 使用與 content-script.js injectPrefix 相同的 React 相容寫入技術。
 *
 * @param {HTMLTextAreaElement} textarea
 */
function applyTextareaCleanup(textarea) {
    // Guard：非 textarea 元素直接返回
    if (!(textarea instanceof HTMLTextAreaElement)) return;

    const extracted = extractUserInput(textarea.value);

    // 無匹配時完全不修改內容（明確需求）
    if (extracted === null) return;

    // 以 native setter 寫入，確保 React 受控元件感知到變更
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
    ).set;
    nativeSetter.call(textarea, extracted);

    // 觸發 React 16+ 的輸入事件
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

// ─────────────────────────────────────────────
// DOM 偵測輔助函式
// ─────────────────────────────────────────────

/**
 * 從編輯按鈕往上尋找最近的訊息容器元素。
 * 策略：逐層往上直到找到含有 textarea 的祖先，或抵達 document.body。
 *
 * @param {Element} editButton - 被點擊的編輯按鈕
 * @returns {Element|null} 訊息容器元素；找不到則回傳 null
 */
function findMessageContainer(editButton) {
    // Guard
    if (!editButton) return null;

    let el = editButton.parentElement;
    while (el && el !== document.body) {
        // 若此層已包含 textarea，代表這就是我們要的容器
        if (el.querySelector('textarea')) return el;
        el = el.parentElement;
    }
    return null;
}

/**
 * 使用 MutationObserver 非同步等候 textarea 出現於容器中，
 * 並在找到後立即執行 cleanup callback。
 * 超過 DETECTION_TIMEOUT_MS 後自動放棄，確保不洩漏觀察者。
 *
 * @param {Element} container - 要觀察的 DOM 容器
 * @param {function(HTMLTextAreaElement): void} onFound - 找到 textarea 後的回呼
 */
function waitForTextareaInContainer(container, onFound) {
    // Guard
    if (!container || typeof onFound !== 'function') return;

    // 若容器內已存在 textarea，直接呼叫（同步路徑）
    const existing = container.querySelector('textarea');
    if (existing) {
        onFound(existing);
        return;
    }

    let isResolved = false;
    let timeoutId = null;

    const observer = new MutationObserver(() => {
        const textarea = container.querySelector('textarea');
        if (!textarea) return;

        // 找到後立即清理觀察者與計時器
        isResolved = true;
        clearTimeout(timeoutId);
        observer.disconnect();
        onFound(textarea);
    });

    observer.observe(container, { childList: true, subtree: true });

    // 硬性逾時：避免無限等待造成資源洩漏
    timeoutId = setTimeout(() => {
        if (isResolved) return;
        observer.disconnect();
    }, DETECTION_TIMEOUT_MS);
}

// ─────────────────────────────────────────────
// 主要點擊處理器
// ─────────────────────────────────────────────

/**
 * 處理文件層級的點擊事件。
 * 使用委派模式，只對編輯按鈕有反應。
 * 所有每次呼叫的狀態均保持在 closure 內部，無模組層級可變狀態。
 *
 * @param {MouseEvent} e
 */
function handleEditButtonClick(e) {
    // Guard：確認點擊目標為編輯按鈕
    const editButton = e.target.closest(`.${EDIT_BUTTON_CLASS}`);
    if (!editButton) return;

    // 立即移除已存在元素的 max-height（同步部分）
    removeMaxHeightConstraints(document);

    // 尋找訊息容器（編輯按鈕的祖先）
    const container = findMessageContainer(editButton);
    if (!container) return;

    // 非同步等候 textarea 出現（React 在點擊後非同步渲染）
    waitForTextareaInContainer(container, (textarea) => {
        // textarea 出現後再次移除 max-height（涵蓋非同步渲染的新元素）
        removeMaxHeightConstraints(document);

        // 對 textarea 執行條件式內容清理
        applyTextareaCleanup(textarea);
    });
}

// ─────────────────────────────────────────────
// 監聽器註冊（冪等保護）
// ─────────────────────────────────────────────

/**
 * 使用 window flag 確保即使腳本被重複注入，監聽器也只綁定一次。
 */
const LISTENER_FLAG = '__dsEditCleanupRegistered';

if (!window[LISTENER_FLAG]) {
    window[LISTENER_FLAG] = true;
    document.addEventListener('click', handleEditButtonClick, { capture: true });
}

// ─────────────────────────────────────────────
// 測試匯出（僅在 Node.js 測試環境中生效）
// ─────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        extractUserInput,
        removeMaxHeightConstraints,
        applyTextareaCleanup,
        findMessageContainer,
        waitForTextareaInContainer,
        handleEditButtonClick,
        EDIT_BUTTON_CLASS,
        MAX_HEIGHT_SELECTORS,
        USER_INPUT_REGEX,
        DETECTION_TIMEOUT_MS,
    };
}
