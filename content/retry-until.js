/**
 * DS studio — 輪詢就緒共用工具（content/retry-until.js）
 *
 * 單一職責：以固定間隔重試判定式，直到取得真值或重試次數用盡。
 * 立即執行第一次判定，之後每 intervalMs 重試，總嘗試次數為 1 + maxRetries。
 * 終止（就緒、放棄、取消）後不留下任何計時器。
 * 無載入期副作用：載入僅完成 globalThis 指派。
 */
(function () {
    'use strict';

    /**
     * @param {Function} predicate 回傳真值代表就緒，該真值會傳給 onReady
     * @param {{intervalMs: number, maxRetries: number, onReady?: Function, onGiveUp?: Function}} options
     * @returns {Function} 取消函式（可重複呼叫；取消後兩個回呼皆不再觸發）
     */
    function retryUntil(predicate, options) {
        if (typeof predicate !== 'function') throw new Error('retryUntil 需要 predicate 函式');
        if (!options || typeof options !== 'object') throw new Error('retryUntil 需要 options 物件');

        const { intervalMs, maxRetries, onReady, onGiveUp } = options;
        let timerId = null;
        let isDone = false;
        let retriesLeft = maxRetries;

        function stop() {
            isDone = true;
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
            }
        }

        function attempt() {
            if (isDone) return;
            timerId = null;

            const result = predicate();
            if (result) {
                stop();
                if (typeof onReady === 'function') onReady(result);
                return;
            }

            if (retriesLeft <= 0) {
                stop();
                if (typeof onGiveUp === 'function') onGiveUp();
                return;
            }

            retriesLeft -= 1;
            timerId = setTimeout(attempt, intervalMs);
        }

        attempt();
        return stop;
    }

    globalThis.DSSRetryUntil = retryUntil;

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = retryUntil;
})();
