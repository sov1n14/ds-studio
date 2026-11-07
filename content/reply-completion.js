/**
 * DS studio — Reply Completion
 * 單一職責：純判斷「哪些訊息工具列是新出現的」與「某則回覆是否被停止」，供自動複製回覆的消費端呼叫。
 * 新回覆或重新生成時，DeepSeek 先掛載不含工具列的虛擬列表項目，之後的批次才把工具列加入該已掛載項目；捲動則整個重新掛載已含工具列的項目，因此與項目同批加入的工具列視為重新掛載而非新出現。
 * 停止的回覆會在工具列自身的外層包裝（toolbar.parentElement）內帶有「继续生成」按鈕；僅以選擇器定位，絕不比對文字，範圍僅限該包裝。
 * 不建立 MutationObserver、不持有模組層級可變狀態、不修改 DOM；由呼叫端傳入 MutationRecord 與工具列節點。
 */
(function (root) {
    'use strict';

    // 合併共用選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 DSstudio；Node.js 測試：直接 require）
    const _DSSelectors = root.DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    /**
     * 收集本批次所有被加入的元素節點（忽略文字節點）。
     * @param {MutationRecord[]} records
     * @returns {Element[]}
     */
    function _collectAddedElements(records) {
        return records.flatMap((record) => Array.from(record.addedNodes))
            .filter((node) => node.nodeType === Node.ELEMENT_NODE);
    }

    /**
     * 節點內含虛擬列表項目：代表整個項目被（重新）掛載。
     * @param {Element} node
     * @returns {boolean}
     */
    function _containsItem(node) {
        return node.querySelector(_DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR) !== null;
    }

    /**
     * 項目本身或其任一祖先是否於本批次加入（同批加入即為重新掛載）。
     * @param {Element} item
     * @param {Set<Element>} addedElements
     * @returns {boolean}
     */
    function _isMountedInBatch(item, addedElements) {
        for (let el = item; el; el = el.parentElement) {
            if (addedElements.has(el)) return true;
        }
        return false;
    }

    /**
     * 加入的節點本身或其子孫中的工具列。
     * @param {Element} node
     * @returns {Element[]}
     */
    function _toolbarsWithin(node) {
        const nested = Array.from(node.querySelectorAll(_DSSelectors.MESSAGE_TOOLBAR_SELECTOR));
        return node.matches(_DSSelectors.MESSAGE_TOOLBAR_SELECTOR) ? [node, ...nested] : nested;
    }

    /** @param {Element} a @param {Element} b @returns {number} 依文件順序排序的比較值 */
    function _compareDocumentOrder(a, b) {
        return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    }

    /**
     * 從一批 MutationRecord（childList、subtree）找出新出現的訊息工具列。
     * 只計入被加入（本身或位於加入的非項目節點內）到「非本批次加入」之虛擬列表項目中的工具列。
     * @param {MutationRecord[]} records
     * @returns {Element[]} 依文件順序、不重複的工具列；無則為空陣列
     */
    function newToolbarsFromRecords(records) {
        const addedElements = _collectAddedElements(records);
        const addedSet = new Set(addedElements);
        const toolbars = new Set();

        addedElements.forEach((node) => {
            if (_containsItem(node)) return;
            const item = node.closest(_DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR);
            if (!item || _isMountedInBatch(item, addedSet)) return;
            _toolbarsWithin(node).forEach((toolbar) => toolbars.add(toolbar));
        });

        return Array.from(toolbars).sort(_compareDocumentOrder);
    }

    /**
     * 判斷工具列所屬回覆是否被停止：工具列自身外層包裝內含「继续生成」按鈕（主要或備援選擇器）。
     * @param {Element} toolbar
     * @returns {boolean}
     */
    function isStoppedReply(toolbar) {
        const wrapper = toolbar?.parentElement;
        if (!wrapper) return false;
        const continueSelector = _DSSelectors.CONTINUE_BUTTON_SELECTOR + ', ' + _DSSelectors.CONTINUE_BUTTON_FALLBACK_SELECTOR;
        return wrapper.querySelector(continueSelector) !== null;
    }

    const ReplyCompletion = {
        newToolbarsFromRecords,
        isStoppedReply,
    };

    // Stryker disable all: equivalent mutants — module/globalThis export boilerplate, untestable in Node
    root.DSstudio = root.DSstudio || {};
    root.DSstudio.ReplyCompletion = ReplyCompletion;
    if (typeof module !== 'undefined' && module.exports) module.exports = ReplyCompletion;
})(globalThis);
// Stryker restore all
