/**
 * DS studio — 分頁卸載寬限期（background/unload-grace.js）
 *
 * 職責：頁面無法分辨關閉分頁與工具列重新整理，content 端在 beforeunload 只送 DSS_TAB_UNLOADING { uuid }。
 * 本模組為每個 uuid 啟動一次寬限計時；寬限期內收到同一 uuid 的 DSS_HEARTBEAT（重新整理後的頁面認領）即取消。
 * 到期時：uuid 不在待刪佇列 → 不處理；仍有 DeepSeek 分頁網址停在該對話 → 續約保留；
 * 否則以本機 token 刪除，成功移出佇列與本機開啟集合，失敗保留於佇列、釋放 lease 並排程既有的重試 alarm。
 * 計時器只存在記憶體：worker 於寬限期內被終止時項目仍留在佇列，由 onStartup 補救流程刪除。
 *
 * 相依：utils/temporary-chat-constants.js、utils/deepseek-api.js、background/pending-store.js 需先載入；
 * install() 由 service worker 於頂層呼叫並注入補救重入防護與重試 alarm 排程。
 */
(function () {
    'use strict';

    // 寬限期（毫秒）：使用者裁示 10 秒
    const GRACE_MS = 10000;
    // 判定「仍有分頁停在該對話」只計 DeepSeek 分頁
    const DEEPSEEK_TAB_URL_PATTERN = '*://chat.deepseek.com/*';
    const CHAT_UUID_IN_URL = /\/a\/chat\/s\/([a-f0-9-]+)/;

    /** 於呼叫時解析相依全域，缺失即拋出並指名修法。 */
    function resolveDependency(globalName, file) {
        const dependency = globalThis[globalName];
        if (!dependency) throw new Error(`[DSS] unload-grace 需要 ${file} 先行載入`);
        return dependency;
    }
    const pendingStore = () => resolveDependency('TemporaryChatPendingStore', 'background/pending-store.js');
    const deepSeekApi = () => resolveDependency('DSSDeepSeekApi', 'utils/deepseek-api.js');

    /** 於呼叫時解析訊息型別常數，缺失即拋出並指名修法。 */
    function resolveMessageTypes() {
        const types = {
            TAB_UNLOADING: globalThis.DSS_TEMP_CHAT?.DSS_MSG_TAB_UNLOADING,
            HEARTBEAT: globalThis.DSS_TEMP_CHAT?.DSS_MSG_HEARTBEAT,
        };
        if (!types.TAB_UNLOADING || !types.HEARTBEAT) {
            throw new Error('[DSS] unload-grace 需要 utils/temporary-chat-constants.js 先行載入');
        }
        return types;
    }

    /** 純查詢：是否有 DeepSeek 分頁的網址停在 uuid；查詢失敗時視為沒有（與補救掃描的 fail-open 一致）。 */
    async function hasDeepSeekTabShowing(uuid) {
        try {
            const tabs = await chrome.tabs.query({ url: DEEPSEEK_TAB_URL_PATTERN });
            // Stryker disable next-line ArrayDeclaration: 等效突變——非分頁的陣列元素沒有 url，分頁比對結果仍是「沒有分頁」
            return (tabs || []).some((tab) => {
                // Stryker disable next-line OptionalChaining: 等效突變——依 url 查詢只回傳網址相符的分頁；url 缺失時拋出並落入 catch，同樣代表「沒有分頁」
                const urlMatch = tab.url?.match(CHAT_UUID_IN_URL);
                return urlMatch?.[1] === uuid;
            });
        }
        // Stryker disable next-line BlockStatement: 等效突變——空 catch 回傳 undefined 而非 false，呼叫端兩者皆視為「沒有分頁」
        catch {
            return false;
        }
    }

    /**
     * 寬限期到期後決定卸載對話的去留（須在補救重入防護下執行，避免補救掃描同時刪除同一項目）。
     * @param {string} uuid
     * @param {(pendingItems: object[]) => Promise<void>} scheduleRetryAlarm - 既有的待刪重試 alarm 排程
     */
    async function settleUnloadedChat(uuid, scheduleRetryAlarm) {
        const store = pendingStore();
        const pending = await store.getPendingDeletes();
        if (!pending.some((item) => item.chatUuid === uuid)) return;

        if (await hasDeepSeekTabShowing(uuid)) {
            await store.refreshLease(uuid);
            return;
        }

        // 無人認領：分頁已不在，先移出本機開啟集合；無 token 時 performDeleteFetch 直接回傳 false
        await store.removeOpenUuid(uuid);
        const isDeleted = await deepSeekApi().performDeleteFetch(uuid, await store.getLastAuthToken());
        if (isDeleted) {
            await store.removePendingDelete(uuid);
            return;
        }
        // 失敗：保留於佇列並釋放 lease（lastActiveAt 0）讓任何裝置可立即接手，再排程重試 alarm
        await store.releaseLease(uuid);
        await scheduleRetryAlarm(await store.getPendingDeletes());
    }

    /**
     * 註冊卸載寬限監聽器。必須由 service worker 於頂層呼叫，確保 worker 重啟後仍能存活。
     * @param {object} deps
     * @param {(job: () => Promise<void>) => Promise<void>} deps.runGuardedQueueJob - 在補救重入防護下執行佇列工作
     * @param {(pendingItems: object[]) => Promise<void>} deps.scheduleRetryAlarm - 待刪重試 alarm 排程
     */
    function install({ runGuardedQueueJob, scheduleRetryAlarm } = {}) {
        if (typeof runGuardedQueueJob !== 'function' || typeof scheduleRetryAlarm !== 'function') {
            throw new Error('[DSS] unload-grace: install({ runGuardedQueueJob, scheduleRetryAlarm }) requires both service worker functions');
        }
        const types = resolveMessageTypes();
        // uuid → 寬限計時器 id；計時器無法持久化，worker 終止即遺失（由 onStartup 補救兜底）
        const graceTimers = new Map();

        function cancelGrace(uuid) {
            clearTimeout(graceTimers.get(uuid));
            graceTimers.delete(uuid);
        }

        // 同一 uuid 已在寬限中時不重複計時，確保重複的卸載訊息只導致一次刪除
        function startGrace(uuid) {
            if (graceTimers.has(uuid)) return;
            const timerId = setTimeout(() => {
                graceTimers.delete(uuid);
                Promise.resolve()
                    .then(() => runGuardedQueueJob(() => settleUnloadedChat(uuid, scheduleRetryAlarm)))
                    .catch((err) => console.error('[DSS] unload-grace settle:', err));
            }, GRACE_MS);
            graceTimers.set(uuid, timerId);
        }

        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            const uuid = typeof message?.uuid === 'string' && message.uuid ? message.uuid : null;
            if (!uuid) {
                // Stryker disable next-line BooleanLiteral: 等效突變——回傳 true 只讓訊息通道保持開啟，發送端頁面正在卸載，無可觀察差異
                return false;
            }
            // 心跳仍由 pending-store-routes 續約並回應；此處只取消寬限，不回應
            if (message.type === types.HEARTBEAT) {
                cancelGrace(uuid);
                // Stryker disable next-line BooleanLiteral: 等效突變——回傳 true 只讓訊息通道保持開啟，心跳由 pending-store-routes 回應，無可觀察差異
                return false;
            }
            // Stryker disable next-line BooleanLiteral: 等效突變——回傳 true 只讓訊息通道保持開啟，其他型別由 pending-store-routes 回應，無可觀察差異
            if (message.type !== types.TAB_UNLOADING) return false;
            startGrace(uuid);
            sendResponse({ ok: true });
            // Stryker disable next-line BooleanLiteral: 等效突變——回應已同步送出，回傳 true 只讓訊息通道保持開啟，無可觀察差異
            return false;
        });
    }

    globalThis.DSSUnloadGrace = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSUnloadGrace;
})();
