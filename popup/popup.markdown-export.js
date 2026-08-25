/**
 * DS studio — Popup Markdown Export 模組
 * 封裝「匯出當前頁面對話為 Markdown」按鈕的事件綁定。
 * 使用 factory 模式接收 ctx 上下文物件。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 建立 Markdown 匯出管理器。
 * @param {Object} ctx - 上下文物件
 * @param {Object} ctx.Modal - Modal 實例
 * @param {Object} ctx.Toast - Toast 實例
 */
function createMarkdownExportManager(ctx) {
    // --- 綁定「匯出 Markdown」按鈕 ---
    function bindExportButton(exportMdBtn, includeThinkingToggle, includeReferencesToggle) {
        if (!exportMdBtn) return;
        exportMdBtn.addEventListener('click', async () => {
            const activeTab = await DSSTabControl.queryActiveDeepseekTab();
            if (!activeTab) {
                await ctx.Modal.confirm({
                    title: dsI18n.t('notOnDeepseekTitle'),
                    message: dsI18n.t('notOnDeepseekMessage'),
                    confirmText: dsI18n.t('confirmButton'),
                    cancelText: null
                });
                return;
            }

            // 內容腳本收到匯出指令後會同步回覆 ack；沒有 ack 代表分頁尚未注入內容腳本
            const ack = await DSSTabControl.sendToTab(activeTab.id, {
                action: "EXPORT_MARKDOWN",
                includeThinking:   includeThinkingToggle   ? includeThinkingToggle.checked   : true,
                includeReferences: includeReferencesToggle ? includeReferencesToggle.checked : true
            });
            if (!ack) ctx.Toast.show(dsI18n.t('exportFailedRefreshToast'));
        });
    }

    return { bindExportButton };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupMarkdownExport = { createMarkdownExportManager };
}
