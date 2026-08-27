/**
 * edit-message-cleanup.js
 *
 * Content 層腳本：DOM 互動專用，不使用 chrome.storage / alarms。
 *
 * 功能：
 *   當使用者點擊 DeepSeek 的「編輯訊息」按鈕時，
 *   自動剝除注入的 <system-reminder> / <user-input> 包裝，
 *   讓使用者只看到、編輯自己原本輸入的文字。
 *
 *   同時調整相關元素的 max-height：
 *   - .cc852ac5：設為 none（移除限制）
 *   - ._646a522：依視窗高度與來源元素高度動態計算
 */

'use strict';

// 合併 pure 子包提供的純函式與常數
const __DS_EditCleanup_pureBundle = (globalThis).__DS_EditCleanup_pure || {};
const {
    extractUserInput,
    computeDynamicMaxHeight,
    computeScrollDelta,
    applyMaxHeightAdjustments,
    applyTextareaCleanup,
    findScrollableAncestor,
    applyEditScrollPosition,
    EDIT_BUTTON_CLASS,
    REMOVE_MAX_HEIGHT_SELECTOR,
    DYNAMIC_MAX_HEIGHT_SELECTOR,
    HEIGHT_SOURCE_SELECTOR_A,
    HEIGHT_SOURCE_SELECTOR_B,
    MAX_HEIGHT_OFFSET_PX,
    EDIT_SCROLL_GAP_PX,
    USER_INPUT_REGEX,
    DETECTION_TIMEOUT_MS,
    VALUE_WAIT_TIMEOUT_MS,
} = __DS_EditCleanup_pureBundle;

// 共用 DOM 選擇器常數
const __DS_EditCleanupSelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

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
        const allTextareas = document.querySelectorAll(__DS_EditCleanupSelectors.INPUT_TEXTAREA_SELECTOR);
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
    const preExisting = new Set(document.querySelectorAll(__DS_EditCleanupSelectors.INPUT_TEXTAREA_SELECTOR));

    // 等候新出現的編輯 textarea（DeepSeek 在點擊後非同步渲染）
    waitForNewTextarea(preExisting, (editTextarea) => {
        // 此時編輯 UI 已掛載，調整 max-height 後再清理 textarea 內容
        applyMaxHeightAdjustments(document);

        // 對 textarea 執行條件式內容清理
        applyTextareaCleanup(editTextarea);

        // 等瀏覽器套用 max-height／版面變更後，再捲動至正確位置
        requestAnimationFrame(() => {
            applyEditScrollPosition(document);
        });
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
        computeScrollDelta,
        applyMaxHeightAdjustments,
        applyTextareaCleanup,
        findScrollableAncestor,
        applyEditScrollPosition,
        waitForNewTextarea,
        handleEditButtonClick,
        EDIT_BUTTON_CLASS,
        REMOVE_MAX_HEIGHT_SELECTOR,
        DYNAMIC_MAX_HEIGHT_SELECTOR,
        HEIGHT_SOURCE_SELECTOR_A,
        HEIGHT_SOURCE_SELECTOR_B,
        MAX_HEIGHT_OFFSET_PX,
        EDIT_SCROLL_GAP_PX,
        USER_INPUT_REGEX,
        DETECTION_TIMEOUT_MS,
        VALUE_WAIT_TIMEOUT_MS,
    };
}