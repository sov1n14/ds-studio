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

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DSS_TEMP_CHAT_STORAGE_KEY,
        DSS_TEMP_CHAT_CHANGED_EVENT,
        DSS_TEMP_CHAT_UUID_KEY,
        DSS_CHAT_CREATE_MESSAGE_TYPE,
        DSS_CHAT_CREATE_ENDPOINT,
    };
}
