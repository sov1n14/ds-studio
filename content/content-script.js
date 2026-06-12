/**
 * DS studio v2.4.1 — Content Script
 * Intercepts chat submissions and injects the preset prompt prefix.
 */

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

function injectOverlayStyles() {
    if (document.getElementById('dss-overlay-style')) return;
    const style = document.createElement('style');
    style.id = 'dss-overlay-style';
    style.textContent = `
        ._2be88ba:not(._1551317) { position: relative !important; }
        #dss-preset-overlay {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000; pointer-events: auto;
        }
        #dss-preset-select {
            height: 30px; padding: 5px 6px;
            border: 1px solid rgba(255,255,255,0.25); border-radius: 6px;
            font-size: 13px; font-family: inherit;
            background-color: rgba(0,0,0,0.45); color: #fff;
            cursor: pointer; max-width: 200px; min-width: 80px;
        }
        #dss-preset-select:focus {
            outline: none; border-color: #4d6bfe;
            box-shadow: 0 0 0 2px rgba(77,107,254,0.3);
        }
    `;
    document.head.appendChild(style);
}

function removeOverlayStyles() {
    const style = document.getElementById('dss-overlay-style');
    style?.remove();
}

const PresetOverlay = {
    TARGET_SELECTOR: '._2be88ba',
    selectEl: null, wrapperEl: null, targetEl: null,
    domObserver: null, _debounceTimer: null,

    buildDOM() {
        const wrapper = document.createElement('div');
        wrapper.id = 'dss-preset-overlay';
        const sel = document.createElement('select');
        sel.id = 'dss-preset-select';
        wrapper.appendChild(sel);
        sel.addEventListener('change', (e) => {
            e.stopPropagation();
            this.onSelectChange(sel.value);
        });
        return wrapper;
    },

    mountTo(targetEl) {
        this.unmount();
        this.wrapperEl = this.buildDOM();
        this.selectEl = this.wrapperEl.querySelector('select');
        this.targetEl = targetEl;
        targetEl.appendChild(this.wrapperEl);
    },

    unmount() {
        this.wrapperEl?.remove();
        this.selectEl = null; this.wrapperEl = null; this.targetEl = null;
    },

    render(presets, activeId) {
        if (!this.selectEl) return;
        this.selectEl.innerHTML = '';
        const empty = document.createElement('option');
        empty.value = ''; empty.textContent = '';
        this.selectEl.appendChild(empty);
        (presets || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.name;
            this.selectEl.appendChild(opt);
        });
        this.selectEl.value = activeId || '';
    },

    findAndMount() {
        const found = document.querySelector(this.TARGET_SELECTOR);
        if (!found) return;
        if (this.targetEl === found) return;
        this.mountTo(found);
        this.setVisible(isEnabled);
        StorageManager.getSettings().then(s => {
            const activeId = currentChatUuid ? (chatPresetMap[currentChatUuid] || '') : '';
            this.render(s.promptPresets, activeId);
        });
    },

    setupDomObserver() {
        if (this.domObserver) return;
        this.domObserver = new MutationObserver(() => {
            if (!isExtensionContextValid()) {
                this.domObserver.disconnect(); this.domObserver = null; return;
            }
            clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(() => this.findAndMount(), 150);
        });
        this.domObserver.observe(document.body, { childList: true, subtree: true });
    },

    onSelectChange(newId) {
        if (currentChatUuid && newId !== '') {
            chatPresetMap[currentChatUuid] = newId;
            StorageManager.bindChatToPreset(currentChatUuid, newId).then(() =>
                StorageManager.getChatPresetMap().then(m => { chatPresetMap = m; })
            );
        } else if (currentChatUuid && newId === '') {
            delete chatPresetMap[currentChatUuid];
            StorageManager.unbindChat(currentChatUuid).then(() =>
                StorageManager.getChatPresetMap().then(m => { chatPresetMap = m; })
            );
        } else {
            pendingPresetId = newId || null;
        }
        StorageManager.saveActivePresetId(newId);
        updatePromptPrefixFromBinding();
    },

    setVisible(enabled) {
        if (this.wrapperEl) {
            this.wrapperEl.style.display = enabled ? '' : 'none';
        }
    },

    updateActiveId(id) {
        if (this.selectEl) this.selectEl.value = id || '';
    },

    start(presets, activeId, enable) {
        injectOverlayStyles();
        this.setupDomObserver();
        this.findAndMount();
        this.render(presets, activeId);
        if (enable !== undefined) this.setVisible(enable);
    }
};

// Load initial settings and listen for changes
async function initSettings() {
    // StorageManager is injected before this script in manifest.json
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

    // Handle initial chat (may auto-select a bound preset)
    await handleChatChange();

    // Set up SPA navigation detection
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

function extractUuidFromUrl() {
    const match = window.location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
    return match ? match[1] : null;
}

/**
 * 標記使用者剛在新對話頁面嘗試送出訊息。
 * 僅在「真的觸發訊息送出」時才允許後續的 auto-bind，
 * 避免從新對話頁手動切到既有對話被誤綁。
 * 5 秒未發生 URL 變化會自動清掉，避免送訊息失敗後污染下次導航。
 */
function markChatCreationAttempt() {
    if (currentChatUuid !== null) return;
    awaitingNewChatUuid = true;
    clearTimeout(awaitingNewChatUuidTimer);
    awaitingNewChatUuidTimer = setTimeout(() => {
        awaitingNewChatUuid = false;
    }, 5000);
}

/**
 * Recalculates promptPrefix based on the current chat's UUID binding.
 * If the current chat has a bound preset, uses that preset's content.
 * Otherwise clears promptPrefix.
 */
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

    // Track whether we're coming from a no-UUID state (new chat just got its UUID)
    const hadNoUuid = currentChatUuid === null;
    currentChatUuid = newUuid;

    // Reload chatPresetMap from chunked storage
    chatPresetMap = await StorageManager.getChatPresetMap();

    if (chatPresetMap[newUuid]) {
        // Verify the bound preset still exists
        const settings = await StorageManager.getSettings();
        const presets = settings.promptPresets;
        if (presets.some(p => p.id === chatPresetMap[newUuid])) {
            await StorageManager.saveActivePresetId(chatPresetMap[newUuid]);
            promptPrefix = await StorageManager.getActivePromptContent();
        } else {
            // Stale binding — clean up via transactional API
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

function isExtensionContextValid() {
    try {
        chrome.runtime.id;
        return true;
    } catch {
        return false;
    }
}

function setupNavigationDetection() {
    let lastPath = window.location.pathname;

    // SPA navigation usually involves DOM changes.
    // We observe the body for changes and check if the URL has changed.
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

    // Handle back/forward navigation
    window.addEventListener('popstate', () => {
        if (!isExtensionContextValid()) return;
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            handleChatChange();
        }
    });
}

function formatSystemTime(date = new Date()) {
    // 取得本地系統時間，格式為 yyyy/mm/dd hh:mm:ss（24小時制、零補位）
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function buildInjectionPrefix() {
    const parts = [];
    if (isGlobalPromptEnabled && globalDefaultPrompt) parts.push(globalDefaultPrompt);
    if (promptPrefix) parts.push(promptPrefix);
    const combined = parts.join('\n\n');
    if (!combined) return '';
    return `<system-prompt>\n${combined}\n</system-prompt>`;
}

/**
 * Injects the combined prompt prefix into the textarea and triggers React state updates.
 * @param {HTMLTextAreaElement} textarea
 * @returns {boolean} True if injection happened, false otherwise
 */
function injectPrefix(textarea) {
    if (!isEnabled) return false;

    const injectionPrefix = buildInjectionPrefix();
    // 嘗試從已注入內容中提取原始使用者訊息；若無則使用原始值
    const rawVal = textarea.value;
    const userInputMatch = rawVal.match(/<user-input>\n([\s\S]*)\n<\/user-input>$/);
    const currentVal = userInputMatch ? userInputMatch[1] : rawVal;

    if (currentVal.trim() === '') return false;

    let newVal;
    const systemTimePrefix = showSystemTime ? `Current Time: ${formatSystemTime()}\n\n` : '';
    
    if (injectionPrefix) {
        newVal = `${systemTimePrefix}${injectionPrefix}\n\n<user-input>\n${currentVal}\n</user-input>`;
    } else {
        newVal = `${systemTimePrefix}<user-input>\n${currentVal}\n</user-input>`;
    }

    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeTextAreaValueSetter.call(textarea, newVal);

    // Trigger 'input' event for React 16+
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // Trigger 'change' event for extra safety
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
}

/**
 * 偵測目前是否為行動裝置或行動裝置模擬器。
 * 涵蓋實體裝置（觸控點數）與 Chrome DevTools 行動裝置模擬（User-Agent 字串）。
 */
function isMobileDevice() {
    return navigator.maxTouchPoints > 0 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

/**
 * Handle keydown events to intercept "Enter" (without shift)
 */
document.addEventListener('keydown', (e) => {
    // Only intercept Enter key without Shift
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        if (isInjecting) return;
        if (isMobileDevice()) return;

        const activeElement = document.activeElement;
        
        // Verify it's a textarea
        if (activeElement && activeElement.tagName === 'TEXTAREA') {
            if (activeElement.value.trim() !== '') markChatCreationAttempt();
            // Try injecting
            if (injectPrefix(activeElement)) {
                // Prevent the original event from sending the message too early
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                // Dispatch a new simulated Enter keypress after React commits
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

/**
 * Handle mouse/pointer events to intercept clicking the send button
 */
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

// Initialize on load
initSettings().catch(e => {
    if (e?.message?.includes('Extension context invalidated')) return;
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXPORT_MARKDOWN") {
        (async () => {
            await exportConversationToMarkdown(
                request.includeThinking,
                request.includeReferences
            );
        })().catch(e => {
            if (e?.message?.includes('Extension context invalidated')) return;
        });
    } else if (request.action === "ACTIVE_PRESET_CHANGED") {
        pendingPresetId = request.presetId || null;
        updatePromptPrefixFromBinding();
        PresetOverlay.updateActiveId(request.presetId || '');
    } else if (request.action === "GET_PENDING_PRESET") {
        sendResponse({ pendingPresetId });
    }
});

/**
 * 將單一訊息節點（.ds-message）轉換為 Markdown 字串。
 * 此函式為純查詢，不修改 DOM，不持有模組層級狀態。
 * @param {Element} msg - .ds-message 節點（可為克隆節點）
 * @param {boolean} includeThinking - 是否包含思考過程
 * @param {boolean} includeReferences - 是否包含引用連結
 * @returns {string} 該訊息的 Markdown 字串（含尾端分隔線）
 */
function convertMessageNodeToMarkdown(msg, includeThinking, includeReferences) {
    // Guard: 空節點直接略過
    if (!msg) return '';

    let result = '';

    // AI 回覆：含 .ds-markdown 容器
    const markdownContainer = msg.querySelector('.ds-markdown');

    if (markdownContainer) {
        result += '## DeepSeek\n\n';

        // 思考過程區塊
        const firstThinkBlock = msg.querySelector('.ds-think-content');
        const thinkContainer = firstThinkBlock ? firstThinkBlock.parentNode : null;

        if (thinkContainer && includeThinking) {
            result += '> **Thinking Process:**\n';
            for (const child of thinkContainer.children) {
                if (child.classList.contains('ds-think-content')) {
                    const mdBlock = child.querySelector('.ds-markdown');
                    if (mdBlock) {
                        const text = parseHtmlToMarkdown(mdBlock, { forceReferences: true });
                        const quoted = text.split('\n').map(line => `> ${line}`).join('\n');
                        result += quoted + '\n';
                    }
                } else if (child.querySelector('._08cbf39')) {
                    const span = child.querySelector('._08cbf39');
                    result += `> ${span.textContent.trim()}\n`;
                } else if (child.querySelector('._442c8e7')) {
                    const labelDiv = child.querySelector('._442c8e7');
                    const links = child.querySelectorAll('a._04ab7b1');
                    let line = `> ${labelDiv.textContent.trim()}`;
                    links.forEach(link => {
                        line += ` [${link.textContent.trim()}](${link.href})`;
                    });
                    result += line + '\n';
                }
            }
            result += '\n';
        }

        // 主回覆：最後一個位於思考容器之外的 .ds-markdown
        const allMarkdownBlocks = Array.from(msg.querySelectorAll('.ds-markdown'));
        const mainResponseItems = thinkContainer
            ? allMarkdownBlocks.filter(block => !thinkContainer.contains(block))
            : allMarkdownBlocks;
        const mainResponse = mainResponseItems[mainResponseItems.length - 1];

        if (mainResponse) {
            result += parseHtmlToMarkdown(mainResponse, { forceReferences: includeReferences }) + '\n\n';
        }
    } else {
        // 使用者訊息
        const userContentWrapper = msg.querySelector('.fbb737a4') || msg.firstElementChild;
        let text = userContentWrapper ? userContentWrapper.innerText : msg.innerText;
        text = (text || '').trim();
        if (text) {
            result += '## User\n\n';
            result += text + '\n\n';
        }
    }

    result += '---\n\n';
    return result;
}

/**
 * 利用 Harvest 模組擷取完整對話，並匯出為 Markdown 檔案。
 * 若擷取未完整（超時），仍匯出已取得部分，並附加警告頁尾。
 * @param {boolean} includeThinking - 是否包含思考過程
 * @param {boolean} includeReferences - 是否包含引用連結
 * @returns {Promise<void>}
 */
async function exportConversationToMarkdown(includeThinking = true, includeReferences = true) {
    // 取得 Harvest 模組（由 harvest.js 掛載在 window.DSstudio.Harvest）
    const Harvest = window.DSstudio?.Harvest;
    if (!Harvest) {
        // Harvest 模組不存在（舊版相容回退：直接擷取目前可見訊息）
        const messages = document.querySelectorAll('.ds-virtual-list-visible-items .ds-message');
        if (!messages || messages.length === 0) {
            alert('找不到對話紀錄。請確認您正在 DeepSeek 聊天頁面中。');
            return;
        }
        let markdownContent = _buildMarkdownHeader();
        messages.forEach(msg => {
            markdownContent += convertMessageNodeToMarkdown(msg, includeThinking, includeReferences);
        });
        downloadMarkdown(markdownContent);
        return;
    }

    // 執行完整擷取（遮罩由 Harvest 內部管理）
    const harvestResult = await Harvest.harvestAllMessages();

    // Guard: 完全沒有訊息
    if (!harvestResult.items || harvestResult.items.length === 0) {
        alert('找不到對話紀錄。請確認您正在 DeepSeek 聊天頁面中。');
        return;
    }

    // 組裝 Markdown
    let markdownContent = _buildMarkdownHeader();

    harvestResult.items.forEach(msg => {
        markdownContent += convertMessageNodeToMarkdown(msg, includeThinking, includeReferences);
    });

    // 若擷取不完整，附加警告頁尾
    if (!harvestResult.isComplete) {
        markdownContent += '\n> ⚠️ Export may be incomplete: scroll-harvest timed out before reaching the end.\n';
    }

    downloadMarkdown(markdownContent);
}

/**
 * 建立 Markdown 匯出的標頭字串。
 * @returns {string}
 */
function _buildMarkdownHeader() {
    const exportedAt = new Date().toLocaleString();
    return `# DeepSeek Chat Export\n\n> Exported at: ${exportedAt}\n\n---\n\n`;
}

/**
 * Parses an HTML element recursively into a formatted Markdown string.
 * @param {Element} node - The root element to parse
 * @param {Object} options - Parsing options
 * @param {boolean} options.forceReferences - Whether to extract citation reference links
 * @returns {string} - The resulting markdown string
 */
function parseHtmlToMarkdown(node, options = { forceReferences: true }) {
    let result = '';

    const blockElements = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'TR']);
    const isBlock = (el) => el && el.tagName && blockElements.has(el.tagName);

    function walk(n, parentTagName = null) {
        let text = '';
        if (n.nodeType === Node.TEXT_NODE) {
            // Remove redundant spaces but keep single spaces
            const content = n.textContent.replace(/\s+/g, ' ');
            // Only return if it's not just a single space between blocks
            if (content.trim() !== '' || content === ' ') {
                text += content;
            }
        } else if (n.nodeType === Node.ELEMENT_NODE) {
            const tagName = n.tagName;
            
            // Handle specific element types
            if (tagName === 'BR') {
                text += '\n';
            } else if (tagName === 'STRONG' || tagName === 'B') {
                const inner = parseChildren(n, tagName).trim();
                if (inner) text += `**${inner}**`;
            } else if (tagName === 'EM' || tagName === 'I') {
                const inner = parseChildren(n, tagName).trim();
                if (inner) text += `*${inner}*`;
            } else if (tagName === 'CODE') {
                if (parentTagName !== 'PRE') {
                    text += `\`${n.textContent}\``;
                } else {
                    text += n.textContent; // Handled by PRE
                }
            } else if (tagName === 'A') {
                const citeSpan = n.querySelector('.ds-markdown-cite');
                if (citeSpan) {
                    if (options.forceReferences) {
                        // It's a reference citation like [1]
                        let citeNumber = citeSpan.textContent.replace(/[^0-9]/g, '');
                        if (!citeNumber) {
                           // Try to find the absolute positioned span for the number
                           const numSpan = Array.from(citeSpan.querySelectorAll('span')).find(s => s.style.position === 'absolute');
                           if (numSpan) citeNumber = numSpan.textContent.trim();
                        }
                        if (citeNumber) {
                            text += ` [[link-${citeNumber}]](${n.href})`;
                        }
                    }
                    // If options.forceReferences is false, ignore this node entirely.
                } else {
                    const inner = parseChildren(n, tagName);
                    text += `[${inner}](${n.href})`;
                }
            } else if (tagName === 'BLOCKQUOTE') {
                const inner = parseChildren(n, tagName);
                const quoted = inner.trim().split('\n').map(line => `> ${line}`).join('\n');
                text += `\n\n${quoted}\n\n`;
            } else if (tagName === 'UL') {
                const items = Array.from(n.children).filter(child => child.tagName === 'LI');
                let ulText = '\n';
                items.forEach(li => {
                    ulText += `- ${parseChildren(li, tagName).trim()}\n`;
                });
                text += `${ulText}\n`;
            } else if (tagName === 'OL') {
                const items = Array.from(n.children).filter(child => child.tagName === 'LI');
                let olText = '\n';
                items.forEach((li, idx) => {
                    olText += `${idx + 1}. ${parseChildren(li, tagName).trim()}\n`;
                });
                text += `${olText}\n`;
            } else if (tagName === 'PRE') {
                const codeLang = n.getAttribute('class')?.replace('language-', '') || '';
                text += `\n\n\`\`\`${codeLang}\n${n.textContent}\n\`\`\`\n\n`;
            } else if (/^H[1-6]$/.test(tagName)) {
                const level = parseInt(tagName[1]);
                const prefix = '#'.repeat(level);
                const inner = parseChildren(n, tagName).trim();
                if (inner) {
                    text += `\n\n${prefix} ${inner}\n\n`;
                }
            } else if (tagName === 'TABLE') {
                const rows = Array.from(n.querySelectorAll('tr'));
                if (rows.length > 0) {
                    let tableText = '\n\n';
                    rows.forEach((row, rowIdx) => {
                        const cells = Array.from(row.children).filter(c => c.tagName === 'TH' || c.tagName === 'TD');
                        const cellContents = cells.map(c => parseChildren(c, 'TABLE').trim().replace(/\n/g, ' '));
                        tableText += '| ' + cellContents.join(' | ') + ' |\n';
                        if (rowIdx === 0) {
                            tableText += '|' + cells.map(() => '-').join('|') + '|\n';
                        }
                    });
                    tableText += '\n';
                    text += tableText;
                }
            } else if (tagName === 'P' || tagName === 'DIV') {
                // Handle code blocks: extract span content from <pre>
                if (tagName === 'DIV' && n.classList && Array.from(n.classList).some(c => c.includes('md-code-block'))) {
                    const pre = n.querySelector('pre');
                    if (pre) {
                        const codeLang = pre.getAttribute('class')?.replace('language-', '') || '';
                        const spans = pre.querySelectorAll('span');
                        const codeContent = Array.from(spans).map(s => s.textContent).join('');
                        text += `\n\n\`\`\`${codeLang}\n${codeContent}\n\`\`\`\n\n`;
                    } else {
                        const inner = parseChildren(n, tagName).trim();
                        if (inner) text += `\n${inner}\n`;
                    }
                } else {
                    const inner = parseChildren(n, tagName).trim();
                    if (inner) {
                        text += `\n${inner}\n`;
                    }
                }
            } else {
                // For other tags, just parse children
                text += parseChildren(n, tagName);
            }
        }
        return text;
    }

    function parseChildren(parentNode, parentTagName) {
        let childText = '';
        for (const child of parentNode.childNodes) {
            childText += walk(child, parentTagName);
        }
        return childText;
    }

    result = parseChildren(node, null);

    // Cleanup redundant newlines
    result = result.replace(/\n{3,}/g, '\n\n').trim();
    return result;
}

/**
 * Triggers the download of the markdown content
 */
function downloadMarkdown(content) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Generate filename with timestamp
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    
    a.download = `deepseek-chat-${timestamp}.md`;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// === Test export (no-op in browser) ===
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
        PresetOverlay,
        __resetState: () => {
            clearTimeout(awaitingNewChatUuidTimer);
            isEnabled = false;
            promptPrefix = '';
            globalDefaultPrompt = '';
            isGlobalPromptEnabled = true;
            showSystemTime = false;
            currentChatUuid = null;
            chatPresetMap = {};
            pendingPresetId = null;
            awaitingNewChatUuid = false;
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