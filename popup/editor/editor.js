/**
 * DS studio — 提示詞獨立編輯視窗控制器
 *
 * 透過 query string 決定編輯目標：
 *   ?target=global              → 全域提示詞
 *   ?target=preset&id=<presetId> → 指定提示詞組
 *
 * 自動儲存策略：
 *   1. input 事件設定 isDirty flag
 *   2. input 事件觸發防抖儲存（500ms）
 *   3. blur / visibilitychange(hidden) / pagehide 立即儲存
 *
 * 載入順序（editor.html 中 bundle 必須先於 entry）：
 *   1. editor.parse.js    → globalThis.__DS_Editor_parse
 *   2. editor.render.js   → globalThis.__DS_Editor_render
 *   3. editor.storage.js  → globalThis.__DS_Editor_storage
 *   4. editor.js          （本檔，合入以上三個 bundle）
 */

'use strict';

// 防抖工具來自 utils/debounce.js（由 editor.html 於本檔之前載入）
const debounce = DSSDebounce;

// ── 合入三個 bundle ──
const { parseTarget } = globalThis.__DS_Editor_parse || {};
const { renderDisabledState, updateSaveStatus } = globalThis.__DS_Editor_render || {};
const { saveContent, loadContent } = globalThis.__DS_Editor_storage || {};

// ─────────────────────────────────────────────
// 主程式進入點
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const titleEl   = document.getElementById('editorTitle');
    const statusEl  = document.getElementById('editorSaveStatus');
    const textareaEl = document.getElementById('editorTextarea');
    const nameInputEl = document.getElementById('editorNameInput');

    await dsI18n.init();
    window.__DS_PopupI18nApply.apply();

    // 解析目標
    const target = parseTarget();

    if (!target) {
        renderDisabledState(titleEl, textareaEl, dsI18n.t('invalidParamsError'));
        return;
    }

    // 載入內容
    let loaded;
    try {
        loaded = await loadContent(target);
    } catch (err) {
        renderDisabledState(titleEl, textareaEl, dsI18n.t('loadFailedError'));
        return;
    }

    if (!loaded) {
        // 找不到提示詞組（可能已被刪除）
        renderDisabledState(titleEl, textareaEl, dsI18n.t('presetNotFoundError'));
        return;
    }

    // 填入初始值
    titleEl.textContent = loaded.title;
    document.title = loaded.title;
    textareaEl.value = loaded.content;
    textareaEl.placeholder = target.type === 'global'
        ? dsI18n.t('globalPlaceholder')
        : dsI18n.t('presetPlaceholder');

    // 提示詞組目標：以名稱輸入框取代標題列，預先聚焦以便立即重新命名
    if (target.type === 'preset') {
        nameInputEl.value = loaded.name ?? '';
        nameInputEl.setAttribute('aria-label', dsI18n.t('renamePresetTitle'));
        nameInputEl.placeholder = dsI18n.t('renamePresetPlaceholder');
        titleEl.classList.add('is-hidden');
        nameInputEl.classList.remove('is-hidden');
        nameInputEl.focus();
    }

    // ── 自動儲存狀態 ──
    let isDirty = false;

    /**
     * 執行儲存並更新狀態指示器。
     * 儲存完成後清除 isDirty flag。
     * @returns {Promise<void>}
     */
    async function performSave() {
        if (!isDirty) return;
        isDirty = false;

        updateSaveStatus(statusEl, 'saving');
        try {
            await saveContent(target, textareaEl.value, nameInputEl.value);
            updateSaveStatus(statusEl, 'saved');
        } catch (err) {
            // 儲存失敗：重置 dirty flag 以便下次觸發重試
            isDirty = true;
            if (err?.code === 'DUPLICATE_NAME') {
                updateSaveStatus(statusEl, 'error',
                    dsI18n.t('duplicateNameMessagePresetManager', { name: nameInputEl.value }));
            }
        }
    }

    // 防抖儲存（500ms）
    const debouncedSave = debounce(performSave, 500);

    // input 事件：設定 dirty + 觸發防抖儲存
    textareaEl.addEventListener('input', () => {
        isDirty = true;
        debouncedSave();
    });

    // blur 事件：立即儲存（防抖儲存尚未觸發時補救）
    textareaEl.addEventListener('blur', () => {
        if (!isDirty) return;
        performSave().catch(() => {});
    });

    // 名稱輸入框：與文字區共用同一條自動儲存管線
    nameInputEl.addEventListener('input', () => {
        isDirty = true;
        debouncedSave();
    });

    nameInputEl.addEventListener('blur', () => {
        if (!isDirty) return;
        performSave().catch(() => {});
    });

    // visibilitychange：頁面被隱藏時立即儲存（fire-and-forget）
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        if (!isDirty) return;
        isDirty = false;
        saveContent(target, textareaEl.value, nameInputEl.value).catch(() => {});
    });

    // pagehide：視窗關閉前最後儲存（fire-and-forget）
    window.addEventListener('pagehide', () => {
        if (!isDirty) return;
        isDirty = false;
        saveContent(target, textareaEl.value, nameInputEl.value).catch(() => {});
    });

    // Esc 關閉視窗：pagehide 自動儲存保證未存內容先寫入
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.close();
    });
});

// ─────────────────────────────────────────────
// 測試介面匯出（雙模式：window namespace + module.exports）
// ─────────────────────────────────────────────

/** 供單元測試直接呼叫的純函式集合 */
const __DSSEditor = {
    parseTarget,
    saveContent,
    loadContent,
    renderDisabledState,
    updateSaveStatus,
};

window.__DSSEditor = __DSSEditor;

// 相容 CommonJS 測試環境（Vitest / Node）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = __DSSEditor;
}
