/**
 * DS studio — Prevent Auto Scroll (MAIN world patch)
 *
 * 此檔案被注入至頁面的 MAIN world，攔截 React/頁面發起的自動捲動，
 * 避免擷取流程中頁面自動跳至最新訊息而破壞受控掃描。
 *
 * 架構決策：
 *   - 此檔案執行於 MAIN world，因此可覆寫頁面自身的 Element.prototype。
 *   - content script（isolated world）的 harvest.js 使用獨立的 prototype 副本，
 *     完全不受此 patch 影響，可自由捲動。
 *   - 透過隱藏的 bridge element（id="dss-prevent-auto-scroll-bridge"）控制啟停，
 *     不使用任何 chrome.* API（MAIN world 無法使用）。
 *   - 使用者放行窗口：isolated world 在使用者實際按下網站原生「捲到底部」按鈕時，
 *     將放行截止時間（epoch 毫秒字串）寫入 bridge 的 dataset.allowScrollUntil；
 *     截止前所有捲動一律放行，僅攔截程式自行觸發的捲動。
 *
 * 注意：此檔案不得包含 chrome.* API 呼叫。
 */

(function () {
    'use strict';

    // ── Guard clause：冪等保護，避免重複注入 ─────────────────────────
    if (window.__dsvPreventAutoScrollInstalled) return;
    window.__dsvPreventAutoScrollInstalled = true;

    // ── 常數 ──────────────────────────────────────────────────────────

    /** Bridge element ID，由 isolated world 管理此元素的 dataset.enabled */
    const BRIDGE_ID = 'dss-prevent-auto-scroll-bridge';

    /** 放行截止時間的 dataset 鍵，與 prevent-auto-scroll-bridge.js 中的 ALLOW_UNTIL_DATASET_KEY 對應 */
    const ALLOW_UNTIL_DATASET_KEY = 'allowScrollUntil';

    // ── 輔助函式 ──────────────────────────────────────────────────────

    /**
     * 判斷使用者放行窗口是否仍開啟。
     * 缺值或非數字時 Number() 為 NaN，比較恆為 false，即視為關閉（維持攔截）。
     * @param {HTMLElement} bridge
     * @returns {boolean}
     */
    function _isUserScrollWindowOpen(bridge) {
        return Date.now() < Number(bridge.dataset[ALLOW_UNTIL_DATASET_KEY]);
    }

    /**
     * 讀取 bridge element 判斷目前是否應攔截捲動：
     * 保護已啟用，且不在使用者放行窗口內。
     * @returns {boolean}
     */
    function _isBlockingActive() {
        const bridge = document.getElementById(BRIDGE_ID);
        if (bridge === null || bridge.dataset.enabled !== 'true') return false;
        return !_isUserScrollWindowOpen(bridge);
    }

    /**
     * 取得元素（或 window）的目前 scrollTop 值。
     * @param {Element|Window} el
     * @returns {number}
     */
    function _getScrollTop(el) {
        if (el === window) {
            return document.documentElement.scrollTop || document.body.scrollTop;
        }
        return el.scrollTop;
    }

    /**
     * 判斷 scrollTo/scrollBy 的目標 Y 值（支援 {top, behavior} 與 (x, y) 兩種呼叫形式）。
     * @param {IArguments|Array} args
     * @returns {number|undefined} 目標 Y 或 undefined（無法判斷時）
     */
    function _extractTargetY(args) {
        if (args.length === 0) return undefined;

        // scrollTo({top, left, behavior}) / scrollBy({top, left, behavior})
        if (args.length === 1 && args[0] !== null && typeof args[0] === 'object') {
            return 'top' in args[0] ? args[0].top : undefined;
        }

        // scrollTo(x, y) / scrollBy(x, y)
        if (args.length >= 2) {
            return args[1];
        }

        return undefined;
    }

    /**
     * 判斷此次 scrollTo 呼叫是否屬於向下捲動。
     * @param {Element|Window} el
     * @param {IArguments|Array} args
     * @returns {boolean}
     */
    function _isScrollToDownward(el, args) {
        const targetY = _extractTargetY(args);
        if (targetY === undefined) return false;
        return targetY > _getScrollTop(el);
    }

    /**
     * 判斷此次 scrollBy 呼叫是否屬於向下捲動。
     * @param {IArguments|Array} args
     * @returns {boolean}
     */
    function _isScrollByDownward(args) {
        const deltaY = _extractTargetY(args);
        if (deltaY === undefined) return false;
        return deltaY > 0;
    }

    /**
     * 判斷是否應攔截 scrollTo 呼叫。
     * 策略：攔截生效時，攔截所有向下的 scrollTo（harvest 在 isolated world，不受影響）。
     * @param {Element|Window} el
     * @param {IArguments|Array} args
     * @returns {boolean}
     */
    function _shouldBlockScrollTo(el, args) {
        if (!_isBlockingActive()) return false;
        return _isScrollToDownward(el, args);
    }

    /**
     * 判斷是否應攔截 scrollBy 呼叫。
     * @param {Element|Window} el
     * @param {IArguments|Array} args
     * @returns {boolean}
     */
    function _shouldBlockScrollBy(el, args) {
        if (!_isBlockingActive()) return false;
        return _isScrollByDownward(args);
    }

    // ── 猴子補丁：window.scrollTo / window.scrollBy ───────────────────

    const _origWindowScrollTo = window.scrollTo;
    window.scrollTo = function (...args) {
        if (_shouldBlockScrollTo(window, args)) return;
        return _origWindowScrollTo.apply(this, args);
    };

    const _origWindowScrollBy = window.scrollBy;
    window.scrollBy = function (...args) {
        if (_shouldBlockScrollBy(window, args)) return;
        return _origWindowScrollBy.apply(this, args);
    };

    // ── 猴子補丁：Element.prototype.scrollTo / scrollBy ──────────────

    const _origElementScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (...args) {
        if (_shouldBlockScrollTo(this, args)) return;
        return _origElementScrollTo.apply(this, args);
    };

    const _origElementScrollBy = Element.prototype.scrollBy;
    Element.prototype.scrollBy = function (...args) {
        if (_shouldBlockScrollBy(this, args)) return;
        return _origElementScrollBy.apply(this, args);
    };

    // ── 猴子補丁：Element.prototype.scrollIntoView ────────────────────

    const _origScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
        if (_isBlockingActive()) {
            // 攔截所有 scrollIntoView：攔截生效時擷取掃描優先，頁面不應主動移動視口
            return;
        }
        return _origScrollIntoView.apply(this, args);
    };

    // ── 猴子補丁：Element.prototype.scrollTop setter ─────────────────

    const _origScrollTopDescriptor = Object.getOwnPropertyDescriptor(
        Element.prototype,
        'scrollTop'
    );

    if (_origScrollTopDescriptor && _origScrollTopDescriptor.set) {
        Object.defineProperty(Element.prototype, 'scrollTop', {
            get: _origScrollTopDescriptor.get,
            set: function (value) {
                if (_isBlockingActive()) {
                    const currentVal = _origScrollTopDescriptor.get.call(this);
                    // 攔截所有向下設定（value > 目前值）
                    if (value > currentVal) {
                        return;
                    }
                }
                return _origScrollTopDescriptor.set.call(this, value);
            },
            configurable: true,
        });
    }
})();
