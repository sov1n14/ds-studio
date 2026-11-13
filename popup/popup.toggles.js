// 278 lines: single popup feature-toggle binder — every toggle shares the same save, refreshSyncStatus, showSaveStatus closure; the permission-gated toggles and the open-time cleanup of refused intents share one closure-held set of intents recorded since open, which the cleanup checks synchronously right before each removal, so splitting would open an async gap between that check and the removal
/**
 * DS studio — Popup Feature Toggles 模組
 * 封裝功能開關（全域提示詞、主開關、思考過程、參考來源、側邊欄自動隱藏、隱藏思考過程、顯示系統時間、防止自動捲動、自動展開訊息、自動重試、自動繼續生成、自動複製回覆與程式碼區塊、聯網搜尋單選、回覆完成通知單選）的 change 事件綁定。
 * 使用 factory 模式接收 ctx 上下文物件。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 建立功能開關管理器。
 * @param {Object} ctx - 上下文物件，提供共享狀態與回呼函式
 * @param {Object} ctx.StorageManager - StorageManager 實例
 * @param {Function} ctx.refreshSyncStatus - 刷新同步狀態 UI
 * @param {Function} ctx.showSaveStatus - 顯示儲存提示
 * @param {Function} ctx.applyMasterSwitchUI - 依主開關狀態更新子控制項 UI（僅主開關綁定使用）
 * @param {Function} ctx.getPresets - 取得目前 presets 陣列
 * @param {Function} ctx.setPresets - 設定 presets 陣列
 * @param {Function} ctx.getActivePresetId - 取得目前活躍 preset id
 * @param {Function} ctx.setActivePresetId - 設定目前活躍 preset id
 * @param {Object} [ctx.DSSNotificationPermission] - 通知權限包裝模組；未提供時使用 popup.html 載入的全域實例
 * @param {Object} [ctx.DSSClipboardPermission] - 剪貼簿權限包裝模組；未提供時使用 popup.html 載入的全域實例
 */
function createToggleManager(ctx) {
    const {
        StorageManager, refreshSyncStatus, showSaveStatus, applyMasterSwitchUI,
        getPresets, setPresets, getActivePresetId, setActivePresetId,
    } = ctx;
    const notificationPermission = ctx.DSSNotificationPermission ?? globalThis.DSSNotificationPermission;
    const clipboardPermission = ctx.DSSClipboardPermission ?? globalThis.DSSClipboardPermission;
    // 本次 popup 開啟後由使用者記下的意圖；開啟時的清理一律跳過，避免刪掉使用者剛建立的意圖
    const intentNamesRecordedSinceOpen = new Set();

    /**
     * 確認權限包裝模組回報已取得權限，未取得時才請求；包裝模組缺失視為未取得，API 失敗由包裝模組轉為 false（唯沒有視窗可承載權限提示時包裝模組視同同意）。
     * 請求前先記下待完成意圖：Chrome 顯示提示時會關閉 popup，同意後改由 background/permission-intent-routes.js 開啟設定；遭拒或失敗時清除意圖。
     */
    async function ensurePermission(permissionModule, hasMethodName, requestMethodName, intentName) {
        if (!permissionModule) return false;
        if (await permissionModule[hasMethodName]()) return true;
        intentNamesRecordedSinceOpen.add(intentName);
        await StorageManager.savePermissionIntent(intentName);
        if ((await permissionModule[requestMethodName]()) === true) return true;
        await StorageManager.clearPermissionIntent(intentName);
        return false;
    }
    const ensureNotificationPermission = (intentName) => ensurePermission(notificationPermission, 'hasNotificationPermission', 'requestNotificationPermission', intentName);
    const ensureClipboardPermission = (intentName) => ensurePermission(clipboardPermission, 'hasClipboardPermission', 'requestClipboardPermission', intentName);

    /** 查詢權限包裝模組是否回報已取得權限；包裝模組缺失視為未取得。 */
    const hasModulePermission = async (permissionModule, hasMethodName) => !!permissionModule && (await permissionModule[hasMethodName]()) === true;

    /**
     * 清除遭拒的待完成意圖：Chrome 顯示提示時已關閉 popup，按下拒絕不會執行 popup 程式碼，故於下次開啟時清除權限仍未取得的意圖；權限已取得者留給 background/permission-intent-routes.js 完成。
     * 移除前同步檢查本次開啟後記下的意圖並跳過；storage 操作依發出順序套用，故不會刪掉使用者在清理期間建立的意圖。
     */
    async function clearRefusedPermissionIntents() {
        const { AUTO_COPY_REPLY, AUTO_COPY_CODE, REPLY_NOTIFICATION } = StorageManager.PERMISSION_INTENTS;
        const hasClipboard = () => hasModulePermission(clipboardPermission, 'hasClipboardPermission');
        const hasPermissionOf = {
            [AUTO_COPY_REPLY]: hasClipboard,
            [AUTO_COPY_CODE]: hasClipboard,
            [REPLY_NOTIFICATION]: () => hasModulePermission(notificationPermission, 'hasNotificationPermission'),
        };
        for (const intentName of await StorageManager.getPendingPermissionIntents()) {
            const hasPermission = hasPermissionOf[intentName];
            if (hasPermission && (await hasPermission())) continue;
            if (intentNamesRecordedSinceOpen.has(intentName)) continue;
            await StorageManager.clearPermissionIntent(intentName);
        }
    }

    /** 取得目前活躍的 preset 物件；無活躍 preset（含已刪除／已清空）時回傳 null。 */
    function resolveActivePreset() {
        const activePresetId = getActivePresetId?.();
        if (!activePresetId) return null;
        const presets = getPresets?.() ?? [];
        return presets.find(p => p.id === activePresetId) ?? null;
    }

    /**
     * 依目前活躍 preset（或無活躍 preset 時的裝置本機舊鍵）更新全域提示詞開關的顯示狀態。
     * 可於初次載入與切換 preset 時重複呼叫，讓開關立即反映當下狀態，無需重開 popup。
     * @param {HTMLElement} globalPromptToggle
     */
    async function renderGlobalPromptToggle(globalPromptToggle) {
        if (!globalPromptToggle) return;
        const activePreset = resolveActivePreset();
        const settings = await StorageManager.getSettings();
        globalPromptToggle.checked = StorageManager.resolveGlobalPromptEnabled(activePreset, settings.globalPromptEnabled);
    }

    /**
     * 綁定所有功能開關的 change 事件監聽器。
     * @param {Object} elements - 各功能開關的 DOM 元素參照
     * @param {HTMLElement} elements.globalPromptToggle
     * @param {HTMLElement} elements.enableToggle
     * @param {HTMLElement} elements.includeThinkingToggle
     * @param {HTMLElement} elements.includeReferencesToggle
     * @param {HTMLElement} elements.sidebarAutoHideToggle
     * @param {HTMLElement} elements.hideThinkingToggle
     * @param {HTMLElement} elements.showSystemTimeToggle
     * @param {HTMLElement} elements.preventAutoScrollToggle
     * @param {HTMLElement} elements.autoExpandMessagesToggle
     * @param {HTMLElement} elements.autoRetryToggle
     * @param {HTMLElement} elements.autoContinueToggle
     * @param {HTMLElement} elements.autoOpenSidebarToggle
     * @param {HTMLElement} elements.autoCopyReplyToggle
     * @param {HTMLElement} elements.autoCopyCodeToggle
     * @param {HTMLElement[]} elements.websearchRadios
     * @param {HTMLElement[]} [elements.replyNotificationRadios]
     */
    function bindToggles(elements) {
        const {
            globalPromptToggle, enableToggle, includeThinkingToggle, includeReferencesToggle, sidebarAutoHideToggle,
            hideThinkingToggle, showSystemTimeToggle, preventAutoScrollToggle, autoExpandMessagesToggle, autoRetryToggle,
            autoContinueToggle, autoOpenSidebarToggle, autoCopyReplyToggle, autoCopyCodeToggle, websearchRadios,
            replyNotificationRadios = [],
        } = elements;
        const { AUTO_COPY_REPLY, AUTO_COPY_CODE, REPLY_NOTIFICATION } = StorageManager.PERMISSION_INTENTS;
        clearRefusedPermissionIntents()
            .catch((err) => console.error('[DSS] popup.toggles clearRefusedPermissionIntents:', err)); // 未被 await 的初始化鏈，無人可攔

        // --- 全域提示詞開關（依目前活躍 preset 決定寫入目的地） ---
        if (globalPromptToggle) {
            globalPromptToggle.addEventListener('change', async () => {
                const activePreset = resolveActivePreset();
                if (activePreset) {
                    activePreset.globalPromptEnabled = globalPromptToggle.checked;
                    activePreset.updatedAt = Date.now();
                    await StorageManager.saveOnePromptPreset(activePreset);
                } else {
                    await StorageManager.saveGlobalPromptEnabled(globalPromptToggle.checked);
                }
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

        if (preventAutoScrollToggle) {
            preventAutoScrollToggle.addEventListener('change', async () => {
                await StorageManager.savePreventAutoScroll(preventAutoScrollToggle.checked);
                await refreshSyncStatus();
                showSaveStatus();
            });
        }

        // --- 自動展開訊息開關 ---
        if (autoExpandMessagesToggle) {
            autoExpandMessagesToggle.addEventListener('change', async () => {
                await StorageManager.saveAutoExpandMessages(autoExpandMessagesToggle.checked);
                await refreshSyncStatus();
                showSaveStatus();
            });
        }

        if (autoRetryToggle) {
            autoRetryToggle.addEventListener('change', async () => {
                await StorageManager.saveAutoRetry(autoRetryToggle.checked);
                await refreshSyncStatus();
                showSaveStatus();
            });
        }

        if (autoContinueToggle) {
            autoContinueToggle.addEventListener('change', async () => {
                await StorageManager.saveAutoContinue(autoContinueToggle.checked);
                await refreshSyncStatus();
                showSaveStatus();
            });
        }

        if (autoOpenSidebarToggle) {
            autoOpenSidebarToggle.addEventListener('change', async () => {
                await StorageManager.saveAutoOpenSidebar(autoOpenSidebarToggle.checked);
                await refreshSyncStatus();
                showSaveStatus();
            });
        }

        // --- 自動複製開關：勾選前須取得剪貼簿權限，遭拒或失敗時退回未勾選且不寫入；寫入前清除待完成意圖，取消勾選即撤回 ---
        const bindAutoCopyToggle = (toggle, intentName, saveValue) => {
            if (!toggle) return;
            toggle.addEventListener('change', async () => {
                const isTurningOn = toggle.checked;
                if (isTurningOn && !(await ensureClipboardPermission(intentName))) {
                    toggle.checked = false;
                    return;
                }
                await StorageManager.clearPermissionIntent(intentName);
                await saveValue(isTurningOn);
                await refreshSyncStatus();
                showSaveStatus();
            });
        };
        bindAutoCopyToggle(autoCopyReplyToggle, AUTO_COPY_REPLY, (isEnabled) => StorageManager.saveAutoCopyReply(isEnabled));
        bindAutoCopyToggle(autoCopyCodeToggle, AUTO_COPY_CODE, (isEnabled) => StorageManager.saveAutoCopyCode(isEnabled));

        websearchRadios.forEach(r => {
            r.addEventListener('change', async () => {
                if (!r.checked) return;
                await StorageManager.saveWebsearchToggle(r.value);
                await refreshSyncStatus();
                showSaveStatus();
            });
        });

        // --- 回覆完成通知單選：開啟前須取得通知權限，遭拒或失敗時退回關閉且不寫入；寫入前清除待完成意圖，選關閉即撤回 ---
        replyNotificationRadios.forEach(r => {
            r.addEventListener('change', async () => {
                if (!r.checked) return;
                const isTurningOn = r.value === 'on';
                if (isTurningOn && !(await ensureNotificationPermission(REPLY_NOTIFICATION))) {
                    replyNotificationRadios.forEach(radio => { radio.checked = (radio.value === 'off'); });
                    return;
                }
                await StorageManager.clearPermissionIntent(REPLY_NOTIFICATION);
                await StorageManager.saveReplyNotification(isTurningOn);
                await refreshSyncStatus();
                showSaveStatus();
            });
        });
    }

    return { bindToggles, renderGlobalPromptToggle };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupToggles = { createToggleManager };
}
