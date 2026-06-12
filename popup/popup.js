/**
 * DS studio — Popup Controller
 * Custom Modal controller — replaces browser native prompt/confirm/alert
 * All dialogs are rendered inside the popup, vertically centered.
 */
const Modal = {
    overlay: null,
    titleEl: null,
    messageEl: null,
    inputEl: null,
    requiredEl: null,
    actionsEl: null,

    init() {
        this.overlay = document.getElementById('modalOverlay');
        this.titleEl = document.getElementById('modalTitle');
        this.messageEl = document.getElementById('modalMessage');
        this.inputEl = document.getElementById('modalInput');
        this.requiredEl = document.getElementById('modalRequired');
        this.actionsEl = document.getElementById('modalActions');
    },

    /** 顯示前的共用初始化 */
    _setup() {
        this.overlay.hidden = false;
        this._keyHandler = (e) => {
            if (e.key === 'Escape') this._dismiss();
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    /** 關閉後的共用清理 */
    _cleanup() {
        this.overlay.hidden = true;
        this.requiredEl.hidden = true;
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        this.actionsEl.innerHTML = '';
        this.inputEl.onkeydown = null;
        this.inputEl.oninput = null;
        this.inputEl.style.display = '';
    },

    /** 預設關閉行為，由各呼叫端覆寫 */
    _dismiss() {},

    /** 若 overlay 可見則關閉目前的 modal */
    dismissActive() {
        if (this.overlay && !this.overlay.hidden) {
            this._dismiss();
        }
    },

    /** 建立按鈕並加入 actions 容器 */
    _buildButton(text, className, onClick) {
        const btn = document.createElement('button');
        btn.className = 'modal-btn' + (className ? ' ' + className : '');
        btn.textContent = text;
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        this.actionsEl.appendChild(btn);
        return btn;
    },

    /**
     * 顯示帶有輸入欄位的 prompt modal。
     * 名稱為必填 — 空白時確認按鈕停用並顯示「必填」提示。
     * 點擊 overlay 不關閉；只能透過取消或 Escape 關閉。
     * @param {Object} options
     * @param {string} options.title - 對話框標題
     * @param {string} [options.value] - 預填值
     * @param {string} [options.placeholder] - 輸入框佔位文字
     * @returns {Promise<string|null>} 修剪後的輸入值，取消則為 null
     */
    prompt({ title, value, placeholder } = {}) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (result) => { if (!settled) { settled = true; this._cleanup(); resolve(result); } };

            this._dismiss = () => finish(null);
            this.titleEl.textContent = title || '';
            this.messageEl.style.display = 'none';
            this.requiredEl.hidden = true;
            this.inputEl.style.display = '';
            this.inputEl.value = value || '';
            this.inputEl.placeholder = placeholder || '';

            this.actionsEl.innerHTML = '';
            const cancelBtn = this._buildButton('取消', '', () => finish(null));
            const confirmBtn = this._buildButton('確認', 'modal-btn--primary', () => {
                const val = this.inputEl.value.trim();
                if (val) finish(val);
            });

            // 驗證輸入：空白時停用確認鈕並顯示必填提示
            function validate() {
                const isEmpty = !this.inputEl.value.trim();
                confirmBtn.disabled = isEmpty;
                this.requiredEl.hidden = !isEmpty;
            }
            this.inputEl.oninput = validate.bind(this);

            // Enter 鍵只在有輸入時確認
            this.inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const val = this.inputEl.value.trim();
                    if (val) finish(val);
                }
            };

            // 初始驗證狀態
            if (!value) {
                confirmBtn.disabled = true;
                this.requiredEl.hidden = false;
            }

            this._setup();
            setTimeout(() => { this.inputEl.focus(); this.inputEl.select(); }, 50);
        });
    },

    /**
     * 顯示確認或提示 modal。
     * @param {Object} options
     * @param {string} options.title - 對話框標題
     * @param {string} [options.message] - 內文
     * @param {string} [options.confirmText='確認'] - 確認按鈕文字
     * @param {string|null} [options.cancelText='取消'] - 取消按鈕文字；傳 null 為單按鈕模式
     * @param {string} [options.variant] - 'danger' 顯示紅色確認鈕
     * @returns {Promise<boolean>} 確認為 true，取消為 false
     */
    confirm({ title, message, confirmText, cancelText, variant } = {}) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (result) => { if (!settled) { settled = true; this._cleanup(); resolve(result); } };

            this._dismiss = () => finish(false);
            this.titleEl.textContent = title || '';
            this.messageEl.textContent = message || '';
            this.messageEl.style.display = '';
            this.inputEl.style.display = 'none';

            this.actionsEl.innerHTML = '';
            // 單按鈕模式時省略取消鈕
            if (cancelText !== null) {
                this._buildButton(cancelText || '取消', '', () => finish(false));
            }

            const btnClass = variant === 'danger' ? 'modal-btn--danger' : 'modal-btn--primary';
            this._buildButton(confirmText || '確認', btnClass, () => finish(true));

            this._setup();
        });
    }
};

// ────────────────────────────────────────────
// Toast notification utility
// ────────────────────────────────────────────

const Toast = {
    el: null,

    init() {
        this.el = document.getElementById('toast');
    },

    show(message, duration = 2000) {
        if (!this.el) return;
        this.el.textContent = message;
        this.el.hidden = false;
        // 強制 reflow，使瀏覽器能從 hidden→visible 觸發過渡動畫
        this.el.offsetHeight;
        this.el.style.opacity = '1';

        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => {
            this.el.style.opacity = '0';
            this._timer = setTimeout(() => {
                this.el.hidden = true;
            }, 400); // 對應 CSS transition 時間
        }, duration);
    }
};

// ────────────────────────────────────────────
// Main popup logic
// ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM refs ---
    const enableToggle              = document.getElementById('enableToggle');
    const includeThinkingToggle     = document.getElementById('includeThinkingToggle');
    const includeReferencesToggle   = document.getElementById('includeReferencesToggle');
    const showSystemTimeToggle      = document.getElementById('showSystemTimeToggle');
    const saveStatus                = document.getElementById('saveStatus');
    const addPresetBtn              = document.getElementById('addPresetBtn');
    const editPresetBtn             = document.getElementById('editPresetBtn');
    const editGlobalPromptBtn       = document.getElementById('editGlobalPromptBtn');
    const globalPromptToggle        = document.getElementById('globalPromptToggle');
    const sidebarAutoHideToggle     = document.getElementById('sidebarAutoHideToggle');
    const hideThinkingToggle        = document.getElementById('hideThinkingToggle');
    const chatWidthToggle           = document.getElementById('chatWidthToggle');
    const chatWidthSlider           = document.getElementById('chatWidthSlider');
    const chatWidthValue            = document.getElementById('chatWidthValue');
    const chatWidthSliderContainer  = document.getElementById('chatWidthSliderContainer');
    const inputWidthToggle          = document.getElementById('inputWidthToggle');
    const inputWidthSlider          = document.getElementById('inputWidthSlider');
    const inputWidthValue           = document.getElementById('inputWidthValue');
    const inputWidthSliderContainer = document.getElementById('inputWidthSliderContainer');
    const forceSyncBtn              = document.getElementById('forceSyncBtn');
    const syncStatusEl              = document.getElementById('syncStatus');

    let saveTimeout;
    let customSelect;

    // Init Modal & Toast
    Modal.init();
    Toast.init();

    // --- 狀態 ---
    let presets        = [];
    let activePresetId = null;
    let chatPresetMap  = {};
    let currentTabUuid = undefined;

    // --- 編輯器視窗 ID 追蹤（各保留一個 slot） ---
    let globalEditorWindowId = null;
    let presetEditorWindowId = null;

    // --- 主開關 UI 輔助 ---
    function applyMasterSwitchUI(isEnabled) {
        const subControls = [
            sidebarAutoHideToggle,
            hideThinkingToggle,
            showSystemTimeToggle,
            chatWidthToggle, chatWidthSlider,
            inputWidthToggle, inputWidthSlider
        ];
        subControls.forEach(el => {
            if (el) el.disabled = !isEnabled;
        });
    }

    // --- 載入初始設定 ---
    await StorageManager.initialize();

    // 檢查同步衝突
    const isConflictPending = await StorageManager.checkSyncConflictPending();
    if (isConflictPending) {
        const isResolved = await Modal.confirm({
            title: '雲端同步衝突',
            message: '偵測到雲端同步資料與本機資料不一致。是否要將雲端設定與本機資料合併？介面設定將以雲端為主，提示詞則會進行合併。',
            confirmText: '合併同步',
            cancelText: '暫時取消'
        });

        if (isResolved) {
            await StorageManager.resolveSyncConflict();
            Toast.show('資料已成功合併同步');
            setTimeout(() => window.location.reload(), 1000);
            return;
        }
    }

    await refreshSyncStatus();
    const settings = await StorageManager.getSettings();

    presets        = settings.promptPresets;
    activePresetId = settings.activePresetId;
    chatPresetMap  = settings.chatPresetMap;

    // 清除已失效的 chatPresetMap 條目
    const validIds = new Set(presets.map(p => p.id));
    chatPresetMap = await StorageManager.mutateChatPresetMap(map => {
        for (const [uuid, pid] of Object.entries(map)) {
            if (pid && !validIds.has(pid)) {
                delete map[uuid];
            }
        }
    });

    enableToggle.checked = settings.isEnabled;
    applyMasterSwitchUI(settings.isEnabled);

    if (includeThinkingToggle)   includeThinkingToggle.checked   = settings.includeThinking;
    if (includeReferencesToggle) includeReferencesToggle.checked = settings.includeReferences;
    if (sidebarAutoHideToggle)   sidebarAutoHideToggle.checked   = settings.sidebarAutoHide;
    if (hideThinkingToggle)      hideThinkingToggle.checked      = settings.hideThinking;
    if (showSystemTimeToggle)    showSystemTimeToggle.checked    = settings.showSystemTime;

    // 全域提示詞開關初始值
    if (globalPromptToggle) {
        globalPromptToggle.checked = settings.globalPromptEnabled ?? true;
    }

    if (chatWidthToggle && chatWidthSlider && chatWidthValue) {
        chatWidthToggle.checked = settings.chatWidthEnabled;
        chatWidthSlider.value   = settings.chatWidth;
        chatWidthValue.textContent = settings.chatWidth + '%';
        if (chatWidthSliderContainer) {
            chatWidthSliderContainer.classList.toggle('collapsed', !settings.chatWidthEnabled);
        }
    }
    if (inputWidthToggle && inputWidthSlider && inputWidthValue) {
        inputWidthToggle.checked = settings.inputWidthEnabled;
        inputWidthSlider.value   = settings.inputWidth;
        inputWidthValue.textContent = settings.inputWidth + '%';
        if (inputWidthSliderContainer) {
            inputWidthSliderContainer.classList.toggle('collapsed', !settings.inputWidthEnabled);
        }
    }

    // 判斷是否在 DeepSeek 分頁並調整活躍提示詞組
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url && tabs[0].url.includes('chat.deepseek.com')) {
            const uuid  = extractUuidFromUrl(tabs[0].url);
            const tabId = tabs[0].id;
            currentTabUuid = uuid || null;

            if (uuid && chatPresetMap[uuid]) {
                // 已綁定對話：自動選擇對應提示詞組
                activePresetId = chatPresetMap[uuid];
                await StorageManager.saveActivePresetId(activePresetId);
            } else {
                // 未綁定對話：從內容腳本查詢 pending preset
                const pending = await getPendingPresetIdFromContentScript(tabId);
                activePresetId = (pending && presets.some(p => p.id === pending)) ? pending : '';
                await StorageManager.saveActivePresetId(activePresetId);
            }
        } else {
            // 非 DeepSeek 頁面：預設空白選項
            activePresetId = '';
        }
    } catch (err) {
        // 查詢分頁失敗：安全回退為空白
        activePresetId = '';
    }

    // --- 重新命名提示詞組 ---
    async function requestEditPreset(id) {
        const current = presets.find(p => p.id === id);
        if (!current) return;

        const newName = await Modal.prompt({
            title: '重新命名',
            value: current.name,
            placeholder: '請輸入新名稱...'
        });

        if (!newName || newName === current.name) return;

        if (presets.some(p => p.name === newName && p.id !== current.id)) {
            await Modal.confirm({
                title: '名稱重複',
                message: `「${newName}」已存在，請使用不同的名稱。`,
                confirmText: '確定',
                cancelText: null
            });
            return;
        }

        current.name      = newName;
        current.updatedAt = Date.now();
        await StorageManager.savePromptPresets(presets);
        await refreshSyncStatus();
        customSelect.render();
        showSaveStatus();
    }

    // --- 刪除提示詞組 ---
    async function requestDeletePreset(id) {
        const current = presets.find(p => p.id === id);
        if (!current) return;

        const isConfirmed = await Modal.confirm({
            title: '刪除提示詞組',
            message: `確定要刪除「${current.name}」嗎？此操作無法復原。`,
            confirmText: '刪除',
            variant: 'danger'
        });

        if (!isConfirmed) return;

        const idx = presets.indexOf(current);
        presets.splice(idx, 1);

        if (activePresetId === current.id) {
            activePresetId = '';
            await StorageManager.saveActivePresetId('');
        }

        await StorageManager.savePromptPresets(presets);
        await refreshSyncStatus();

        const deletedId = current.id;
        chatPresetMap = await StorageManager.mutateChatPresetMap(map => {
            for (const uuid of Object.keys(map)) {
                if (map[uuid] === deletedId) {
                    delete map[uuid];
                }
            }
        });
        await refreshSyncStatus();

        customSelect.render();
        updateEditPresetBtnState();
        showSaveStatus();
        sendActivePresetToContentScript();
    }

    customSelect = window.__DSSCustomSelect.createPresetCustomSelect({
        triggerEl:    document.getElementById('presetSelect'),
        panelEl:      document.getElementById('presetSelectPanel'),
        valueEl:      document.getElementById('presetSelectValue'),
        searchInputEl: document.getElementById('presetSearchInput'),
        listEl:       document.getElementById('presetSelectList'),
        blankItemEl:  document.querySelector('.ds-select__item--empty'),
        emptyHintEl:  document.getElementById('presetSelectEmptyHint'),
        getPresets:        () => presets,
        getActivePresetId: () => activePresetId,
        onSelect: async (id) => {
            Modal.dismissActive();

            if (currentTabUuid && id !== '') {
                await StorageManager.bindChatToPreset(currentTabUuid, id);
                chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
            } else if (currentTabUuid && id === '') {
                await StorageManager.unbindChat(currentTabUuid);
                chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
            }

            activePresetId = id;
            await StorageManager.saveActivePresetId(activePresetId);

            updateEditPresetBtnState();
            showSaveStatus();
            await refreshSyncStatus();
            sendActivePresetToContentScript();
            customSelect.render();
        },
        onReorder: async (newPresets) => {
            presets = newPresets;
            await StorageManager.savePromptPresets(newPresets);
            await refreshSyncStatus();
            customSelect.render();
        },
        onRequestEdit:   requestEditPreset,
        onRequestDelete: requestDeletePreset,
    });

    customSelect.render();
    updateEditPresetBtnState();
    sendActivePresetToContentScript();

    // ────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────

    async function getPendingPresetIdFromContentScript(tabId) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: 'GET_PENDING_PRESET' });
            return response?.pendingPresetId || null;
        } catch (err) {
            return null;
        }
    }

    function extractUuidFromUrl(url) {
        try {
            const match = new URL(url).pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    function showSaveStatus() {
        saveStatus.classList.remove('status-hidden');
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveStatus.classList.add('status-hidden');
        }, 1000);
    }

    async function refreshSyncStatus() {
        try {
            const isSynced = await StorageManager.isSyncedWithCloud();
            const el = document.getElementById('syncStatus');
            el.classList.toggle('synced',   isSynced);
            el.classList.toggle('unsynced', !isSynced);
            el.textContent = isSynced ? '雲端同步' : '未同步';
        } catch (e) { /* 靜默忽略 — 僅為 UI 提示 */ }
    }

    /** 依目前活躍提示詞組更新鉛筆按鈕的停用狀態 */
    function updateEditPresetBtnState() {
        if (editPresetBtn) {
            editPresetBtn.disabled = (activePresetId === '');
        }
    }

    /** 廣播目前活躍提示詞組至內容腳本 */
    function sendActivePresetToContentScript() {
        const preset  = presets.find(p => p.id === activePresetId);
        const content = preset?.content ?? '';
        window.DSVMessaging?.broadcastActivePreset(activePresetId, content);
    }

    /**
     * 開啟（或聚焦）編輯器視窗（singleton per target）
     * @param {'global'|'preset'} target - 編輯目標類型
     * @param {string} [presetId] - 僅在 target==='preset' 時使用
     */
    async function openEditorWindow(target, presetId) {
        const baseUrl = chrome.runtime.getURL('popup/editor/editor.html');
        const url = target === 'global'
            ? `${baseUrl}?target=global`
            : `${baseUrl}?target=preset&id=${encodeURIComponent(presetId)}`;

        // 根據 target 選取對應的視窗 ID slot
        const isGlobal      = target === 'global';
        const trackedId     = isGlobal ? globalEditorWindowId : presetEditorWindowId;

        if (trackedId !== null) {
            try {
                // 嘗試聚焦現有視窗
                await chrome.windows.update(trackedId, { focused: true });
                return;
            } catch {
                // 視窗已關閉，清除追蹤 ID 並重新建立
                if (isGlobal) {
                    globalEditorWindowId = null;
                } else {
                    presetEditorWindowId = null;
                }
            }
        }

        try {
            const win = await chrome.windows.create({ url, type: 'popup', width: 1280, height: 720 });
            if (isGlobal) {
                globalEditorWindowId = win.id;
            } else {
                presetEditorWindowId = win.id;
            }
        } catch (err) {
        }
    }

    // ────────────────────────────────────────────
    // 按鈕 & 開關事件綁定
    // ────────────────────────────────────────────

    // --- 新增提示詞組 ---
    addPresetBtn.addEventListener('click', async () => {
        const name = await Modal.prompt({
            title: '新增提示詞組',
            placeholder: '請輸入提示詞組名稱...'
        });

        if (!name) return;

        // 名稱重複檢查
        if (presets.some(p => p.name === name)) {
            await Modal.confirm({
                title: '名稱重複',
                message: `「${name}」已存在，請使用不同的名稱。`,
                confirmText: '確定',
                cancelText: null
            });
            return;
        }

        const newPreset = {
            id:        'preset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            name:      name,
            content:   '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        presets.push(newPreset);
        activePresetId = newPreset.id;

        await Promise.all([
            StorageManager.savePromptPresets(presets),
            StorageManager.saveActivePresetId(activePresetId)
        ]);
        await refreshSyncStatus();

        // 若在對話頁面則自動綁定新提示詞組
        if (currentTabUuid) {
            await StorageManager.bindChatToPreset(currentTabUuid, activePresetId);
            chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
            await refreshSyncStatus();
        }

        customSelect.render();
        updateEditPresetBtnState();
        showSaveStatus();
        sendActivePresetToContentScript();
    });

    // --- 編輯提示詞組內容（開啟編輯器視窗） ---
    if (editPresetBtn) {
        editPresetBtn.addEventListener('click', () => {
            if (!activePresetId) return;
            openEditorWindow('preset', activePresetId);
        });
    }

    // --- 編輯全域提示詞（開啟編輯器視窗） ---
    if (editGlobalPromptBtn) {
        editGlobalPromptBtn.addEventListener('click', () => {
            openEditorWindow('global');
        });
    }

    // --- 全域提示詞開關 ---
    if (globalPromptToggle) {
        globalPromptToggle.addEventListener('change', async () => {
            await StorageManager.saveGlobalPromptEnabled(globalPromptToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // --- 主開關 ---
    enableToggle.addEventListener('change', async () => {
        await StorageManager.saveEnabledState(enableToggle.checked);
        await refreshSyncStatus();
        applyMasterSwitchUI(enableToggle.checked);
        showSaveStatus();
    });

    if (includeThinkingToggle) {
        includeThinkingToggle.addEventListener('change', async () => {
            await StorageManager.saveIncludeThinking(includeThinkingToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (includeReferencesToggle) {
        includeReferencesToggle.addEventListener('change', async () => {
            await StorageManager.saveIncludeReferences(includeReferencesToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (sidebarAutoHideToggle) {
        sidebarAutoHideToggle.addEventListener('change', async () => {
            await StorageManager.saveSidebarAutoHide(sidebarAutoHideToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (hideThinkingToggle) {
        hideThinkingToggle.addEventListener('change', async () => {
            await StorageManager.saveHideThinking(hideThinkingToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (showSystemTimeToggle) {
        showSystemTimeToggle.addEventListener('change', async () => {
            await StorageManager.saveShowSystemTime(showSystemTimeToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // 對話區域寬度開關與 slider
    if (chatWidthToggle && chatWidthSliderContainer) {
        chatWidthToggle.addEventListener('change', async () => {
            const isEnabled = chatWidthToggle.checked;
            chatWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
            await StorageManager.saveChatWidthEnabled(isEnabled);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }
    if (chatWidthSlider && chatWidthValue) {
        chatWidthSlider.addEventListener('input', () => {
            chatWidthValue.textContent = chatWidthSlider.value + '%';
        });
        chatWidthSlider.addEventListener('change', async () => {
            await StorageManager.saveChatWidth(parseInt(chatWidthSlider.value, 10));
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // 編輯輸入框寬度開關與 slider
    if (inputWidthToggle && inputWidthSliderContainer) {
        inputWidthToggle.addEventListener('change', async () => {
            const isEnabled = inputWidthToggle.checked;
            inputWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
            await StorageManager.saveInputWidthEnabled(isEnabled);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }
    if (inputWidthSlider && inputWidthValue) {
        inputWidthSlider.addEventListener('input', () => {
            inputWidthValue.textContent = inputWidthSlider.value + '%';
        });
        inputWidthSlider.addEventListener('change', async () => {
            await StorageManager.saveInputWidth(parseInt(inputWidthSlider.value, 10));
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // --- 匯出 Markdown ---
    const exportMdBtn = document.getElementById('exportMdBtn');
    if (exportMdBtn) {
        exportMdBtn.addEventListener('click', async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('chat.deepseek.com')) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "EXPORT_MARKDOWN",
                    includeThinking:   includeThinkingToggle   ? includeThinkingToggle.checked   : true,
                    includeReferences: includeReferencesToggle ? includeReferencesToggle.checked : true
                }).catch(() => {
                    Toast.show('匯出失敗，請重整頁面後再試');
                });
            } else {
                await Modal.confirm({
                    title: '提示',
                    message: '請在 chat.deepseek.com 頁面使用此功能。',
                    confirmText: '確定',
                    cancelText: null
                });
            }
        });
    }

    // --- JSON 備份與還原 ---
    const exportJsonBtn  = document.getElementById('exportJsonBtn');
    const importJsonBtn  = document.getElementById('importJsonBtn');
    const importJsonInput = document.getElementById('importJsonInput');

    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', async () => {
            try {
                const currentSettings = await StorageManager.getSettings();
                const dataStr = JSON.stringify(currentSettings, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const url  = URL.createObjectURL(blob);

                const a    = document.createElement('a');
                a.href     = url;
                const date = new Date();
                const yyyy = date.getFullYear();
                const mm   = String(date.getMonth() + 1).padStart(2, '0');
                const dd   = String(date.getDate()).padStart(2, '0');
                a.download = `ds-studio-backup-${yyyy}${mm}${dd}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                Toast.show('設定已成功匯出');
            } catch (err) {
                Toast.show('匯出失敗');
            }
        });
    }

    if (importJsonBtn && importJsonInput) {
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

                const isConfirmed = await Modal.confirm({
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

                await StorageManager.restoreSettings(importedSettings);
                await refreshSyncStatus();

                Toast.show('設定已成功還原，請重新整理頁面。');
                setTimeout(() => window.location.reload(), 3000);

            } catch (err) {
                await Modal.confirm({
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

    // --- 復原訊息備份 匯出／匯入 ---
    const exportRestoredBtn   = document.getElementById('exportRestoredBtn');
    const importRestoredBtn   = document.getElementById('importRestoredBtn');
    const importRestoredInput = document.getElementById('importRestoredInput');

    if (exportRestoredBtn) {
        exportRestoredBtn.addEventListener('click', async () => {
            try {
                const data            = await chrome.storage.local.get('restored_messages');
                const restoredMessages = data.restored_messages || {};
                const dataStr = JSON.stringify({ restored_messages: restoredMessages }, null, 2);
                const blob    = new Blob([dataStr], { type: 'application/json' });
                const url     = URL.createObjectURL(blob);

                const a    = document.createElement('a');
                a.href     = url;
                const date = new Date();
                const yyyy = date.getFullYear();
                const mm   = String(date.getMonth() + 1).padStart(2, '0');
                const dd   = String(date.getDate()).padStart(2, '0');
                a.download = `ds-studio-restore-backup-${yyyy}-${mm}-${dd}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                Toast.show('復原備份已成功匯出');
            } catch (err) {
                Toast.show('匯出失敗');
            }
        });
    }

    if (importRestoredBtn && importRestoredInput) {
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
                Toast.show('復原備份已成功匯入');

                // 重新載入 popup 以更新開關狀態
                setTimeout(() => window.location.reload(), 1500);
            } catch (err) {
                await Modal.confirm({
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
    const clearRestoredBtn = document.getElementById('clearRestoredBtn');
    if (clearRestoredBtn) {
        clearRestoredBtn.addEventListener('click', async () => {
            const isConfirmed = await Modal.confirm({
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

                Toast.show('已清除所有復原紀錄');
            } catch (err) {
                Toast.show('清除失敗');
            }
        });
    }

    if (forceSyncBtn) {
        forceSyncBtn.addEventListener('click', async () => {
            const original = forceSyncBtn.textContent;
            forceSyncBtn.disabled = true;
            forceSyncBtn.textContent = '同步中…';
            try {
                const result = await StorageManager.retrySync();
                if (result.success) {
                    Toast.show('已同步完成');
                } else {
                    Toast.show('仍有 ' + result.remainingUnsyncedCount + ' 項未同步');
                }
            } catch (e) {
                Toast.show('同步失敗');
            } finally {
                forceSyncBtn.disabled = false;
                forceSyncBtn.textContent = original;
                await refreshSyncStatus();
            }
        });
    }
});
