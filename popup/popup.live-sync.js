/**
 * DS studio — Popup Live Sync 模組
 * 監聽 chrome.storage.onChanged（local + sync 兩個 area），
 * 讓其他裝置／分頁／視窗所做的設定變更即時反映到目前開啟的 popup UI，
 * 不需使用者重新開啟 popup 或手動按下「手動同步」。
 *
 * 設計原則（冪等更新，避免 jank / 無限迴圈）：
 *   - 僅在新值與目前 DOM 狀態不同時才更動 DOM（checked/value/textContent 賦值本身已是冪等操作）。
 *   - 本模組不會主動寫入 chrome.storage，因此不會形成迴圈；popup 自身操作觸發的
 *     onChanged 事件只會把同一個值再套用一次，等同於 no-op。
 *   - 沿用 content/content-script.js 既有的 onChanged 監聽慣例（namespace 白名單 + 逐鍵比對）。
 *
 * 使用 factory 模式接收 ctx 上下文物件。此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 建立並啟動 Live Sync 監聽器。
 * @param {Object} ctx
 * @param {Object} ctx.StorageManager - StorageManager 實例
 * @param {Object} ctx.dom - 需要即時更新的 DOM 元素集合
 * @param {Function} ctx.applyMasterSwitchUI - 依主開關狀態切換子控制項 disabled
 * @param {Function} ctx.updateEditPresetBtnState - 依 activePresetId 更新鉛筆按鈕狀態
 * @param {Function} ctx.getPresets / ctx.setPresets - 提示詞組陣列存取
 * @param {Function} ctx.getActivePresetId / ctx.setActivePresetId - 目前選中提示詞組 ID 存取
 * @param {Function} ctx.getChatPresetMap / ctx.setChatPresetMap - 對話綁定表存取
 * @param {Function} ctx.getCustomSelect - 取得 customSelect 實例（可能尚未建立，回傳 falsy）
 */
function createLiveSyncListener(ctx) {
    const {
        StorageManager,
        dom,
        applyMasterSwitchUI,
        updateEditPresetBtnState,
        getPresets, setPresets,
        getActivePresetId, setActivePresetId,
        getChatPresetMap, setChatPresetMap,
        getCustomSelect,
    } = ctx;
    const KEYS = StorageManager.KEYS;

    // --- 單一開關 / 數值型設定的冪等 DOM 更新 ---
    function applyToggle(el, isChecked) {
        if (!el) return;
        if (el.checked !== isChecked) el.checked = isChecked;
    }

    function applySlider(sliderEl, valueEl, containerEl, percent, isSliderEnabled) {
        if (sliderEl && String(sliderEl.value) !== String(percent)) {
            sliderEl.value = percent;
        }
        if (valueEl) valueEl.textContent = percent + '%';
        if (containerEl) containerEl.classList.toggle('collapsed', !isSliderEnabled);
    }

    // --- 重新讀取提示詞組清單並重繪下拉選單 ---
    async function reloadPresetsAndRender() {
        const settings = await StorageManager.getSettings();
        setPresets(settings.promptPresets);
        const customSelect = getCustomSelect();
        if (customSelect) customSelect.render();
        updateEditPresetBtnState();
    }

    // --- 重新讀取分塊式 chatPresetMap ---
    async function reloadChatPresetMap() {
        const map = await StorageManager.getChatPresetMap();
        setChatPresetMap(map);
    }

    // --- 套用單一 storage 變更批次 ---
    function handleChanges(changes) {
        if (changes[KEYS.IS_ENABLED]) {
            const isEnabled = changes[KEYS.IS_ENABLED].newValue;
            applyToggle(dom.enableToggle, isEnabled);
            applyMasterSwitchUI(isEnabled);
        }

        if (changes[KEYS.GLOBAL_PROMPT_ENABLED]) {
            applyToggle(dom.globalPromptToggle, changes[KEYS.GLOBAL_PROMPT_ENABLED].newValue ?? true);
        }

        if (changes[KEYS.INCLUDE_THINKING]) {
            applyToggle(dom.includeThinkingToggle, changes[KEYS.INCLUDE_THINKING].newValue);
        }

        if (changes[KEYS.INCLUDE_REFERENCES]) {
            applyToggle(dom.includeReferencesToggle, changes[KEYS.INCLUDE_REFERENCES].newValue);
        }

        if (changes[KEYS.SIDEBAR_AUTO_HIDE]) {
            applyToggle(dom.sidebarAutoHideToggle, changes[KEYS.SIDEBAR_AUTO_HIDE].newValue);
        }

        if (changes[KEYS.HIDE_THINKING]) {
            applyToggle(dom.hideThinkingToggle, changes[KEYS.HIDE_THINKING].newValue);
        }

        if (changes[KEYS.SHOW_SYSTEM_TIME]) {
            applyToggle(dom.showSystemTimeToggle, changes[KEYS.SHOW_SYSTEM_TIME].newValue ?? false);
        }

        if (changes[KEYS.CHAT_WIDTH] || changes[KEYS.CHAT_WIDTH_ENABLED]) {
            const isSliderEnabled = changes[KEYS.CHAT_WIDTH_ENABLED]
                ? changes[KEYS.CHAT_WIDTH_ENABLED].newValue
                : dom.chatWidthToggle?.checked;
            applyToggle(dom.chatWidthToggle, isSliderEnabled);
            const percent = changes[KEYS.CHAT_WIDTH]
                ? changes[KEYS.CHAT_WIDTH].newValue
                : dom.chatWidthSlider?.value;
            applySlider(dom.chatWidthSlider, dom.chatWidthValue, dom.chatWidthSliderContainer, percent, isSliderEnabled);
        }

        if (changes[KEYS.INPUT_WIDTH] || changes[KEYS.INPUT_WIDTH_ENABLED]) {
            const isSliderEnabled = changes[KEYS.INPUT_WIDTH_ENABLED]
                ? changes[KEYS.INPUT_WIDTH_ENABLED].newValue
                : dom.inputWidthToggle?.checked;
            applyToggle(dom.inputWidthToggle, isSliderEnabled);
            const percent = changes[KEYS.INPUT_WIDTH]
                ? changes[KEYS.INPUT_WIDTH].newValue
                : dom.inputWidthSlider?.value;
            applySlider(dom.inputWidthSlider, dom.inputWidthValue, dom.inputWidthSliderContainer, percent, isSliderEnabled);
        }

        // 提示詞組清單本身變更（新增／刪除／重新排序／內容編輯）
        const hasPresetListChanged = Object.keys(changes).some(k =>
            k === KEYS.PRESET_INDEX ||
            k === KEYS.PRESET_ORDER_META ||
            k.startsWith('dsPreset_')
        );
        if (hasPresetListChanged) {
            reloadPresetsAndRender();
        }

        // 對話 ⇄ 提示詞組綁定表變更（分塊式儲存）
        const hasChatPresetMapChanged = Object.keys(changes).some(k =>
            k === KEYS.CHAT_PRESET_MAP_META ||
            k.startsWith(KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX)
        );
        if (hasChatPresetMapChanged) {
            reloadChatPresetMap();
        }

        // 目前選中的提示詞組（其他分頁/裝置切換後同步下拉選單顯示）
        if (changes[KEYS.ACTIVE_PRESET_ID]) {
            const newActivePresetId = changes[KEYS.ACTIVE_PRESET_ID].newValue ?? '';
            if (newActivePresetId !== getActivePresetId()) {
                setActivePresetId(newActivePresetId);
                updateEditPresetBtnState();
                const customSelect = getCustomSelect();
                if (customSelect) customSelect.render();
            }
        }
    }

    function start() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local' && namespace !== 'sync') return;
            handleChanges(changes);
        });
    }

    return { start };
}

window.__DS_PopupLiveSync = { createLiveSyncListener };
