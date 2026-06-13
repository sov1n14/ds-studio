/**
 * DS studio — Popup Backup Manager 模組
 * 封裝 JSON 備份匯出／匯入、復原訊息備份匯出／匯入、清除已還原紀錄等操作。
 * 使用 factory 模式接收 ctx 上下文物件。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 建立備份管理器，並自動綁定所有備份相關按鈕的事件監聽器。
 * @param {Object} ctx
 * @param {Function} ctx.refreshSyncStatus - 刷新同步狀態 UI
 * @param {Object} ctx.Modal - Modal 實例
 * @param {Object} ctx.Toast - Toast 實例
 * @param {Object} ctx.StorageManager - StorageManager 實例
 */
function createBackupManager(ctx) {

    // --- 產生日期字串 YYYYMMDD ---
    function _formatDate(date) {
        const yyyy = date.getFullYear();
        const mm   = String(date.getMonth() + 1).padStart(2, '0');
        const dd   = String(date.getDate()).padStart(2, '0');
        return { yyyy, mm, dd };
    }

    // --- 觸發瀏覽器下載 Blob ---
    function _triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- 匯出 JSON 設定備份 ---
    function bindExportJson(exportJsonBtn) {
        if (!exportJsonBtn) return;
        exportJsonBtn.addEventListener('click', async () => {
            try {
                const currentSettings = await ctx.StorageManager.getSettings();
                const dataStr = JSON.stringify(currentSettings, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const { yyyy, mm, dd } = _formatDate(new Date());
                _triggerDownload(blob, `ds-studio-backup-${yyyy}${mm}${dd}.json`);
                ctx.Toast.show('設定已成功匯出');
            } catch (err) {
                ctx.Toast.show('匯出失敗');
            }
        });
    }

    // --- 匯入 JSON 設定備份 ---
    function bindImportJson(importJsonBtn, importJsonInput) {
        if (!importJsonBtn || !importJsonInput) return;

        importJsonBtn.addEventListener('click', () => {
            importJsonInput.click();
        });

        importJsonInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text             = await file.text();
                const importedSettings = JSON.parse(text);

                if (!importedSettings.promptPresets || !Array.isArray(importedSettings.promptPresets)) {
                    throw new Error('無效的備份檔案格式');
                }

                const isConfirmed = await ctx.Modal.confirm({
                    title: '還原設定',
                    message: '確定要匯入嗎？\n' +
                        '• 覆蓋：介面設定、對話綁定、全域提示詞\n' +
                        '• 合併：提示詞組合（相同 ID 保留本地、新組合新增於後）',
                    confirmText: '匯入並合併',
                    cancelText:  '取消',
                    variant:     'danger'
                });

                if (!isConfirmed) {
                    importJsonInput.value = '';
                    return;
                }

                await ctx.StorageManager.restoreSettings(importedSettings);
                await ctx.refreshSyncStatus();

                ctx.Toast.show('設定已成功還原，請重新整理頁面。');
                setTimeout(() => window.location.reload(), 3000);

            } catch (err) {
                await ctx.Modal.confirm({
                    title: '還原失敗',
                    message: '讀取備份檔案時發生錯誤：' + err.message,
                    confirmText: '確定',
                    cancelText:  null
                });
            } finally {
                importJsonInput.value = '';
            }
        });
    }

    // --- 匯出復原訊息備份 ---
    function bindExportRestored(exportRestoredBtn) {
        if (!exportRestoredBtn) return;
        exportRestoredBtn.addEventListener('click', async () => {
            try {
                const data             = await chrome.storage.local.get('restored_messages');
                const restoredMessages = data.restored_messages || {};
                const dataStr = JSON.stringify({ restored_messages: restoredMessages }, null, 2);
                const blob    = new Blob([dataStr], { type: 'application/json' });
                const { yyyy, mm, dd } = _formatDate(new Date());
                _triggerDownload(blob, `ds-studio-restore-backup-${yyyy}-${mm}-${dd}.json`);
                ctx.Toast.show('復原備份已成功匯出');
            } catch (err) {
                ctx.Toast.show('匯出失敗');
            }
        });
    }

    // --- 匯入復原訊息備份 ---
    function bindImportRestored(importRestoredBtn, importRestoredInput) {
        if (!importRestoredBtn || !importRestoredInput) return;

        importRestoredBtn.addEventListener('click', () => {
            importRestoredInput.click();
        });

        importRestoredInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text         = await file.text();
                const importedData = JSON.parse(text);

                if (!importedData.restored_messages || typeof importedData.restored_messages !== 'object') {
                    throw new Error('無效的備份檔案格式：缺少 restored_messages');
                }

                const existing = await chrome.storage.local.get('restored_messages');
                const merged   = { ...(existing.restored_messages || {}), ...importedData.restored_messages };

                await chrome.storage.local.set({ restored_messages: merged });
                ctx.Toast.show('復原備份已成功匯入');

                // 重新載入 popup 以更新開關狀態
                setTimeout(() => window.location.reload(), 1500);
            } catch (err) {
                await ctx.Modal.confirm({
                    title: '匯入失敗',
                    message: '讀取備份檔案時發生錯誤：' + err.message,
                    confirmText: '確定',
                    cancelText:  null
                });
            } finally {
                importRestoredInput.value = '';
            }
        });
    }

    // --- 清除所有已還原紀錄 ---
    function bindClearRestored(clearRestoredBtn) {
        if (!clearRestoredBtn) return;
        clearRestoredBtn.addEventListener('click', async () => {
            const isConfirmed = await ctx.Modal.confirm({
                title: '清除已還原紀錄',
                message: '確定要清除所有已還原內容嗎？此操作無法復原。',
                confirmText: '清除',
                cancelText:  '取消',
                variant:     'danger'
            });

            if (!isConfirmed) return;

            try {
                // 清除本地儲存
                await chrome.storage.local.set({ restored_messages: {} });

                // 通知所有 DeepSeek 分頁的內容腳本
                const tabs = await chrome.tabs.query({});
                for (const tab of tabs) {
                    if (tab.url && tab.url.includes('chat.deepseek.com')) {
                        chrome.tabs.sendMessage(tab.id, { type: 'clearRestoredMessages' }).catch(() => {});
                    }
                }

                ctx.Toast.show('已清除所有復原紀錄');
            } catch (err) {
                ctx.Toast.show('清除失敗');
            }
        });
    }

    return { bindExportJson, bindImportJson, bindExportRestored, bindImportRestored, bindClearRestored };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupBackupManager = { createBackupManager };
}
