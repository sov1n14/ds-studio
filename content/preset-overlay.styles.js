/**
 * DS Studio — PresetOverlay 樣式注入模組
 * 負責將定位相關的最小樣式集合動態注入 document.head，
 * 並於主開關關閉時移除。此為刻意保留於 JS 中的必要副作用：
 * 樣式需與 injectOverlayStyles()/removeOverlayStyles() 生命週期綁定，
 * 不可移至靜態 manifest CSS。
 *
 * 注入內容（僅定位相關）：
 *   1. ._2be88ba:not(._1551317) — 建立 containing block；跳過新對話頁。
 *   2. #dss-preset-overlay — absolute 基底 + 垂直置中；水平定位由 controller 以 inline style 覆寫。
 *
 * 此檔案以 classic script 載入，無 ES import/export。
 * 載入順序：preset-dropdown.position.js → preset-dropdown.component.js
 *           → preset-overlay.styles.js → preset-overlay.controller.js
 */

(function (root) {
    'use strict';

    /** 注入樣式的 <style> 元素 id */
    var STYLE_ID = 'dss-overlay-style';

    /**
     * 將 overlay 定位樣式注入 document.head（冪等：已存在則略過）。
     *
     * 注意：水平定位（left + translateX）不寫在此處；
     * 由 preset-overlay.controller.js 的 reposition() 依模式動態套用 inline style。
     * 垂直置中（top:50%; translateY(-50%)）固定於此。
     */
    function injectOverlayStyles() {
        // 冪等守衛：避免重複注入
        if (document.getElementById(STYLE_ID)) return;

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            /* 為 #dss-preset-overlay 建立 absolute 定位的 containing block；
               ._1551317 為新對話頁，刻意跳過以避免不必要掛載。 */
            '._2be88ba:not(._1551317){position:relative!important}',

            /* overlay 容器基底定位：脫離 flow（absolute）+ 垂直置中。
               水平定位（left / width）由 reposition() 依 computePlacement 結果寫入 inline style。 */
            '#dss-preset-overlay{position:absolute;top:50%;transform:translateY(-50%);z-index:1000;pointer-events:auto}'
        ].join('\n');

        document.head.appendChild(style);
    }

    /**
     * 移除先前注入的 overlay 定位樣式（若存在）。
     * 主開關關閉時呼叫，確保 containing block 的 position:relative 被清除。
     */
    function removeOverlayStyles() {
        var style = document.getElementById(STYLE_ID);
        style?.remove();
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    // 瀏覽器 classic script 環境：掛至全域命名空間
    root.__DS_PresetOverlayStyles = { injectOverlayStyles, removeOverlayStyles };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { injectOverlayStyles, removeOverlayStyles };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
