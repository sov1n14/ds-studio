/**
 * DS studio — DeepSeek 分頁顯示中的對話查詢（background/deepseek-tabs.js）
 *
 * 單一職責：回答「目前開著的 DeepSeek 分頁各停在哪個對話」。待刪佇列補救掃描（background/service-worker.js）與分頁卸載寬限計時（background/unload-grace.js）共用此一查詢，分頁比對樣式與對話 id 解析各取自唯一的定義處。
 * 分頁比對樣式取 utils/message-constants.js 的 DSS_TAB_URL，對話 id 由 utils/chat-session-id.js 的 DSSChatSessionId 解析；兩者皆於呼叫當下讀取，缺失即拋出並指名修法。
 * 查詢失敗一律視為「沒有分頁」（fail-open）：分頁查詢出錯時不阻擋刪除。
 * 無載入期副作用：載入僅完成全域指派。
 */
(function () {
    'use strict';

    /** 於呼叫時解析相依全域，缺失即拋出並指名修法。 */
    function resolveDependencies() {
        const tabUrlPattern = globalThis.DSS_TAB_URL;
        if (!tabUrlPattern) throw new Error('[DSS] deepseek-tabs 需要 utils/message-constants.js 先行載入');
        const chatSessionId = globalThis.DSSChatSessionId;
        if (!chatSessionId) throw new Error('[DSS] deepseek-tabs 需要 utils/chat-session-id.js 先行載入');
        return { tabUrlPattern, chatSessionId };
    }

    /**
     * 目前 DeepSeek 分頁停在的對話 uuid 集合；查詢失敗時回傳空集合。
     * @returns {Promise<Set<string>>}
     */
    async function listShownChatUuids() {
        const { tabUrlPattern, chatSessionId } = resolveDependencies();
        const uuids = new Set();
        try {
            const tabs = await chrome.tabs.query({ url: tabUrlPattern });
            // Stryker disable next-line ArrayDeclaration: 等效突變——非分頁的陣列元素沒有 url，解析結果仍是「沒有對話」，集合不變
            for (const tab of tabs || []) {
                // url 缺失時傳入空字串：extractChatSessionId 對 undefined 會改讀目前頁面的 pathname
                // Stryker disable next-line StringLiteral: 等效突變——任何不含對話 id 的字串都解析為「沒有對話」，與空字串結果相同
                const uuid = chatSessionId.extractChatSessionId(tab.url ?? '');
                if (uuid) uuids.add(uuid);
            }
        } catch {
            // fail-open：tabs.query 失敗時以目前已收集的結果（空集合）繼續
        }
        return uuids;
    }

    globalThis.DSSDeepSeekTabs = { listShownChatUuids };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    // Stryker disable next-line ConditionalExpression: 等效突變——module 檢查在 Node 測試環境恆為真，瀏覽器情境無法在 Node 觀察
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSDeepSeekTabs;
})();
