/**
 * DS studio — Harvest :: Think Bundle
 * 單一職責：複製單則訊息前暫時展開其中已收合的思考區塊，複製後恢復收合。
 * DeepSeek 原生收合會卸載思考內容節點，內容只在展開時存在於 DOM；收合屬於顯示層選擇，不得影響匯出，匯出也不得改變畫面。
 * 展開與恢復皆以 header.click() 點擊原生標頭（與 content/hide-thinking.js 相同）。已展開的區塊不碰。
 * 由 harvest.js 合入使用；不持有模組層級可變狀態。
 */
(function (root) {
    'use strict';

    // 合併共用選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const _DSSelectors = (root).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // 輪詢工具（瀏覽器：由 content/retry-until.js 於前載入設定全域；Node.js 測試：直接 require）
    const _retryUntil = root.DSSRetryUntil ||
        (typeof require !== 'undefined' ? require('./retry-until.js') : null);

    /** 等待思考內容掛載的輪詢間隔（ms） */
    const THINK_MOUNT_POLL_INTERVAL_MS = 50;

    /** 等待思考內容掛載的最多重試次數（約 2 秒後放棄，仍照常複製） */
    const THINK_MOUNT_MAX_RETRIES = 40;

    /**
     * 取得思考區塊的可點擊標頭（區塊的直接子節點）。
     * 以 children + matches 比對而非 block.querySelector：標頭選擇器以區塊外的 .ds-message 祖先為錨點，部分 DOM 實作（happy-dom）的 querySelector 不比對範圍外的祖先。
     * @param {Element} block
     * @returns {Element|null}
     */
    function _findThinkHeader(block) {
        return Array.from(block.children).find((child) => child.matches(_DSSelectors.THINK_HEADER_TOGGLE_SELECTOR)) || null;
    }

    /** @param {Element} block @returns {boolean} 區塊是否已掛載思考內容 */
    function _hasMountedThinkBody(block) {
        return block.querySelector(_DSSelectors.THINK_CONTENT_SELECTOR) !== null;
    }

    /**
     * 找出訊息內已收合的思考區塊：有標頭但未掛載思考內容。
     * @param {Element} msg - .ds-message 節點
     * @returns {Element[]}
     */
    function _findCollapsedThinkBlocks(msg) {
        return Array.from(msg.querySelectorAll(_DSSelectors.THINK_BLOCK_SELECTOR))
            .filter((block) => !_hasMountedThinkBody(block) && _findThinkHeader(block) !== null);
    }

    /**
     * 等待所有區塊掛載思考內容；逾時仍 resolve（不拋出），讓擷取照常進行。
     * @param {Element[]} blocks
     * @returns {Promise<void>}
     */
    function _waitUntilThinkBodiesMounted(blocks) {
        return new Promise((resolve) => {
            _retryUntil(() => blocks.every(_hasMountedThinkBody), {
                intervalMs: THINK_MOUNT_POLL_INTERVAL_MS,
                maxRetries: THINK_MOUNT_MAX_RETRIES,
                onReady: () => resolve(),
                onGiveUp: () => resolve(),
            });
        });
    }

    /**
     * 展開訊息內已收合的思考區塊後複製訊息，最後點回標頭恢復收合。
     * 恢復寫在 finally：等待中拋出或中止都不會讓區塊停留在展開狀態。
     * 只點回目前已掛載內容的區塊：點擊未生效的區塊再點一次反而會把它展開。
     * @param {Element} msg - 頁面上的 .ds-message 節點
     * @returns {Promise<Element>} 訊息的深層複製
     */
    async function _cloneMessageWithThinkingExpanded(msg) {
        if (typeof _retryUntil !== 'function') {
            throw new Error('content/harvest.think.js requires content/retry-until.js — check that it loads before content/harvest.think.js in manifest.json');
        }

        const collapsedBlocks = _findCollapsedThinkBlocks(msg);
        if (collapsedBlocks.length === 0) return msg.cloneNode(true);

        try {
            collapsedBlocks.forEach((block) => _findThinkHeader(block).click());
            // 同步快速路徑：點擊後內容已掛載則不等待
            if (!collapsedBlocks.every(_hasMountedThinkBody)) {
                await _waitUntilThinkBodiesMounted(collapsedBlocks);
            }
            return msg.cloneNode(true);
        } finally {
            collapsedBlocks.filter(_hasMountedThinkBody).forEach((block) => {
                const header = _findThinkHeader(block);
                if (header) header.click();
            });
        }
    }

    const bundle = {
        _cloneMessageWithThinkingExpanded,
    };

    // Stryker disable all: equivalent mutants — module/globalThis export boilerplate, untestable in Node
    root.__DS_Harvest_think = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
// Stryker restore all
