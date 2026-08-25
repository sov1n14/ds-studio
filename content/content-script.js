/**
 * DS studio v4.0.0 — Content Script（入口／接線層）
 * 職責：解析同層協作模組、建立 PresetOverlay / PromptInjector / ChatBinding 實例、
 * 持有唯一的 body MutationObserver、處理 background 的設定變更廣播與 popup 訊息路由。
 *
 * 對話綁定狀態機（含所有可變狀態）由 content/chat-binding-controller.js 持有；
 * 匯出管線（Markdown 相關函式）由 content-script.export.js 提供。
 * 設定初始值經 utils/storage-manager.js 取得，後續變更由 background 廣播送達。
 */

// 全域解析根：僅計算一次，其餘相依模組一律直接讀 __root.__DS_X
var __root = (typeof globalThis !== 'undefined' ? globalThis : window);

// 綁定 Export 模組（瀏覽器：由 content-script.export.js 在前載入；Node.js 測試：直接 require）
var __DSExport = __root.__DS_ContentExport ||
    (typeof require !== 'undefined' ? require('./content-script.export.js') : {});
var parseHtmlToMarkdown          = __DSExport.parseHtmlToMarkdown;
var convertMessageNodeToMarkdown = __DSExport.convertMessageNodeToMarkdown;
var exportConversationToMarkdown = __DSExport.exportConversationToMarkdown;
var _buildMarkdownHeader         = __DSExport._buildMarkdownHeader;
var downloadMarkdown             = __DSExport.downloadMarkdown;
var formatSystemTime             = __DSExport.formatSystemTime;
var formatTimezoneOffset         = __DSExport.formatTimezoneOffset;

// Extension 狀態檢查
function isExtensionContextValid() {
    try {
        chrome.runtime.id;
        return true;
    } catch {
        return false;
    }
}

// ── ChatBinding 狀態機（由 chat-binding-controller.js 在前載入） ──────────────
// 本檔不再持有模組層級可變狀態；所有狀態集中於 ChatBinding.state。
var __chatBindingModule = __root.__DS_ChatBindingController ||
    (typeof require !== 'undefined' ? require('./chat-binding-controller.js') : {});
const ChatBinding = __chatBindingModule.createChatBindingController({
    // 延遲取值：PresetOverlay 於下方才建立，實際呼叫時已完成初始化
    getPresetOverlay: () => PresetOverlay,
    isExtensionContextValid,
});
const bindingState = ChatBinding.state;

// ── PresetOverlay factory（由 preset-overlay.controller.js 在前載入） ────────
// ctx 的 getter/setter 直接讀寫 ChatBinding.state，確保狀態異動雙向即時可見。
var __overlayFactory = __root.__DS_PresetOverlay ||
    (typeof require !== 'undefined' ? require('./preset-overlay.controller.js') : {});
const PresetOverlay = __overlayFactory.createPresetOverlay({
    // 相依模組由本組合點注入（manifest 已保證兩者先行載入）
    storageManager:            StorageManager,
    i18n:                      dsI18n,
    getIsEnabled:              () => bindingState.isEnabled,
    getCurrentChatUuid:        () => bindingState.currentChatUuid,
    setCurrentChatUuid:        (v) => { bindingState.currentChatUuid = v; },
    getChatPresetMap:          () => bindingState.chatPresetMap,
    setChatPresetMap:          (v) => { bindingState.chatPresetMap = v; },
    setPendingPresetId:        (v) => { bindingState.pendingPresetId = v; },
    getPendingPresetId:        () => bindingState.pendingPresetId,
    updatePromptPrefixFromBinding: (...a) => ChatBinding.updatePromptPrefixFromBinding(...a),
    isExtensionContextValid:   () => isExtensionContextValid(),
});
// 樣式工具函式由 overlay 模組提供（避免重複定義）
var injectOverlayStyles = __overlayFactory.injectOverlayStyles;
var removeOverlayStyles = __overlayFactory.removeOverlayStyles;

// 唯一的 body 子樹觀察器：SPA 導覽偵測（DOM 變動通常伴隨路徑變更）。
// 新增的 body 層級偵測需求一律掛在此處扇出，不得再開第二個 body 觀察器。
function startBodyObserver(onBodyMutation) {
    const bodyObserver = new MutationObserver(() => {
        if (!isExtensionContextValid()) {
            bodyObserver.disconnect();
            return;
        }
        onBodyMutation();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    return bodyObserver;
}

// 設定初始化
async function initSettings() {
    // i18n 由本檔明確初始化（utils/i18n.js 載入期不做任何事）
    await dsI18n.init();

    // StorageManager 由 manifest.json 在本腳本之前注入
    // 統一同步進入點：先重試推送擱置項目，再拉取雲端收斂後的最新設定
    const settings = await StorageManager.syncNow();
    ChatBinding.applyInitialSettings(settings);

    // 啟動 overlay preset 選單（受主開關控制顯示/隱藏）
    // Must be started before handleChatChange so that updateActiveId() has a
    // valid selectEl to write into when resolving bound-preset lookups.
    PresetOverlay.start(settings.promptPresets, settings.activePresetId ?? '', settings.isEnabled);

    // 處理初始對話（可能自動選取已綁定的 preset）
    await ChatBinding.handleChatChange();

    // SPA 導航偵測：popstate 由狀態機自行掛載，DOM 變動由本檔的單一觀察器扇出。
    // 扇出目標：導覽檢查 + 浮動選單重掛（各自持有自己的去抖動語意）。
    const checkForNavigation = ChatBinding.setupNavigationDetection();
    startBodyObserver(() => {
        checkForNavigation();
        PresetOverlay.scheduleFindAndMount?.();
    });

    // 設定變更廣播的接收註冊（由 background/settings-routes.js 送達）
    chrome.runtime.onMessage.addListener(handleSettingsChangedMessage);
}

/**
 * background 設定變更廣播的接收端；僅處理 DSS_SETTINGS_CHANGED。
 * area 沿用遷移前的範圍：local 與 sync 兩區的變更皆需反映。
 */
function handleSettingsChangedMessage(message) {
    if (!message || message.type !== globalThis.getSettingsMessageTypes().SETTINGS_CHANGED) return;
    if (message.area !== 'local' && message.area !== 'sync') return;
    if (!message.changes) return;
    if (!isExtensionContextValid()) return;

    // 訊息監聽器邊界：無人可接手的失敗一律在此收斂
    applySettingsChanged(message.changes).catch((err) => {
        console.error('[DSS] content-script 設定變更處理失敗:', err);
    });
}

/** 依變更的金鑰同步本地狀態、overlay 選項與全域提示詞開關生效值。 */
async function applySettingsChanged(changes) {
    const KEYS = StorageManager.KEYS;

    if (changes[KEYS.IS_ENABLED]) {
        bindingState.isEnabled = changes[KEYS.IS_ENABLED].newValue;
        if (bindingState.isEnabled) {
            injectOverlayStyles();
            PresetOverlay.setVisible(true);
        } else {
            PresetOverlay.setVisible(false);
            removeOverlayStyles();
        }
    }

    if (changes[KEYS.GLOBAL_DEFAULT_PROMPT]) {
        bindingState.globalDefaultPrompt = changes[KEYS.GLOBAL_DEFAULT_PROMPT].newValue ?? '';
    }

    if (changes[KEYS.SHOW_SYSTEM_TIME]) {
        bindingState.showSystemTime = changes[KEYS.SHOW_SYSTEM_TIME].newValue ?? false;
    }

    const changedKeys = Object.keys(changes);
    const isPresetChanged = changedKeys.some(k => k === KEYS.PRESET_INDEX || k.startsWith('dsPreset_'));
    // 檢查任何 chunk 相關金鑰是否變更（分塊式 chatPresetMap 感知）
    const isChunkKeyTouched = changedKeys.some(k =>
        k === KEYS.CHAT_PRESET_MAP_META ||
        k.startsWith(KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX)
    );
    const isActivePresetIdChanged = Boolean(changes[KEYS.ACTIVE_PRESET_ID]);

    if (isPresetChanged || isChunkKeyTouched) {
        if (isChunkKeyTouched) {
            bindingState.chatPresetMap = await StorageManager.getChatPresetMap();
        }
        await ChatBinding.updatePromptPrefixFromBinding();
        // Overlay 選項清單同步
        const settings = await StorageManager.getSettings();
        PresetOverlay.render(settings.promptPresets, ChatBinding.resolveActivePresetIdFrom(settings));
    }

    // Overlay 當前選中同步（popup 切換後）
    if (isActivePresetIdChanged) {
        const settings = await StorageManager.getSettings();
        PresetOverlay.updateActiveId(ChatBinding.resolveActivePresetIdFrom(settings));
    }

    // 全域提示詞開關生效值重新解析：目前啟用中的 preset 內容變動（含跨裝置同步）、
    // 切換啟用中的 preset（activePresetId 變動），或 legacy 裝置旗標變動皆須觸發，
    // 否則畫面上的 isGlobalPromptEnabled 會停留在舊值，直到下次頁面重新載入才更新。
    if (isPresetChanged || isActivePresetIdChanged || changes[KEYS.GLOBAL_PROMPT_ENABLED]) {
        await ChatBinding.refreshGlobalPromptEnabled();
    }
}

// ── PromptInjector factory（由 prompt-injector.controller.js 在前載入） ──────
// 前綴組裝、textarea 注入、Enter 鍵與送出按鈕攔截皆由該檔負責；
// ctx 的 getter/setter 直接讀寫 ChatBinding.state，確保狀態異動雙向即時可見。
var __injectorFactory = __root.__DS_PromptInjector ||
    (typeof require !== 'undefined' ? require('./prompt-injector.controller.js') : {});
const PromptInjector = __injectorFactory.createPromptInjector({
    getIsEnabled:             () => bindingState.isEnabled,
    getPromptPrefix:          () => bindingState.promptPrefix,
    getGlobalDefaultPrompt:   () => bindingState.globalDefaultPrompt,
    getIsGlobalPromptEnabled: () => bindingState.isGlobalPromptEnabled,
    getShowSystemTime:        () => bindingState.showSystemTime,
    getIsInjecting:           () => bindingState.isInjecting,
    setIsInjecting:           (v) => { bindingState.isInjecting = v; },
    markChatCreationAttempt:  (...a) => ChatBinding.markChatCreationAttempt(...a),
    formatSystemTime:         formatSystemTime,
});
var buildInjectionPrefix = PromptInjector.buildInjectionPrefix;
var injectPrefix = PromptInjector.injectPrefix;

// 初始化：入口檔的刻意啟動點
initSettings().catch(e => {
    if (e?.message?.includes('Extension context invalidated')) return;
});

// 臨時對話側邊欄隱藏：無條件啟動（模組本身無載入期副作用，
// 防禦性參照避免載入順序缺失時拋錯；沿用 sidebar-auto-hide.js 的自啟動模式）
globalThis.TemporaryChatSidebarHide?.init();

// Popup 訊息監聽
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXPORT_MARKDOWN') {
        (async () => {
            await exportConversationToMarkdown(
                request.includeThinking,
                request.includeReferences
            );
        })().catch(e => {
            if (e?.message?.includes('Extension context invalidated')) return;
        });
        // 同步回覆 ack，讓 popup 能區分「內容腳本未注入」與「已收下匯出指令」
        sendResponse({ received: true });
    } else if (request.action === 'ACTIVE_PRESET_CHANGED') {
        bindingState.pendingPresetId = request.presetId ?? null;
        ChatBinding.updatePromptPrefixFromBinding();
        PresetOverlay.updateActiveId(request.presetId || '');
    } else if (request.action === 'GET_PENDING_PRESET') {
        sendResponse({ pendingPresetId: bindingState.pendingPresetId });
    }
});

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        extractUuidFromUrl: (...a) => ChatBinding.extractUuidFromUrl(...a),
        buildInjectionPrefix,
        parseHtmlToMarkdown,
        convertMessageNodeToMarkdown,
        exportConversationToMarkdown,
        _buildMarkdownHeader,
        updatePromptPrefixFromBinding: (...a) => ChatBinding.updatePromptPrefixFromBinding(...a),
        handleChatChange: (...a) => ChatBinding.handleChatChange(...a),
        injectPrefix,
        markChatCreationAttempt: (...a) => ChatBinding.markChatCreationAttempt(...a),
        formatSystemTime,
        formatTimezoneOffset,
        PresetOverlay,
        __resetState: ChatBinding.__resetState,
        __setState: ChatBinding.__setState,
        __getState: ChatBinding.__getState,
    };
}
