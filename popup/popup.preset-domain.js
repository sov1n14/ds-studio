/**
 * DS studio — 提示詞組領域規則
 *
 * 提示詞組的實體建構與名稱驗證規則的唯一來源，供 popup 新增流程與
 * 獨立編輯視窗（editor.js）共用。純函式，不觸碰 DOM 也不呼叫 chrome.*。
 */
(function (root) {
    'use strict';

    /**
     * 建立一筆新的提示詞組實體。
     * id 由建立當下的時戳與亂數尾碼組成，內容留白、全域提示詞預設啟用。
     * @param {string} name - 提示詞組名稱（原樣保存，不做修剪）
     * @returns {{ id: string, name: string, content: string, createdAt: number, updatedAt: number, globalPromptEnabled: boolean }}
     */
    function createPreset(name) {
        const now = Date.now();
        return {
            id: 'preset-' + now + '-' + Math.random().toString(36).slice(2, 6),
            name: name,
            content: '',
            createdAt: now,
            updatedAt: now,
            globalPromptEnabled: true,
        };
    }

    /**
     * 驗證提示詞組名稱是否可用。
     * 空白名稱優先於重複名稱回報；重複比對大小寫相異，並排除 selfId 自身。
     * @param {string} name - 待驗證的名稱
     * @param {Array<{ id: string, name: string }>} existingPresets - 現有提示詞組清單
     * @param {{ selfId?: string }} [options] - selfId 指定時，該筆不列入重複比對（重新命名流程）
     * @returns {{ ok: true } | { ok: false, reason: 'empty' | 'duplicate' }}
     */
    function validatePresetName(name, existingPresets, options) {
        if (typeof name !== 'string' || name.trim() === '') {
            return { ok: false, reason: 'empty' };
        }

        const selfId = options?.selfId;
        const presets = existingPresets ?? [];
        const isDuplicate = presets.some(p => p.name === name && p.id !== selfId);

        return isDuplicate ? { ok: false, reason: 'duplicate' } : { ok: true };
    }

    const api = { createPreset, validatePresetName };

    root.DSSPresetDomain = api;

    // 相容 CommonJS 測試環境（Vitest / Node）
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
