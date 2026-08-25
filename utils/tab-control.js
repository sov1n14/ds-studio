/**
 * DS studio — 分頁控制共用工具（utils/tab-control.js）
 *
 * 單一職責：把 chrome.tabs 的查詢與訊息傳送包成不會向呼叫端拋錯的 popup 介面。
 * popup 層依規範不得直接呼叫 chrome.*，一律經由本模組。
 * 無載入期副作用：載入僅完成全域指派。
 */

/** DeepSeek 分頁的 URL 比對樣式（條件下推給 chrome.tabs.query，不在 JS 端過濾）。 */
const DEEPSEEK_TAB_URL = '*://chat.deepseek.com/*';

/** 目前視窗中作用中的 DeepSeek 分頁查詢條件。 */
const ACTIVE_DEEPSEEK_TAB_QUERY = {
    active: true,
    currentWindow: true,
    url: DEEPSEEK_TAB_URL,
};

/**
 * 查詢目前視窗中作用中的 DeepSeek 分頁。
 * @returns {Promise<Object|null>} 第一個符合的分頁；沒有符合或查詢失敗時為 null
 */
async function queryActiveDeepseekTab() {
    try {
        const tabs = await chrome.tabs.query(ACTIVE_DEEPSEEK_TAB_QUERY);
        return tabs?.[0] ?? null;
    } catch (err) {
        console.error('[DSS] tab-control.queryActiveDeepseekTab:', err);
        return null;
    }
}

/**
 * 查詢所有 DeepSeek 分頁（跨視窗），供需要廣播的呼叫端使用。
 * @returns {Promise<Object[]>} 符合的分頁陣列；查詢失敗時為空陣列
 */
async function queryDeepseekTabs() {
    try {
        const tabs = await chrome.tabs.query({ url: DEEPSEEK_TAB_URL });
        return tabs ?? [];
    } catch (err) {
        console.error('[DSS] tab-control.queryDeepseekTabs:', err);
        return [];
    }
}

/**
 * 傳送訊息給指定分頁的內容腳本。
 * @param {number} tabId - 目標分頁 ID
 * @param {Object} message - 訊息內容
 * @returns {Promise<*>} 內容腳本的回應；傳送失敗時為 undefined
 */
async function sendToTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
        console.error('[DSS] tab-control.sendToTab:', err);
        return undefined;
    }
}

/**
 * 將目前啟用的預設提示詞廣播至所有 DeepSeek 分頁的 content script。
 * 併發送出（建立於 queryDeepseekTabs / sendToTab 之上）；無 id 的分頁跳過，
 * 個別分頁失敗由 sendToTab 各自吞掉，不影響其他分頁與呼叫端。
 *
 * @param {string} presetId      - 目前啟用的預設 ID
 * @param {string} presetContent - 預設提示詞內容
 * @returns {Promise<void>}
 */
async function broadcastActivePreset(presetId, presetContent) {
    const tabs = await queryDeepseekTabs();
    const message = { action: 'ACTIVE_PRESET_CHANGED', presetId, presetContent };
    await Promise.all(
        tabs
            .filter((tab) => tab?.id !== undefined)
            .map((tab) => sendToTab(tab.id, message)),
    );
}

globalThis.DSSTabControl = { queryActiveDeepseekTab, queryDeepseekTabs, sendToTab, broadcastActivePreset };

// 匯出供 Node.js 單元測試環境使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { queryActiveDeepseekTab, queryDeepseekTabs, sendToTab, broadcastActivePreset };
}
