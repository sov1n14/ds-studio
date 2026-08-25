/**
 * DS studio — Harvest :: DOM Bundle
 * 單一職責：DOM 探測與量測 —「目前頁面掛載了哪些訊息節點、量到什麼幾何值」。
 * 從 content/harvest.js 抽出，不含迴圈編排、policy 呼叫、toast 呼叫，
 * 也不含 PreventAutoScroll 生命週期。純函式集合，不持有模組層級可變狀態。
 * 由 harvest.js 合入使用（同 harvest.toast.js 的純函式方法包慣例）。
 */
(function (root) {
    'use strict';

    // 合併共用選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const _DSSelectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // ─────────────────────────────────────────────────────────────────
    //  選擇器
    // ─────────────────────────────────────────────────────────────────

    /** 虛擬列表可見項目容器（單一來源定義於 content/ds-selectors.js） */
    const VISIBLE_ITEMS_SELECTOR = _DSSelectors.VISIBLE_ITEMS_SELECTOR;

    /** 訊息元素 */
    const MESSAGE_SELECTOR = _DSSelectors.MESSAGE_SELECTOR;

    /** 虛擬列表項目包裝（攜帶 data-virtual-list-item-key） */
    const ITEM_KEY_ATTR = _DSSelectors.VIRTUAL_ITEM_KEY_ATTR;

    /** 虛擬列表外容器（用於定位滾動容器；單一來源定義於 content/ds-selectors.js） */
    const VIRTUAL_LIST_SELECTOR = _DSSelectors.VIRTUAL_LIST_SELECTOR;
    const VIRTUAL_LIST_FALLBACK = _DSSelectors.VIRTUAL_LIST_FALLBACK;

    /** DOM 穩定判定：連續幾次未偵測到 mutation 即視為穩定 */
    const HARVEST_STABLE_TICKS = 3;

    /** DOM 穩定判定：穩定 tick 間隔（ms） */
    const HARVEST_STABLE_INTERVAL = 100;

    /** 判定抵達底部：scrollTop + clientHeight >= scrollHeight - 此容差（px） */
    const HARVEST_BOTTOM_TOLERANCE = 4;

    // ─────────────────────────────────────────────────────────────────
    //  DOM 探測 / 量測
    // ─────────────────────────────────────────────────────────────────

    /**
     * 定位對話的滾動容器。
     * 策略：從虛擬列表向上走，找到 .ds-scroll-area 且具備可滾動高度的元素。
     * 若失敗回退到 document.scrollingElement。
     * @returns {Element} 滾動容器
     */
    function _findHarvestScrollContainer() {
        const virtualList =
            document.querySelector(VIRTUAL_LIST_SELECTOR) ||
            document.querySelector(VIRTUAL_LIST_FALLBACK);

        if (virtualList) {
            let el = virtualList.parentElement;
            while (el && el !== document.body) {
                if (
                    el.classList.contains(_DSSelectors.SCROLL_AREA_CLASS) &&
                    el.scrollHeight > el.clientHeight
                ) {
                    return el;
                }
                el = el.parentElement;
            }
        }

        const firstMsg = document.querySelector(
            `${VISIBLE_ITEMS_SELECTOR} ${MESSAGE_SELECTOR}`
        );
        if (firstMsg) {
            let el = firstMsg.parentElement;
            while (el && el !== document.body) {
                const style = getComputedStyle(el);
                const overflowY = style.overflowY;
                if (
                    (overflowY === 'auto' || overflowY === 'scroll') &&
                    el.scrollHeight > el.clientHeight
                ) {
                    return el;
                }
                el = el.parentElement;
            }
        }

        return document.scrollingElement || document.documentElement;
    }

    /**
     * 取得目前可見的訊息，回傳 { key, clonedNode } 陣列。
     * 每個訊息節點被克隆以防止後續 React 虛擬化銷毀。
     * @returns {Array<{key: number, clonedNode: Element}>}
     */
    function _harvestVisibleMessages() {
        const visibleContainers = document.querySelectorAll(VISIBLE_ITEMS_SELECTOR);

        const results = [];

        visibleContainers.forEach(container => {
            const messages = container.querySelectorAll(MESSAGE_SELECTOR);
            messages.forEach(msg => {
                let keyEl = msg.closest(`[${ITEM_KEY_ATTR}]`);
                if (!keyEl) return;

                const rawKey = keyEl.getAttribute(ITEM_KEY_ATTR);
                const key = parseInt(rawKey, 10);
                if (isNaN(key)) return;

                results.push({ key, clonedNode: msg.cloneNode(true) });
            });
        });

        return results;
    }

    /**
     * 等待滾動容器內 DOM 穩定（連續 HARVEST_STABLE_TICKS 個 interval 無 mutation）。
     * 同時設有逾時保護，逾時後仍 resolve（不拋出），讓主流程繼續。
     * @param {Element} container - 要觀察的滾動容器
     * @param {number} stepTimeout - 最大等待時間（ms）
     * @returns {Promise<void>}
     */
    function _waitForDomStability(container, stepTimeout) {
        return new Promise((resolve) => {
            let stableTicks = 0;
            let isMutated = false;

            const observer = new MutationObserver(() => {
                isMutated = true;
                stableTicks = 0;
            });

            observer.observe(container, { childList: true, subtree: true });

            const timeoutId = setTimeout(() => {
                observer.disconnect();
                clearInterval(tickId);
                resolve();
            }, stepTimeout);

            const tickId = setInterval(() => {
                if (!isMutated) {
                    stableTicks++;
                }
                isMutated = false;

                if (stableTicks >= HARVEST_STABLE_TICKS) {
                    clearTimeout(timeoutId);
                    clearInterval(tickId);
                    observer.disconnect();
                    resolve();
                }
            }, HARVEST_STABLE_INTERVAL);
        });
    }

    /**
     * 判斷滾動容器是否已抵達底部。
     * @param {Element} container
     * @returns {boolean}
     */
    function _isAtBottom(container) {
        return (
            container.scrollTop + container.clientHeight >=
            container.scrollHeight - HARVEST_BOTTOM_TOLERANCE
        );
    }

    /**
     * 量測「掛載內容底部量測值」：從滾動容器可視區域頂緣，往下到目前
     * 已掛載、攜帶 data-virtual-list-item-key 的最下方節點底緣的距離（CSS px）。
     * 節點範圍與 _harvestVisibleMessages() 擷取的節點集合一致（同一批
     * VISIBLE_ITEMS_SELECTOR 容器），確保量測的是同一份掛載視窗。
     *
     * 回傳 null 代表量測不可用（無鍵節點或幾何值不合理），呼叫端須自行退回
     * 備援步進，本函式不丟例外、不捏造預設值。
     * @param {Element} container - 滾動容器（用來取得可視區域頂緣）
     * @returns {number|null} 掛載內容底部量測值（CSS px），或 null
     */
    function _measureMountedBottomOffset(container) {
        if (!container) return null;
        if (typeof container.getBoundingClientRect !== 'function') return null;

        const visibleContainers = document.querySelectorAll(VISIBLE_ITEMS_SELECTOR);
        if (!visibleContainers.length) return null;

        let lowestNodeBottom = -Infinity;
        visibleContainers.forEach(visibleContainer => {
            const keyedNodes = visibleContainer.querySelectorAll(`[${ITEM_KEY_ATTR}]`);
            keyedNodes.forEach(node => {
                const rect = node.getBoundingClientRect();
                if (rect.bottom > lowestNodeBottom) {
                    lowestNodeBottom = rect.bottom;
                }
            });
        });

        if (lowestNodeBottom === -Infinity) return null;

        const containerVisibleTop = Math.max(0, container.getBoundingClientRect().top);

        const mountedBottomOffset = lowestNodeBottom - containerVisibleTop;
        if (!Number.isFinite(mountedBottomOffset) || mountedBottomOffset <= 0) return null;

        return mountedBottomOffset;
    }

    const bundle = {
        VISIBLE_ITEMS_SELECTOR,
        MESSAGE_SELECTOR,
        ITEM_KEY_ATTR,
        VIRTUAL_LIST_SELECTOR,
        VIRTUAL_LIST_FALLBACK,
        _findHarvestScrollContainer,
        _harvestVisibleMessages,
        _waitForDomStability,
        _isAtBottom,
        _measureMountedBottomOffset,
    };

    root.__DS_Harvest_dom = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
