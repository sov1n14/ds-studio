/**
 * DS studio — Messaging Utilities
 * 提供跨頁面可重用的訊息傳遞輔助函式。
 * 以傳統 classic script 方式載入，同時支援 Node.js 模組環境（供單元測試使用）。
 */

/**
 * 將目前啟用的預設提示詞廣播至當前分頁的 content script。
 * 只對符合 DeepSeek 網址的分頁傳送訊息，錯誤靜默吞掉以免影響呼叫端。
 *
 * @param {string} presetId      - 目前啟用的預設 ID
 * @param {string} presetContent - 預設提示詞內容
 * @returns {Promise<void>}
 */
async function broadcastActivePreset(presetId, presetContent) {
    // 取得目前作用中分頁；若查詢失敗則靜默結束
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const tab = tabs[0];

    // 未找到分頁或非 DeepSeek 網址則略過
    if (!tab?.id) return;
    const isDeepSeekTab = tab.url && tab.url.includes('chat.deepseek.com');
    if (!isDeepSeekTab) return;

    await chrome.tabs.sendMessage(tab.id, {
        action: 'ACTIVE_PRESET_CHANGED',
        presetId,
        presetContent,
    }).catch(() => {});
}

// 掛載至全域供 classic script 環境（popup、editor）呼叫
window.DSVMessaging = { broadcastActivePreset };

// 匯出供 Node.js 單元測試環境使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { broadcastActivePreset };
}
