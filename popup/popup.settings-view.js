/**
 * DS studio — Popup Settings View 模組
 * 將一份完整的設定物件套用到 popup 的控制項上（單向：settings → DOM）。
 * 初次載入與其他需要整批還原 UI 的流程共用此對應表，避免十二個設定鍵的對應邏輯重複實作。
 *
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 將設定套用至 popup 控制項。
 * 純呈現層：不讀寫 chrome.storage，也不觸發任何 change 事件監聽器。
 * @param {Object} dom - 控制項參照集合（缺少的欄位會被略過）
 * @param {Object} settings - StorageManager.getSettings() 回傳的設定物件
 */
function applySettingsToDom(dom, settings) {
    if (!dom || !settings) return;

    const {
        enableToggle,
        includeThinkingToggle,
        includeReferencesToggle,
        sidebarAutoHideToggle,
        hideThinkingToggle,
        showSystemTimeToggle,
        preventAutoScrollToggle,
        autoExpandMessagesToggle,
        websearchRadios = [],
        chatWidthToggle, chatWidthSlider, chatWidthValue, chatWidthSliderContainer,
        inputWidthToggle, inputWidthSlider, inputWidthValue, inputWidthSliderContainer,
    } = dom;

    if (enableToggle)            enableToggle.checked            = settings.isEnabled;
    if (includeThinkingToggle)   includeThinkingToggle.checked   = settings.includeThinking;
    if (includeReferencesToggle) includeReferencesToggle.checked = settings.includeReferences;
    if (sidebarAutoHideToggle)   sidebarAutoHideToggle.checked   = settings.sidebarAutoHide;
    if (hideThinkingToggle)      hideThinkingToggle.checked      = settings.hideThinking;
    if (showSystemTimeToggle)    showSystemTimeToggle.checked    = settings.isShowSystemTime;
    if (preventAutoScrollToggle) preventAutoScrollToggle.checked = settings.preventAutoScroll;
    if (autoExpandMessagesToggle) autoExpandMessagesToggle.checked = settings.autoExpandMessages;

    // 舊版 'default' 值由 StorageManager 的讀取路徑統一校正，此處僅處理尚未設定的情況
    if (websearchRadios.length) {
        websearchRadios.forEach(r => { r.checked = (r.value === (settings.websearchToggle ?? 'on')); });
    }

    if (chatWidthToggle && chatWidthSlider && chatWidthValue) {
        chatWidthToggle.checked = settings.chatWidthEnabled;
        chatWidthSlider.value   = settings.chatWidth;
        chatWidthValue.textContent = settings.chatWidth + '%';
        if (chatWidthSliderContainer) {
            chatWidthSliderContainer.classList.toggle('collapsed', !settings.chatWidthEnabled);
        }
    }
    if (inputWidthToggle && inputWidthSlider && inputWidthValue) {
        inputWidthToggle.checked = settings.inputWidthEnabled;
        inputWidthSlider.value   = settings.inputWidth;
        inputWidthValue.textContent = settings.inputWidth + '%';
        if (inputWidthSliderContainer) {
            inputWidthSliderContainer.classList.toggle('collapsed', !settings.inputWidthEnabled);
        }
    }
}

// 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupSettingsView = { applySettingsToDom };
}
