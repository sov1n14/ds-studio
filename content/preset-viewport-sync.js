/**
 * DS Studio — PresetOverlay 視窗同步模組
 * 純視窗同步邏輯：ResizeObserver 設定、window resize 監聽器（含 rAF 節流）、
 * settle loop 的啟動包裝。不持有任何模組層級可變狀態，也不回頭存取
 * controller 內部欄位 —— 所有必要參照（元素、callback）皆以參數傳入。
 *
 * 依賴：preset-settle.scheduler.js（__DS_PresetSettle.runSettle）。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

(function (root) {
    'use strict';

    // ── 依賴解析（瀏覽器：全域命名空間；Node.js/Vitest：require） ────────────

    var __settleModule = (globalThis).__DS_PresetSettle ||
        (typeof require !== 'undefined' ? require('./preset-settle.scheduler.js') : {});

    var runSettle = __settleModule.runSettle;

    // ── ResizeObserver ───────────────────────────────────────────────────────

    /**
     * 建立 ResizeObserver 觀察 targetEl，容器尺寸變動時以 rAF 節流呼叫 onResize。
     * Feature-detect ResizeObserver：jsdom 等環境可能未實作，無則回傳 null（no-op）。
     * @param {Element}  targetEl              要觀察的容器元素
     * @param {Function} onResize              尺寸變動且通過節流後呼叫
     * @param {Function} scheduleFrame         幀排程器（rAF 或同步 fallback）
     * @param {Function} isExtensionContextValid 回傳 boolean，context 失效時 disconnect
     * @returns {ResizeObserver|null}
     */
    function setupResizeObserver(targetEl, onResize, scheduleFrame, isExtensionContextValid) {
        if (typeof ResizeObserver === 'undefined') return null;
        if (!targetEl) return null;
        if (typeof onResize !== 'function') throw new Error('setupResizeObserver: onResize must be a function');
        if (typeof scheduleFrame !== 'function') throw new Error('setupResizeObserver: scheduleFrame must be a function');
        if (typeof isExtensionContextValid !== 'function') throw new Error('setupResizeObserver: isExtensionContextValid must be a function');

        var isRafPending = false;
        var observer = new ResizeObserver(function () {
            // context 失效 → 停止觀察
            if (!isExtensionContextValid()) {
                observer.disconnect();
                return;
            }
            // rAF 節流：多次 callback 合併為單次 onResize
            if (isRafPending) return;
            isRafPending = true;
            scheduleFrame(function () {
                isRafPending = false;
                onResize();
            });
        });

        observer.observe(targetEl);
        return observer;
    }

    // ── Window resize 監聽器 ─────────────────────────────────────────────────

    /**
     * 建立 window 'resize' 監聽器，以 rAF 節流呼叫 onResize。
     * 呼叫端負責在需要時以回傳的 handler 呼叫 window.removeEventListener 移除。
     * @param {Function} onResize      resize 且通過節流後呼叫
     * @param {Function} scheduleFrame 幀排程器（rAF 或同步 fallback）
     * @returns {Function|null} 已註冊的 handler（供 removeEventListener 使用），無 window 時回傳 null
     */
    function setupWindowResizeListener(onResize, scheduleFrame) {
        if (typeof window === 'undefined') return null;
        if (typeof onResize !== 'function') throw new Error('setupWindowResizeListener: onResize must be a function');
        if (typeof scheduleFrame !== 'function') throw new Error('setupWindowResizeListener: scheduleFrame must be a function');

        var isRafPending = false;
        var handler = function () {
            if (isRafPending) return;
            isRafPending = true;
            scheduleFrame(function () {
                isRafPending = false;
                onResize();
            });
        };
        window.addEventListener('resize', handler);
        return handler;
    }

    // ── Settlement 自動穩定 ──────────────────────────────────────────────────

    /**
     * 啟動 settlement loop：持續量測 measure() 直到穩定，每幀呼叫 apply()。
     * 固定收斂參數：約 1 秒（60 幀）上限，連續 4 幀穩定即收斂。
     * 收斂後的版面變動由 ResizeObserver 與 window resize 監聽器接手。
     * @param {Function} measure       回傳當前 key metric（px），無法解析時回傳 null
     * @param {Function} apply         每幀重新套用 reposition
     * @param {Function} scheduleFrame 幀排程器（rAF 或同步 fallback）
     * @returns {{cancel: () => void}|null} runSettle 不可用時回傳 null
     */
    function startSettle(measure, apply, scheduleFrame) {
        if (!runSettle) return null;
        if (typeof measure !== 'function') throw new Error('startSettle: measure must be a function');
        if (typeof apply !== 'function') throw new Error('startSettle: apply must be a function');
        if (typeof scheduleFrame !== 'function') throw new Error('startSettle: scheduleFrame must be a function');

        return runSettle({
            measure: measure,
            apply: apply,
            schedule: scheduleFrame,
            maxFrames: 60,
            stableK: 4,
            epsilon: 1,
            onDone: undefined
        });
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    // 瀏覽器 classic script 環境：掛至全域命名空間
    root.__DS_PresetViewportSync = { setupResizeObserver, setupWindowResizeListener, startSettle };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { setupResizeObserver, setupWindowResizeListener, startSettle };
    }

})(globalThis);
