/**
 * DS studio — Editor Auto-save Bundle
 * 自動儲存控制器：集中管理 dirty flag、防抖計時器與進行中的儲存，讓 Esc 關閉與各備援觸發點共用同一條儲存管線而不重複寫入。
 */
(function (root) {
    'use strict';

    const noop = () => {};

    /**
     * 建立自動儲存控制器。
     * @param {{ save: () => Promise<unknown>, debounceMs: number }} options
     *   save：實際寫入函式；失敗時應 reject，控制器會重新標記 dirty 以便下次重試
     *   debounceMs：markDirty 後延遲觸發儲存的毫秒數
     * @returns {{ markDirty: () => void, flush: () => Promise<unknown>, hasPendingWork: () => boolean }}
     */
    function createAutosaveController({ save, debounceMs }) {
        if (typeof save !== 'function') throw new Error('createAutosaveController: save 必須是函式');
        if (!Number.isFinite(debounceMs) || debounceMs < 0) throw new Error('createAutosaveController: debounceMs 必須是非負數');
        if (typeof root.DSSDebounce !== 'function') throw new Error('createAutosaveController: 缺少 DSSDebounce，utils/debounce.js 必須先於 editor.autosave.js 載入');

        let isDirty = false;
        let inFlightSave = null;
        // 防抖世代：flush 遞增世代，使已排程但屬於舊世代的防抖觸發失效（共用防抖工具沒有 cancel）
        let debounceGeneration = 0;

        const scheduleDebouncedFlush = root.DSSDebounce((scheduledGeneration) => {
            if (scheduledGeneration !== debounceGeneration) return;
            // 防抖觸發的儲存錯誤由 save 自行呈現，這裡僅避免未處理的 rejection
            flush().catch(noop);
        }, debounceMs);

        function cancelPendingDebounce() {
            debounceGeneration += 1;
        }

        /** 啟動一次寫入；save 於微任務中執行，確保 inFlightSave 指派先於清除 */
        function startSave() {
            isDirty = false;
            const attempt = Promise.resolve()
                .then(save)
                .catch((err) => {
                    // 寫入失敗：保留未存狀態，下次 flush 或輸入時重試
                    isDirty = true;
                    throw err;
                })
                .finally(() => {
                    if (inFlightSave === attempt) inFlightSave = null;
                });
            inFlightSave = attempt;
            return attempt;
        }

        /** 標記內容已變更並重設防抖計時器 */
        function markDirty() {
            isDirty = true;
            scheduleDebouncedFlush(debounceGeneration);
        }

        /**
         * 立即寫入未存內容：取消防抖、等待進行中的儲存，再於仍 dirty 時寫入。
         * @returns {Promise<unknown>} 本次寫入的結果；沒有未存內容時 resolve 為 undefined
         */
        async function flush() {
            cancelPendingDebounce();
            // 逐一等待進行中的儲存，避免與其並行寫入（其結果由各自的呼叫端處理）
            while (inFlightSave) await inFlightSave.catch(noop);
            if (!isDirty) return undefined;
            return startSave();
        }

        /** 是否仍有未存內容或進行中的儲存（純查詢） */
        function hasPendingWork() {
            return isDirty || inFlightSave !== null;
        }

        return { markDirty, flush, hasPendingWork };
    }

    /**
     * 等待 promise 落定，最多等待 timeoutMs；逾時不會取消原 promise。
     * @param {Promise<unknown>} promise
     * @param {number} timeoutMs
     * @returns {Promise<{ status: 'fulfilled', value: unknown } | { status: 'rejected', reason: unknown } | { status: 'timeout' }>}
     */
    function settleWithin(promise, timeoutMs) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
            Promise.resolve(promise).then(
                (value) => { clearTimeout(timer); resolve({ status: 'fulfilled', value }); },
                (reason) => { clearTimeout(timer); resolve({ status: 'rejected', reason }); },
            );
        });
    }

    const bundle = { createAutosaveController, settleWithin };

    root.__DS_Editor_autosave = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
