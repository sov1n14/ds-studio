/**
 * DS studio — 擴充情境失效監視器（content/invalidation-watcher.js）
 * 單一職責：定期檢查擴充情境是否仍有效，失效時顯示 toast 並停止輪詢。
 * 無載入期副作用：由呼叫端於初始化後 start()。
 */
(function (root) {
    'use strict';

    /** 建立失效監視器實例。 */
    function create({ isValid, showToast, interval = 30000 }) {
        let intervalId = null;
        // 已觸發 toast 旗標，防止重複通知
        let hasFired = false;

        function tick() {
            if (hasFired) return;
            if (!isValid()) {
                hasFired = true;
                showToast();
                stop();
            }
        }

        /** 啟動定期檢查；冪等，重複呼叫不疊加計時器。 */
        function start() {
            if (intervalId !== null) return;
            intervalId = setInterval(tick, interval);
        }

        /** 停止輪詢；未執行中呼叫亦安全。 */
        function stop() {
            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
            }
        }

        return { start, stop };
    }

    root.DSSInvalidationWatcher = { create };

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = root.DSSInvalidationWatcher;
})(typeof globalThis !== 'undefined' ? globalThis : this);
