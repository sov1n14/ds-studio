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

// ── PresetOverlay factory（由 content-script.overlay.js 在前載入） ────────────
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
    updatePromptPrefixFromBinding: (...a) => updatePromptPrefixFromBinding(...a),
    isExtensionContextValid:   () => isExtensionContextValid(),
});
// 樣式工具函式由 overlay 模組提供（避免重複定義）
var injectOverlayStyles = __overlayFactory.injectOverlayStyles;
var removeOverlayStyles = __overlayFactory.removeOverlayStyles;

// 設定初始化
async function initSettings() {
    // StorageManager 由 manifest.json 在本腳本之前注入
    const settings = await StorageManager.getSettings();
    isEnabled = settings.isEnabled;
    globalDefaultPrompt = settings.globalDefaultPrompt ?? '';
    isGlobalPromptEnabled = settings.globalPromptEnabled ?? true;
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

        if (changes[StorageManager.KEYS.GLOBAL_PROMPT_ENABLED]) {
            isGlobalPromptEnabled = changes[StorageManager.KEYS.GLOBAL_PROMPT_ENABLED].newValue ?? true;
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
    });
}

// URL / Chat 工具函式
function extractUuidFromUrl() {
    const match = window.location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
    return match ? match[1] : null;
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
    let presetId = null;
    if (currentChatUuid && chatPresetMap[currentChatUuid]) {
        presetId = chatPresetMap[currentChatUuid];
    } else if (!currentChatUuid && pendingPresetId) {
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
        promptPrefix = '';
        pendingPresetId = null;
        awaitingNewChatUuid = false;
        clearTimeout(awaitingNewChatUuidTimer);
        PresetOverlay.updateActiveId('');
        return;
    }

    if (newUuid === currentChatUuid) return;

    // 追蹤是否從無 UUID 狀態進入（新對話剛取得 UUID）
    const hadNoUuid = currentChatUuid === null;
    currentChatUuid = newUuid;

    // 從分塊儲存重新載入 chatPresetMap
    chatPresetMap = await StorageManager.getChatPresetMap();

    if (chatPresetMap[newUuid]) {
        // 確認已綁定的 preset 仍然存在
        const settings = await StorageManager.getSettings();
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
            const settings = await StorageManager.getSettings();
            const preset = settings.promptPresets.find(p => p.id === pendingPresetId);
            promptPrefix = preset?.content ?? '';
        } else {
            promptPrefix = '';
        }
    } else {
        // 從新對話手動切到既有對話 / 既有對話間導航：不綁定
        promptPrefix = '';
    }
    awaitingNewChatUuid = false;
    clearTimeout(awaitingNewChatUuidTimer);
    pendingPresetId = null;

    // Overlay 同步當前綁定狀態
    const overlayResolvedId = chatPresetMap[currentChatUuid] || '';
    PresetOverlay.updateActiveId(overlayResolvedId);
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

// 前綴組裝與注入
function buildInjectionPrefix() {
    const parts = [];
    if (isGlobalPromptEnabled && globalDefaultPrompt) parts.push(globalDefaultPrompt);
    if (promptPrefix) parts.push(promptPrefix);
    const combined = parts.join('\n\n');
    if (!combined) return '';
    return `<system-prompt>\n${combined}\n</system-prompt>`;
}

/**
 * 將組合後的提示前綴注入 textarea，並觸發 React 狀態更新。
 * @param {HTMLTextAreaElement} textarea
 * @returns {boolean} 注入成功回傳 true，否則 false
 */
function injectPrefix(textarea) {
    if (!isEnabled) return false;

    const injectionPrefix = buildInjectionPrefix();
    // 嘗試從已注入內容中提取原始使用者訊息；若無則使用原始值
    const rawVal = textarea.value;
    const userInputMatch = rawVal.match(/<user-input>\n([\s\S]*)\n<\/user-input>$/);
    const currentVal = userInputMatch ? userInputMatch[1] : rawVal;

    if (currentVal.trim() === '') return false;

    // formatSystemTime 由 __DS_ContentExport 提供（不讀取模組層級狀態）
    const systemTimePrefix = showSystemTime ? `Current Time: ${formatSystemTime()}\n\n` : '';

    let newVal;
    if (injectionPrefix) {
        newVal = `${systemTimePrefix}${injectionPrefix}\n\n<user-input>\n${currentVal}\n</user-input>`;
    } else {
        newVal = `${systemTimePrefix}<user-input>\n${currentVal}\n</user-input>`;
    }

    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeTextAreaValueSetter.call(textarea, newVal);

    // 觸發 React 16+ 的 input 事件
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
}

/**
 * 偵測目前是否為行動裝置或行動裝置模擬器。
 */
function isMobileDevice() {
    return navigator.maxTouchPoints > 0 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

// 鍵盤事件攔截（Enter 送出）
document.addEventListener('keydown', (e) => {
    // 僅攔截不含 Shift 的 Enter 鍵
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        if (isInjecting) return;
        if (isMobileDevice()) return;

        const activeElement = document.activeElement;

        if (activeElement && activeElement.tagName === 'TEXTAREA') {
            if (activeElement.value.trim() !== '') markChatCreationAttempt();
            if (injectPrefix(activeElement)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                requestAnimationFrame(() => {
                    isInjecting = true;
                    const enterEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true,
                        composed: true
                    });
                    activeElement.dispatchEvent(enterEvent);
                    isInjecting = false;
                });
            }
        }
    }
}, { capture: true });

// 滑鼠/指標事件攔截（點擊送出按鈕）
['pointerdown', 'mousedown', 'click'].forEach(eventType => {
    document.addEventListener(eventType, (e) => {
        if (isInjecting) return;

        // 同時比對桌面版（ds-icon-button）與行動版（ds-button）送出按鈕
        const button = e.target.closest('div.ds-icon-button[role="button"], div.ds-button[role="button"]');

        if (button) {
            const isEditSendButton = button.querySelector('span.ds-button__content')?.textContent.trim() === '发送';

            const isSendButton = button.innerHTML.includes('M8.3125') ||
                                 button.closest('.ba4f09d3') ||
                                 button.parentElement.classList.contains('bf38813a') ||
                                 isEditSendButton;

            if (!isSendButton) return;

            let textarea;
            if (isEditSendButton) {
                let el = button.parentElement;
                while (el && el !== document.body) {
                    const ta = el.querySelector('textarea');
                    if (ta) { textarea = ta; break; }
                    el = el.parentElement;
                }
            } else {
                textarea = document.querySelector('textarea');
            }

            if (textarea && textarea.value.trim() !== '') {
                markChatCreationAttempt();
                const didInject = injectPrefix(textarea);

                if (didInject) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const capturedTextarea = textarea;
                    requestAnimationFrame(() => {
                        const ta = isEditSendButton ? capturedTextarea : document.querySelector('textarea');
                        if (!ta || ta.value.trim() === '') return;
                        isInjecting = true;
                        button.click();
                        isInjecting = false;
                    });
                }
            }
        }
    }, { capture: true });
});

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
        pendingPresetId = request.presetId || null;
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
            if ('awaitingNewChatUuid' in s) awaitingNewChatUuid = s.awaitingNewChatUuid; },
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
