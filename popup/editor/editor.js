/**
 * DS studio — 提示詞獨立編輯視窗控制器
 *
 * 透過 query string 決定編輯目標：
 *   ?target=global              → 全域預設提示詞
 *   ?target=preset&id=<presetId> → 指定提示詞組
 *
 * 自動儲存策略：
 *   1. input 事件設定 isDirty flag
 *   2. input 事件觸發防抖儲存（500ms）
 *   3. blur / visibilitychange(hidden) / pagehide 立即儲存
 */

'use strict';

// ─────────────────────────────────────────────
// 防抖工具（本檔案的正式實作，classic script 環境下獨立運作）
// ─────────────────────────────────────────────

/**
 * 建立防抖包裝函式。
 * @param {Function} fn - 要延遲執行的函式
 * @param {number} delayMs - 延遲毫秒數
 * @returns {Function} 防抖後的函式
 */
function debounce(fn, delayMs) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, delayMs);
    };
}

// ─────────────────────────────────────────────
// 解析 Query String 目標
// ─────────────────────────────────────────────

/**
 * 解析 location.search 取得編輯目標。
 * 合法結果：{ type: 'global' } 或 { type: 'preset', id: string }
 * 非法結果：null（呼叫端應轉為停用狀態）
 * @returns {{ type: 'global' } | { type: 'preset', id: string } | null}
 */
function parseTarget() {
    const params = new URLSearchParams(location.search);
    const type = params.get('target');

    if (type === 'global') {
        return { type: 'global' };
    }

    if (type === 'preset') {
        const id = params.get('id');
        // id 必須為非空字串
        if (!id || !id.trim()) return null;
        return { type: 'preset', id: id.trim() };
    }

    // 未知或缺少 target 參數
    return null;
}

// ─────────────────────────────────────────────
// 停用狀態渲染
// ─────────────────────────────────────────────

/**
 * 將編輯器渲染為停用狀態（錯誤或找不到提示詞）。
 * @param {HTMLElement} titleEl - 標題元素
 * @param {HTMLTextAreaElement} textareaEl - 文字輸入區元素
 * @param {string} message - 停用原因訊息（顯示為標題）
 */
function renderDisabledState(titleEl, textareaEl, message) {
    titleEl.textContent = message;
    titleEl.classList.add('is-error');
    textareaEl.disabled = true;
    textareaEl.value = '';
    document.title = message;
}

// ─────────────────────────────────────────────
// 儲存狀態指示器
// ─────────────────────────────────────────────

/**
 * 更新儲存狀態指示器顯示。
 * @param {HTMLElement} statusEl - 狀態文字元素
 * @param {'saving' | 'saved' | 'error'} state - 目前儲存狀態
 */
function updateSaveStatus(statusEl, state, message) {
    if (!statusEl) return;

    if (state === 'saving') {
        statusEl.textContent = dsI18n.t('savingStatus');
        statusEl.classList.remove('save-status--error');
        statusEl.classList.remove('save-status--hidden');
    } else if (state === 'error') {
        // 錯誤狀態：顯示訊息、套用錯誤樣式，且不自動隱藏（等待下次儲存觸發）
        statusEl.textContent = message ?? '';
        statusEl.classList.add('save-status--error');
        statusEl.classList.remove('save-status--hidden');
    } else {
        statusEl.textContent = dsI18n.t('savedStatus');
        statusEl.classList.remove('save-status--error');
        statusEl.classList.remove('save-status--hidden');
        // 顯示 1 秒後淡出
        setTimeout(() => {
            statusEl.classList.add('save-status--hidden');
        }, 1000);
    }
}

// ─────────────────────────────────────────────
// 重複名稱檢查
// ─────────────────────────────────────────────

/**
 * 檢查名稱是否已被其他提示詞組使用。
 * 大小寫視為相異；排除自身 id 以免把自己的名稱誤判為重複。
 * @param {Array<{ id: string, name: string }>} presets - 提示詞組清單
 * @param {string} name - 要檢查的名稱
 * @param {string} selfId - 自身 id（不列入比較）
 * @returns {boolean} 是否為重複名稱
 */
function isDuplicateName(presets, name, selfId) {
    return presets.some(p => p.name === name && p.id !== selfId);
}


// ─────────────────────────────────────────────
// 儲存邏輯
// ─────────────────────────────────────────────

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
        if (isDuplicateName(settings.promptPresets, nextName, target.id)) {
            // 名稱已被其他提示詞組使用：整次儲存取消，等待使用者修正
            throw Object.assign(new Error('duplicate preset name'), { code: 'DUPLICATE_NAME' });
        }
        preset.content = value;
        preset.name = nextName;
        preset.updatedAt = Date.now();
        await StorageManager.saveOnePromptPreset(preset);

        // 廣播給活躍的 DeepSeek 頁籤（選用鏈以免 messaging.js 載入失敗時中斷儲存）
        window.DSVMessaging?.broadcastActivePreset(target.id, value)
            ?.catch(() => {});
        return;
    }

    throw new Error('saveContent: 未知的 target.type');
}

// ─────────────────────────────────────────────
// 載入內容
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// 主程式進入點
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const titleEl   = document.getElementById('editorTitle');
    const statusEl  = document.getElementById('editorSaveStatus');
    const textareaEl = document.getElementById('editorTextarea');
    const nameInputEl = document.getElementById('editorNameInput');

    await dsI18n.init();

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
    debounce,
    renderDisabledState,
    updateSaveStatus,
    isDuplicateName,
};

window.__DSSEditor = __DSSEditor;

// 相容 CommonJS 測試環境（Vitest / Node）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = __DSSEditor;
}
