/**
 * DS Studio — PresetOverlay Resolvers
 * 單一職責：解析 preset header 區域內的 DOM 元素（標題、新建對話按鈕）。
 * 由 preset-overlay.controller.js 消費；透過全域命名空間 __DS_PresetOverlayResolvers 共享。
 *
 * 載入順序：此檔須在 preset-overlay.controller.js 之前被 manifest 載入。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

(function (root) {
    'use strict';

    var selectors = (globalThis).DSstudio && (globalThis).DSstudio.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // ── Selector 常數（僅限解析器使用） ──────────────────────────────────────

    // 皆為結構選擇器（不依賴 DeepSeek 建置產出的 hash class），由 ds-selectors.js 集中定義。
    var TITLE_ROW_SELECTOR = selectors.CHAT_HEADER_TITLE_ROW_SELECTOR;   // 標題列：直接含按鈕子層的 .the-header
    var TITLE_SELECTOR     = selectors.CHAT_TITLE_FALLBACK_SELECTOR;     // 聊天標題：標題列內緊接在按鈕之後的 div

    // ── DOM 解析器：title ────────────────────────────────────────────────────

    /**
     * 在 container（直接包住 .the-header 的標題列容器）內解析聊天標題元素。
     * 結構路徑：.the-header 內緊接在 role="button" 直接子層之後的 div。
     * @param {Element} container
     * @returns {{ el: Element|null, path: 'semantic'|'none' }}
     */
    function resolveTitleEl(container) {
        var titleEl = container.querySelector(TITLE_SELECTOR);
        if (titleEl) return { el: titleEl, path: 'semantic' };
        return { el: null, path: 'none' };
    }

    // ── DOM 解析器：new-chat button ──────────────────────────────────────────

    /**
     * 回傳 parent 的直接子元素中，最後一個符合 selector 的元素。
     * @param {Element} parent
     * @param {string} selector
     * @returns {Element|null}
     */
    function findLastDirectChild(parent, selector) {
        for (var child = parent.lastElementChild; child; child = child.previousElementSibling) {
            if (child.matches(selector)) return child;
        }
        return null;
    }

    /**
     * 在 container（直接包住 .the-header 的標題列容器）內解析「新建對話」按鈕元素。
     * 結構路徑：標題列直接子層中最後一個 role="button" div（new-chat 按鈕位於標題列最右側）。只看直接子層：「下载应用」等按鈕包在子層 wrapper 內，標題列之外的 role="button" 也不在範圍內；不依賴 inline style（例如 min-width），樣式數值變動不影響解析。
     * @param {Element} container
     * @returns {{ el: Element|null, path: 'semantic'|'none' }}
     */
    function resolveNewChatButtonEl(container) {
        var titleRow = container.querySelector(TITLE_ROW_SELECTOR);
        if (!titleRow) return { el: null, path: 'none' };

        var buttonEl = findLastDirectChild(titleRow, selectors.ROLE_BUTTON_DIV_SELECTOR);
        if (buttonEl) return { el: buttonEl, path: 'semantic' };
        return { el: null, path: 'none' };
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    // 瀏覽器 classic script 環境：掛至全域命名空間
    root.__DS_PresetOverlayResolvers = { resolveTitleEl, resolveNewChatButtonEl };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { resolveTitleEl, resolveNewChatButtonEl };
    }

})(globalThis);
