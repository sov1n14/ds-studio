// The storage-manager side-effect import installs the bare `StorageManager`
// global that content/censor-reply-restore.js dereferences at load time.
import '../../utils/storage-manager.js';
import fs from 'fs';
import path from 'path';
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

// Live DeepSeek markup of a finished conversation (visible virtual-list items, message text replaced by placeholders): item 0 is the user message (.ds-message > div > .ds-collapsible-text, plus its 2-button edit/copy row), item 1 is the assistant message followed by an outer .ds-flex wrapper whose first child is the 6-button toolbar group. Note that the live user .ds-message carries the same `_63c77b1` hash class as the assistant one, so that class does not tell the two apart.
const CHAT_SNAPSHOT = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/conv2-finished-visible-items-collapsible.html'), 'utf8');

function parseSnapshot() {
    const host = document.createElement('div');
    host.innerHTML = CHAT_SNAPSHOT;
    const container = host.firstElementChild;
    const [userItem, assistantItem] = container.children;
    return { container, userItem, assistantItem };
}

/**
 * Returns a detached user virtual-list item cloned from the live snapshot, keyed by `key` and showing `promptText`.
 */
export function createUserItem(key, promptText) {
    const { userItem } = parseSnapshot();
    userItem.setAttribute('data-virtual-list-item-key', key);
    userItem.querySelector('.ds-collapsible-text span').textContent = promptText;
    return userItem;
}

/**
 * Returns a detached assistant virtual-list item cloned from the live snapshot, keyed by `key`.
 * `censored: true` disables the regenerate (index 1) and read-aloud (index 4) toolbar buttons the way a censored reply renders them: index 1 gets `ds-button--disabled` + `aria-disabled="true"`, index 4 gets `ds-button--disabled` only. `censored: false` keeps the toolbar as captured (all enabled).
 */
export function createAssistantItem(key, { censored = true } = {}) {
    const { assistantItem } = parseSnapshot();
    assistantItem.setAttribute('data-virtual-list-item-key', key);
    assistantItem.querySelector('.ds-markdown').innerHTML = '<p class="ds-markdown-paragraph"><span>censored text</span></p>';
    if (censored) {
        const buttons = toolbarButtonsOf(assistantItem);
        buttons[1].classList.add('ds-button--disabled');
        buttons[1].setAttribute('aria-disabled', 'true');
        buttons[4].classList.add('ds-button--disabled');
    }
    return assistantItem;
}

/**
 * Toolbar buttons of a snapshot assistant item, in DOM order. The live assistant item holds no other role=button element.
 */
export function toolbarButtonsOf(assistantItem) {
    return [...assistantItem.querySelectorAll('[role="button"]')];
}

/**
 * Returns the `.ds-virtual-list-visible-items` container in the body, mounting an empty one taken from the snapshot when none exists yet.
 */
export function mountVisibleItems() {
    const existing = document.body.querySelector('.ds-virtual-list-visible-items');
    if (existing) return existing;
    const { container } = parseSnapshot();
    container.replaceChildren();
    document.body.appendChild(container);
    return container;
}

/**
 * Shared DOM helper: appends a user + assistant item pair (live DeepSeek markup) to the visible-items container, the way consecutive turns sit in one virtual list.
 * Returns the assistant `.ds-message` element. `censored: false` renders the captured all-enabled toolbar instead of the censored pattern.
 */
export function buildChatPair(assistantKey, userPromptText, { censored = true } = {}) {
    const container = mountVisibleItems();
    container.appendChild(createUserItem('user-' + assistantKey, userPromptText));
    const assistantItem = createAssistantItem(assistantKey, { censored });
    container.appendChild(assistantItem);
    return assistantItem.querySelector('.ds-message');
}
