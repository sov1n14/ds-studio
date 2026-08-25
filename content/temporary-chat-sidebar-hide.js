/**
 * DS studio — Temporary Chat 側邊欄隱藏（content/temporary-chat-sidebar-hide.js）
 * 單一職責：將待刪佇列中的對話從 DeepSeek 側邊欄隱藏（含發起裝置目前開啟的那筆，此為刻意的產品決策）。
 * 無載入期副作用：由生命週期呼叫端 init()／stop()。
 * content 層不觸碰 chrome.storage：佇列快照一律經由訊息向 service worker 索取，並接收其推送更新。
 */
(function (root) {
    'use strict';

    // 常數參照：classic script 的 top-level const 不會掛上 globalThis，故保留硬編碼 fallback
    const _getConst = (name, fallback) =>
        (typeof globalThis !== 'undefined' && globalThis[name] !== undefined)
            ? globalThis[name]
            : (typeof window !== 'undefined' && window[name] !== undefined)
                ? window[name]
                : fallback;

    // 共用 DOM 選擇器（瀏覽器：ds-selectors.js 於前載入設定 window.DSstudio；Node 測試：直接 require）
    const _selectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const STYLE_ID = 'ds-temp-chat-sidebar-hide-style';
    const HIDDEN_CLASS = 'ds-temp-chat-hidden';
    const MSG_GET = _getConst('DSS_MSG_GET_PENDING_UUIDS', 'DSS_GET_PENDING_UUIDS');
    const MSG_CHANGED = _getConst('DSS_MSG_PENDING_UUIDS_CHANGED', 'DSS_PENDING_UUIDS_CHANGED');
    const GROUP_SELECTOR = _selectors.SIDEBAR_DATE_GROUP_SELECTOR;
    const CHAT_LINK_SELECTOR = _selectors.SIDEBAR_CHAT_LINK_SELECTOR;
    const WRAPPER_SELECTOR = _selectors.SIDEBAR_WRAPPER_SELECTOR || 'div.dc04ec1d';

    // 執行期狀態（僅存活於本分頁生命期）
    const queuedUuids = new Set();
    let observer = null;
    let isScheduled = false;
    let isListenerAdded = false;

    // 由 href 取最後一段作為 uuid；不假設帶有 origin，並去除 query／hash。
    function uuidFromHref(href) {
        if (!href) return '';
        const path = href.split('?')[0].split('#')[0];
        const segments = path.split('/').filter(Boolean);
        return segments.length ? segments[segments.length - 1] : '';
    }

    // 以最新 uuid 陣列重建佇列集合。
    function setQueued(uuids) {
        queuedUuids.clear();
        if (Array.isArray(uuids)) {
            for (const uuid of uuids) if (uuid) queuedUuids.add(uuid);
        }
    }

    // 注入隱藏樣式（以 ds- 前綴 class 隔離，絕不寫 inline style）。
    function injectStyles() {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = '.' + HIDDEN_CLASS + ' { display: none !important; }';
        document.head.appendChild(style);
    }

    function removeStyles() {
        const style = document.getElementById(STYLE_ID);
        if (style) style.remove();
    }

    // 判斷群組內是否每個對話列都在佇列中（單列群組其唯一列在佇列亦算）。
    function isEveryAnchorQueued(anchors) {
        if (anchors.length === 0) return false;
        for (const anchor of anchors) {
            if (!queuedUuids.has(uuidFromHref(anchor.getAttribute('href')))) return false;
        }
        return true;
    }

    // 隱藏群組內個別在佇列中的對話列。
    function hideQueuedAnchors(anchors) {
        for (const anchor of anchors) {
            if (queuedUuids.has(uuidFromHref(anchor.getAttribute('href')))) anchor.classList.add(HIDDEN_CLASS);
        }
    }

    // 群組收合規則：整組皆在佇列→隱藏整個容器（連日期標籤）；否則僅隱藏個別列。
    function applyGroup(group) {
        const anchors = group.querySelectorAll(CHAT_LINK_SELECTOR);
        if (isEveryAnchorQueued(anchors)) {
            group.classList.add(HIDDEN_CLASS);
            return;
        }
        hideQueuedAnchors(anchors);
    }

    // 冪等重套：先清空既有隱藏 class，再依當前佇列重新推導，使離開佇列的項目自動復原。
    function apply() {
        if (typeof document === 'undefined') return;
        const marked = document.querySelectorAll('.' + HIDDEN_CLASS);
        for (const el of marked) el.classList.remove(HIDDEN_CLASS);

        const groups = document.querySelectorAll(GROUP_SELECTOR);
        if (groups.length === 0) {
            // 降級：群組選擇器失效（DeepSeek 改版）時，改以 href 隱藏任意位置的個別對話列
            hideQueuedAnchors(document.querySelectorAll(CHAT_LINK_SELECTOR));
            return;
        }
        for (const group of groups) applyGroup(group);
    }

    // 將一連串 mutation 併為每個 tick 一次套用，避免逐筆 mutation 重跑。
    function scheduleApply() {
        if (isScheduled) return;
        isScheduled = true;
        const runner = (typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
        runner(() => {
            isScheduled = false;
            try {
                apply();
            } catch (err) {
                console.error('[DSS] temporary-chat-sidebar-hide apply:', err);
            }
        });
    }

    // 監看側邊欄 DOM 變動（wrapper 尚未掛載時降級觀察 document.body）。
    function observeSidebar() {
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
        if (observer) observer.disconnect();
        const target = document.querySelector(WRAPPER_SELECTOR) || document.body;
        if (!target) return;
        observer = new MutationObserver(() => scheduleApply());
        observer.observe(target, { childList: true, subtree: true });
    }

    // 接收 service worker 推送的最新佇列快照。
    function onMessage(message) {
        try {
            if (message?.type !== MSG_CHANGED) return;
            setQueued(message.uuids);
            scheduleApply();
        } catch (err) {
            console.error('[DSS] temporary-chat-sidebar-hide message:', err);
        }
    }

    // 向 service worker 索取目前佇列快照。
    function requestSnapshot() {
        try {
            Promise.resolve(chrome.runtime.sendMessage({ type: MSG_GET }))
                .then((res) => {
                    if (res?.ok) {
                        setQueued(res.uuids);
                        scheduleApply();
                    }
                })
                .catch((err) => console.warn('[DSS] temporary-chat-sidebar-hide snapshot:', err));
        } catch (err) {
            console.warn('[DSS] temporary-chat-sidebar-hide snapshot:', err);
        }
    }

    // 啟動：注入樣式、索取快照、監聽推送與側邊欄變動，並立即套用一次。
    function init() {
        injectStyles();
        requestSnapshot();
        if (!isListenerAdded) {
            chrome.runtime.onMessage.addListener(onMessage);
            isListenerAdded = true;
        }
        observeSidebar();
        scheduleApply();
    }

    // 停止：拆掉 observer 與監聽器、移除樣式並清除所有隱藏 class。
    function stop() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (isListenerAdded) {
            try { chrome.runtime.onMessage.removeListener(onMessage); } catch (err) { /* no-op */ }
            isListenerAdded = false;
        }
        removeStyles();
        if (typeof document !== 'undefined') {
            const marked = document.querySelectorAll('.' + HIDDEN_CLASS);
            for (const el of marked) el.classList.remove(HIDDEN_CLASS);
        }
        queuedUuids.clear();
    }

    root.TemporaryChatSidebarHide = { init, stop };

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = root.TemporaryChatSidebarHide;
})(typeof globalThis !== 'undefined' ? globalThis : window);
