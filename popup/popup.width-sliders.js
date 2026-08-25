/**
 * DS studio — Popup Width Sliders 模組
 * 封裝「對話區域寬度」「編輯輸入框寬度」兩組開關＋滑桿的事件綁定。
 * 使用 factory 模式接收 ctx 上下文物件。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

// 防抖工具來自 utils/debounce.js（由 popup.html 於本檔之前載入）
const debounce = DSSDebounce;

/**
 * 建立寬度滑桿管理器。
 * @param {Object} ctx - 上下文物件，提供共享狀態與回呼函式
 * @param {Function} ctx.refreshSyncStatus - 刷新同步狀態 UI
 * @param {Function} ctx.showSaveStatus - 顯示儲存提示
 * @param {Object} ctx.StorageManager - StorageManager 實例
 */
function createWidthSliderManager(ctx) {
    // --- 對話區域寬度開關與 slider ---
    function bindChatWidthControls(chatWidthToggle, chatWidthSlider, chatWidthValue, chatWidthSliderContainer) {
        if (chatWidthToggle && chatWidthSliderContainer) {
            chatWidthToggle.addEventListener('change', async () => {
                const isEnabled = chatWidthToggle.checked;
                chatWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
                await ctx.StorageManager.saveChatWidthEnabled(isEnabled);
                await ctx.refreshSyncStatus();
                ctx.showSaveStatus();
            });
        }
        // 防抖儲存對話區域寬度（500ms），避免拖曳滑桿時頻繁寫入 storage
        const debouncedSaveChatWidth = debounce(async (widthValue) => {
            await ctx.StorageManager.saveChatWidth(widthValue);
            await ctx.refreshSyncStatus();
            ctx.showSaveStatus();
        }, 500);

        if (chatWidthSlider && chatWidthValue) {
            chatWidthSlider.addEventListener('input', () => {
                chatWidthValue.textContent = chatWidthSlider.value + '%';
            });
            chatWidthSlider.addEventListener('change', () => {
                debouncedSaveChatWidth(parseInt(chatWidthSlider.value, 10));
            });
        }
    }

    // --- 編輯輸入框寬度開關與 slider ---
    function bindInputWidthControls(inputWidthToggle, inputWidthSlider, inputWidthValue, inputWidthSliderContainer) {
        if (inputWidthToggle && inputWidthSliderContainer) {
            inputWidthToggle.addEventListener('change', async () => {
                const isEnabled = inputWidthToggle.checked;
                inputWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
                await ctx.StorageManager.saveInputWidthEnabled(isEnabled);
                await ctx.refreshSyncStatus();
                ctx.showSaveStatus();
            });
        }
        // 防抖儲存編輯輸入框寬度（500ms），避免拖曳滑桿時頻繁寫入 storage
        const debouncedSaveInputWidth = debounce(async (widthValue) => {
            await ctx.StorageManager.saveInputWidth(widthValue);
            await ctx.refreshSyncStatus();
            ctx.showSaveStatus();
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

    return { bindChatWidthControls, bindInputWidthControls };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupWidthSliders = { createWidthSliderManager };
}
