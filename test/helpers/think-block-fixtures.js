// Think-block fixtures copied from live DeepSeek snapshots (message text replaced by placeholders), shared by the hide-thinking, export and censor-reply-restore specs.
// Fixture anatomy, read from the captured markup by position (never through the selectors under test): the think block is the first child of the assistant .ds-message; its children are the header, a spacer, the think body nodes, and a footer as the last child. A natively collapsed block holds only header, spacer and footer.
import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';

const SNAPSHOT_DIR = path.resolve(__dirname, '../fixtures/ds-snapshots');

const THINK_FIXTURES = {
    // Finished reply, think block expanded: three think steps, a "搜索到 15 个网页" search row, a "浏览 4 个页面" row with four reference links.
    open: 'think-open-message.html',
    // Same finished reply after the user collapsed the think block natively.
    closed: 'think-closed-message.html',
    // Reply still streaming its thinking: header shows "正在思考", one think step.
    streaming: 'think-streaming-message.html',
};

function parseFirstElement(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    const el = host.firstElementChild;
    el.remove();
    return el;
}

/** Returns a detached assistant .ds-message for the given think-block state ('open', 'closed', 'streaming'). */
export function loadThinkMessage(state) {
    const file = THINK_FIXTURES[state];
    if (!file) throw new Error('Unknown think fixture state: ' + state);
    return parseFirstElement(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf8'));
}

/** Returns detached copies of the user message and the think-less assistant message of a finished conversation (conv2-finished-visible-items.html). */
export function loadMessagesWithoutThinkBlock() {
    const items = parseFirstElement(fs.readFileSync(path.join(SNAPSHOT_DIR, 'conv2-finished-visible-items.html'), 'utf8'));
    const [userItem, assistantItem] = items.children;
    return { userMessage: userItem.querySelector('.ds-message'), assistantMessage: assistantItem.querySelector('.ds-message') };
}

/** Positional anatomy of a think-block message fixture. */
export function thinkParts(msg) {
    const block = msg.firstElementChild;
    const header = block.firstElementChild;
    return {
        msg,
        block,
        header,
        statusSpan: header.firstElementChild.children[1],
        spacer: block.children[1],
        footer: block.lastElementChild,
    };
}

/** The think body nodes of a block: every child between the spacer and the footer. */
export function thinkBodyNodes(block) {
    return Array.from(block.children).slice(2, -1);
}

/**
 * Models DeepSeek's native header toggle on a fixture block: a click on an expanded block detaches its think body nodes (leaving the captured collapsed shape header, spacer, footer); a click on a collapsed block re-inserts them before the footer.
 * `bodyNodes` supplies the nodes an initially collapsed block shows when expanded (default: the block's own body nodes).
 * Returns a spy called once per header click.
 */
export function installNativeThinkToggle(block, bodyNodes = thinkBodyNodes(block)) {
    const header = block.firstElementChild;
    const footer = block.lastElementChild;
    let hidden = thinkBodyNodes(block).length === 0 ? bodyNodes.slice() : [];
    const clicks = vi.fn();
    header.addEventListener('click', () => {
        clicks();
        const shown = thinkBodyNodes(block);
        if (shown.length > 0) {
            shown.forEach((node) => node.remove());
            hidden = shown;
        } else {
            hidden.forEach((node) => block.insertBefore(node, footer));
            hidden = [];
        }
    });
    return clicks;
}

const HASHED_CLASS = /^_?[0-9a-f]{7,8}$/;

/** Removes every obfuscated hash class (e.g. `_74c0879`, `e1675d8b`) under and including `root`, modelling a DeepSeek release that rotates all of them; semantic classes such as `ds-message` stay. */
export function stripHashedClasses(root) {
    [root, ...root.querySelectorAll('[class]')].forEach((el) => {
        Array.from(el.classList).filter((cls) => HASHED_CLASS.test(cls)).forEach((cls) => el.classList.remove(cls));
    });
    return root;
}

/**
 * Models DeepSeek's native header toggle as a React state flip whose think body mounts asynchronously: each click flips the open state; opening schedules the body insert (before the footer) `mountDelayMs` later on the global timer, so fake timers control it; closing detaches the shown body at once and cancels a pending insert.
 * `bodyNodes` supplies the nodes an initially collapsed block shows when expanded (default: the block's own body nodes).
 * Returns a spy called once per header click.
 */
export function installDelayedNativeThinkToggle(block, mountDelayMs, bodyNodes = thinkBodyNodes(block)) {
    const header = block.firstElementChild;
    const footer = block.lastElementChild;
    let hidden = thinkBodyNodes(block).length === 0 ? bodyNodes.slice() : [];
    let isOpen = hidden.length === 0;
    let mountTimer = null;
    const clicks = vi.fn();
    header.addEventListener('click', () => {
        clicks();
        isOpen = !isOpen;
        clearTimeout(mountTimer);
        mountTimer = null;
        if (isOpen) {
            mountTimer = setTimeout(() => {
                mountTimer = null;
                hidden.forEach((node) => block.insertBefore(node, footer));
                hidden = [];
            }, mountDelayMs);
            return;
        }
        const shown = thinkBodyNodes(block);
        shown.forEach((node) => node.remove());
        if (shown.length > 0) hidden = shown;
    });
    return clicks;
}

/**
 * Mounts a finished two-message conversation (real user prompt, real reply with a think block) in the virtual-list structure the harvest scans; the container does not overflow (scrollHeight === clientHeight), so every message is mounted and the harvest needs no scrolling.
 * `state`: 'expanded' leaves the think block open; 'collapsed' collapses it through its header the way hide-thinking and the user do.
 * Returns the reply's thinkParts plus `clicks`, the native toggle's per-click spy (cleared after the initial collapse).
 */
export function mountThinkConversation(state) {
    const scrollArea = document.createElement('div');
    scrollArea.className = 'ds-virtual-list ds-scroll-area';
    Object.defineProperty(scrollArea, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });
    scrollArea.scrollBy = () => {};
    scrollArea.scrollTo = () => {};
    const listItems = document.createElement('div');
    listItems.className = 'ds-virtual-list-items';
    const visibleItems = document.createElement('div');
    visibleItems.className = 'ds-virtual-list-visible-items';
    listItems.appendChild(visibleItems);
    scrollArea.appendChild(listItems);

    const { userMessage } = loadMessagesWithoutThinkBlock();
    const parts = thinkParts(loadThinkMessage('open'));
    [userMessage, parts.msg].forEach((msg, key) => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-virtual-list-item-key', String(key));
        wrapper.appendChild(msg);
        visibleItems.appendChild(wrapper);
    });
    document.body.appendChild(scrollArea);

    const clicks = installNativeThinkToggle(parts.block);
    if (state === 'collapsed') {
        parts.header.click();
        clicks.mockClear();
    }
    return { ...parts, clicks };
}

function collectThinkBodyMounts(records, mounted) {
    records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node.nodeType === 1 && (node.matches('.ds-think-content') || node.querySelector('.ds-think-content'))) mounted.push(node);
    }));
}

/** Records every think step node mounted into `block` from now on (any route, not only a header click); `stop()` returns the mounted nodes. */
export function watchThinkBodyMounts(block) {
    const mounted = [];
    const observer = new MutationObserver((records) => collectThinkBodyMounts(records, mounted));
    observer.observe(block, { childList: true, subtree: true });
    return {
        stop() {
            collectThinkBodyMounts(observer.takeRecords(), mounted);
            observer.disconnect();
            return mounted;
        },
    };
}
