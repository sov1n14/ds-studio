/**
 * DS studio — 設定訊息路由與變更廣播（background/settings-routes.js）
 *
 * 職責：background 層的訊息路由。install() 於呼叫時（非載入時）註冊
 *   1. chrome.runtime.onMessage：DSS_GET_SETTINGS / DSS_SET_SETTINGS 的讀寫路由，
 *      未知型別回傳 false 且不回應，讓既有的其他 onMessage 監聽器仍能處理。
 *   2. chrome.storage.onChanged：受監看鍵變更時廣播 DSS_SETTINGS_CHANGED 給
 *      chat.deepseek.com 的所有分頁。
 *
 * 相依：utils/settings-message-constants.js、utils/storage-manager.js 需先載入。
 */
(function () {
    'use strict';

    // 前綴型受監看鍵：預設集與 chatPresetMap 分塊，local 與 sync 兩區皆需廣播
    const WATCHED_KEY_PREFIXES = ['dsPreset_', 'chatPresetMap_'];
    // 不屬於 StorageManager.KEYS 但仍需廣播的 local 鍵（同 utils/temporary-chat-constants.js）
    const EXTRA_WATCHED_LOCAL_KEYS = ['dss-temporary-chat-enabled'];

    /**
     * 於呼叫時解析 StorageManager（service worker 以頂層 const 提供、
     * 其他情境掛載於全域），缺失即拋出並指名修法。
     */
    function resolveStorageManager() {
        const manager = typeof StorageManager !== 'undefined' ? StorageManager : globalThis.StorageManager;
        if (!manager) throw new Error('[DSS] settings-routes 需要 utils/storage-manager.js 先行載入');
        return manager;
    }

    /** 於呼叫時解析訊息型別常數，缺失即拋出並指名修法。 */
    const resolveMessageTypes = () => DSS_SETTINGS_MSG;

    /** 判斷變更鍵是否受監看：前綴不分區；完整鍵僅 local 區。 */
    function isWatchedKey(key, area) {
        if (WATCHED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
        if (area !== 'local') return false;
        if (EXTRA_WATCHED_LOCAL_KEYS.includes(key)) return true;
        return Object.values(resolveStorageManager().KEYS).includes(key);
    }

    /**
     * 包裝 chrome.storage.local 讀取，同時支援 callback 與 promise 兩種慣例。
     * @param {string[]} keys
     * @returns {Promise<Object>}
     */
    function readLocal(keys) {
        return new Promise((resolve, reject) => {
            const settle = (data) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) { reject(new Error(lastError.message || 'chrome.storage.local.get 失敗')); return; }
                resolve(data || {});
            };
            const returned = chrome.storage.local.get(keys, settle);
            if (returned && typeof returned.then === 'function') returned.then(settle, reject);
        });
    }

    /**
     * 包裝 chrome.storage.local 寫入，同時支援 callback 與 promise 兩種慣例。
     * @param {Object} values
     * @returns {Promise<void>}
     */
    function writeLocal(values) {
        return new Promise((resolve, reject) => {
            const settle = () => {
                const lastError = chrome.runtime.lastError;
                if (lastError) { reject(new Error(lastError.message || 'chrome.storage.local.set 失敗')); return; }
                resolve();
            };
            const returned = chrome.storage.local.set(values, settle);
            if (returned && typeof returned.then === 'function') returned.then(settle, reject);
        });
    }

    /** 讀取指定鍵，缺漏者以 StorageManager.DEFAULTS 補齊、網搜切換鍵經正規化後回應。 */
    async function handleGetSettings(message) {
        const keys = message?.keys;
        if (!Array.isArray(keys) || keys.length === 0) {
            throw new Error('DSS_GET_SETTINGS 需要非空的 keys 字串陣列');
        }
        const manager = resolveStorageManager();
        const defaults = manager.DEFAULTS;
        const stored = await readLocal(keys);
        const values = {};
        keys.forEach((key) => {
            const rawValue = key in stored ? stored[key] : defaults[key];
            // 僅網搜切換鍵需要舊值校正，規則與 StorageManager.getSettings() 共用一份
            values[key] = key === manager.KEYS.WEBSEARCH_TOGGLE
                ? manager.normalizeWebsearchToggle(rawValue)
                : rawValue;
        });
        return { values };
    }

    /** 將 values 寫入 chrome.storage.local 並回報結果。 */
    async function handleSetSettings(message) {
        const values = message?.values;
        const hasWritableValues = !!values
            && typeof values === 'object'
            && !Array.isArray(values)
            && Object.keys(values).length > 0;
        if (!hasWritableValues) {
            throw new Error('DSS_SET_SETTINGS 需要非空的 values 物件');
        }
        await writeLocal(values);
    }

    /** 將受監看的儲存變更原樣廣播給所有 DeepSeek 分頁；單一分頁失敗不影響其餘分頁。 */
    async function broadcastSettingsChanged(changes, area) {
        const changedKeys = Object.keys(changes || {});
        if (!changedKeys.some((key) => isWatchedKey(key, area))) return;

        const message = { type: resolveMessageTypes().SETTINGS_CHANGED, area, changes };
        const tabs = await chrome.tabs.query({ url: DSS_TAB_URL });
        for (const tab of tabs || []) {
            if (typeof tab?.id !== 'number') continue;
            try {
                await chrome.tabs.sendMessage(tab.id, message);
            } catch {
                // 該分頁無接收端（尚未注入或正在導航）：忽略，繼續送往其餘分頁
            }
        }
    }

    /**
     * 建立 message.type → 處理函式的對照表。
     * @returns {Object<string, (message: object) => Promise<void|object>>}
     */
    function buildRouteTable() {
        const types = resolveMessageTypes();
        return {
            [types.GET_SETTINGS]: (message) => handleGetSettings(message),
            [types.SET_SETTINGS]: (message) => handleSetSettings(message),
        };
    }

    /**
     * 執行單一路由並回應結果；失敗於此邊界攔截（onMessage 之外無人可攔）。
     * @param {(message: object) => Promise<void>} route
     * @param {object} message
     * @param {(response: object) => void} sendResponse
     */
    async function runRoute(route, message, sendResponse) {
        try {
            const result = await route(message);
            sendResponse(result && typeof result === 'object' ? { ok: true, ...result } : { ok: true });
        } catch (err) {
            console.error(`[DSS] settings-routes ${message?.type}:`, err);
            sendResponse({ ok: false, error: err?.message || String(err) });
        }
    }

    /**
     * 註冊設定訊息路由與變更廣播監聽器。
     * 必須由 service worker 於頂層呼叫，確保 worker 重啟後仍能存活。
     */
    function install() {
        const routes = buildRouteTable();

        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            const route = routes[message?.type];
            if (!route) return false; // 交由其他監聽器處理
            runRoute(route, message, sendResponse);
            return true; // 非同步回應
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            broadcastSettingsChanged(changes, area).catch((err) => {
                console.error('[DSS] settings-routes broadcast:', err);
            });
        });
    }

    globalThis.DSSSettingsRoutes = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSSettingsRoutes;
})();
