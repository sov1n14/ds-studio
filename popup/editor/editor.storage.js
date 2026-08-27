/**
 * DS studio — Editor Storage Bundle
 * 提示詞內容的儲存與載入邏輯。
 */
(function (root) {
    'use strict';

    /**
     * 依據目標類型儲存內容。
     * @param {{ type: 'global' } | { type: 'preset', id: string }} target
     * @param {string} value - 要儲存的文字內容
     * @param {string} [name] - 提示詞組的新名稱（僅 preset 目標使用）
     * @returns {Promise<void>}
     */
    async function saveContent(target, value, name) {
        if (!target) throw new Error('saveContent: target 不可為空');

        if (target.type === 'global') {
            await StorageManager.saveGlobalDefaultPrompt(value);
            return;
        }

        if (target.type === 'preset') {
            // 重新取得最新 preset 物件以避免覆寫其他欄位
            const settings = await StorageManager.getSettings();
            const preset = settings.promptPresets.find(p => p.id === target.id);
            if (!preset) {
                // 提示詞組已在儲存期間被刪除，靜默放棄
                return;
            }
            const nextName = name ?? preset.name;
            // 名稱規則由 popup.preset-domain.js 集中定義（editor.html 於本檔之前載入）
            const validation = DSSPresetDomain.validatePresetName(nextName, settings.promptPresets, { selfId: target.id });
            if (validation.reason === 'duplicate') {
                // 名稱已被其他提示詞組使用：整次儲存取消，等待使用者修正
                throw Object.assign(new Error('duplicate preset name'), { code: 'DUPLICATE_NAME' });
            }
            preset.content = value;
            preset.name = nextName;
            preset.updatedAt = Date.now();
            await StorageManager.saveOnePromptPreset(preset);

            // 廣播給活躍的 DeepSeek 頁籤（選用鏈以免 tab-control.js 載入失敗時中斷儲存）
            window.DSSTabControl?.broadcastActivePreset(target.id, value)
                ?.catch(() => {});
            return;
        }

        throw new Error('saveContent: 未知的 target.type');
    }

    /**
     * 依據目標從 StorageManager 載入初始內容。
     * 載入失敗或找不到提示詞時回傳 null，讓呼叫端轉為停用狀態。
     * @param {{ type: 'global' } | { type: 'preset', id: string }} target
     * @returns {Promise<{ content: string, title: string, name?: string } | null>}
     */
    async function loadContent(target) {
        if (!target) return null;

        await StorageManager.initialize();
        const settings = await StorageManager.getSettings();

        if (target.type === 'global') {
            return {
                content: settings.globalDefaultPrompt ?? '',
                title: dsI18n.t('globalPresetTitle'),
            };
        }

        if (target.type === 'preset') {
            const preset = settings.promptPresets.find(p => p.id === target.id);
            if (!preset) {
                // 找不到提示詞組（可能已被刪除）
                return null;
            }
            return {
                content: preset.content ?? '',
                title: preset.name,
                name: preset.name,
            };
        }

        return null;
    }

    const bundle = { saveContent, loadContent };

    root.__DS_Editor_storage = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
