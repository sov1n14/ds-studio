/**
 * DS studio — 提示詞獨立編輯視窗控制器
 *
 * 透過 query string 決定編輯目標：
 *   ?target=global              → 全域提示詞
 *   ?target=preset&id=<presetId> → 指定提示詞組
 *
 * 自動儲存策略（由 editor.autosave.js 控制器統一管理）：
 *   1. input 事件標記 dirty 並觸發防抖儲存（500ms）
 *   2. blur / visibilitychange(hidden) / pagehide 作為備援立即寫入
 *   3. Esc 先寫入未存內容，落定後才關閉視窗（名稱重複時保持開啟）
 *
 * 載入順序（editor.html 中 bundle 必須先於 entry）：
 *   1. editor.parse.js    → globalThis.__DS_Editor_parse
 *   2. editor.render.js   → globalThis.__DS_Editor_render
 *   3. editor.storage.js  → globalThis.__DS_Editor_storage
 *   4. editor.autosave.js → globalThis.__DS_Editor_autosave
 *   5. editor.js          （本檔，合入以上四個 bundle）
 */

'use strict';

// 防抖工具 utils/debounce.js 由 editor.html 於 editor.autosave.js 之前載入

// ── 合入四個 bundle ──
const { parseTarget } = globalThis.__DS_Editor_parse || {};
const { renderDisabledState, updateSaveStatus } = globalThis.__DS_Editor_render || {};
const { saveContent, loadContent } = globalThis.__DS_Editor_storage || {};
const { createAutosaveController, settleWithin } = globalThis.__DS_Editor_autosave || {};

const AUTOSAVE_DEBOUNCE_MS = 500;
// Esc 等待寫入落定的上限：逾時仍關閉視窗，避免儲存卡住時視窗無法關閉
const ESC_SAVE_WAIT_MS = 1500;

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

    /**
     * 寫入目前內容並更新狀態指示器；失敗時顯示名稱重複錯誤並 reject，交由控制器保留 dirty 狀態。
     * @returns {Promise<void>}
     */
    async function persistEdits() {
        updateSaveStatus(statusEl, 'saving');
        try {
            await saveContent(target, textareaEl.value, nameInputEl.value);
            updateSaveStatus(statusEl, 'saved');
        } catch (err) {
            if (isDuplicateNameError(err)) {
                updateSaveStatus(statusEl, 'error',
                    dsI18n.t('duplicateNameMessagePresetManager', { name: nameInputEl.value }));
            }
            throw err;
        }
    }

    const autosave = createAutosaveController({ save: persistEdits, debounceMs: AUTOSAVE_DEBOUNCE_MS });

    /** 備援觸發點：僅在有未存內容時寫入，錯誤已由 persistEdits 呈現 */
    function flushInBackground() {
        if (!autosave.hasPendingWork()) return;
        autosave.flush().catch(() => {});
    }

    // 文字區與名稱輸入框共用同一條自動儲存管線
    for (const fieldEl of [textareaEl, nameInputEl]) {
        fieldEl.addEventListener('input', () => autosave.markDirty());
        fieldEl.addEventListener('blur', flushInBackground);
    }

    // visibilitychange / pagehide：視窗隱藏或關閉前的備援寫入（無法保證於卸載前完成）
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        flushInBackground();
    });
    window.addEventListener('pagehide', flushInBackground);

    let isEscapeFlushPending = false;

    /**
     * Esc 關閉視窗：先寫入未存內容，落定後才關閉。
     * 名稱重複時保持開啟並顯示錯誤；其他失敗或逾時仍關閉，避免視窗卡住。
     */
    async function closeAfterFlush() {
        if (!autosave.hasPendingWork()) {
            window.close();
            return;
        }
        isEscapeFlushPending = true;
        try {
            const outcome = await settleWithin(autosave.flush(), ESC_SAVE_WAIT_MS);
            if (outcome.status === 'rejected' && isDuplicateNameError(outcome.reason)) return;
            window.close();
        } finally {
            isEscapeFlushPending = false;
        }
    }

    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // 輸入法組字中的 Esc 用於取消組字，不關閉視窗
        if (e.isComposing) return;
        e.preventDefault();
        // 寫入進行中時忽略重複按下（含長按連發），避免重複關閉
        if (isEscapeFlushPending) return;
        closeAfterFlush().catch((err) => console.error('[DSS] editor Esc close:', err));
    });
});

/**
 * 是否為名稱重複造成的儲存失敗（純查詢）。
 * @param {unknown} err
 * @returns {boolean}
 */
function isDuplicateNameError(err) {
    return err?.code === 'DUPLICATE_NAME';
}

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
