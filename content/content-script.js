/**
 * DS studio v4.0.0 — Content Script
 * 攔截聊天送出事件，注入預設提示前綴。
 * 匯出管線（Markdown 相關函式）由 content-script.export.js 提供，
 * 透過 __DS_ContentExport 全域命名空間於此處綁定。
 */

// 模組層級狀態變數
let isEnabled = false;
let promptPrefix = '';
let globalDefaultPrompt = '';
let isGlobalPromptEnabled = true;
let showSystemTime = false;
let isInjecting = false;
let currentChatUuid = null;
let chatPresetMap = {};
let pendingPresetId = null;
let awaitingNewChatUuid = false;
let awaitingNewChatUuidTimer = null;

// 綁定 Export 模組（瀏覽器：由 content-script.export.js 在前載入；Node.js 測試：直接 require）
var __DSExport = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_ContentExport ||
    (typeof require !== 'undefined' ? require('./content-script.export.js') : {});
var parseHtmlToMarkdown          = __DSExport.parseHtmlToMarkdown;
var convertMessageNodeToMarkdown = __DSExport.convertMessageNodeToMarkdown;
var exportConversationToMarkdown = __DSExport.exportConversationToMarkdown;
var _buildMarkdownHeader         = __DSExport._buildMarkdownHeader;
var downloadMarkdown             = __DSExport.downloadMarkdown;
var formatSystemTime             = __DSExport.formatSystemTime;
var formatTimezoneOffset         = __DSExport.formatTimezoneOffset;

// ── PresetOverlay factory（由 preset-overlay.controller.js 在前載入） ────────
// 取得 factory 參照並以 ctx 物件實例化，ctx 的 getter/setter 直接讀寫本模組的
// let 變數，確保 __setState/__getState 的異動對 overlay 即時可見，反之亦然。
var __overlayFactory = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_PresetOverlay ||
    (typeof require !== 'undefined' ? require('./preset-overlay.controller.js') : {});
const PresetOverlay = __overlayFactory.createPresetOverlay({
    getIsEnabled:              () => isEnabled,
    getCurrentChatUuid:        () => currentChatUuid,
    setCurrentChatUuid:        (v) => { currentChatUuid = v; },
    getChatPresetMap:          () => chatPresetMap,
    setChatPresetMap:          (v) => { chatPresetMap = v; },
    setPendingPresetId:        (v) => { pendingPresetId = v; },
    getPendingPresetId:        () => pendingPresetId,
    updatePromptPrefixFromBinding: (...a) => updatePromptPrefixFromBinding(...a),
    isExtensionContextValid:   () => isExtensionContextValid(),
});
// 樣式工具函式由 overlay 模組提供（避免重複定義）
var injectOverlayStyles = __overlayFactory.injectOverlayStyles;
var removeOverlayStyles = __overlayFactory.removeOverlayStyles;

// PresetId Resolver（由 preset-id.resolver.js 在前載入）：與浮動選單共用同一份 preset 優先序規則。
var __presetIdResolverModule = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_PresetIdResolver ||
    (typeof require !== 'undefined' ? require('./preset-id.resolver.js') : {});
var resolveOverlayPresetId = __presetIdResolverModule.resolveOverlayPresetId;

// Session id 擷取共用工具（由 chat-session-id.js 在前載入；Node.js 測試：直接 require）
var __DSChatSessionId = (typeof globalThis !== 'undefined' ? globalThis : window).DSSChatSessionId ||
    (typeof require !== 'undefined' ? require('./chat-session-id.js') : {});

// 設定初始化
async function initSettings() {
    // StorageManager 由 manifest.json 在本腳本之前注入
    // 統一同步進入點：先重試推送擱置項目，再拉取雲端收斂後的最新設定
    const settings = await StorageManager.syncNow();
    isEnabled = settings.isEnabled;
    globalDefaultPrompt = settings.globalDefaultPrompt ?? '';
    isGlobalPromptEnabled = resolveGlobalPromptEnabledFromSettings(settings);
    showSystemTime = settings.showSystemTime ?? false;
    chatPresetMap = settings.chatPresetMap ?? {};

    // 啟動 overlay preset 選單（受主開關控制顯示/隱藏）
    // Must be started before handleChatChange so that updateActiveId() has a
    // valid selectEl to write into when resolving bound-preset lookups.
    PresetOverlay.start(settings.promptPresets, settings.activePresetId ?? '', settings.isEnabled);

    // 處理初始對話（可能自動選取已綁定的 preset）
    await handleChatChange();

    // 設定 SPA 導航偵測
    setupNavigationDetection();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (!isExtensionContextValid()) return;
        if (namespace !== 'local' && namespace !== 'sync') return;

        if (changes[StorageManager.KEYS.IS_ENABLED]) {
            isEnabled = changes[StorageManager.KEYS.IS_ENABLED].newValue;
            if (isEnabled) {
                injectOverlayStyles();
                PresetOverlay.setVisible(true);
            } else {
                PresetOverlay.setVisible(false);
                removeOverlayStyles();
            }
        }

        if (changes[StorageManager.KEYS.GLOBAL_DEFAULT_PROMPT]) {
            globalDefaultPrompt = changes[StorageManager.KEYS.GLOBAL_DEFAULT_PROMPT].newValue ?? '';
        }

        if (changes[StorageManager.KEYS.SHOW_SYSTEM_TIME]) {
            showSystemTime = changes[StorageManager.KEYS.SHOW_SYSTEM_TIME].newValue ?? false;
        }

        const presetChanged = Object.keys(changes).some(k =>
            k === StorageManager.KEYS.PRESET_INDEX ||
            k.startsWith('dsPreset_')
        );
        // 檢查任何 chunk 相關金鑰是否變更（分塊式 chatPresetMap 感知）
        const chunkKeysTouched = Object.keys(changes).some(k =>
            k === StorageManager.KEYS.CHAT_PRESET_MAP_META ||
            k.startsWith(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX)
        );
        if (presetChanged || chunkKeysTouched) {
            if (chunkKeysTouched) {
                StorageManager.getChatPresetMap().then(m => { chatPresetMap = m; });
            }
            updatePromptPrefixFromBinding();
            // Overlay 選項清單同步
            StorageManager.getSettings().then(s => {
                const resolvedId = currentChatUuid
                    ? (chatPresetMap[currentChatUuid] || '')
                    : (pendingPresetId || '');
                PresetOverlay.render(s.promptPresets, resolvedId);
            });
        }
        // Overlay 當前選中同步（popup 切換後）
        if (changes[StorageManager.KEYS.ACTIVE_PRESET_ID]) {
            const resolvedId = currentChatUuid
                ? (chatPresetMap[currentChatUuid] || '')
                : (pendingPresetId || '');
            PresetOverlay.updateActiveId(resolvedId);
        }

        // 全域提示詞開關生效值重新解析：目前啟用中的 preset 內容變動（含跨裝置同步）、
        // 切換啟用中的 preset（activePresetId 變動），或 legacy 裝置旗標變動皆須觸發，
        // 否則畫面上的 isGlobalPromptEnabled 會停留在舊值，直到下次頁面重新載入才更新。
        if (presetChanged || changes[StorageManager.KEYS.ACTIVE_PRESET_ID] || changes[StorageManager.KEYS.GLOBAL_PROMPT_ENABLED]) {
            refreshGlobalPromptEnabled();
        }
    });
}

// 純函式：以「指定的作用中 preset id」+ 完整 settings 決定全域提示詞開關生效值。
// 找不到對應 preset（含傳入空字串 —— 代表目前對話無綁定/無選取）時回退至 legacy
// 裝置層級旗標。抽出此輔助函式，讓 handleChatChange() 能在每次導覽時，直接用剛解析
// 出的正確 preset id（而非可能與目前對話脫勾的 settings.activePresetId）重新計算，
// 避免切換對話後沿用上一個對話殘留的 preset 開關值。
function resolveGlobalPromptEnabledFor(activePresetId, settings) {
    const activePreset = settings.promptPresets.find(p => p.id === activePresetId) ?? null;
    return StorageManager.resolveGlobalPromptEnabled(activePreset, settings.globalPromptEnabled ?? true);
}

// 純函式：由完整 settings 物件解析目前生效中的全域提示詞開關。
// 以「目前啟用中的 preset」自身欄位為準（StorageManager.resolveGlobalPromptEnabled 內部
// 以 ?? true 處理欄位缺漏），找不到啟用中的 preset 時回退至 legacy 裝置層級旗標。
function resolveGlobalPromptEnabledFromSettings(settings) {
    return resolveGlobalPromptEnabledFor(settings.activePresetId, settings);
}

// 重新讀取設定並解析全域提示詞開關；供 chrome.storage.onChanged 監聽器在 preset 相關
// 金鑰（啟用中 preset 自身內容、activePresetId、legacy 旗標）變動時呼叫，
// 確保下一則送出訊息即反映最新生效值，不需重新整理頁面。
async function refreshGlobalPromptEnabled() {
    const settings = await StorageManager.getSettings();
    isGlobalPromptEnabled = resolveGlobalPromptEnabledFromSettings(settings);
}

// URL / Chat 工具函式
function extractUuidFromUrl() {
    return __DSChatSessionId.extractChatSessionId();
}

// 標記使用者在新對話頁面送出訊息，允許後續 auto-bind；5 秒後自動清除。
function markChatCreationAttempt() {
    if (currentChatUuid !== null) return;
    awaitingNewChatUuid = true;
    clearTimeout(awaitingNewChatUuidTimer);
    awaitingNewChatUuidTimer = setTimeout(() => {
        awaitingNewChatUuid = false;
    }, 5000);
}

// 根據當前聊天 UUID 綁定重新計算 promptPrefix；無綁定則清空。
async function updatePromptPrefixFromBinding() {
    // pendingPresetId 僅適用於「尚無 currentChatUuid」的情境（新對話尚未取得 UUID 前的暫存選擇）。
    // 一旦已綁定至具體對話，該對話的綁定狀態必須完全由 chatPresetMap 決定，
    // 避免因其他管道（例如 ACTIVE_PRESET_CHANGED 訊息）殘留的過期 pendingPresetId
    // 在使用者明確選擇「無提示詞組」後被誤用而重新注入舊提示詞組。
    let presetId = null;
    if (currentChatUuid) {
        presetId = chatPresetMap[currentChatUuid] || null;
    } else if (pendingPresetId) {
        presetId = pendingPresetId;
    }

    if (!presetId) {
        promptPrefix = '';
        return;
    }

    const settings = await StorageManager.getSettings();
    const preset = settings.promptPresets.find(p => p.id === presetId);
    promptPrefix = preset?.content ?? '';
}

async function handleChatChange() {
    const newUuid = extractUuidFromUrl();

    if (!newUuid) {
        currentChatUuid = null;
        awaitingNewChatUuid = false;
        clearTimeout(awaitingNewChatUuidTimer);

        // 新對話：若有已釘選的預設提示詞組且該組仍存在，預先選中它
        const settings = await StorageManager.getSettings();
        const pinnedId = settings.pinnedPresetId;
        const pinnedPreset = pinnedId && settings.promptPresets.find(p => p.id === pinnedId);

        if (pinnedPreset) {
            pendingPresetId = pinnedId;
            await StorageManager.saveActivePresetId(pinnedId);
            await updatePromptPrefixFromBinding();
            PresetOverlay.updateActiveId(pinnedId);
        } else {
            promptPrefix = '';
            pendingPresetId = null;
            PresetOverlay.updateActiveId('');
        }
        // 導覽當下立即重新解析全域提示詞開關生效值（SPA 導覽不觸發 chrome.storage.onChanged）；
        // 生效 preset id 由 resolveOverlayPresetId 統一解析，與浮動選單共用同一份優先序規則。
        const resolvedActiveId = resolveOverlayPresetId({ chatUuid: currentChatUuid, chatPresetMap, pendingPresetId, pinnedPresetId: settings.pinnedPresetId, presets: settings.promptPresets });
        isGlobalPromptEnabled = resolveGlobalPromptEnabledFor(resolvedActiveId, settings);
        return;
    }

    if (newUuid === currentChatUuid) return;

    // 追蹤是否從無 UUID 狀態進入（新對話剛取得 UUID）
    const hadNoUuid = currentChatUuid === null;
    currentChatUuid = newUuid;

    // 從分塊儲存重新載入 chatPresetMap
    chatPresetMap = await StorageManager.getChatPresetMap();

    const settings = await StorageManager.getSettings();

    if (chatPresetMap[newUuid]) {
        // 確認已綁定的 preset 仍然存在
        const presets = settings.promptPresets;
        if (presets.some(p => p.id === chatPresetMap[newUuid])) {
            await StorageManager.saveActivePresetId(chatPresetMap[newUuid]);
            promptPrefix = await StorageManager.getActivePromptContent();
        } else {
            // 綁定已失效 — 透過交易式 API 清除
            chatPresetMap = await StorageManager.mutateChatPresetMap(map => {
                delete map[newUuid];
            });
            promptPrefix = '';
        }
    } else if (hadNoUuid && awaitingNewChatUuid) {
        // 真的是「新對話送出訊息 → DeepSeek 配 UUID」場景，才自動綁定
        if (pendingPresetId) {
            chatPresetMap = await StorageManager.mutateChatPresetMap(map => {
                map[newUuid] = pendingPresetId;
            });
            const preset = settings.promptPresets.find(p => p.id === pendingPresetId);
            promptPrefix = preset?.content ?? '';
        } else {
            promptPrefix = '';
        }
    } else {
        // 從新對話手動切到既有對話 / 既有對話間導航：不綁定。
        promptPrefix = '';
    }
    awaitingNewChatUuid = false;
    clearTimeout(awaitingNewChatUuidTimer);
    pendingPresetId = null;

    // 生效 preset id 解析同上（既有對話規則等同「完全依 chatPresetMap 決定」）。
    const resolvedActiveId = resolveOverlayPresetId({ chatUuid: currentChatUuid, chatPresetMap, pendingPresetId: null, pinnedPresetId: settings.pinnedPresetId, presets: settings.promptPresets });
    // 導覽當下立即重新解析全域提示詞開關生效值，理由同上（新對話分支）。
    isGlobalPromptEnabled = resolveGlobalPromptEnabledFor(resolvedActiveId, settings);

    // Overlay 同步當前綁定狀態
    PresetOverlay.updateActiveId(resolvedActiveId);
}

// Extension 狀態檢查
function isExtensionContextValid() {
    try {
        chrome.runtime.id;
        return true;
    } catch {
        return false;
    }
}

// SPA 導航偵測
function setupNavigationDetection() {
    let lastPath = window.location.pathname;

    // SPA 導航通常伴隨 DOM 變化；觀察 body 並比對 URL 是否改變
    const navObserver = new MutationObserver(() => {
        if (!isExtensionContextValid()) {
            navObserver.disconnect();
            return;
        }
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            handleChatChange();
        }
    });

    navObserver.observe(document.body, { childList: true, subtree: true });

    // 處理上一頁/下一頁導航
    window.addEventListener('popstate', () => {
        if (!isExtensionContextValid()) return;
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            handleChatChange();
        }
    });
}

// ── PromptInjector factory（由 prompt-injector.controller.js 在前載入） ──────
// 前綴組裝、textarea 注入、Enter 鍵與送出按鈕攔截皆移至該檔；ctx 的 getter/setter
// 直接讀寫本模組的 let 變數，確保狀態異動雙向即時可見。
var __injectorFactory = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_PromptInjector ||
    (typeof require !== 'undefined' ? require('./prompt-injector.controller.js') : {});
const PromptInjector = __injectorFactory.createPromptInjector({
    getIsEnabled:             () => isEnabled,
    getPromptPrefix:          () => promptPrefix,
    getGlobalDefaultPrompt:   () => globalDefaultPrompt,
    getIsGlobalPromptEnabled: () => isGlobalPromptEnabled,
    getShowSystemTime:        () => showSystemTime,
    getIsInjecting:           () => isInjecting,
    setIsInjecting:           (v) => { isInjecting = v; },
    markChatCreationAttempt:  (...a) => markChatCreationAttempt(...a),
    formatSystemTime:         formatSystemTime,
});
var buildInjectionPrefix = PromptInjector.buildInjectionPrefix;
var injectPrefix = PromptInjector.injectPrefix;

// 初始化
initSettings().catch(e => {
    if (e?.message?.includes('Extension context invalidated')) return;
});

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
    } else if (request.action === 'ACTIVE_PRESET_CHANGED') {
        pendingPresetId = request.presetId ?? null;
        updatePromptPrefixFromBinding();
        PresetOverlay.updateActiveId(request.presetId || '');
    } else if (request.action === 'GET_PENDING_PRESET') {
        sendResponse({ pendingPresetId });
    }
});

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        extractUuidFromUrl,
        buildInjectionPrefix,
        parseHtmlToMarkdown,
        convertMessageNodeToMarkdown,
        exportConversationToMarkdown,
        _buildMarkdownHeader,
        updatePromptPrefixFromBinding,
        handleChatChange,
        injectPrefix,
        markChatCreationAttempt,
        formatSystemTime,
        formatTimezoneOffset,
        PresetOverlay,
        __resetState: () => {
            clearTimeout(awaitingNewChatUuidTimer);
            isEnabled = false; promptPrefix = ''; globalDefaultPrompt = '';
            isGlobalPromptEnabled = true; showSystemTime = false;
            currentChatUuid = null; chatPresetMap = {};
            pendingPresetId = null; awaitingNewChatUuid = false;
        },
        __setState: (s) => {
            if ('isEnabled' in s) isEnabled = s.isEnabled;
            if ('promptPrefix' in s) promptPrefix = s.promptPrefix;
            if ('globalDefaultPrompt' in s) globalDefaultPrompt = s.globalDefaultPrompt;
            if ('isGlobalPromptEnabled' in s) isGlobalPromptEnabled = s.isGlobalPromptEnabled;
            if ('showSystemTime' in s) showSystemTime = s.showSystemTime;
            if ('currentChatUuid' in s) currentChatUuid = s.currentChatUuid;
            if ('chatPresetMap' in s) chatPresetMap = s.chatPresetMap;
            if ('pendingPresetId' in s) pendingPresetId = s.pendingPresetId;
            if ('awaitingNewChatUuid' in s) awaitingNewChatUuid = s.awaitingNewChatUuid;
        },
        __getState: () => ({
            isEnabled,
            promptPrefix,
            globalDefaultPrompt,
            isGlobalPromptEnabled,
            showSystemTime,
            currentChatUuid,
            chatPresetMap,
            pendingPresetId,
            awaitingNewChatUuid,
        }),
    };
}
