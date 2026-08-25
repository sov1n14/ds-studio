/**
 * DS studio — Temporary Chat 共用常數
 * 集中定義跨模組共用的 sessionStorage key 與 CustomEvent 名稱，
 * 避免硬編碼重複字串（chrome-extension-coding-guidelines §2：訊息型別與 storage key 皆用具名常數）。
 */

// chrome.storage.local key：臨時對話功能啟用狀態；值為 boolean；缺少時預設為停用
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

// window.postMessage type：MAIN world XHR hook 攔截到 authorization 標頭時回傳給 ISOLATED world
const DSS_AUTH_CAPTURED_TYPE = 'DSS_AUTH_CAPTURED';

// window.postMessage type：MAIN world history hook 偵測到 SPA 導航（pushState/replaceState）時通知 ISOLATED world
const DSS_HISTORY_NAV_TYPE = 'DSS_HISTORY_NAV';

// window.postMessage type：MAIN world XHR hook 完成一段 SSE 片段組裝後回傳給 ISOLATED world
const DSS_FRAGMENT_COMPLETE_TYPE = 'DSS_FRAGMENT_COMPLETE';

// chrome.storage.sync：跨裝置待刪佇列 Array<{chatUuid, attemptCount, lastActiveAt}>
const DSS_PENDING_DELETES_SYNC_KEY = 'dss-pending-deletes-sync';
// chrome.storage.local：本機最近有效 bearer token（絕不同步）
const DSS_LAST_AUTH_TOKEN_KEY = 'dss-last-auth-token';
// chrome.storage.local：本機開啟中臨時對話 UUID 集合 string[]
const DSS_OPEN_TEMP_UUIDS_KEY = 'dss-open-temp-uuids';
// content→SW：SPA 導航刪除失敗且情境存活時請 SW 排程重試 alarm
const DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE = 'DSS_SCHEDULE_DELETE_RETRY';

// content→SW 待刪佇列路由：由 background/pending-store-routes.js 代為存取 chrome.storage
// payload {uuid}：登記為待刪並加入本機開啟集合
const DSS_MSG_TRACK_FOR_DELETION = 'DSS_TRACK_FOR_DELETION';
// payload {uuid}：自跨裝置待刪佇列移除
const DSS_MSG_REMOVE_PENDING_DELETE = 'DSS_REMOVE_PENDING_DELETE';
// payload {uuid}：自本機開啟中 UUID 集合移除
const DSS_MSG_REMOVE_OPEN_UUID = 'DSS_REMOVE_OPEN_UUID';
// payload {token}：更新本機最近有效 bearer token 快取
const DSS_MSG_SET_LAST_AUTH_TOKEN = 'DSS_SET_LAST_AUTH_TOKEN';
// payload {uuid}：追蹤中臨時對話定期續約 lease，避免其他裝置誤刪
const DSS_MSG_HEARTBEAT = 'DSS_HEARTBEAT';
// payload {uuid}：刪除失敗且重試耗盡時歸零該項 lease，讓其他裝置可立即接手
const DSS_MSG_RELEASE_LEASE = 'DSS_RELEASE_LEASE';
// content->SW：索取目前待刪佇列 uuid 快照，回應 {ok:true, uuids:string[]}
const DSS_MSG_GET_PENDING_UUIDS = 'DSS_GET_PENDING_UUIDS';
// SW->content：待刪佇列變更後推送最新 uuid 快照，payload {uuids:string[]}
const DSS_MSG_PENDING_UUIDS_CHANGED = 'DSS_PENDING_UUIDS_CHANGED';

// 待刪佇列 lease 存活時間（毫秒）：now-lastActiveAt 超過此值即視為過期，可由其他裝置接手
const LEASE_TTL_MS = 600000;
// 待刪佇列 lease 心跳間隔（毫秒）：擁有裝置定期 refreshLease 續約的週期
const HEARTBEAT_INTERVAL_MS = 60000;

const DSS_TEMP_CHAT_CONSTANTS = {
    DSS_TEMP_CHAT_STORAGE_KEY,
    DSS_TEMP_CHAT_CHANGED_EVENT,
    DSS_TEMP_CHAT_UUID_KEY,
    DSS_CHAT_CREATE_MESSAGE_TYPE,
    DSS_CHAT_CREATE_ENDPOINT,
    DSS_CHAT_COMPLETION_MESSAGE_TYPE,
    DSS_FIBER_DELETE_MESSAGE_TYPE,
    DSS_FIBER_DELETE_RESULT_TYPE,
    DSS_AUTH_CAPTURED_TYPE,
    DSS_HISTORY_NAV_TYPE,
    DSS_FRAGMENT_COMPLETE_TYPE,
    DSS_PENDING_DELETES_SYNC_KEY,
    DSS_LAST_AUTH_TOKEN_KEY,
    DSS_OPEN_TEMP_UUIDS_KEY,
    DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE,
    DSS_MSG_TRACK_FOR_DELETION,
    DSS_MSG_REMOVE_PENDING_DELETE,
    DSS_MSG_REMOVE_OPEN_UUID,
    DSS_MSG_SET_LAST_AUTH_TOKEN,
    DSS_MSG_HEARTBEAT,
    DSS_MSG_RELEASE_LEASE,
    DSS_MSG_GET_PENDING_UUIDS,
    DSS_MSG_PENDING_UUIDS_CHANGED,
    LEASE_TTL_MS,
    HEARTBEAT_INTERVAL_MS,
};

// 發布至 globalThis：classic script 的 top-level const 僅存在於全域語彙環境而非 globalThis 屬性，消費端以 globalThis[name] 解析常數時需要此份掛載
Object.assign(globalThis, DSS_TEMP_CHAT_CONSTANTS);

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DSS_TEMP_CHAT_CONSTANTS;
}
