/**
 * DS studio — Harvest :: Toast Bundle
 * 擷取進度遮罩 UI（顯示/更新/隱藏）。由 harvest.js 合入使用。
 * 純函式集合，不持有模組層級可變狀態；跨呼叫需保留的狀態（取消回呼、
 * 是否已點擊取消）改為存放於 DOM 元素本身（自訂屬性 / disabled 屬性），
 * 與 _ensureHarvestToast() 既有「以 DOM 為狀態來源」的作法一致。
 */
(function (root) {
    'use strict';

    function _ensureHarvestToast() {
        let toast = document.querySelector('.dss-harvest-toast');
        if (toast) return toast;

        toast = document.createElement('div');
        toast.className = 'dss-harvest-toast';

        const text = document.createElement('p');
        text.className = 'dss-harvest-toast__text';
        toast.appendChild(text);

        const warn = document.createElement('p');
        warn.className = 'dss-harvest-toast__warn';
        toast.appendChild(warn);

        document.body.appendChild(toast);
        return toast;
    }

    function _resetIncompleteState(toast) {
        toast.classList.remove('dss-harvest-toast--incomplete');

        clearTimeout(toast.__dsAutoDismissTimer);
        toast.__dsAutoDismissTimer = null;

        const dismissBtn = toast.querySelector('.dss-harvest-toast__dismiss-btn');
        if (dismissBtn) dismissBtn.remove();
    }

    function _renderCancelButton(toast, onCancel) {
        const hasCancelHandler = typeof onCancel === 'function';
        let cancelBtn = toast.querySelector('.dss-harvest-toast__cancel-btn');

        if (!hasCancelHandler) {
            if (cancelBtn) cancelBtn.remove();
            return;
        }

        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'dss-harvest-toast__cancel-btn';
            cancelBtn.textContent = dsI18n.t('harvestCancelButton');
            cancelBtn.setAttribute('aria-label', dsI18n.t('harvestCancelButtonAriaLabel'));
            cancelBtn.addEventListener('click', () => {
                if (cancelBtn.disabled) return;

                cancelBtn.disabled = true;
                cancelBtn.textContent = dsI18n.t('harvestCancellingButton');
                cancelBtn.setAttribute('aria-label', dsI18n.t('harvestCancellingButtonAriaLabel'));

                const handler = cancelBtn.__dsOnCancel;
                if (typeof handler === 'function') handler();
            });
            toast.appendChild(cancelBtn);
        }

        cancelBtn.__dsOnCancel = onCancel;
    }

    function _renderDismissButton(toast) {
        let dismissBtn = toast.querySelector('.dss-harvest-toast__dismiss-btn');
        if (dismissBtn) return;

        dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'dss-harvest-toast__dismiss-btn';
        dismissBtn.textContent = dsI18n.t('harvestDismissButton');
        dismissBtn.setAttribute('aria-label', dsI18n.t('harvestDismissButtonAriaLabel'));
        dismissBtn.addEventListener('click', hideHarvestToast);
        toast.appendChild(dismissBtn);
    }

    function showHarvestToastScrolling(onCancel) {
        const toast = _ensureHarvestToast();

        _resetIncompleteState(toast);

        const text = toast.querySelector('.dss-harvest-toast__text');
        if (text) {
            text.textContent = dsI18n.t('harvestScrollingToast');
        }

        const warn = toast.querySelector('.dss-harvest-toast__warn');
        if (warn) {
            warn.style.display = 'none';
        }

        _renderCancelButton(toast, onCancel);

        toast.style.display = 'block';
    }

    function showHarvestToastCapturing(capturedCount, onCancel) {
        if (typeof capturedCount !== 'number') return;

        const toast = _ensureHarvestToast();

        const text = toast.querySelector('.dss-harvest-toast__text');
        if (text) {
            text.textContent = dsI18n.t('harvestCapturingToast', { count: capturedCount });
        }

        const warn = toast.querySelector('.dss-harvest-toast__warn');
        if (warn) {
            warn.textContent = dsI18n.t('harvestWarning');
            warn.style.display = '';
        }

        _renderCancelButton(toast, onCancel);

        toast.style.display = 'block';
    }

    const HARVEST_INCOMPLETE_TOAST_AUTO_DISMISS_MS = 10000;

    function showHarvestToastIncomplete(capturedCount, reasonText) {
        if (typeof capturedCount !== 'number') return;
        if (typeof reasonText !== 'string' || !reasonText) return;

        hideHarvestToast();

        const toast = _ensureHarvestToast();
        toast.classList.add('dss-harvest-toast--incomplete');

        const text = toast.querySelector('.dss-harvest-toast__text');
        if (text) {
            text.textContent = dsI18n.t('harvestIncompleteToast', {
                count: capturedCount,
                reason: reasonText,
            });
        }

        const warn = toast.querySelector('.dss-harvest-toast__warn');
        if (warn) {
            warn.style.display = 'none';
        }

        _renderDismissButton(toast);

        toast.style.display = 'block';

        clearTimeout(toast.__dsAutoDismissTimer);
        toast.__dsAutoDismissTimer = setTimeout(() => {
            hideHarvestToast();
        }, HARVEST_INCOMPLETE_TOAST_AUTO_DISMISS_MS);
    }

    function hideHarvestToast() {
        const toast = document.querySelector('.dss-harvest-toast');
        if (!toast) return;

        toast.style.display = 'none';

        const cancelBtn = toast.querySelector('.dss-harvest-toast__cancel-btn');
        if (cancelBtn) cancelBtn.remove();

        _resetIncompleteState(toast);
    }

    const bundle = {
        showHarvestToastScrolling,
        showHarvestToastCapturing,
        showHarvestToastIncomplete,
        hideHarvestToast,
    };

    root.__DS_Harvest_toast = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
