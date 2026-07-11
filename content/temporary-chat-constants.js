/**
 * DS studio — Temporary Chat 共用常數
 * 集中定義跨模組共用的 sessionStorage key 與 CustomEvent 名稱，
 * 避免硬編碼重複字串（coding-guidelines §7 反模式：Hardcoded message type strings）。
 */

// sessionStorage key：臨時對話功能啟用狀態；值為字串 'true' 或 'false'；缺少時預設為停用
const DSS_TEMP_CHAT_STORAGE_KEY = 'dss-temporary-chat-enabled';

// CustomEvent：切換開關後由 toggle 模組 dispatch，detail: { isEnabled: boolean }
const DSS_TEMP_CHAT_CHANGED_EVENT = 'dss-temporary-chat-changed';

// sessionStorage key：目前追蹤中的臨時對話 UUID；值為 UUID 字串或空字串（無追蹤時）
const DSS_TEMP_CHAT_UUID_KEY = 'dss-temporary-chat-uuid';

// window.postMessage type：main world XHR/fetch hook 偵測到新對話建立請求時發送
const DSS_CHAT_CREATE_MESSAGE_TYPE = 'DSS_CHAT_CREATE_DETECTED';

// 新對話建立 API 端點路徑片段（用於 XHR/fetch URL 比對）
const DSS_CHAT_CREATE_ENDPOINT = '/api/v0/chat_session/create';

// window.postMessage type：XHR hook 偵測到 /api/v0/chat/completion 時發送
const DSS_CHAT_COMPLETION_MESSAGE_TYPE = 'DSS_CHAT_COMPLETION_DETECTED';

// window.postMessage type：ISOLATED world 要求 MAIN world 透過 React Fiber 刪除對話
const DSS_FIBER_DELETE_MESSAGE_TYPE = 'DSS_FIBER_DELETE_SESSION';

// window.postMessage type：MAIN world 回報 Fiber 刪除結果給 ISOLATED world
const DSS_FIBER_DELETE_RESULT_TYPE = 'DSS_FIBER_DELETE_RESULT';

// chrome.storage.sync：跨裝置待刪佇列 Array<{chatUuid, attemptCount}>
const DSS_PENDING_DELETES_SYNC_KEY = 'dss-pending-deletes-sync';
// chrome.storage.local：本機最近有效 bearer token（絕不同步）
const DSS_LAST_AUTH_TOKEN_KEY = 'dss-last-auth-token';
// chrome.storage.local：本機開啟中臨時對話 UUID 集合 string[]
const DSS_OPEN_TEMP_UUIDS_KEY = 'dss-open-temp-uuids';
// 刪除對話的 API 端點
const DSS_DELETE_ENDPOINT_URL = 'https://chat.deepseek.com/api/v0/chat_session/delete';
// content→SW：SPA 導航刪除失敗且情境存活時請 SW 排程重試 alarm
const DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE = 'DSS_SCHEDULE_DELETE_RETRY';

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DSS_TEMP_CHAT_STORAGE_KEY,
        DSS_TEMP_CHAT_CHANGED_EVENT,
        DSS_TEMP_CHAT_UUID_KEY,
        DSS_CHAT_CREATE_MESSAGE_TYPE,
        DSS_CHAT_CREATE_ENDPOINT,
        DSS_CHAT_COMPLETION_MESSAGE_TYPE,
        DSS_FIBER_DELETE_MESSAGE_TYPE,
        DSS_FIBER_DELETE_RESULT_TYPE,
        DSS_PENDING_DELETES_SYNC_KEY,
        DSS_LAST_AUTH_TOKEN_KEY,
        DSS_OPEN_TEMP_UUIDS_KEY,
        DSS_DELETE_ENDPOINT_URL,
        DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE,
    };
}
