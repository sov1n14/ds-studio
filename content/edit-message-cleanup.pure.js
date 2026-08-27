/**
 * DS Studio — EditCleanup 純函式與常數群組
 * 負責使用者輸入擷取、動態高度計算、textarea 清理、捲動定位等可測試邏輯。
 */
(function (root) {
    'use strict';

// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DS_EditCleanupSelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

/** 編輯按鈕的混淆 class 名稱 */
const EDIT_BUTTON_CLASS = __DS_EditCleanupSelectors.EDIT_MESSAGE_BUTTON_CLASS;

/** 需移除 max-height（設為 none）的容器 selector */
const REMOVE_MAX_HEIGHT_SELECTOR = __DS_EditCleanupSelectors.EDIT_BOX_SELECTOR;

/** 需動態設定 max-height 的容器 selector */
const DYNAMIC_MAX_HEIGHT_SELECTOR = __DS_EditCleanupSelectors.EDIT_BOX_HEIGHT_CONTAINER_SELECTOR;

/** 動態 max-height 計算來源元素 A 的 selector */
const HEIGHT_SOURCE_SELECTOR_A = __DS_EditCleanupSelectors.CHAT_HEADER_SELECTOR;

/** 動態 max-height 計算來源元素 B 的 selector */
const HEIGHT_SOURCE_SELECTOR_B = __DS_EditCleanupSelectors.CONTENT_COLUMN_SELECTOR;

/** 動態 max-height 公式中扣除的固定偏移量（px） */
const MAX_HEIGHT_OFFSET_PX = 32;

/** 捲動後編輯框頂端與固定 header 底端的視覺間距（px） */
const EDIT_SCROLL_GAP_PX = 16;

/** 偵測編輯 textarea 的等待上限時間（毫秒） */
const DETECTION_TIMEOUT_MS = 2000;

/** textarea value 延遲填入的等待上限時間（毫秒） */
const VALUE_WAIT_TIMEOUT_MS = 800;

/** 包裝格式的正規表示式：擷取 <user-input>...</user-input> 內容 */
const USER_INPUT_REGEX = /<user-input>\n([\s\S]*)\n<\/user-input>$/;

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
 * 計算需要增加到捲動容器 scrollTop 的像素量，
 * 使編輯框頂端落在 header 底端以下 gap px 處。
 * 純計算函式，不存取 DOM。
 *
 * 公式：editBoxTop - (headerBottom + gap)
 * 正值 → 向下捲動；負值 → 向上捲動。
 *
 * @param {number} editBoxTop   - 編輯框的 getBoundingClientRect().top
 * @param {number} headerBottom - 固定 header 的 getBoundingClientRect().bottom
 * @param {number} gap          - 期望的視覺間距（px）
 * @returns {number} 應加到 scrollTop 的有號像素量
 */
function computeScrollDelta(editBoxTop, headerBottom, gap) {
    return editBoxTop - (headerBottom + gap);
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

/**
 * 從指定元素向上（含自身）尋找第一個真正可捲動的祖先元素。
 * 判斷條件：scrollHeight > clientHeight。
 *
 * @param {Element} el - 起始元素
 * @returns {Element|null} 找到的可捲動元素；若無則回傳 null
 */
function findScrollableAncestor(el) {
    // Guard：非 Element 直接返回
    if (!(el instanceof Element)) return null;

    let current = el;
    while (current) {
        if (current.scrollHeight > current.clientHeight) return current;
        current = current.parentElement;
    }
    return null;
}

/**
 * 捲動訊息列表容器，使編輯框頂端視覺上位於固定 header 底端下方 EDIT_SCROLL_GAP_PX px 處。
 * 在編輯 UI 開啟時執行一次；不監聽 resize / scroll 事件。
 *
 * 若編輯框、header 或捲動容器任一不存在，則靜默 no-op 不拋出例外。
 *
 * @param {Document|Element} [root=document] - 搜尋起點
 */
function applyEditScrollPosition(root) {
    // Guard：若未傳入則使用 document
    const searchRoot = root != null ? root : document;

    // 取得編輯框元素（使用既有的 REMOVE_MAX_HEIGHT_SELECTOR 常數）
    const editBox = searchRoot.querySelector(REMOVE_MAX_HEIGHT_SELECTOR);
    if (!editBox) return;

    // 取得固定 header 元素
    const header = document.querySelector(HEIGHT_SOURCE_SELECTOR_A);
    if (!header) return;

    // 找到 ._6f2c522 容器，再向上尋找真正可捲動的祖先
    const listItems = document.querySelector(__DS_EditCleanupSelectors.VIRTUAL_LIST_CONTAINER_SELECTOR);
    if (!listItems) return;

    const scrollContainer = findScrollableAncestor(listItems) || listItems;

    // 即時讀取幾何資訊，計算需調整的捲動量
    const editBoxTop = editBox.getBoundingClientRect().top;
    const headerBottom = header.getBoundingClientRect().bottom;
    const delta = computeScrollDelta(editBoxTop, headerBottom, EDIT_SCROLL_GAP_PX);

    scrollContainer.scrollTop += delta;
}

    var bundle = {
        extractUserInput: extractUserInput,
        computeDynamicMaxHeight: computeDynamicMaxHeight,
        computeScrollDelta: computeScrollDelta,
        applyMaxHeightAdjustments: applyMaxHeightAdjustments,
        applyTextareaCleanup: applyTextareaCleanup,
        findScrollableAncestor: findScrollableAncestor,
        applyEditScrollPosition: applyEditScrollPosition,
        // 常數匯出（供測試與主檔使用）
        EDIT_BUTTON_CLASS: EDIT_BUTTON_CLASS,
        REMOVE_MAX_HEIGHT_SELECTOR: REMOVE_MAX_HEIGHT_SELECTOR,
        DYNAMIC_MAX_HEIGHT_SELECTOR: DYNAMIC_MAX_HEIGHT_SELECTOR,
        HEIGHT_SOURCE_SELECTOR_A: HEIGHT_SOURCE_SELECTOR_A,
        HEIGHT_SOURCE_SELECTOR_B: HEIGHT_SOURCE_SELECTOR_B,
        MAX_HEIGHT_OFFSET_PX: MAX_HEIGHT_OFFSET_PX,
        EDIT_SCROLL_GAP_PX: EDIT_SCROLL_GAP_PX,
        USER_INPUT_REGEX: USER_INPUT_REGEX,
        DETECTION_TIMEOUT_MS: DETECTION_TIMEOUT_MS,
        VALUE_WAIT_TIMEOUT_MS: VALUE_WAIT_TIMEOUT_MS,
    };

    root.__DS_EditCleanup_pure = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
