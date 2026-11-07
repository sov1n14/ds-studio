// @vitest-environment jsdom
/**
 * content/reply-completion.js — DSstudio.ReplyCompletion.newToolbarsFromRecords(records) and isStoppedReply(toolbar).
 *
 * Requirement (user request): when a new message toolbar (「快捷功能條」) appears, the extension copies the reply automatically; a toolbar that is not new (an old one scrolled back into view) MUST NOT trigger it. This function is the decision: given the MutationRecords a real MutationObserver (childList, subtree) collected on the message list, it returns the toolbars that newly appeared, in document order, without duplicates.
 *
 * Live behaviour (observed 2026-11-08): a new reply or a regenerate mounts its `[data-virtual-list-item-key]` item first, without a toolbar, and appends the toolbar into that already-mounted item in a later mutation batch. Scrolling re-mounts whole items that already hold their toolbar. A toolbar arriving inside an item that was added in the same batch therefore counts as a re-mount.
 *
 * isStoppedReply (user decision D-07: a stopped or aborted reply gets no auto-copy and no notification): a stopped reply's toolbar arrives in one mutation together with DeepSeek's 「继续生成」 button, inside the toolbar's own row wrapper (toolbar.parentElement), as [toolbar, div, div._8e85838 > div.ds-button[role="button"]._6eef0b0]; a normally completed reply's wrapper holds no continue button, and older replies never carry it even when the latest reply was stopped. It returns true exactly when the toolbar's own wrapper holds the continue button by CONTINUE_BUTTON_SELECTOR or CONTINUE_BUTTON_FALLBACK_SELECTOR; the scope is that wrapper, never the document, and the button is never located by its text.
 *
 * DOM: copies of live snapshots via test/helpers/reply-completion-fixtures.js; mutations are performed on the mounted fixture and the records come from observer.takeRecords(). Runs under jsdom because the toolbar selector uses `:has()`, which happy-dom mis-evaluates. Assertions check the returned elements by identity, never by structural equality (two toolbars from the same snapshot are structurally equal).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import '../../content/ds-selectors.js';
import { loadVisibleItems, loadAssistantItem, detachUserActionRow, loadCodeBlock, loadContinueContainer, loadContinueTextDecoy, mountAndObserve } from '../helpers/reply-completion-fixtures.js';

const MODULE_REL = 'content/reply-completion.js';
const MODULE_FILE = path.resolve(__dirname, '../..', MODULE_REL);
const moduleLoaders = import.meta.glob('../../content/reply-completion.js');

let api = null;
let session = null;

/** Loads the module once (no load-time side effects are allowed, so one load serves every test) and returns its published and exported APIs; each API function is checked where it is used. */
async function loadApi() {
    if (api) return api;
    if (!fs.existsSync(MODULE_FILE)) throw new Error(`${MODULE_REL} does not exist (red phase: module not implemented yet)`);
    const load = Object.values(moduleLoaders)[0];
    if (!load) throw new Error(`${MODULE_REL} exists but import.meta.glob did not pick it up; fix the glob in reply-completion.spec.js`);
    const exported = await load();
    const published = globalThis.DSstudio?.ReplyCompletion;
    if (typeof published?.newToolbarsFromRecords !== 'function') throw new Error(`${MODULE_REL} loaded but globalThis.DSstudio.ReplyCompletion.newToolbarsFromRecords is not a function`);
    api = { published, exported: exported.default ?? exported };
    return api;
}

async function newToolbars(records) {
    const { published } = await loadApi();
    return published.newToolbarsFromRecords(records);
}

async function isStoppedReply(toolbar) {
    const { published } = await loadApi();
    if (typeof published.isStoppedReply !== 'function') throw new Error(`${MODULE_REL} does not publish globalThis.DSstudio.ReplyCompletion.isStoppedReply`);
    return published.isStoppedReply(toolbar);
}

function observe(list) {
    session = mountAndObserve(list);
    return session;
}

/** Same elements, same order, compared by identity. */
function expectSameElements(actual, expected, label) {
    expect(Array.isArray(actual), label + ': result is not an array').toBe(true);
    expect(actual.length, label + ': wrong number of toolbars returned').toBe(expected.length);
    expected.forEach((el, i) => expect(actual[i] === el, label + ': element ' + i + ' is not the expected toolbar node').toBe(true));
}

/** The captured list with the assistant item's toolbar row detached: the state right after a new reply's item mounted, before its toolbar. */
function listAwaitingToolbar() {
    const fx = loadVisibleItems();
    fx.row.remove();
    return fx;
}

afterEach(() => {
    session?.disconnect();
    session = null;
    document.body.innerHTML = '';
});

describe('module harness', () => {
    it('publishes newToolbarsFromRecords and isStoppedReply on globalThis.DSstudio.ReplyCompletion and through module.exports', async () => {
        const { published, exported } = await loadApi();
        expect(typeof published.newToolbarsFromRecords).toBe('function');
        expect(typeof published.isStoppedReply, 'globalThis.DSstudio.ReplyCompletion does not carry isStoppedReply').toBe('function');
        expect(typeof exported.newToolbarsFromRecords, 'module.exports does not carry newToolbarsFromRecords').toBe('function');
        expect(typeof exported.isStoppedReply, 'module.exports does not carry isStoppedReply').toBe('function');
    });
});

describe('newToolbarsFromRecords — new toolbars are returned', () => {
    it('new reply: the item mounts without a toolbar (nothing new), then its toolbar row arrives in a later batch (that toolbar is new)', async () => {
        const fx = listAwaitingToolbar();
        fx.item.remove();
        const { flush } = observe(fx.list);

        fx.list.appendChild(fx.item);
        expectSameElements(await newToolbars(flush()), [], 'batch 1 (item mounted, no toolbar yet)');

        fx.item.appendChild(fx.row);
        expectSameElements(await newToolbars(flush()), [fx.toolbar], 'batch 2 (toolbar row appended into the mounted item)');
    });

    it('returns the toolbar when the toolbar itself is appended directly into an already-mounted item', async () => {
        const fx = listAwaitingToolbar();
        const { flush } = observe(fx.list);

        fx.toolbar.remove();
        fx.item.appendChild(fx.toolbar);

        expectSameElements(await newToolbars(flush()), [fx.toolbar], 'toolbar appended as a direct child of the mounted item');
    });

    it('returns the inner toolbar, not the added wrapper, when the added node is a non-item ancestor that contains the toolbar', async () => {
        const fx = listAwaitingToolbar();
        const { flush } = observe(fx.list);

        fx.item.appendChild(fx.row);

        const result = await newToolbars(flush());
        expect(Array.isArray(result) && result.includes(fx.row), 'the outer row wrapper was returned as a toolbar').toBe(false);
        expectSameElements(result, [fx.toolbar], 'row wrapper (containing the toolbar) appended into the mounted item');
    });

    it('returns toolbars in document order, not in the order they were appended', async () => {
        const fx = listAwaitingToolbar();
        const later = loadAssistantItem(4);
        later.row.remove();
        fx.list.appendChild(later.item);
        const { flush } = observe(fx.list);

        later.item.appendChild(later.row);
        fx.item.appendChild(fx.row);

        expectSameElements(await newToolbars(flush()), [fx.toolbar, later.toolbar], 'two toolbars appended later-item-first');
    });

    it('returns a toolbar once even when it is reachable from more than one record in the batch', async () => {
        const fx = listAwaitingToolbar();
        const { flush } = observe(fx.list);

        fx.toolbar.remove();
        fx.item.appendChild(fx.row);      // record 1: the (now toolbar-less) row wrapper is added to the mounted item
        fx.row.prepend(fx.toolbar);       // record 2: the toolbar is added into that wrapper

        const records = flush();
        expect(records.length, 'fixture precondition: the batch should hold two records').toBe(2);
        expectSameElements(await newToolbars(records), [fx.toolbar], 'one toolbar reachable from two records');
    });

    it('one record adding several toolbar-bearing nodes at once (a fragment of two rows) returns every new toolbar, in document order, once', async () => {
        const fx = listAwaitingToolbar();
        const later = loadAssistantItem(4);
        later.row.remove();
        fx.list.appendChild(later.item);
        const second = loadAssistantItem(9);
        second.row.remove();
        const { flush } = observe(fx.list);

        later.item.appendChild(later.row);      // record 1: a toolbar row into the later item (later in document order, collected first)
        const fragment = document.createDocumentFragment();
        fragment.append(fx.row, second.row);
        fx.item.appendChild(fragment);          // record 2: ONE record adding two toolbar rows into the earlier, already-mounted item
        fx.toolbar.remove();
        fx.row.prepend(fx.toolbar);             // records 3-4: the first toolbar is re-added inside its row, so a later record reaches it again

        const records = flush();
        const multi = records.find((r) => r.target === fx.item);
        expect(multi, 'fixture precondition: a record adds nodes into the earlier item').toBeDefined();
        expect(multi.addedNodes.length, 'fixture precondition: that single record adds at least two nodes').toBeGreaterThanOrEqual(2);
        expect(Array.from(multi.addedNodes).includes(fx.row) && Array.from(multi.addedNodes).includes(second.row), 'fixture precondition: both toolbar rows arrive in that one record').toBe(true);
        expectSameElements(await newToolbars(records), [fx.toolbar, second.toolbar, later.toolbar], 'two toolbars from one multi-node record plus one from another record');
    });
});

describe('newToolbarsFromRecords — re-mounted or non-toolbar content is not returned', () => {
    it('returns [] for an empty record list', async () => {
        expectSameElements(await newToolbars([]), [], 'empty records');
    });

    it('scroll re-mount: a whole item added with its toolbar already inside is not new', async () => {
        const fx = loadVisibleItems();
        fx.item.remove();
        const { flush } = observe(fx.list);

        const remounted = loadAssistantItem(2);
        fx.list.appendChild(remounted.item);

        expectSameElements(await newToolbars(flush()), [], 'item re-mounted with its toolbar');
    });

    it('item added and toolbar appended into it within the same batch counts as a re-mount', async () => {
        const fx = listAwaitingToolbar();
        fx.item.remove();
        const { flush } = observe(fx.list);

        fx.list.appendChild(fx.item);
        fx.item.appendChild(fx.row);

        const records = flush();
        expect(records.length, 'fixture precondition: the batch should hold the item record and the row record').toBe(2);
        expectSameElements(await newToolbars(records), [], 'item and its toolbar in one batch');
    });

    it('item mounted inside a non-item wrapper and toolbar appended into that item within the same batch counts as a re-mount (ancestor added, not the item)', async () => {
        const fx = listAwaitingToolbar();
        fx.item.remove();
        const wrapper = document.createElement('div');
        wrapper.appendChild(fx.item);
        const { flush } = observe(fx.list);

        fx.list.appendChild(wrapper);     // record 1: the wrapper (holding the toolbar-less item) is added to the list
        fx.item.appendChild(fx.row);      // record 2: the toolbar row is added into that item

        const records = flush();
        expect(records.length, 'fixture precondition: the batch should hold the wrapper record and the row record').toBe(2);
        expect(records.some((r) => r.target === fx.list && Array.from(r.addedNodes).includes(wrapper)), 'fixture precondition: a record adds the wrapper to the list').toBe(true);
        expect(records.some((r) => r.target === fx.item && Array.from(r.addedNodes).includes(fx.row)), 'fixture precondition: a separate record adds the toolbar row into the item').toBe(true);
        expect(records.some((r) => Array.from(r.addedNodes).includes(fx.item)), 'fixture precondition: the item itself is not an added node (only its ancestor is)').toBe(false);
        expectSameElements(await newToolbars(records), [], 'wrapper with item, then toolbar into that item, in one batch');
    });

    it('a non-item wrapper appended into an already-mounted item, carrying a nested item that already holds its toolbar, is not new (nested virtual list re-mount, D-16)', async () => {
        const fx = loadVisibleItems();
        const nested = loadAssistantItem(7);
        const wrapper = document.createElement('div');
        wrapper.appendChild(nested.item);
        const { flush } = observe(fx.list);

        fx.item.appendChild(wrapper);     // one record: the wrapper (holding item B with its toolbar row) is added inside mounted item A

        const records = flush();
        expect(records.some((r) => r.target === fx.item && Array.from(r.addedNodes).includes(wrapper)), 'fixture precondition: a record adds the wrapper inside the mounted item A').toBe(true);
        expect(records.some((r) => Array.from(r.addedNodes).includes(nested.item)), 'fixture precondition: no record adds the nested item B directly (only its wrapper is added)').toBe(false);
        expect(nested.item.contains(nested.toolbar), 'fixture precondition: item B already holds its toolbar').toBe(true);
        expectSameElements(await newToolbars(records), [], 'wrapper with a toolbar-carrying item appended into a mounted item');
    });

    it('in a mixed batch returns only the toolbar appended into the already-mounted item, not the one inside a re-mounted item', async () => {
        const fx = listAwaitingToolbar();
        const { flush } = observe(fx.list);

        const remounted = loadAssistantItem(0);
        fx.list.insertBefore(remounted.item, fx.list.firstChild);
        fx.item.appendChild(fx.row);

        expectSameElements(await newToolbars(flush()), [fx.toolbar], 're-mounted item plus a new toolbar in one batch');
    });

    it('returns [] when a mounted reply only grows text (text node and paragraph appended)', async () => {
        const fx = loadVisibleItems();
        const { flush } = observe(fx.list);
        const markdown = fx.item.querySelector('.ds-markdown');

        markdown.lastElementChild.appendChild(document.createTextNode(' more streamed text'));
        const paragraph = document.createElement('p');
        paragraph.textContent = 'another streamed paragraph';
        markdown.appendChild(paragraph);

        expectSameElements(await newToolbars(flush()), [], 'text growth');
    });

    it('returns [] when a code block with its banner (two buttons) is appended into a mounted reply', async () => {
        const fx = loadVisibleItems();
        const { flush } = observe(fx.list);

        fx.item.querySelector('.ds-markdown').appendChild(loadCodeBlock());

        expectSameElements(await newToolbars(flush()), [], 'code block banner');
    });

    it('returns [] when a two-button user-message action row is appended into a mounted user item', async () => {
        const fx = loadVisibleItems();
        const row = detachUserActionRow(fx.userItem);
        const parent = fx.userItem.lastElementChild.firstElementChild;
        const { flush } = observe(fx.list);

        parent.appendChild(row);

        expectSameElements(await newToolbars(flush()), [], 'user action row');
    });

    it('returns [] for a batch that only removes nodes (items scrolled out of view)', async () => {
        const fx = loadVisibleItems();
        const { flush } = observe(fx.list);

        fx.item.remove();
        fx.userItem.remove();

        expectSameElements(await newToolbars(flush()), [], 'removal-only batch');
    });

    it('returns [] when a toolbar row is appended into the mounted list container itself, outside any virtual-list item (only toolbars added into an already-mounted item count)', async () => {
        const fx = listAwaitingToolbar();
        const { flush } = observe(fx.list);

        fx.list.appendChild(fx.row);

        const records = flush();
        expect(records.some((r) => r.target === fx.list && Array.from(r.addedNodes).includes(fx.row)), 'fixture precondition: a record adds the toolbar row directly to the mounted list').toBe(true);
        expect(fx.row.closest('[data-virtual-list-item-key]'), 'fixture precondition: the row sits outside every virtual-list item').toBe(null);
        expectSameElements(await newToolbars(records), [], 'toolbar row outside any item');
    });
});

describe('isStoppedReply — stopped replies are recognised by their own toolbar wrapper', () => {
    /** The live stop sequence: the item is mounted without a toolbar, then the row arrives in one mutation already holding [toolbar, div, continue container]. */
    function stopReply(fx, continueOptions) {
        fx.row.appendChild(loadContinueContainer(continueOptions));
        fx.item.appendChild(fx.row);
    }

    it('returns true for the toolbar of a stopped reply (continue button in its own wrapper, both continue selectors match)', async () => {
        const fx = listAwaitingToolbar();
        observe(fx.list);
        stopReply(fx);

        expect(await isStoppedReply(fx.toolbar)).toBe(true);
    });

    it('returns true when only CONTINUE_BUTTON_SELECTOR matches (button hash _6eef0b0 stripped)', async () => {
        const fx = listAwaitingToolbar();
        observe(fx.list);
        stopReply(fx, { fallback: false });

        expect(await isStoppedReply(fx.toolbar)).toBe(true);
    });

    it('returns true when only CONTINUE_BUTTON_FALLBACK_SELECTOR matches (container hash _8e85838 stripped)', async () => {
        const fx = listAwaitingToolbar();
        observe(fx.list);
        stopReply(fx, { primary: false });

        expect(await isStoppedReply(fx.toolbar)).toBe(true);
    });

    it('returns false for the toolbar of a normally completed reply', async () => {
        const fx = listAwaitingToolbar();
        observe(fx.list);
        fx.item.appendChild(fx.row);

        expect(await isStoppedReply(fx.toolbar)).toBe(false);
    });

    it('returns false for an older normal toolbar while a later reply on the page is stopped (scope is the own wrapper, not the document)', async () => {
        const fx = loadVisibleItems();
        const stopped = loadAssistantItem(4);
        stopped.row.remove();
        fx.list.appendChild(stopped.item);
        observe(fx.list);
        stopReply(stopped);

        expect(await isStoppedReply(fx.toolbar), 'older normal toolbar').toBe(false);
        expect(await isStoppedReply(stopped.toolbar), 'fixture check: the later, stopped toolbar').toBe(true);
    });

    it('returns false when the wrapper only holds a control with the continue text but neither continue selector (never located by text)', async () => {
        const fx = listAwaitingToolbar();
        observe(fx.list);
        fx.row.appendChild(loadContinueTextDecoy());
        fx.item.appendChild(fx.row);

        expect(await isStoppedReply(fx.toolbar)).toBe(false);
    });

    it('returns false for null (no toolbar)', async () => {
        expect(await isStoppedReply(null)).toBe(false);
    });

    it('returns false for a toolbar that was never attached (no own wrapper to hold a continue button)', async () => {
        const fx = listAwaitingToolbar();
        observe(fx.list);
        stopReply(fx);
        const detached = fx.toolbar.cloneNode(true);

        expect(detached.parentElement, 'fixture precondition: the cloned toolbar has no parent').toBe(null);
        expect(await isStoppedReply(fx.toolbar), 'fixture check: the attached original in its stopped wrapper').toBe(true);
        expect(await isStoppedReply(detached), 'never-attached toolbar').toBe(false);
    });
});
