// The storage-manager side-effect import installs the bare `StorageManager`
// global that content/censor-reply-restore.js dereferences at load time.
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';

/**
 * Resets every piece of CensorReplyRestore runtime state plus the document body.
 * Extracted verbatim from the outer beforeEach of the original
 * censor-reply-restore.spec.js monolith, shared by all of its split parts.
 */
export function resetCensorReplyRestore() {
    CensorReplyRestore.disable();
    CensorReplyRestore.enabled = false;
    CensorReplyRestore._pendingQueue = [];
    CensorReplyRestore._keyToMessageId = new Map();
    CensorReplyRestore._restoredMessages = {};
    CensorReplyRestore._hasStoredRecordsApplied = false;
    CensorReplyRestore._currentSessionId = null;
    document.body.innerHTML = '';
}

/**
 * Shared DOM helper: builds a user+assistant chat pair in a virtual list container.
 * Returns the assistant message element. `censored: false` renders an all-enabled
 * toolbar instead of the censored (buttons[1]/[4] disabled) pattern.
 */
export function buildChatPair(assistantKey, userPromptText, { censored = true } = {}) {
    const container = document.createElement('div');
    container.className = 'ds-virtual-list-visible-items';

    const userItem = document.createElement('div');
    userItem.setAttribute('data-virtual-list-item-key', 'user-' + assistantKey);
    const userMsg = document.createElement('div');
    userMsg.className = 'ds-message';
    const userContent = document.createElement('div');
    userContent.className = 'fbb737a4';
    userContent.textContent = userPromptText;
    userMsg.appendChild(userContent);
    userItem.appendChild(userMsg);
    container.appendChild(userItem);

    const asstItem = document.createElement('div');
    asstItem.setAttribute('data-virtual-list-item-key', assistantKey);
    const asstMsg = document.createElement('div');
    asstMsg.className = 'ds-message _63c77b1';
    const mainContent = document.createElement('div');
    mainContent.className = 'ds-markdown ds-assistant-message-main-content';
    mainContent.textContent = 'censored text';
    asstMsg.appendChild(mainContent);
    asstItem.appendChild(asstMsg);

    // Toolbar — censored pattern: buttons[1] and buttons[4] disabled
    const toolbar = document.createElement('div');
    toolbar.className = 'ds-flex';
    for (const state of ['enabled', 'disabled', 'enabled', 'enabled', 'disabled']) {
        const btn = document.createElement('button');
        btn.className = 'ds-icon-button';
        if (state === 'disabled' && censored) {
            btn.classList.add('ds-icon-button--disabled');
            btn.setAttribute('aria-disabled', 'true');
        }
        toolbar.appendChild(btn);
    }
    asstItem.appendChild(toolbar);
    container.appendChild(asstItem);

    document.body.appendChild(container);
    return asstMsg;
}
