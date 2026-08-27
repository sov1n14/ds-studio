/**
 * DS studio — Mobile Sidebar Swipe (Entry)
 * Detects right-swipe gestures within the central 80% viewport area on
 * mobile devices and clicks the sidebar toggle button to show/hide the
 * navigation sidebar.
 *
 * 觸發區域：畫面正中央 80% 區域（水平與垂直各扣除 10% 邊界），
 * 在該區域內向右滑動即可展開側邊欄。
 *
 * 架構決策：
 *   - 僅在行動裝置（觸控或行動 UA）上啟動，桌面端零開銷；
 *     判定委派 content/mobile-device.js 的共用實作。
 *   - 主開關閘控委派 content/feature-toggle.js 的共用管線（本功能無自身開關）。
 *   - 側邊欄切換按鈕的 DOM 就緒輪詢委派 content/retry-until.js。
 */
// 共用模組（瀏覽器：由 manifest 於前載入設定 globalThis；Node.js 測試：直接 require）
const __DS_SwipeMobileDevice = globalThis.DSSMobileDevice
    || (typeof require !== 'undefined' ? require('./mobile-device.js') : null);
const __DS_SwipeFeatureToggle = globalThis.DSSFeatureToggle
    || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
const __DS_SwipeRetryUntil = globalThis.DSSRetryUntil
    || (typeof require !== 'undefined' ? require('./retry-until.js') : null);
if (!__DS_SwipeMobileDevice || !__DS_SwipeFeatureToggle || !__DS_SwipeRetryUntil) {
    throw new Error('content/mobile-sidebar-swipe.js 需要 content/mobile-device.js、content/feature-toggle.js 與 content/retry-until.js 先行載入');
}

// 各分包（瀏覽器：由 manifest 於前載入；Node.js 測試：直接 require）
var __swipeButton = globalThis.__DS_MobileSidebarSwipe_button ||
    (typeof require !== 'undefined' ? require('./mobile-sidebar-swipe.button.js') : {});
var __swipeGesture = globalThis.__DS_MobileSidebarSwipe_gesture ||
    (typeof require !== 'undefined' ? require('./mobile-sidebar-swipe.gesture.js') : {});
var __swipeBind = globalThis.__DS_MobileSidebarSwipe_bind ||
    (typeof require !== 'undefined' ? require('./mobile-sidebar-swipe.bind.js') : {});
var __swipeLifecycle = globalThis.__DS_MobileSidebarSwipe_lifecycle ||
    (typeof require !== 'undefined' ? require('./mobile-sidebar-swipe.lifecycle.js') : {});

const MobileSidebarSwipe = {
    // === 常數 ===
    SWIPE_THRESHOLD_PX: 50,
    SWIPE_MAX_DURATION_MS: 500,
    TRIGGER_ZONE_MARGIN_RATIO: 0.10,
    DOM_RETRY_INTERVAL_MS: 500,
    DOM_MAX_RETRIES: 60,

    // === 狀態 ===
    enabled: false,
    _isTouchBound: false,
    _startPoint: null,
    _startTime: null,
    _deltaX: 0,
    _deltaY: 0,
    _touchStartHandler: null,
    _touchMoveHandler: null,
    _touchEndHandler: null,
    _domRetryCancel: null,
    _unregisterToggle: null,
};

Object.assign(MobileSidebarSwipe, __swipeButton, __swipeGesture, __swipeBind, __swipeLifecycle);

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
MobileSidebarSwipe.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MobileSidebarSwipe;
}

// Expose on window for cross-module access
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.MobileSidebarSwipe = MobileSidebarSwipe;
}
