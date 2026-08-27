/**
 * DS studio — Editor Render Bundle
 * 停用狀態渲染與儲存狀態指示器。
 */
(function (root) {
    'use strict';

    /**
     * 將編輯器渲染為停用狀態（錯誤或找不到提示詞）。
     * @param {HTMLElement} titleEl - 標題元素
     * @param {HTMLTextAreaElement} textareaEl - 文字輸入區元素
     * @param {string} message - 停用原因訊息（顯示為標題）
     */
    function renderDisabledState(titleEl, textareaEl, message) {
        titleEl.textContent = message;
        titleEl.classList.add('is-error');
        textareaEl.disabled = true;
        textareaEl.value = '';
        document.title = message;
    }

    /**
     * 更新儲存狀態指示器顯示。
     * @param {HTMLElement} statusEl - 狀態文字元素
     * @param {'saving' | 'saved' | 'error'} state - 目前儲存狀態
     */
    function updateSaveStatus(statusEl, state, message) {
        if (!statusEl) return;

        if (state === 'saving') {
            statusEl.textContent = dsI18n.t('savingStatus');
            statusEl.classList.remove('save-status--error');
            statusEl.classList.remove('save-status--hidden');
        } else if (state === 'error') {
            // 錯誤狀態：顯示訊息、套用錯誤樣式，且不自動隱藏（等待下次儲存觸發）
            statusEl.textContent = message ?? '';
            statusEl.classList.add('save-status--error');
            statusEl.classList.remove('save-status--hidden');
        } else {
            statusEl.textContent = dsI18n.t('savedStatus');
            statusEl.classList.remove('save-status--error');
            statusEl.classList.remove('save-status--hidden');
            // 顯示 1 秒後淡出
            setTimeout(() => {
                statusEl.classList.add('save-status--hidden');
            }, 1000);
        }
    }

    const bundle = { renderDisabledState, updateSaveStatus };

    root.__DS_Editor_render = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
