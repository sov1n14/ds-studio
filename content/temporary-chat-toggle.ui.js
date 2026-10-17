/**
 * DS studio — Temporary Chat Toggle :: UI Bundle
 * 切換列 DOM 建構、視覺狀態更新、注入與移除。
 * 純 UI 層：不持有業務邏輯或儲存存取，由 temporary-chat-toggle.js 委派使用。
 */
(function (root) {
    'use strict';

    // ── 切換列 DOM 元素 ID ──────────────────────────────────────────────────
    const ROW_ID = 'dss-temp-chat-toggle-row';

    /**
     * 根據啟用狀態更新 UI 視覺（標籤文字色、checkbox 狀態）。
     * @param {HTMLElement} row - 已注入的容器列
     * @param {boolean} isEnabled
     */
    function applyVisualState(row, isEnabled) {
        if (!row) return;
        const label = row.querySelector('.dss-temp-chat-label');
        const input = row.querySelector('.dss-temp-chat-switch__input');
        if (!label || !input) return;

        if (isEnabled) {
            label.classList.add('dss-temp-chat-label--on');
        } else {
            label.classList.remove('dss-temp-chat-label--on');
        }
        input.checked = isEnabled;
    }

    /**
     * 建立並回傳切換列 DOM 元素（未附加至文件）。
     * @param {boolean} isEnabled - 初始狀態
     * @param {function(boolean):void} onChange - checkbox 變更時的回呼，參數為新的 checked 值
     * @returns {HTMLElement}
     */
    function createToggleRow(isEnabled, onChange) {
        const row = document.createElement('div');
        row.id = ROW_ID;
        row.className = 'dss-temp-chat-row';

        // 開關（左側）
        const switchLabel = document.createElement('label');
        switchLabel.className = 'dss-temp-chat-switch';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'dss-temp-chat-switch__input';
        input.checked = isEnabled;
        input.setAttribute('aria-label', '臨時對話');
        // 停用瀏覽器表單狀態自動還原：Chromium 會在重新整理後對動態注入的表單控制項
        // 還原先前狀態並觸發真實的 change 事件，若不關閉會被誤判為使用者操作
        input.setAttribute('autocomplete', 'off');

        const track = document.createElement('span');
        track.className = 'dss-temp-chat-switch__track';

        switchLabel.appendChild(input);
        switchLabel.appendChild(track);

        // 文字標籤（右側）
        const textLabel = document.createElement('span');
        textLabel.className = isEnabled
            ? 'dss-temp-chat-label dss-temp-chat-label--on'
            : 'dss-temp-chat-label';
        textLabel.textContent = '臨時對話';

        row.appendChild(switchLabel);
        row.appendChild(textLabel);

        // 切換事件：委派給呼叫端提供的回呼
        input.addEventListener('change', () => {
            const newIsEnabled = input.checked;
            if (typeof onChange === 'function') onChange(newIsEnabled);
            applyVisualState(row, newIsEnabled);
        });

        return row;
    }

    /**
     * 從 DOM 移除已注入的切換列。
     * @returns {boolean} 是否有實際移除元素
     */
    function removeToggleRow() {
        const existing = document.getElementById(ROW_ID);
        if (!existing) return false;
        existing.remove();
        return true;
    }

    /**
     * 檢查切換列是否已存在於 DOM 中。
     * @returns {boolean}
     */
    function isRowPresent() {
        return document.getElementById(ROW_ID) !== null;
    }

    const bundle = {
        applyVisualState,
        createToggleRow,
        removeToggleRow,
        isRowPresent,
    };

    root.__DS_TemporaryChatToggleUI = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
