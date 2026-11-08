/**
 * DS Studio — StorageManager 鍵值與常數群組
 * 儲存鍵名、預設值、錯誤類別、與純輔助函式。
 */
(function (root) {
    'use strict';

// === 錯誤類別（供 instanceof 檢查） ===

class ChatMapDispatchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ChatMapDispatchError';
    }
}

// === 單一事實來源 helper：遞增 meta 版號 ===

/**
 * 基於前一版 meta 遞增版號並選擇性覆寫 chunkCount / chunkSizes。
 * 所有寫入路徑必須經由此函式建構 newMeta，確保版號單調遞增。
 */
function _buildNextMeta(prevMeta, { chunkCount, chunkSizes }) {
    return {
        version: (prevMeta.version || 0) + 1,
        chunkCount: chunkCount ?? prevMeta.chunkCount,
        chunkSizes: chunkSizes ?? [...prevMeta.chunkSizes],
    };
}

    const bundle = {
    /**
     * Keys used in the extension
     */
    KEYS: {
        PROMPT_PRESETS: 'promptPresets',       // migration detection only
        PRESET_INDEX: 'dsPresetIndex',         // new: ordered ID list
        LOCAL_AUTHORITATIVE: 'dsLocalAuth',    // new: Plan A tracking
        OVERSIZED_KEYS: 'dsOversizedKeys',     // keys permanently blocked from sync (> QUOTA_BYTES_PER_ITEM)
        ACTIVE_PRESET_ID: 'activePresetId',
        PINNED_PRESET_ID: 'pinnedPresetId',
        IS_ENABLED: 'isEnabled',
        GLOBAL_PROMPT_ENABLED: 'globalPromptEnabled',
        INCLUDE_THINKING: 'includeThinking',
        INCLUDE_REFERENCES: 'includeReferences',
        GLOBAL_DEFAULT_PROMPT: 'globalDefaultPrompt',
        CHAT_PRESET_MAP: 'chatPresetMap',
        CHAT_PRESET_MAP_META: 'chatPresetMapMeta',
        CHAT_PRESET_MAP_CHUNK_PREFIX: 'chatPresetMap_',
        SIDEBAR_AUTO_HIDE: 'dsSidebarAutoHide',
        HIDE_THINKING: 'dsHideThinking',
        AUTO_EXPAND_MESSAGES: 'dsAutoExpandMessages',
        AUTO_RETRY: 'isAutoRetryEnabled',
        AUTO_CONTINUE: 'isAutoContinueEnabled',
        AUTO_OPEN_SIDEBAR: 'isAutoOpenSidebarEnabled',
        AUTO_COPY_REPLY: 'isAutoCopyReplyEnabled',
        AUTO_COPY_CODE: 'isAutoCopyCodeEnabled',
        REPLY_NOTIFICATION: 'isReplyNotificationEnabled', // local-only：回覆完成通知開關（裝置層級）
        PREVENT_AUTO_SCROLL: 'dsPreventAutoScroll',
        WEBSEARCH_TOGGLE: 'dsWebSearchToggle',
        SHOW_SYSTEM_TIME: 'dsShowSystemTime',
        CHAT_WIDTH: 'dsChatWidth',
        CHAT_WIDTH_ENABLED: 'dsChatWidthEnabled',
        INPUT_WIDTH: 'dsInputWidth',
        INPUT_WIDTH_ENABLED: 'dsInputWidthEnabled',
        SYNC_INITIALIZED: 'syncInitialized',
        SYNC_CONFLICT_PENDING: 'syncConflictPending',
        PRESET_ORDER_META: 'dsPresetOrderMeta',
        PRESET_TOMBSTONES: 'dsPresetTombstones', // new: 刪除墓碑記錄，防止跨裝置合併時復活已刪除項目
        RESTORED_MESSAGES: 'restored_messages',
    },

    /**
     * Default values for settings
     */
    DEFAULTS: {
        dsPresetIndex: [],
        activePresetId: '',
        pinnedPresetId: '',
        isEnabled: false,
        globalPromptEnabled: true,
        includeThinking: true,
        includeReferences: true,
        globalDefaultPrompt: '',
        chatPresetMap: {},
        dsSidebarAutoHide: false,
        dsHideThinking: false,
        dsAutoExpandMessages: false,
        isAutoRetryEnabled: false,
        isAutoContinueEnabled: false,
        isAutoOpenSidebarEnabled: false,
        isAutoCopyReplyEnabled: false,
        isAutoCopyCodeEnabled: false,
        isReplyNotificationEnabled: false,
        dsPreventAutoScroll: false,
        dsWebSearchToggle: 'on',
        dsShowSystemTime: false,
        dsChatWidth: 70,
        dsChatWidthEnabled: false,
        dsInputWidth: 70,
        dsInputWidthEnabled: false,
        syncInitialized: false,
        syncConflictPending: false,
        dsPresetOrderMeta: { order: [], orderUpdatedAt: 0 },
        dsPresetTombstones: {},
        restored_messages: {},
    },

    /**
     * Typed error constructors for instanceof checks by callers and tests.
     */
    errors: {
        ChatMapDispatchError,
    },

    /**
     * chrome.storage.sync 單一項目的位元組上限。超過此大小的寫入永久無法成功，
     * 必須在送出前攔截，避免污染 dsLocalAuth 重試佇列（見 _set()）。
     */
    QUOTA_BYTES_PER_ITEM: 8192,

    // === 提升至物件的私有狀態 ===

    /**
     * 單一事實來源 meta 版號遞增 helper（從模組層級提升，供 bundle 方法存取）。
     */
    _buildNextMeta,

    /**
     * 每個 preset 各自獨立 storage key 的共同前綴。
     * 組出 preset key 與判斷某 key 是否為 preset 的位置皆引用此常數，前綴僅此一處定義。
     */
    PRESET_KEY_PREFIX: 'dsPreset_',

    /**
     * 待完成權限意圖：popup 於選用權限提示前記下要開啟哪項設定，權限授予後由 service worker 完成開啟（決策 D-26）。
     * 每筆意圖各占一個 chrome.storage.local 金鑰（前綴 + 意圖名），各自獨立寫入與移除；前綴不列入 KEYS，同步合併因此不會把意圖寫進 sync。
     */
    PERMISSION_INTENT_KEY_PREFIX: 'dsPermissionIntent_',

    /** 意圖名稱即 getSettings() 的欄位名。 */
    PERMISSION_INTENTS: {
        AUTO_COPY_REPLY: 'autoCopyReply',
        AUTO_COPY_CODE: 'autoCopyCode',
        REPLY_NOTIFICATION: 'replyNotification',
    },

    /**
     * Helper to get storage key for a specific preset
     */
    _presetKey(id) {
        return this.PRESET_KEY_PREFIX + id;
    },

    /**
     * Reconstruct PromptPreset[] from raw storage data
     */
    _getPresetsFromRawStorage(data) {
        const ids = data[this.KEYS.PRESET_INDEX] || [];
        return ids.map(id => data[this._presetKey(id)]).filter(Boolean);
    },
    };

    root.__DS_StorageManager_keys = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
