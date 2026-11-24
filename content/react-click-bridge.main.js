/**
 * DS studio — React Click Bridge（MAIN world）
 *
 * DeepSeek 的重試／繼續生成按鈕只透過 React onClick 生效，且處理器要求 e.nativeEvent.isTrusted === true 並為 Event 實例；isolated world 的 element.click() 屬不受信任事件而被忽略，也看不到 __reactProps$ expando。
 * 本檔由 manifest 以 "world": "MAIN" 載入：收到冒泡至 document 的 dss:react-click 事件時，以通過該檢查的 nativeEvent 直接呼叫目標元素的 React onClick；元素無 React onClick 時退回 element.click()。
 *
 * 失焦自動複製：事件 detail 為 'auto-copy' 時（僅 content/auto-copy.js 如此派送），先登記一筆待擷取項目（存活時間見 content/react-click-bridge.shared.js）再呼叫 onClick。本檔包裝 navigator.clipboard.writeText：有存活的待擷取項目時消耗一筆並記下文字，原 Promise 原封不動回傳給網站；僅在該 Promise 拒絕（如文件未取得焦點）時，於 document 派送 dss:auto-copy-captured（detail 為文字），由 isolated world 的 content/auto-copy.relay.js 轉交 service worker。使用者點擊、無待擷取項目或寫入成功時不做任何額外動作。
 *
 * 相依：content/react-click-bridge.shared.js（事件名稱、detail 標記與待處理佇列的共用定義）須先於本檔載入，manifest 的 "world": "MAIN" 項目與 isolated 項目皆列出。
 *
 * 載入期即安裝監聽器與包裝：MAIN world 腳本無法由 isolated world 呼叫其 init，故為刻意的啟動點；window 旗標為防禦性防護：若同一視窗內本腳本被執行兩次，仍只保留一個監聽器與一層包裝，一次 dss:react-click 只呼叫一次 onClick。
 * 注意：此檔案不得包含 chrome.* API 呼叫。
 */

(function () {
    'use strict';

    const shared = globalThis.DSSReactClickBridgeShared;
    if (!shared) throw new Error('[DSS] content/react-click-bridge.main.js 需要 content/react-click-bridge.shared.js 先行載入');

    if (window.__dssIsReactClickBridgeInstalled) return;
    window.__dssIsReactClickBridgeInstalled = true;

    const { REACT_CLICK_EVENT, AUTO_COPY_DETAIL, AUTO_COPY_CAPTURED_EVENT } = shared;

    // 待擷取項目佇列（先進先出，對應自動複製的派送順序）
    const pendingCaptures = shared.createPendingQueue();

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
            const hasPendingCapture = pendingCaptures.consume();
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
            if (event.detail === AUTO_COPY_DETAIL) pendingCaptures.note();
            const onClick = _findReactOnClick(el);
            if (onClick) onClick(_createSyntheticClick(el));
            else el.click();
        } catch (err) {
            console.error('[DSS] react-click-bridge:', err);
        }
    });

    _installClipboardCapture();
})();
