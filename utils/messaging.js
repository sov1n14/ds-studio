/**
 * DS studio — Messaging Utilities
 * 提供跨頁面可重用的訊息傳遞輔助函式。
 * 以傳統 classic script 方式載入，同時支援 Node.js 模組環境（供單元測試使用）。
 *
 * 注意：本檔案的分頁廣播函式依賴 chrome.tabs，僅能在 popup 或其他擴充功能頁面
 * （含 background service worker）的環境中呼叫；content script 無法取用 chrome.tabs。
 */

/**
 * 將目前啟用的預設提示詞廣播至所有 DeepSeek 分頁的 content script。
 * 對每個分頁併發傳送，單一分頁失敗只吞掉該筆錯誤，不影響其他分頁與呼叫端。
 *
 * @param {string} presetId      - 目前啟用的預設 ID
 * @param {string} presetContent - 預設提示詞內容
 * @returns {Promise<void>}
 */
async function broadcastActivePreset(presetId, presetContent) {
    // 查詢所有 DeepSeek 分頁；查詢失敗則視為無分頁並靜默結束
    const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' }).catch(() => []);

    const message = {
        action: 'ACTIVE_PRESET_CHANGED',
        presetId,
        presetContent,
    };

    // 併發送出；無 id 的分頁跳過，個別分頁的拒絕各自吞掉
    await Promise.all(
        tabs
            .filter((tab) => tab?.id !== undefined)
            .map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})),
    );
}

// 掛載至全域供 classic script 環境（popup、editor）呼叫；沒有 window 時退回 globalThis
(typeof window !== 'undefined' ? window : globalThis).DSVMessaging = { broadcastActivePreset };

// 匯出供 Node.js 單元測試環境使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { broadcastActivePreset };
}
