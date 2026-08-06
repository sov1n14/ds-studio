/**
 * DS studio — Popup Pin Manager 模組
 * 封裝「預設提示詞組」釘選狀態的切換與清除邏輯。
 * 同一時間僅能有一個提示詞組被釘選；再次點擊已釘選項目會取消釘選。
 * 使用 factory 模式接收 ctx 上下文物件，以保持與 popup.js 的共享狀態同步。
 * 此檔案以 classic script 載入，無 ES import/export。
 *
 * @param {Object} ctx - 上下文物件，提供共享狀態與回呼函式
 * @param {Object} ctx.StorageManager - StorageManager 實例，需提供 async savePinnedPresetId(id)
 * @param {Function} ctx.getPinnedPresetId - 取得目前已釘選的 preset id（無釘選時為空字串）
 * @param {Function} ctx.setPinnedPresetId - 更新快取中的已釘選 preset id
 * @param {Function} [ctx.onPinChanged] - 釘選狀態變更後的回呼，供 UI 重新渲染
 */
function createPinManager(ctx) {

    // --- 持久化並更新已釘選的 preset id ---
    async function applyPinnedId(id) {
        await ctx.StorageManager.savePinnedPresetId(id);
        ctx.setPinnedPresetId(id);
        ctx.onPinChanged?.();
    }

    // --- 切換釘選狀態 ---
    async function togglePin(id) {
        if (!id) return;

        const isAlreadyPinned = ctx.getPinnedPresetId() === id;
        await applyPinnedId(isAlreadyPinned ? '' : id);
    }

    // --- 若已釘選的提示詞組被刪除，則清除釘選 ---
    async function clearPinIfDeleted(deletedIds) {
        const pinnedId = ctx.getPinnedPresetId();
        if (!pinnedId || !deletedIds.includes(pinnedId)) return;

        await applyPinnedId('');
    }

    return {
        togglePin,
        clearPinIfDeleted,
    };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupPinManager = { createPinManager };
}
