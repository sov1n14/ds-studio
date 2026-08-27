/**
 * DS studio — Service Worker 共用常數（background/service-worker-constants.js）
 *
 * 集中定義 background 層 chrome.alarms 名稱，避免在 service-worker.js 與各測試
 * 之間重複硬編碼字串（chrome-extension-coding-guidelines §2：alarm 名稱用具名常數）。
 * classic script：頂層 const 不會成為 globalThis 屬性，故以顯式 globalThis 指派公開。
 */

// chrome.alarms 名稱：待刪對話重試
const RETRY_ALARM_NAME = 'dss-delete-retry';
// chrome.alarms 名稱：雲端同步重試
const SYNC_RETRY_ALARM_NAME = 'dss-sync-retry';

const DSS_SERVICE_WORKER_CONSTANTS = {
    RETRY_ALARM_NAME,
    SYNC_RETRY_ALARM_NAME,
};

// 發布至 globalThis：classic script 的 top-level const 僅存在於全域語彙環境而非 globalThis 屬性，service-worker.js 以 bare global 參照這些名稱時需要此份掛載
Object.assign(globalThis, DSS_SERVICE_WORKER_CONSTANTS);

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DSS_SERVICE_WORKER_CONSTANTS;
}
