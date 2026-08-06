/**
 * DS Studio — 浮動選單 Preset ID 決策模組
 * 純函式：依當前頁面情境（有無 chatUuid、pending/pinned 狀態）決定
 * 浮動 preset 選單應顯示哪個 preset id。不存取 DOM、不存取 chrome.*、無副作用。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

(function (root) {
    'use strict';

    /**
     * 判斷 presets 陣列中是否存在指定 id 的 preset。
     *
     * @param {Array<{id: string}>|undefined} presets
     * @param {string} presetId
     * @returns {boolean}
     */
    function hasPreset(presets, presetId) {
        if (!Array.isArray(presets)) return false;
        for (var i = 0; i < presets.length; i++) {
            if (presets[i] && presets[i].id === presetId) return true;
        }
        return false;
    }

    /**
     * 決定浮動 preset 選單應顯示的 preset id。
     *
     * @param {Object} [options]
     * @param {string} [options.chatUuid]         - 現有對話的 uuid；新對話頁面則為空。
     * @param {Object} [options.chatPresetMap]     - chatUuid → presetId 綁定表。
     * @param {string} [options.pendingPresetId]   - 使用者在新對話頁面尚未送出前選擇的 preset id。
     * @param {string} [options.pinnedPresetId]    - 使用者釘選的預設 preset id。
     * @param {Array<{id: string}>} [options.presets] - 目前可用的 preset 清單。
     * @returns {string} 應顯示的 preset id，永遠回傳字串，絕不回傳 undefined/null。
     */
    function resolveOverlayPresetId(options) {
        // ── Guard Clauses ──────────────────────────────────────────────────
        if (!options) return '';

        var chatUuid = options.chatUuid;

        // 規則 1：已存在的對話 — 完全依 chatPresetMap 決定，忽略 pending/pinned。
        if (typeof chatUuid === 'string' && chatUuid !== '') {
            var chatPresetMap = options.chatPresetMap;
            if (chatPresetMap && typeof chatPresetMap[chatUuid] === 'string' && chatPresetMap[chatUuid] !== '') {
                return chatPresetMap[chatUuid];
            }
            return '';
        }

        // 規則 2：新對話頁面（無 chatUuid）。
        var pendingPresetId = options.pendingPresetId;
        var presets = options.presets;

        if (typeof pendingPresetId === 'string') {
            if (pendingPresetId === '') {
                // 使用者明確選擇了空 preset，不 fallback 至 pinned。
                return '';
            }
            if (hasPreset(presets, pendingPresetId)) {
                return pendingPresetId;
            }
            // pendingPresetId 過期（presets 中不存在）→ 繼續往下判斷 pinned。
        }

        var pinnedPresetId = options.pinnedPresetId;
        if (typeof pinnedPresetId === 'string' && pinnedPresetId !== '' && hasPreset(presets, pinnedPresetId)) {
            return pinnedPresetId;
        }

        return '';
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    // 瀏覽器 classic script 環境：掛載至全域命名空間
    root.__DS_PresetIdResolver = { resolveOverlayPresetId };

    // Node.js / Vitest 測試環境
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { resolveOverlayPresetId };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
