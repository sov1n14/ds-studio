/**
 * DS studio — Go To Top (Entry)
 * 將「回到頂部」按鈕注入原生 go-bottom 按鈕的包裝容器，利用頁面自身佈局定位，不再使用 position:fixed 座標計算。
 *
 * 架構決策（v2.6.2+）：主路徑將 GoTop 按鈕以 insertBefore 注入原生按鈕的直接父層容器，由 flexbox 自動排列位置。Solo 路徑在找不到原生按鈕但包裝容器存在時注入。兩條路徑均失敗則放棄注入。MutationObserver 監控包裝容器，偵測 React re-render 後重新注入。
 *
 * 載入順序：locate → render → scroll → observers → lifecycle → go-top.js（entry，Object.assign 合併後呼叫 init()）
 *
 * 設定來源：主開關狀態由 registerFeatureToggle 經 background 的 DSS_GET_SETTINGS 與 DSS_SETTINGS_CHANGED 訊息路由取得。
 */

// 合併共用選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DSSelectorsGoTop = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

const GoToTop = {
    TIMEOUT: 30000,
    OBSERVER_DEBOUNCE: 50,
    ANCHOR_POLL_INTERVAL: 100,
    MAX_ANCHOR_RETRIES: 5,
    WRAPPER_OBSERVER_DEBOUNCE: 80,
    CONNECT_RETRY_INTERVAL: 500,
    MAX_CONNECT_RETRIES: 120,
    NATIVE_BTN_TAG: 'div',
    NATIVE_BTN_CLASSES: 'ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ds-button--m ds-button--icon-relative-m ds-button--floating',
    NATIVE_BTN_INLINE_STYLE: '--dsl-button-color: var(--dsw-alias-button-floating-fill); --dsl-button-height: 34px; --dsl-button-hover-color: var(--dsw-alias-button-floating-hover); --dsl-button-icon-size: 14px;',
    STACK_GAP_PX: 8,
    ANCHOR_SELECTOR: '._9663006._2c189bc',
    ANCHOR_SELECTOR_FALLBACK1: '._9663006',
    ANCHOR_SELECTOR_FALLBACK2: '[data-virtual-list-item-key="1"]',
    FIRST_MSG_SELECTOR: __DSSelectorsGoTop.ASSISTANT_MESSAGE_SELECTOR,
    VIRTUAL_LIST_SELECTOR: __DSSelectorsGoTop.VIRTUAL_LIST_SELECTOR,
    VIRTUAL_LIST_FALLBACK: __DSSelectorsGoTop.VIRTUAL_LIST_FALLBACK,
    NATIVE_BTN_SELECTOR: '.' + __DSSelectorsGoTop.GO_TOP_NATIVE_BUTTON_CLASS + ':not(.dsw-gotop)',
    INJECT_PARENT_SELECTOR: __DSSelectorsGoTop.FLOATING_BUTTON_BAR_SELECTOR,
    INJECT_PARENT_FALLBACK: __DSSelectorsGoTop.CONTENT_COLUMN_SELECTOR + ' > div:nth-child(2)',
    OUTER_WRAPPER_SELECTOR: __DSSelectorsGoTop.CONTENT_COLUMN_SELECTOR,
    enabled: false,
    _masterEnabled: false,
    _button: null,
    _injectionMode: null,
    _scrollContainer: null,
    _observer: null,
    _wrapperObserver: null,
    _wrapperObserverTimer: null,
    _scrollListener: null,
    _isLocked: false,
    _hasSeenDom: false,
    _scrollPromise: null,
    _scrollReject: null,
    _popstateHandler: null,
    _observerTimer: null,
    _cancelConnectRetry: null,
    _routeChangeTimer: null,
    _unregisterToggle: null,
    _lastPath: '',
};

// 合併所有 bundle（bundle 檔案須在 manifest 中先於此檔案載入）
(function (root) {
    Object.assign(GoToTop, root.__DS_GoToTop_locate || {}, root.__DS_GoToTop_render || {}, root.__DS_GoToTop_scroll || {}, root.__DS_GoToTop_observers || {}, root.__DS_GoToTop_lifecycle || {});
})(globalThis);

GoToTop.init();

if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.GoToTop = GoToTop;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoToTop;
}
