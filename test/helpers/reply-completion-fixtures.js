// Reply-completion fixtures copied from live DeepSeek snapshots (message text replaced by placeholders), for the content/reply-completion.js specs.
// Fixture anatomy, read from the captured markup by position (never through the selectors under test): conv2-finished-visible-items.html is the `.ds-virtual-list-visible-items` container holding two `[data-virtual-list-item-key]` items, the user item ("-2") and the assistant item ("2"). The assistant item's children are the `.ds-message` and, as its last child, the toolbar row (an outer `div.ds-flex` with two children); the row's first child is the toolbar (`div.ds-flex` with six `div[role="button"]` children). The code block comes from think-open-message.html (a `.md-code-block` whose banner holds two `role="button"` controls). A stopped reply's toolbar row additionally holds DeepSeek's continue container as its third child (live POC 2026-11-08); that container reuses CONTINUE_MARKUP from auto-click-harness.js.
import fs from 'fs';
import path from 'path';
import { CONTINUE_MARKUP } from './auto-click-harness.js';

const SNAPSHOT_DIR = path.resolve(__dirname, '../fixtures/ds-snapshots');
const VISIBLE_ITEMS_FILE = 'conv2-finished-visible-items.html';
const CODE_BLOCK_SOURCE_FILE = 'think-open-message.html';

function readSnapshot(file) {
    return fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf8');
}

function parseFirstElement(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    const el = host.firstElementChild;
    el.remove();
    return el;
}

function directButtonCount(el) {
    return Array.from(el.children).filter((c) => c.getAttribute('role') === 'button').length;
}

/** Positional anatomy of a captured assistant item; throws when the snapshot no longer has the shape this file documents. */
export function assistantParts(item) {
    const row = item.lastElementChild;
    const toolbar = row && row.firstElementChild;
    if (!row || !row.classList.contains('ds-flex') || row.children.length !== 2 || !toolbar || !toolbar.classList.contains('ds-flex') || directButtonCount(toolbar) !== 6) {
        throw new Error('assistant item fixture lost its toolbar row / six-button toolbar; re-check ' + VISIBLE_ITEMS_FILE);
    }
    return { item, row, toolbar };
}

/** A detached copy of the captured `.ds-virtual-list-visible-items` container with its user and assistant items. */
export function loadVisibleItems() {
    const list = parseFirstElement(readSnapshot(VISIBLE_ITEMS_FILE));
    if (!list.classList.contains('ds-virtual-list-visible-items') || list.children.length !== 2) {
        throw new Error('unexpected root in ' + VISIBLE_ITEMS_FILE);
    }
    const [userItem, assistantItem] = list.children;
    return { list, userItem, ...assistantParts(assistantItem) };
}

/** A fresh, detached assistant item exactly as the snapshot captured it (toolbar row inside), with the given virtual-list key. */
export function loadAssistantItem(key) {
    const { item } = loadVisibleItems();
    item.remove();
    item.setAttribute('data-virtual-list-item-key', String(key));
    return assistantParts(item);
}

/** The user item's action row (`div.ds-flex` with two `role="button"` children), detached from the given user item. */
export function detachUserActionRow(userItem) {
    const row = userItem.querySelector('.ds-flex');
    if (!row || directButtonCount(row) !== 2) throw new Error('user item fixture lost its two-button action row; re-check ' + VISIBLE_ITEMS_FILE);
    row.remove();
    return row;
}

/** A detached copy of the captured `.md-code-block` (banner with copy / download controls). */
export function loadCodeBlock() {
    const message = parseFirstElement(readSnapshot(CODE_BLOCK_SOURCE_FILE));
    const block = message.querySelector('.md-code-block');
    if (!block || !block.querySelector('.md-code-block-banner')) throw new Error('code block fixture missing in ' + CODE_BLOCK_SOURCE_FILE);
    block.remove();
    return block;
}

/** Mounts `list` in a fresh document body and observes it with a real MutationObserver (childList, subtree). `flush()` returns the records collected since the last flush. */
export function mountAndObserve(list) {
    document.body.innerHTML = '';
    document.body.appendChild(list);
    // Records the callback already received (an await between mutations lets it run) are kept, so a flush never loses part of a batch.
    let delivered = [];
    const observer = new MutationObserver((records) => { delivered = delivered.concat(records); });
    observer.observe(list, { childList: true, subtree: true });
    return {
        flush: () => {
            const records = delivered.concat(observer.takeRecords());
            delivered = [];
            return records;
        },
        disconnect: () => observer.disconnect(),
    };
}

/** DeepSeek's 「继续生成」 container (`div._8e85838` > `div.ds-button[role="button"]._6eef0b0`), parsed from the captured markup shared with the auto-click specs (CONTINUE_MARKUP). `primary: false` strips the container hash `_8e85838`; `fallback: false` strips the button hash `_6eef0b0`, so each continue selector can be exercised alone. */
export function loadContinueContainer({ primary = true, fallback = true } = {}) {
    const container = parseFirstElement(CONTINUE_MARKUP);
    const button = container.firstElementChild;
    if (!container.classList.contains('_8e85838') || !button || button.getAttribute('role') !== 'button' || !button.classList.contains('_6eef0b0')) {
        throw new Error('continue-button fixture lost its captured shape; re-check CONTINUE_MARKUP in auto-click-harness.js');
    }
    if (!primary) container.classList.remove('_8e85838');
    if (!fallback) button.classList.remove('_6eef0b0');
    return container;
}

/** A `role="button"` control that carries the continue button's text but neither continue hash, wrapped like the real container. */
export function loadContinueTextDecoy() {
    return parseFirstElement('<div><div role="button" class="ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--capsule ds-button--s" tabindex="0"><div class="ds-button__background"></div><div class="ds-button__border"></div><span class="ds-button__content">继续生成</span></div></div>');
}
