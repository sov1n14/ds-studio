/**
 * DS studio — Temporary Chat 心跳續約（content/temporary-chat-heartbeat.js）
 * 單一職責：當某臨時對話正被本分頁追蹤時，定期向 background 發送心跳，
 * 為該對話的待刪佇列 lease 續約，避免其他裝置在 TTL 過期後誤刪使用中的對話。
 * 無載入期副作用：由生命週期呼叫端於追蹤開始時 start()、追蹤結束時 stop()。
 * content 層不直接觸碰 chrome.storage，一律透過 DSS_MSG_HEARTBEAT 訊息路由。
 */
(function (root) {
    'use strict';

    // 執行期心跳狀態（僅存活於本分頁生命期，無需跨刷新保存）
    let intervalId = null;
    let currentUuid = null;

    /** 發送單次心跳；fire-and-forget，情境已卸載時吞掉錯誤僅記錄警告，絕不拋入計時器。 */
    function sendHeartbeat(chatUuid) {
        const type = globalThis.DSS_MSG_HEARTBEAT;
        try {
            Promise.resolve(chrome.runtime.sendMessage({ type, uuid: chatUuid }))
                .catch((err) => console.warn('[DSS] temporary-chat-heartbeat send:', err));
        } catch (err) {
            console.warn('[DSS] temporary-chat-heartbeat send:', err);
        }
    }

    /**
     * 開始為指定 UUID 定期續約 lease。
     * 已對同一 UUID 執行中則不重複疊加計時器；換成不同 UUID 則取代現有計時器。
     * 立即發送一次心跳，使 lease 無須等待整個間隔即獲續約。
     * @param {string} chatUuid
     */
    function start(chatUuid) {
        if (!chatUuid) return;
        if (intervalId !== null && currentUuid === chatUuid) return;

        stop();
        currentUuid = chatUuid;
        sendHeartbeat(chatUuid);

        const intervalMs = globalThis.HEARTBEAT_INTERVAL_MS;
        intervalId = setInterval(() => sendHeartbeat(currentUuid), intervalMs);
    }

    /** 停止心跳並忘記當前 UUID；未執行中時呼叫亦安全。 */
    function stop() {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
        currentUuid = null;
    }

    root.TemporaryChatHeartbeat = { start, stop };

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = root.TemporaryChatHeartbeat;
})(globalThis);
