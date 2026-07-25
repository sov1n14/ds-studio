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
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('chat.deepseek.com')) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "EXPORT_MARKDOWN",
                    includeThinking:   includeThinkingToggle   ? includeThinkingToggle.checked   : true,
                    includeReferences: includeReferencesToggle ? includeReferencesToggle.checked : true
                }).catch(() => {
                    ctx.Toast.show(dsI18n.t('exportFailedRefreshToast'));
                });
            } else {
                await ctx.Modal.confirm({
                    title: dsI18n.t('notOnDeepseekTitle'),
                    message: dsI18n.t('notOnDeepseekMessage'),
                    confirmText: dsI18n.t('confirmButton'),
                    cancelText: null
                });
            }
        });
    }

    return { bindExportButton };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupMarkdownExport = { createMarkdownExportManager };
}
