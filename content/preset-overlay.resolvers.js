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

    // ── Selector / Hash 常數（僅限解析器使用） ───────────────────────────────

    // DeepSeek 建置產出的 hash class；隨版本可能改名，語意路徑為主要解析路徑，hash 僅作後備。
    var HEADER_WRAPPER_HASH  = '._1aa2651';   // 容器內的標題列 wrapper div
    var TITLE_HASH_FALLBACK  = '._9986c0c';   // 聊天標題節點（hash 後備）

    // ── DOM 解析器：title ────────────────────────────────────────────────────

    /**
     * 在 container（._2be88ba）內解析聊天標題元素。
     * 語意主路徑：header wrapper 內第一個非 role="button" 的子元素（即標題 div）。
     * hash 後備：._9986c0c。
     * @param {Element} container
     * @returns {{ el: Element|null, path: 'semantic'|'hash-fallback'|'none' }}
     */
    function resolveTitleEl(container) {
        var wrapper = container.querySelector(HEADER_WRAPPER_HASH);
        if (wrapper) {
            // 語意路徑：標題是 wrapper 直接子元素中，第一個非按鈕的 div
            var children = wrapper.children;
            for (var i = 0; i < children.length; i++) {
                if (children[i].getAttribute('role') !== 'button') {
                    return { el: children[i], path: 'semantic' };
                }
            }
        }
        // hash 後備路徑
        var hashEl = container.querySelector(TITLE_HASH_FALLBACK);
        if (hashEl) return { el: hashEl, path: 'hash-fallback' };
        return { el: null, path: 'none' };
    }

    // ── DOM 解析器：new-chat button ──────────────────────────────────────────

    /**
     * 在 container（._2be88ba）內解析「新建對話」按鈕元素。
     * 語意主路徑：header wrapper 內，帶有 style*="min-width: 44px" 的 role="button" div；
     *            若無則取標題之後的第一個 role="button" div（即 new-chat 按鈕在標題右側）。
     * 後備路徑：wrapper 內最後一個 role="button" div。
     * 刻意不使用已確認錯誤的 ._57370c5（位於 wrapper 外部）。
     * @param {Element} container
     * @returns {{ el: Element|null, path: 'semantic'|'structural-fallback'|'none' }}
     */
    function resolveNewChatButtonEl(container) {
        var wrapper = container.querySelector(HEADER_WRAPPER_HASH);
        if (!wrapper) return { el: null, path: 'none' };

        var roleButtons = wrapper.querySelectorAll('div[role="button"]');

        // 語意主路徑：帶 inline min-width: 44px 的按鈕為 new-chat 按鈕
        for (var j = 0; j < roleButtons.length; j++) {
            var styleAttr = roleButtons[j].getAttribute('style') || '';
            if (styleAttr.indexOf('min-width: 44px') !== -1) {
                return { el: roleButtons[j], path: 'semantic' };
            }
        }

        // 結構後備路徑：取標題之後出現的第一個 role="button"（即 new-chat 按鈕）
        var titleResult = resolveTitleEl(container);
        if (titleResult.el) {
            var titleEl = titleResult.el;
            for (var k = 0; k < roleButtons.length; k++) {
                // compareDocumentPosition bit 4 = 前者在後者之後
                if (titleEl.compareDocumentPosition(roleButtons[k]) & Node.DOCUMENT_POSITION_FOLLOWING) {
                    return { el: roleButtons[k], path: 'structural-fallback' };
                }
            }
        }

        // 最終後備：wrapper 內最後一個 role="button"
        if (roleButtons.length > 0) {
            return { el: roleButtons[roleButtons.length - 1], path: 'structural-fallback' };
        }

        return { el: null, path: 'none' };
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    // 瀏覽器 classic script 環境：掛至全域命名空間
    root.__DS_PresetOverlayResolvers = { resolveTitleEl, resolveNewChatButtonEl };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { resolveTitleEl, resolveNewChatButtonEl };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
