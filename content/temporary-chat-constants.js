/**
 * DS studio — Temporary Chat 共用常數
 * 集中定義跨模組共用的 sessionStorage key 與 CustomEvent 名稱，
 * 避免硬編碼重複字串（coding-guidelines §7 反模式：Hardcoded message type strings）。
 */

// sessionStorage key：臨時對話功能啟用狀態；值為字串 'true' 或 'false'；缺少時預設為停用
const DSS_TEMP_CHAT_STORAGE_KEY = 'dss-temporary-chat-enabled';

// CustomEvent：切換開關後由 toggle 模組 dispatch，detail: { isEnabled: boolean }
const DSS_TEMP_CHAT_CHANGED_EVENT = 'dss-temporary-chat-changed';

// CustomEvent：使用者離開對話（SPA URL 變更）時由 content-script.js dispatch，detail: { chatUuid: string }
const DSS_CHAT_LEFT_EVENT = 'dss-chat-left';

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DSS_TEMP_CHAT_STORAGE_KEY,
        DSS_TEMP_CHAT_CHANGED_EVENT,
        DSS_CHAT_LEFT_EVENT,
    };
}
