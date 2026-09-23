// 270 lines: single chat-binding state machine — URL extraction, navigation detection, preset resolution, and prompt-prefix derivation share one mutable state object; splitting would scatter closely coupled state transitions across files
/**
 * DS Studio — Chat Binding Controller
 * 單一職責：維護「目前對話 ↔ 提示詞組」的綁定狀態機 —— 對話狀態、SPA 導覽偵測、
 * 綁定解析，以及由此衍生的全域提示詞開關生效值。
 *
 * 邊界：本檔不註冊任何 chrome.runtime 訊息監聽器（由 content-script.js 負責），
 * 設定讀寫一律經 utils/storage-manager.js。
 * 此檔案以 classic script 載入，無 ES import/export，須在 content-script.js 之前載入。
 */

(function (root) {
    'use strict';

    // PresetId Resolver（由 preset-id.resolver.js 在前載入）：與浮動選單共用同一份 preset 優先序規則。
    var __presetIdResolverModule = root.__DS_PresetIdResolver ||
        (typeof require !== 'undefined' ? require('./preset-id.resolver.js') : {});
    var resolveOverlayPresetId = __presetIdResolverModule.resolveOverlayPresetId;

    // Session id 擷取共用工具（由 chat-session-id.js 在前載入；Node.js 測試：直接 require）
    var __chatSessionIdModule = root.DSSChatSessionId ||
        (typeof require !== 'undefined' ? require('../utils/chat-session-id.js') : {});

    // 新對話送出訊息後，允許 auto-bind 的等待時間（毫秒）
    const NEW_CHAT_UUID_WAIT_MS = 5000;


    /** 建立一份全新的初始狀態。 */
    function createInitialBindingState() {
        return {
            isEnabled: false,
            promptPrefix: '',
            globalDefaultPrompt: '',
            isGlobalPromptEnabled: true,
            isShowSystemTime: false,
            isInjecting: false,
            currentChatUuid: null,
            chatPresetMap: {},
            pendingPresetId: null,
            awaitingNewChatUuid: false,
            awaitingNewChatUuidTimer: null,
        };
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

    /**
     * 建立綁定狀態機實例。
     * @param {{getPresetOverlay: Function, isExtensionContextValid: Function}} deps
     *        getPresetOverlay 以延遲取值提供，避免與 overlay 建構順序形成循環相依。
     */
    function createChatBindingController(deps) {
        if (!deps || typeof deps.getPresetOverlay !== 'function') {
            throw new Error('createChatBindingController 需要 getPresetOverlay 函式');
        }
        if (typeof deps.isExtensionContextValid !== 'function') {
            throw new Error('createChatBindingController 需要 isExtensionContextValid 函式');
        }

        const getPresetOverlay = deps.getPresetOverlay;
        const isExtensionContextValid = deps.isExtensionContextValid;
        const state = createInitialBindingState();

        function extractUuidFromUrl() {
            return __chatSessionIdModule.extractChatSessionId();
        }

        /** 以目前狀態 + 一份完整 settings 解析浮動選單應顯示的 preset id。 */
        function resolveActivePresetIdFrom(settings) {
            return resolveOverlayPresetId({
                chatUuid: state.currentChatUuid,
                chatPresetMap: state.chatPresetMap,
                pendingPresetId: state.pendingPresetId,
                pinnedPresetId: settings.pinnedPresetId,
                presets: settings.promptPresets,
            });
        }

        /** 由 initSettings 於啟動時套用首次讀取到的設定。 */
        function applyInitialSettings(settings) {
            state.isEnabled = settings.isEnabled;
            state.globalDefaultPrompt = settings.globalDefaultPrompt ?? '';
            state.isShowSystemTime = settings.isShowSystemTime ?? false;
            state.chatPresetMap = settings.chatPresetMap ?? {};
            state.isGlobalPromptEnabled = resolveDisplayedGlobalPromptEnabled(settings);
        }

        // 全域提示詞開關一律以「浮動選單顯示的 preset」為準（單一真相來源），
        // 而非可能與目前對話脫勾的 settings.activePresetId，確保顯示與實際注入一致。
        function resolveDisplayedGlobalPromptEnabled(settings) {
            return resolveGlobalPromptEnabledFor(resolveActivePresetIdFrom(settings), settings);
        }

        // 重新讀取設定並解析全域提示詞開關；供設定變更廣播在 preset 相關金鑰
        //（preset 內容、activePresetId、chatPresetMap、legacy 旗標）變動時，
        // 以及 popup 切換 pending preset 時呼叫，確保下一則送出訊息即反映最新生效值。
        async function refreshGlobalPromptEnabled() {
            const settings = await StorageManager.getSettings();
            state.isGlobalPromptEnabled = resolveDisplayedGlobalPromptEnabled(settings);
        }

        // 標記使用者在新對話頁面送出訊息，允許後續 auto-bind；逾時後自動清除。
        function markChatCreationAttempt() {
            if (state.currentChatUuid !== null) return;
            state.awaitingNewChatUuid = true;
            clearTimeout(state.awaitingNewChatUuidTimer);
            state.awaitingNewChatUuidTimer = setTimeout(() => {
                state.awaitingNewChatUuid = false;
            }, NEW_CHAT_UUID_WAIT_MS);
        }

        // 根據當前聊天 UUID 綁定重新計算 promptPrefix；無綁定則清空。
        async function updatePromptPrefixFromBinding() {
            // pendingPresetId 僅適用於「尚無 currentChatUuid」的情境（新對話尚未取得 UUID 前的暫存選擇）。
            // 一旦已綁定至具體對話，該對話的綁定狀態必須完全由 chatPresetMap 決定，
            // 避免因其他管道（例如 ACTIVE_PRESET_CHANGED 訊息）殘留的過期 pendingPresetId
            // 在使用者明確選擇「無提示詞組」後被誤用而重新注入舊提示詞組。
            let presetId = null;
            if (state.currentChatUuid) {
                presetId = state.chatPresetMap[state.currentChatUuid] || null;
            } else if (state.pendingPresetId) {
                presetId = state.pendingPresetId;
            }

            if (!presetId) {
                state.promptPrefix = '';
                return;
            }

            const settings = await StorageManager.getSettings();
            const preset = settings.promptPresets.find(p => p.id === presetId);
            state.promptPrefix = preset?.content ?? '';
        }

        async function handleChatChange() {
            const newUuid = extractUuidFromUrl();

            if (!newUuid) {
                state.currentChatUuid = null;
                state.awaitingNewChatUuid = false;
                clearTimeout(state.awaitingNewChatUuidTimer);

                // 新對話：若有已釘選的預設提示詞組且該組仍存在，預先選中它
                const settings = await StorageManager.getSettings();
                const pinnedId = settings.pinnedPresetId;
                const pinnedPreset = pinnedId && settings.promptPresets.find(p => p.id === pinnedId);

                if (pinnedPreset) {
                    state.pendingPresetId = pinnedId;
                    await StorageManager.saveActivePresetId(pinnedId);
                    await updatePromptPrefixFromBinding();
                    getPresetOverlay().updateActiveId(pinnedId);
                } else {
                    state.promptPrefix = '';
                    state.pendingPresetId = null;
                    getPresetOverlay().updateActiveId('');
                }
                // 導覽當下立即重新解析全域提示詞開關生效值（SPA 導覽不觸發設定變更廣播）；
                // 生效 preset id 由 resolveOverlayPresetId 統一解析，與浮動選單共用同一份優先序規則。
                const resolvedNewChatId = resolveActivePresetIdFrom(settings);
                state.isGlobalPromptEnabled = resolveGlobalPromptEnabledFor(resolvedNewChatId, settings);
                return;
            }

            if (newUuid === state.currentChatUuid) return;

            // 追蹤是否從無 UUID 狀態進入（新對話剛取得 UUID）
            const hadNoUuid = state.currentChatUuid === null;
            state.currentChatUuid = newUuid;

            // 從分塊儲存重新載入 chatPresetMap
            state.chatPresetMap = await StorageManager.getChatPresetMap();

            const settings = await StorageManager.getSettings();

            if (state.chatPresetMap[newUuid]) {
                // 確認已綁定的 preset 仍然存在
                const presets = settings.promptPresets;
                if (presets.some(p => p.id === state.chatPresetMap[newUuid])) {
                    await StorageManager.saveActivePresetId(state.chatPresetMap[newUuid]);
                    state.promptPrefix = await StorageManager.getActivePromptContent();
                } else {
                    // 綁定已失效 — 交由 service worker 清除後重新讀取
                    await StorageManager.unbindChat(newUuid);
                    state.chatPresetMap = await StorageManager.getChatPresetMap();
                    state.promptPrefix = '';
                }
            } else if (hadNoUuid && state.awaitingNewChatUuid) {
                // 真的是「新對話送出訊息 → DeepSeek 配 UUID」場景，才自動綁定
                if (state.pendingPresetId) {
                    const boundPresetId = state.pendingPresetId;
                    await StorageManager.bindChatToPreset(newUuid, boundPresetId);
                    state.chatPresetMap = await StorageManager.getChatPresetMap();
                    const preset = settings.promptPresets.find(p => p.id === boundPresetId);
                    state.promptPrefix = preset?.content ?? '';
                } else {
                    state.promptPrefix = '';
                }
            } else {
                // 從新對話手動切到既有對話 / 既有對話間導航：不綁定。
                state.promptPrefix = '';
            }
            state.awaitingNewChatUuid = false;
            clearTimeout(state.awaitingNewChatUuidTimer);
            state.pendingPresetId = null;

            // 生效 preset id 解析同上（既有對話規則等同「完全依 chatPresetMap 決定」）。
            const resolvedActiveId = resolveActivePresetIdFrom(settings);
            // 導覽當下立即重新解析全域提示詞開關生效值，理由同上（新對話分支）。
            state.isGlobalPromptEnabled = resolveGlobalPromptEnabledFor(resolvedActiveId, settings);

            // Overlay 同步當前綁定狀態
            getPresetOverlay().updateActiveId(resolvedActiveId);
        }

        /**
         * SPA 導航偵測。
         * 本函式不自建 MutationObserver：body 子樹變動一律由 content-script.js 的
         * 單一觀察器扇出，這裡只回傳「收到 DOM 變動時該做什麼」的回呼，
         * 並自行掛上 popstate（上一頁/下一頁導航）監聽。
         * @returns {Function} 供單一 body 觀察器呼叫的導覽檢查回呼
         */
        function setupNavigationDetection() {
            let lastPath = window.location.pathname;

            const checkForNavigation = () => {
                if (window.location.pathname === lastPath) return;
                lastPath = window.location.pathname;
                // 導覽回呼無人可接住 rejection（含 popstate 路徑），於此記錄避免 unhandled rejection
                handleChatChange().catch(err => console.error('[DSS] chat-binding handleChatChange 失敗:', err));
            };

            window.addEventListener('popstate', () => {
                if (!isExtensionContextValid()) return;
                checkForNavigation();
            });

            return checkForNavigation;
        }

        return {
            state,
            applyInitialSettings,
            extractUuidFromUrl,
            resolveActivePresetIdFrom,
            refreshGlobalPromptEnabled,
            markChatCreationAttempt,
            updatePromptPrefixFromBinding,
            handleChatChange,
            setupNavigationDetection
        };
    }

    // 瀏覽器 classic script 環境：掛載至全域命名空間
    root.__DS_ChatBindingController = { createChatBindingController };

    // Node.js / Vitest 測試環境
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createChatBindingController };
    }

})(globalThis);
