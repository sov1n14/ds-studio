/**
 * DS studio — Harvest :: Toast Bundle
 * 擷取進度遮罩 UI（顯示/更新/隱藏）。由 harvest.js 合入使用。
 * 純函式集合，不持有跨函式共享狀態，因此不採用 this-based 方法合併，
 * 直接以具名函式匯出（與 prevent-auto-scroll-bridge.js 同一慣例）。
 */
(function (root) {
    'use strict';

    /**
     * 確保 Toast 容器存在並回傳它（若不存在則建立）。
     * 建立時同時產生 __text 與 __warn 兩個子元素。
     * @returns {Element} Toast 根節點
     */
    function _ensureHarvestToast() {
        let toast = document.querySelector('.dss-harvest-toast');
        if (toast) return toast;

        toast = document.createElement('div');
        toast.className = 'dss-harvest-toast';

        // 第一行：主要進度文字
        const text = document.createElement('p');
        text.className = 'dss-harvest-toast__text';
        toast.appendChild(text);

        // 第二行：操作警示（擷取階段才顯示）
        const warn = document.createElement('p');
        warn.className = 'dss-harvest-toast__warn';
        toast.appendChild(warn);

        document.body.appendChild(toast);
        return toast;
    }

    /**
     * 【捲動至頂部階段】顯示 Toast，文字為「正在捲動至對話頂端…」，不顯示數量。
     * 警示行保持隱藏，避免使用者在尚未開始擷取時看到不相干警告。
     */
    function showHarvestToastScrolling() {
        const toast = _ensureHarvestToast();

        const text = toast.querySelector('.dss-harvest-toast__text');
        if (text) {
            text.textContent = dsI18n.t('harvestScrollingToast');
        }

        // 捲動階段不顯示警示行
        const warn = toast.querySelector('.dss-harvest-toast__warn');
        if (warn) {
            warn.style.display = 'none';
        }

        toast.style.display = 'block';
    }

    /**
     * 【擷取階段】切換至擷取狀態並更新已擷取數量，同時顯示操作警示。
     * 在向下掃描的每一步呼叫，N 隨實際擷取數量即時更新。
     * @param {number} capturedCount - 已擷取訊息數
     */
    function showHarvestToastCapturing(capturedCount) {
        if (typeof capturedCount !== 'number') return;

        const toast = _ensureHarvestToast();

        // 第一行：進度數量
        const text = toast.querySelector('.dss-harvest-toast__text');
        if (text) {
            text.textContent = dsI18n.t('harvestCapturingToast', { count: capturedCount });
        }

        // 第二行：警示——整個擷取階段持續可見
        const warn = toast.querySelector('.dss-harvest-toast__warn');
        if (warn) {
            warn.textContent = dsI18n.t('harvestWarning');
            warn.style.display = '';
        }

        toast.style.display = 'block';
    }

    /**
     * 隱藏 Toast（擷取結束時呼叫，finally 區塊保證執行）。
     */
    function hideHarvestToast() {
        const toast = document.querySelector('.dss-harvest-toast');
        if (toast) {
            toast.style.display = 'none';
        }
    }

    const bundle = {
        showHarvestToastScrolling,
        showHarvestToastCapturing,
        hideHarvestToast,
    };

    // 掛載至全域（供 harvest.js 合入使用）；同時提供 CommonJS 匯出供 Node/vitest 測試環境使用
    root.__DS_Harvest_toast = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
