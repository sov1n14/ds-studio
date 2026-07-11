/**
 * DS studio — Popup Live Sync 模組
 * 監聽 chrome.storage.onChanged（local + sync 兩個 area），
 * 讓其他裝置／分頁／視窗所做的設定變更即時反映到目前開啟的 popup UI，
 * 不需使用者重新開啟 popup 即可自動取得最新設定。
 *
 * 設計原則（冪等更新，避免 jank / 無限迴圈）：
 *   - 僅在新值與目前 DOM 狀態不同時才更動 DOM（checked/value/textContent 賦值本身已是冪等操作）。
 *   - 本模組不會主動寫入 chrome.storage，因此不會形成迴圈；popup 自身操作觸發的
 *     onChanged 事件只會把同一個值再套用一次，等同於 no-op。
 *   - 沿用 content/content-script.js 既有的 onChanged 監聽慣例（namespace 白名單 + 逐鍵比對）。
 *
 * StorageManager、DOM toggle/slider consts、applyMasterSwitchUI、updateEditPresetBtnState
 * 皆為頁面全域（classic script 共享同一作用域，於 popup.js 頂層宣告）。
 */

// --- 單一開關 / 數值型設定的冪等 DOM 更新 ---
function _applyToggle(el, isChecked) {
    if (!el) return;
    if (el.checked !== isChecked) el.checked = isChecked;
}

function _applySlider(sliderEl, valueEl, containerEl, percent, isSliderEnabled) {
    if (sliderEl && String(sliderEl.value) !== String(percent)) {
        sliderEl.value = percent;
    }
    if (valueEl) valueEl.textContent = percent + '%';
    if (containerEl) containerEl.classList.toggle('collapsed', !isSliderEnabled);
}

// --- 重新讀取提示詞組清單並重繪下拉選單 ---
async function _reloadPresetsAndRender(popupState) {
    const settings = await StorageManager.getSettings();
    popupState.presets = settings.promptPresets;
    if (popupState.customSelect) popupState.customSelect.render();
    updateEditPresetBtnState();
}

// --- 重新讀取分塊式 chatPresetMap ---
async function _reloadChatPresetMap(popupState) {
    popupState.chatPresetMap = await StorageManager.getChatPresetMap();
}

// --- 套用單一 storage 變更批次 ---
function _handleChanges(popupState, changes) {
    const KEYS = StorageManager.KEYS;

    if (changes[KEYS.IS_ENABLED]) {
        const isEnabled = changes[KEYS.IS_ENABLED].newValue;
        _applyToggle(enableToggle, isEnabled);
        applyMasterSwitchUI(isEnabled);
    }

    if (changes[KEYS.GLOBAL_PROMPT_ENABLED]) {
        _applyToggle(globalPromptToggle, changes[KEYS.GLOBAL_PROMPT_ENABLED].newValue ?? true);
    }

    if (changes[KEYS.INCLUDE_THINKING]) {
        _applyToggle(includeThinkingToggle, changes[KEYS.INCLUDE_THINKING].newValue);
    }

    if (changes[KEYS.INCLUDE_REFERENCES]) {
        _applyToggle(includeReferencesToggle, changes[KEYS.INCLUDE_REFERENCES].newValue);
    }

    if (changes[KEYS.SIDEBAR_AUTO_HIDE]) {
        _applyToggle(sidebarAutoHideToggle, changes[KEYS.SIDEBAR_AUTO_HIDE].newValue);
    }

    if (changes[KEYS.HIDE_THINKING]) {
        _applyToggle(hideThinkingToggle, changes[KEYS.HIDE_THINKING].newValue);
    }

    if (changes[KEYS.SHOW_SYSTEM_TIME]) {
        _applyToggle(showSystemTimeToggle, changes[KEYS.SHOW_SYSTEM_TIME].newValue ?? false);
    }

    if (changes[KEYS.CHAT_WIDTH] || changes[KEYS.CHAT_WIDTH_ENABLED]) {
        const isSliderEnabled = changes[KEYS.CHAT_WIDTH_ENABLED]
            ? changes[KEYS.CHAT_WIDTH_ENABLED].newValue
            : chatWidthToggle?.checked;
        _applyToggle(chatWidthToggle, isSliderEnabled);
        const percent = changes[KEYS.CHAT_WIDTH]
            ? changes[KEYS.CHAT_WIDTH].newValue
            : chatWidthSlider?.value;
        _applySlider(chatWidthSlider, chatWidthValue, chatWidthSliderContainer, percent, isSliderEnabled);
    }

    if (changes[KEYS.INPUT_WIDTH] || changes[KEYS.INPUT_WIDTH_ENABLED]) {
        const isSliderEnabled = changes[KEYS.INPUT_WIDTH_ENABLED]
            ? changes[KEYS.INPUT_WIDTH_ENABLED].newValue
            : inputWidthToggle?.checked;
        _applyToggle(inputWidthToggle, isSliderEnabled);
        const percent = changes[KEYS.INPUT_WIDTH]
            ? changes[KEYS.INPUT_WIDTH].newValue
            : inputWidthSlider?.value;
        _applySlider(inputWidthSlider, inputWidthValue, inputWidthSliderContainer, percent, isSliderEnabled);
    }

    // 提示詞組清單本身變更（新增／刪除／重新排序／內容編輯）
    const hasPresetListChanged = Object.keys(changes).some(k =>
        k === KEYS.PRESET_INDEX ||
        k === KEYS.PRESET_ORDER_META ||
        k.startsWith('dsPreset_')
    );
    if (hasPresetListChanged) {
        _reloadPresetsAndRender(popupState);
    }

    // 對話 ⇄ 提示詞組綁定表變更（分塊式儲存）
    const hasChatPresetMapChanged = Object.keys(changes).some(k =>
        k === KEYS.CHAT_PRESET_MAP_META ||
        k.startsWith(KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX)
    );
    if (hasChatPresetMapChanged) {
        _reloadChatPresetMap(popupState);
    }

    // 目前選中的提示詞組（其他分頁/裝置切換後同步下拉選單顯示）
    if (changes[KEYS.ACTIVE_PRESET_ID]) {
        const newActivePresetId = changes[KEYS.ACTIVE_PRESET_ID].newValue ?? '';
        if (newActivePresetId !== popupState.activePresetId) {
            popupState.activePresetId = newActivePresetId;
            updateEditPresetBtnState();
            if (popupState.customSelect) popupState.customSelect.render();
        }
    }
}

/**
 * 啟動 Live Sync 監聽器。
 * @param {Object} popupState - 共享的 popup 狀態物件（由 popup.js 建立）
 */
function startLiveSync(popupState) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local' && namespace !== 'sync') return;
        _handleChanges(popupState, changes);
    });
}
