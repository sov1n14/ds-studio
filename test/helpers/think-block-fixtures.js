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
