/**
 * DS Studio — PresetDropdown 自然寬度量測模組
 * 量測觸發器 label 於各候選文字下的實際像素寬度，並提供每個下拉選單實例
 * 專屬（非模組層共享）的快取，避免逐次量測造成的版面 reflow 效能問題。
 * 此檔案以 classic script 載入，無 ES import/export，須在
 * preset-dropdown.component.js 之前載入。
 * 依賴 preset-dropdown.position.js 的 pickNaturalWidth()。
 */

(function (root) {
    'use strict';

    const PresetPosition = root.__DS_PresetPosition ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.position.js') : undefined);

    /**
     * 建立一個自然寬度量測器（每個下拉選單實例各自持有一份快取，非模組層共享）。
     *
     * @param {Object}      deps
     * @param {HTMLElement} deps.label   - 用於暫時寫入候選文字以量測寬度的 label 元素
     * @param {HTMLElement} deps.trigger - 觸發器元素（讀取其 computed padding / gap）
     * @returns {{ measure: (optionData: Array<{name:string}>, placeholderText: string) => number, invalidate: () => void }}
     */
    function createWidthMeasurer(deps) {
        if (!deps) throw new Error('createWidthMeasurer: deps is required');
        if (!deps.label)   throw new Error('createWidthMeasurer: deps.label is required');
        if (!deps.trigger) throw new Error('createWidthMeasurer: deps.trigger is required');

        const label   = deps.label;
        const trigger = deps.trigger;

        // 每個實例專屬的快取（非模組層共享的可變狀態）
        let cachedNaturalWidth = null;

        /**
         * 量測所有候選標籤（每個選項名稱 + 佔位文字）中最寬者的實際像素寬度。
         * 結果會快取；僅在呼叫 invalidate() 後才會重新量測
         * （呼叫端須在 optionData 或 placeholderText 改變時呼叫 invalidate()）。
         *
         * @param {Array<{name:string}>} optionData      - 目前選項資料
         * @param {string}               placeholderText - 目前佔位文字
         * @returns {number} 觸發器所需最小完整寬度（px）
         */
        function measure(optionData, placeholderText) {
            if (cachedNaturalWidth !== null) return cachedNaturalWidth;

            const safeOptionData = Array.isArray(optionData) ? optionData : [];

            // 候選標籤 = 所有選項名稱 + 佔位文字（佔位文字是未選取時實際顯示的內容）
            const candidateTexts = safeOptionData.map(o => o.name).concat([placeholderText]);

            const originalText = label.textContent;
            const labelWidths = [];
            try {
                for (let i = 0; i < candidateTexts.length; i++) {
                    label.textContent = candidateTexts[i];
                    labelWidths.push(label.scrollWidth);
                }
            } finally {
                label.textContent = originalText;
            }

            // 箭頭寬度使用穩定常數，避免 getBoundingClientRect 受當前 inline width 約束影響，
            // 確保連續兩次呼叫對相同標籤文字回傳完全相同的值（冪等性保證）
            const arrowWidth = 16;

            // 讀取觸發器水平 padding（在 jsdom 中為 0，不影響邏輯正確性）
            const computed     = window.getComputedStyle(trigger);
            const paddingLeft  = parseFloat(computed.paddingLeft)  || 0;
            const paddingRight = parseFloat(computed.paddingRight) || 0;
            const gap          = parseFloat(computed.gap)          || 4;

            cachedNaturalWidth = PresetPosition.pickNaturalWidth({
                labelWidths:  labelWidths,
                arrowWidth:   arrowWidth,
                paddingLeft:  paddingLeft,
                paddingRight: paddingRight,
                gap:          gap
            });

            return cachedNaturalWidth;
        }

        /** 清空快取（optionData 或 placeholderText 改變時呼叫） */
        function invalidate() {
            cachedNaturalWidth = null;
        }

        return { measure, invalidate };
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    root.__DS_PresetWidth = { createWidthMeasurer };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createWidthMeasurer };
    }

})(globalThis);
