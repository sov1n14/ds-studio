/**
 * DS studio — 視窗控制共用工具（utils/window-control.js）
 *
 * 單一職責：以 chrome.storage.session 保存視窗 ID，維持「同一 storageKey 只有一個視窗」
 * 的真正單例（決策 D5）。視窗 ID 存在 popup 閉包之外，popup 關閉後再次點擊仍能聚焦既有視窗；
 * 目標 URL 不同時直接導向新 URL，避免顯示前一組內容。
 * 無載入期副作用：載入僅完成全域指派。
 */

/**
 * 讀取已保存的視窗 ID。
 * @param {string} storageKey - session 儲存鍵
 * @returns {Promise<number|null>} 保存的視窗 ID；無紀錄或讀取失敗時為 null
 */
async function readStoredWindowId(storageKey) {
    try {
        const stored = await chrome.storage.session.get(storageKey);
        const windowId = stored?.[storageKey];
        return typeof windowId === 'number' ? windowId : null;
    } catch (err) {
        // 讀取失敗時以「可用性優先於去重」處理：照常開新視窗
        console.error('[DSS] window-control.readStoredWindowId:', err);
        return null;
    }
}

/**
 * 保存視窗 ID。
 * @param {string} storageKey - session 儲存鍵
 * @param {number} windowId - 視窗 ID
 */
async function persistWindowId(storageKey, windowId) {
    try {
        await chrome.storage.session.set({ [storageKey]: windowId });
    } catch (err) {
        console.error('[DSS] window-control.persistWindowId:', err);
    }
}

/**
 * 聚焦既有視窗，並在目前 URL 與請求不符時導向新 URL。
 * @param {number} windowId - 已保存的視窗 ID
 * @param {string} url - 請求的 URL
 * @returns {Promise<Object|null>} 既有視窗物件；視窗已關閉時為 null
 */
async function focusExistingWindow(windowId, url) {
    let existingWindow;
    try {
        existingWindow = await chrome.windows.get(windowId, { populate: true });
        await chrome.windows.update(windowId, { focused: true });
    } catch {
        // 視窗已關閉：交由呼叫端重新建立
        return null;
    }

    try {
        const tab = existingWindow?.tabs?.[0];
        if (tab && typeof tab.id === 'number' && tab.url !== url) {
            await chrome.tabs.update(tab.id, { url });
        }
    } catch (err) {
        // 視窗可能並行關閉；已聚焦的結果仍然有效
        console.error('[DSS] window-control.focusExistingWindow:', err);
    }

    return existingWindow;
}

/**
 * 開啟（或聚焦）單例視窗。
 * @param {Object} options
 * @param {string} options.url - 視窗要載入的 URL
 * @param {Object} [options.createOptions] - 傳給 chrome.windows.create 的額外選項
 * @param {string} options.storageKey - 保存視窗 ID 的 session 儲存鍵
 * @returns {Promise<{window: Object, created: boolean}>} 視窗物件與是否為新建
 */
async function openSingletonWindow({ url, createOptions, storageKey } = {}) {
    if (!url) throw new Error('[DSS] openSingletonWindow: url is required');
    if (!storageKey) throw new Error('[DSS] openSingletonWindow: storageKey is required');

    const storedWindowId = await readStoredWindowId(storageKey);
    if (storedWindowId !== null) {
        const existingWindow = await focusExistingWindow(storedWindowId, url);
        if (existingWindow) return { window: existingWindow, created: false };
    }

    const createdWindow = await chrome.windows.create({ url, ...createOptions });
    if (typeof createdWindow?.id === 'number') {
        await persistWindowId(storageKey, createdWindow.id);
    }
    return { window: createdWindow, created: true };
}

/**
 * 解析擴充功能內資源的絕對 URL。
 * popup 層不可直接呼叫 chrome.*，需透過本模組取得資源 URL，維持 utils/ 為唯一 API 邊界。
 * @param {string} resourcePath - 相對於擴充功能根目錄的資源路徑
 * @returns {string} 該資源的 chrome-extension:// 絕對 URL
 */
function getExtensionUrl(resourcePath) {
    if (!resourcePath) throw new Error('[DSS] getExtensionUrl: resourcePath is required');
    return chrome.runtime.getURL(resourcePath);
}

globalThis.DSSWindowControl = { openSingletonWindow, getExtensionUrl };

// 匯出供 Node.js 單元測試環境使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { openSingletonWindow, getExtensionUrl };
}
