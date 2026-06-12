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
 *   同時調整相關元素的 max-height：
 *   - .cc852ac5：設為 none（移除限制）
 *   - ._646a522：依視窗高度與來源元素高度動態計算
 */

'use strict';

// ─────────────────────────────────────────────
// 常數
// ─────────────────────────────────────────────

/** 編輯按鈕的混淆 class 名稱 */
const EDIT_BUTTON_CLASS = 'd4910adc';

/** 需移除 max-height（設為 none）的容器 selector */
const REMOVE_MAX_HEIGHT_SELECTOR = '.cc852ac5';

/** 需動態設定 max-height 的容器 selector */
const DYNAMIC_MAX_HEIGHT_SELECTOR = '._646a522';

/** 動態 max-height 計算來源元素 A 的 selector */
const HEIGHT_SOURCE_SELECTOR_A = '._2be88ba';

/** 動態 max-height 計算來源元素 B 的 selector */
const HEIGHT_SOURCE_SELECTOR_B = '._871cbca';

/** 動態 max-height 公式中扣除的固定偏移量（px） */
const MAX_HEIGHT_OFFSET_PX = 32;

/** 偵測編輯 textarea 的等待上限時間（毫秒） */
const DETECTION_TIMEOUT_MS = 2000;

/** textarea value 延遲填入的等待上限時間（毫秒） */
const VALUE_WAIT_TIMEOUT_MS = 800;

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
 * 計算 ._646a522 元素的動態 max-height 值。
 * 純計算函式，不存取 DOM。
 *
 * 公式：windowHeight - sourceHeightA - sourceHeightB - MAX_HEIGHT_OFFSET_PX
 *
 * @param {number} windowHeight  - window.innerHeight
 * @param {number} sourceHeightA - HEIGHT_SOURCE_SELECTOR_A 元素的 getBoundingClientRect().height
 * @param {number} sourceHeightB - HEIGHT_SOURCE_SELECTOR_B 元素的 getBoundingClientRect().height
 * @returns {number} 計算出的 max-height（px）
 */
function computeDynamicMaxHeight(windowHeight, sourceHeightA, sourceHeightB) {
    return windowHeight - sourceHeightA - sourceHeightB - MAX_HEIGHT_OFFSET_PX;
}

/**
 * 調整指定根節點內所有相關元素的 max-height：
 *   - REMOVE_MAX_HEIGHT_SELECTOR (.cc852ac5)：一律設為 'none'
 *   - DYNAMIC_MAX_HEIGHT_SELECTOR (._646a522)：依視窗高度與來源元素高度動態計算；
 *     若任一來源元素不存在於 DOM 中，則跳過 ._646a522 的設定。
 *
 * 在 textarea 被偵測到的當下呼叫一次；不監聽 resize 事件。
 *
 * @param {Document|Element} [root=document] - 搜尋起點
 */
function applyMaxHeightAdjustments(root) {
    // Guard：若未傳入則使用 document
    const searchRoot = root != null ? root : document;

    // 移除 .cc852ac5 的 max-height 限制
    searchRoot.querySelectorAll(REMOVE_MAX_HEIGHT_SELECTOR).forEach((el) => {
        el.style.maxHeight = 'none';
    });

    // 讀取動態高度所需的來源元素
    const sourceElA = document.querySelector(HEIGHT_SOURCE_SELECTOR_A);
    const sourceElB = document.querySelector(HEIGHT_SOURCE_SELECTOR_B);

    // 缺少任一來源元素時，跳過 ._646a522 的 max-height 設定
    if (!sourceElA || !sourceElB) return;

    const computed = computeDynamicMaxHeight(
        window.innerHeight,
        sourceElA.getBoundingClientRect().height,
        sourceElB.getBoundingClientRect().height
    );

    searchRoot.querySelectorAll(DYNAMIC_MAX_HEIGHT_SELECTOR).forEach((el) => {
        el.style.maxHeight = computed + 'px';
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
 * @returns {boolean} 是否成功匹配並改寫 textarea 內容
 */
function applyTextareaCleanup(textarea) {
    // Guard：非 textarea 元素直接返回
    if (!(textarea instanceof HTMLTextAreaElement)) return false;

    const extracted = extractUserInput(textarea.value);

    if (extracted === null) return false;

    // 以 native setter 寫入，確保 React 受控元件感知到變更
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
    ).set;
    nativeSetter.call(textarea, extracted);

    // 觸發 React 16+ 的輸入事件
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
}

// ─────────────────────────────────────────────
// DOM 偵測輔助函式
// ─────────────────────────────────────────────

/**
 * 等候點擊後「新出現」的 textarea（即不在 preExisting 集合中的那個）。
 * 使用 MutationObserver 監聽 document.body，確保即使 DeepSeek 非同步渲染
 * 編輯框也能正確捕獲到真正的編輯 textarea，而非主要底部輸入框。
 *
 * 若找到新 textarea 後其 value 仍為空（React 可能延遲填入），
 * 則啟動二次監聽，最長等待 VALUE_WAIT_TIMEOUT_MS 後放棄。
 *
 * 所有每次呼叫的狀態均保持在 closure 內部，無模組層級可變狀態。
 *
 * @param {Set<HTMLTextAreaElement>} preExisting - 點擊當下已存在的 textarea 集合
 * @param {function(HTMLTextAreaElement): void} onFound - 找到新 textarea 後的回呼
 */
function waitForNewTextarea(preExisting, onFound) {
    // Guard
    if (!(preExisting instanceof Set) || typeof onFound !== 'function') return;

    let isResolved = false;
    let timeoutId = null;

    /**
     * 掃描所有 textarea，找出不在 preExisting 中的第一個新元素。
     * @returns {HTMLTextAreaElement|null}
     */
    function findNewTextarea() {
        const allTextareas = document.querySelectorAll('textarea');
        for (const ta of allTextareas) {
            if (!preExisting.has(ta)) return ta;
        }
        return null;
    }

    /**
     * 找到新 textarea 後，處理 value 可能延遲填入的情況。
     * 若 value 已包含包裝格式，直接呼叫 onFound；
     * 否則啟動二次監聽等待 value 填入。
     * @param {HTMLTextAreaElement} editTextarea
     */
    function handleFoundTextarea(editTextarea) {
        // Guard：避免重複觸發
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timeoutId);
        observer.disconnect();

        // 快速路徑：value 已有內容（包裝 regex 可能立即匹配）
        if (editTextarea.value !== '') {
            onFound(editTextarea);
            return;
        }

        // 延遲路徑：React 尚未填入 value，等待 value 出現
        let isValueResolved = false;
        let valueTimeoutId = null;

        const valueObserver = new MutationObserver(() => {
            if (isValueResolved) return;
            if (editTextarea.value !== '') {
                isValueResolved = true;
                clearTimeout(valueTimeoutId);
                valueObserver.disconnect();
                onFound(editTextarea);
            }
        });

        // 觀察 textarea 本身的 childList 與 characterData 變化
        valueObserver.observe(editTextarea, { childList: true, characterData: true, subtree: true });

        valueTimeoutId = setTimeout(() => {
            if (isValueResolved) return;
            valueObserver.disconnect();
            // value 仍為空但已等待足夠久，仍呼叫 onFound 讓後續邏輯決定
            onFound(editTextarea);
        }, VALUE_WAIT_TIMEOUT_MS);
    }

    // 啟動 MutationObserver 監聽整個 document.body
    const observer = new MutationObserver(() => {
        const newTextarea = findNewTextarea();
        if (newTextarea) handleFoundTextarea(newTextarea);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 同步預檢：有時 textarea 在 click 事件處理前已渲染完畢
    const immediate = findNewTextarea();
    if (immediate) {
        handleFoundTextarea(immediate);
        return;
    }

    // 硬性逾時：避免觀察者無限運行造成資源洩漏
    timeoutId = setTimeout(() => {
        if (isResolved) return;
        isResolved = true;
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

    // 快照點擊當下已存在的所有 textarea，用於後續辨識「新出現的」編輯 textarea
    const preExisting = new Set(document.querySelectorAll('textarea'));

    // 等候新出現的編輯 textarea（DeepSeek 在點擊後非同步渲染）
    waitForNewTextarea(preExisting, (editTextarea) => {
        // 此時編輯 UI 已掛載，調整 max-height 後再清理 textarea 內容
        applyMaxHeightAdjustments(document);

        // 對 textarea 執行條件式內容清理
        applyTextareaCleanup(editTextarea);
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
        computeDynamicMaxHeight,
        applyMaxHeightAdjustments,
        applyTextareaCleanup,
        waitForNewTextarea,
        handleEditButtonClick,
        EDIT_BUTTON_CLASS,
        REMOVE_MAX_HEIGHT_SELECTOR,
        DYNAMIC_MAX_HEIGHT_SELECTOR,
        HEIGHT_SOURCE_SELECTOR_A,
        HEIGHT_SOURCE_SELECTOR_B,
        MAX_HEIGHT_OFFSET_PX,
        USER_INPUT_REGEX,
        DETECTION_TIMEOUT_MS,
        VALUE_WAIT_TIMEOUT_MS,
    };
}
