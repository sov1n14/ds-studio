/**
 * DS studio — React Click Bridge（MAIN world）
 *
 * DeepSeek 的重試／繼續生成按鈕只透過 React onClick 生效，且處理器要求 e.nativeEvent.isTrusted === true 並為 Event 實例；isolated world 的 element.click() 屬不受信任事件而被忽略，也看不到 __reactProps$ expando。
 * 本檔由 manifest 以 "world": "MAIN" 載入：收到冒泡至 document 的 dss:react-click 事件時，以通過該檢查的 nativeEvent 直接呼叫目標元素的 React onClick；元素無 React onClick 時退回 element.click()。
 *
 * 載入期即安裝監聽器：MAIN world 腳本無法由 isolated world 呼叫其 init，故為刻意的啟動點；window 旗標為防禦性防護：若同一視窗內本腳本被執行兩次，仍只保留一個監聽器，一次 dss:react-click 只呼叫一次 onClick。
 * 注意：此檔案不得包含 chrome.* API 呼叫。
 */

(function () {
    'use strict';

    if (window.__dssIsReactClickBridgeInstalled) return;
    window.__dssIsReactClickBridgeInstalled = true;

    // 與 content/auto-retry.js 共用的事件名稱（跨 world 無共用載入器，兩端各自宣告）
    const REACT_CLICK_EVENT = 'dss:react-click';

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

    document.addEventListener(REACT_CLICK_EVENT, (event) => {
        // DOM 事件監聽器為無人可攔截的邊界：處理器拋錯時記錄而非外拋
        try {
            const el = event.target;
            if (!(el instanceof Element)) return;
            const onClick = _findReactOnClick(el);
            if (onClick) onClick(_createSyntheticClick(el));
            else el.click();
        } catch (err) {
            console.error('[DSS] react-click-bridge:', err);
        }
    });
})();
