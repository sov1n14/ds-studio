/**
 * DS studio — Popup Settings Controls 模組
 * 負責綁定各項設定開關與滑桿（寬度調整）的事件監聽器。
 * StorageManager / refreshSyncStatus / showSaveStatus / applyMasterSwitchUI 皆為頁面全域
 * （classic script 共享同一作用域，於 popup.js 頂層宣告）。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 建立防抖包裝函式。
 * @param {Function} fn - 要延遲執行的函式
 * @param {number} delayMs - 延遲毫秒數
 * @returns {Function} 防抖後的函式
 */
function debounce(fn, delayMs) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, delayMs);
    };
}

/** 綁定所有設定開關與寬度滑桿的事件監聽器 */
function bindSettingsControls() {
    // --- 全域提示詞開關 ---
    if (globalPromptToggle) {
        globalPromptToggle.addEventListener('change', async () => {
            await StorageManager.saveGlobalPromptEnabled(globalPromptToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // --- 主開關 ---
    enableToggle.addEventListener('change', async () => {
        await StorageManager.saveEnabledState(enableToggle.checked);
        await refreshSyncStatus();
        applyMasterSwitchUI(enableToggle.checked);
        showSaveStatus();
    });

    if (includeThinkingToggle) {
        includeThinkingToggle.addEventListener('change', async () => {
            await StorageManager.saveIncludeThinking(includeThinkingToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (includeReferencesToggle) {
        includeReferencesToggle.addEventListener('change', async () => {
            await StorageManager.saveIncludeReferences(includeReferencesToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (sidebarAutoHideToggle) {
        sidebarAutoHideToggle.addEventListener('change', async () => {
            await StorageManager.saveSidebarAutoHide(sidebarAutoHideToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (hideThinkingToggle) {
        hideThinkingToggle.addEventListener('change', async () => {
            await StorageManager.saveHideThinking(hideThinkingToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (showSystemTimeToggle) {
        showSystemTimeToggle.addEventListener('change', async () => {
            await StorageManager.saveShowSystemTime(showSystemTimeToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // 對話區域寬度開關與 slider
    if (chatWidthToggle && chatWidthSliderContainer) {
        chatWidthToggle.addEventListener('change', async () => {
            const isEnabled = chatWidthToggle.checked;
            chatWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
            await StorageManager.saveChatWidthEnabled(isEnabled);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }
    // 防抖儲存對話區域寬度（500ms），避免拖曳滑桿時頻繁寫入 storage
    const debouncedSaveChatWidth = debounce(async (widthValue) => {
        await StorageManager.saveChatWidth(widthValue);
        await refreshSyncStatus();
        showSaveStatus();
    }, 500);

    if (chatWidthSlider && chatWidthValue) {
        chatWidthSlider.addEventListener('input', () => {
            chatWidthValue.textContent = chatWidthSlider.value + '%';
        });
        chatWidthSlider.addEventListener('change', () => {
            debouncedSaveChatWidth(parseInt(chatWidthSlider.value, 10));
        });
    }

    // 編輯輸入框寬度開關與 slider
    if (inputWidthToggle && inputWidthSliderContainer) {
        inputWidthToggle.addEventListener('change', async () => {
            const isEnabled = inputWidthToggle.checked;
            inputWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
            await StorageManager.saveInputWidthEnabled(isEnabled);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }
    // 防抖儲存編輯輸入框寬度（500ms），避免拖曳滑桿時頻繁寫入 storage
    const debouncedSaveInputWidth = debounce(async (widthValue) => {
        await StorageManager.saveInputWidth(widthValue);
        await refreshSyncStatus();
        showSaveStatus();
    }, 500);

    if (inputWidthSlider && inputWidthValue) {
        inputWidthSlider.addEventListener('input', () => {
            inputWidthValue.textContent = inputWidthSlider.value + '%';
        });
        inputWidthSlider.addEventListener('change', () => {
            debouncedSaveInputWidth(parseInt(inputWidthSlider.value, 10));
        });
    }
}
