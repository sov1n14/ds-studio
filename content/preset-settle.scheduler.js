/**
 * DS Studio — PresetDropdown 收斂排程模組
 * 純排程邏輯：管理 settle loop 的 timing/control，不讀取 DOM。
 * 所有 DOM 測量與定位操作由回呼注入（measure/apply）。
 * 此檔案以 classic script 載入，無 ES import/export。
 * 載入順序：無依賴；由 controller 或其他排程需求端引用。
 */

(function (root) {
    'use strict';

    /**
     * 執行收斂迴圈，重複 apply → measure → compare 直到穩定或超時。
     *
     * @param {Object} opts
     * @param {() => number|null} opts.measure         - 回傳當前 key metric（buttonRect.left）。
     *                                                   元素無法解析時回傳 null。
     * @param {(reason: string) => void} opts.apply    - 每幀重新套用 reposition。
     *                                                   接收 reason 字串（如 'settle:frame-3'）。
     * @param {(fn: () => void) => void} opts.schedule - 注入的幀排程器（rAF 或 sync）。
     *                                                   確保環境/測試一致性。
     * @param {number} opts.maxFrames                 - 硬上限幀數。安全閥，防止無限迴圈。
     * @param {number} opts.stableK                   - 收斂所需連續穩定幀數。
     * @param {number} opts.epsilon                   - 相等判定容差（px），吸收子像素抖動。
     * @param {(result: {reason:string, frames:number, elapsedMs:number, finalMetric:number|null}) => void} [opts.onDone]
     *                                                   收斂結束回呼（選擇性）。接收結果摘要。
     * @returns {{ cancel: () => void }}
     */
    function runSettle(opts) {
        // ── Guard Clauses ──────────────────────────────────────────────────
        if (!opts) throw new Error('runSettle: opts is required');
        if (typeof opts.measure !== 'function') {
            throw new Error('runSettle: opts.measure must be a function');
        }
        if (typeof opts.apply !== 'function') {
            throw new Error('runSettle: opts.apply must be a function');
        }
        if (typeof opts.schedule !== 'function') {
            throw new Error('runSettle: opts.schedule must be a function');
        }
        if (typeof opts.maxFrames !== 'number') {
            throw new Error('runSettle: opts.maxFrames must be a number');
        }
        if (typeof opts.stableK !== 'number') {
            throw new Error('runSettle: opts.stableK must be a number');
        }
        if (typeof opts.epsilon !== 'number') {
            throw new Error('runSettle: opts.epsilon must be a number');
        }
        // onDone 是選擇性的 — 不需要 guard clause

        // ── 內部狀態 ────────────────────────────────────────────────────────
        var _cancelled  = false;
        var frame       = 0;
        var prevMetric  = null;
        var stableCount = 0;
        var startTime   = Date.now();

        // ── 結束回呼辅助 ──────────────────────────────────────────────────────
        function emitDone(reason, frames, finalMetric) {
            if (opts.onDone) {
                opts.onDone({
                    reason:      reason,
                    frames:      frames,
                    elapsedMs:   Date.now() - startTime,
                    finalMetric: finalMetric
                });
            }
        }

        // ── 單幀回呼 ─────────────────────────────────────────────────────────
        function runFrame() {
            if (_cancelled) return;

            // Step 1: 重新套用 reposition（先套用再量測，確保量到最新渲染狀態）
            opts.apply('settle:frame-' + frame);

            // Step 2: 量測當前 key metric
            var currentMetric = opts.measure();

            // Step 3: 處理 null metric
            if (currentMetric === null) {
                if (prevMetric !== null) {
                    // 之前有非 null 值但現在消失 → 元素在 settle 過程中被移除 DOM
                    emitDone('detached', frame + 1, currentMetric);
                    return;
                }

                // 首幀（或連續 null）尚未就緒 → 繼續等待，不中斷迴圈
                prevMetric = null;
                frame++;

                if (frame >= opts.maxFrames) {
                    emitDone('maxFrames', frame, currentMetric);
                    return;
                }

                opts.schedule(runFrame);
                return;
            }

            // Step 4-5: 比較 metric 並更新 prevMetric
            var oldPrevMetric = prevMetric;
            var delta         = null;

            if (oldPrevMetric !== null) {
                delta = currentMetric - oldPrevMetric;

                if (Math.abs(delta) <= opts.epsilon) {
                    stableCount++;
                } else {
                    stableCount = 0;
                }
            }

            prevMetric = currentMetric;

            // Step 6: 停止條件檢查
            if (stableCount >= opts.stableK) {
                emitDone('converged', frame + 1, currentMetric);
                return;
            }

            frame++;

            if (frame >= opts.maxFrames) {
                emitDone('maxFrames', frame, currentMetric);
                return;
            }

            // Step 7: 排程下一幀
            opts.schedule(runFrame);
        }

        // ── 啟動首幀 ─────────────────────────────────────────────────────────
        opts.schedule(runFrame);

        return {
            cancel: function () {
                _cancelled = true;
            }
        };
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    // 瀏覽器 classic script 環境：掛載至全域命名空間
    root.__DS_PresetSettle = { runSettle };

    // Node.js / Vitest 測試環境
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { runSettle };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
