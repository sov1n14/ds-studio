/**
 * DS studio — React Click Bridge（MAIN world）
 *
 * DeepSeek 的重試／繼續生成按鈕只透過 React onClick 生效，且處理器要求 e.nativeEvent.isTrusted === true 並為 Event 實例；isolated world 的 element.click() 屬不受信任事件而被忽略，也看不到 __reactProps$ expando。
 * 本檔由 manifest 以 "world": "MAIN" 載入：收到冒泡至 document 的 dss:react-click 事件時，以通過該檢查的 nativeEvent 直接呼叫目標元素的 React onClick；元素無 React onClick 時退回 element.click()。
 *
 * 失焦自動複製：事件 detail 為 'auto-copy' 時（僅 content/auto-copy.js 如此派送），先登記一筆約 1500 ms 後失效的待擷取項目再呼叫 onClick。本檔包裝 navigator.clipboard.writeText：有存活的待擷取項目時消耗一筆並記下文字，原 Promise 原封不動回傳給網站；僅在該 Promise 拒絕（如文件未取得焦點）時，於 document 派送 dss:auto-copy-captured（detail 為文字），由 isolated world 的 content/auto-copy.relay.js 轉交 service worker。使用者點擊、無待擷取項目或寫入成功時不做任何額外動作。
 *
 * 載入期即安裝監聽器與包裝：MAIN world 腳本無法由 isolated world 呼叫其 init，故為刻意的啟動點；window 旗標為防禦性防護：若同一視窗內本腳本被執行兩次，仍只保留一個監聽器與一層包裝，一次 dss:react-click 只呼叫一次 onClick。
 * 注意：此檔案不得包含 chrome.* API 呼叫。
 */

(function () {
    'use strict';

    if (window.__dssIsReactClickBridgeInstalled) return;
    window.__dssIsReactClickBridgeInstalled = true;

    // 與 content/auto-retry.js、content/auto-copy.js 共用的事件名稱（跨 world 無共用載入器，各端各自宣告）
    const REACT_CLICK_EVENT = 'dss:react-click';
    // 與 content/auto-copy.js 一致的 detail 標記：僅自動複製派送的點擊會登記待擷取項目
    const AUTO_COPY_DETAIL = 'auto-copy';
    // 與 content/auto-copy.relay.js 一致的擷取事件名稱
    const AUTO_COPY_CAPTURED_EVENT = 'dss:auto-copy-captured';
    // 待擷取項目的存活時間：涵蓋網站於 onClick 內同步或稍後非同步呼叫 writeText 的情況
    const PENDING_WINDOW_MS = 1500;

    // 待擷取項目的失效時間戳（先進先出，對應自動複製的派送順序）
    const pendingExpiries = [];

    /**
     * 取得元素自身 __reactProps$* 上的 onClick。
     * @param {Element} el
     * @returns {Function|null}
     */
    function _findReactOnClick(el) {
        const propsKey = Object.keys(el).find((key) => key.startsWith('__reactProps$'));
        const onClick = propsKey ? el[propsKey]?.onClick : null;
        return typeof onClick === 'function' ? onClick : null;
    }

    /**
     * 建立可通過 React 處理器受信任檢查的最小 synthetic event。
     * @param {Element} el
     */
    function _createSyntheticClick(el) {
        return {
            target: el,
            currentTarget: el,
            nativeEvent: Object.create(Event.prototype, { isTrusted: { value: true } }),
            preventDefault() {},
            stopPropagation() {},
        };
    }

    /** 登記一筆自動複製的待擷取項目 */
    function _notePendingCapture() {
        pendingExpiries.push(Date.now() + PENDING_WINDOW_MS);
    }

    /**
     * 丟棄已失效的項目後消耗最早的一筆存活項目。
     * @returns {boolean} 是否消耗到存活項目
     */
    function _consumePendingCapture() {
        const now = Date.now();
        while (pendingExpiries.length > 0 && pendingExpiries[0] <= now) pendingExpiries.shift();
        if (pendingExpiries.length === 0) return false;
        pendingExpiries.shift();
        return true;
    }

    /**
     * 寫入被拒絕時，把網站欲寫入的文字交給 isolated world。
     * @param {string} text
     */
    function _dispatchCaptured(text) {
        document.dispatchEvent(new CustomEvent(AUTO_COPY_CAPTURED_EVENT, { detail: text }));
    }

    /**
     * 以包裝取代 navigator.clipboard.writeText；剪貼簿 API 不存在時不安裝。
     * 包裝永遠回傳原呼叫的結果（含同步拋錯），不吞下也不改變網站看到的拒絕。
     */
    function _installClipboardCapture() {
        const clipboard = navigator.clipboard;
        const originalWriteText = clipboard?.writeText;
        if (typeof originalWriteText !== 'function') return;

        clipboard.writeText = function (text) {
            const hasPendingCapture = _consumePendingCapture();
            const result = Reflect.apply(originalWriteText, this, arguments);
            if (!hasPendingCapture || typeof text !== 'string') return result;
            if (!result || typeof result.then !== 'function') return result;
            // 衍生鏈只處理拒絕分支，原 Promise 的拒絕仍由網站自行處理
            result.then(null, () => {
                try {
                    _dispatchCaptured(text);
                } catch (err) {
                    console.error('[DSS] react-click-bridge:轉交擷取文字失敗:', err);
                }
            });
            return result;
        };
    }

    document.addEventListener(REACT_CLICK_EVENT, (event) => {
        // DOM 事件監聽器為無人可攔截的邊界：處理器拋錯時記錄而非外拋
        try {
            const el = event.target;
            if (!(el instanceof Element)) return;
            if (event.detail === AUTO_COPY_DETAIL) _notePendingCapture();
            const onClick = _findReactOnClick(el);
            if (onClick) onClick(_createSyntheticClick(el));
            else el.click();
        } catch (err) {
            console.error('[DSS] react-click-bridge:', err);
        }
    });

    _installClipboardCapture();
})();
