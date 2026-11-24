// @vitest-environment jsdom
/**
 * content/hide-thinking.js — collapse behavior plus toggle gating.
 *
 * Runs under jsdom: the think-block selectors are structural (multi-level `:has()` anchored at .ds-message), which happy-dom mis-evaluates; jsdom matched Chrome on the captured DeepSeek snapshots.
 *
 * DOM: think-block messages copied from live snapshots (test/helpers/think-block-fixtures.js). DeepSeek's own header toggle is modelled by installNativeThinkToggle: a header click detaches or re-inserts the think body nodes, exactly the difference between the captured expanded and collapsed blocks. Success is the page-level outcome (the block no longer shows a .ds-think-content), not only that a click happened.
 *
 * Settings surface: the module reads no storage. Master switch + its own key (dsHideThinking) are gated by content/feature-toggle.js, which fetches the initial values with DSS_GET_SETTINGS and reacts to DSS_SETTINGS_CHANGED broadcasts from background. Tests drive both through chrome.runtime stubs.
 *
 * feature-toggle holds its registry and shared onMessage listener in module scope, so each test loads a fresh module graph (vi.resetModules + dynamic import) bound to that test's stubs -- same pattern as width-feature.spec.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';
import '../../content/ds-selectors.js';
import '../../utils/storage-manager.js';
import StorageManager from '../../utils/storage-manager.js';
import {
    loadThinkMessage, loadMessagesWithoutThinkBlock, thinkParts, thinkBodyNodes, installNativeThinkToggle, stripHashedClasses,
} from '../helpers/think-block-fixtures.js';

const MASTER_KEY = 'isEnabled';
const OWN_KEY = StorageManager.KEYS.HIDE_THINKING;

/** True when the block shows its think body the way the captured expanded snapshot does. */
function showsThinking(block) {
    return block.querySelector('.ds-think-content') !== null;
}

/** Real finished reply with its think block expanded; DeepSeek's header toggle modelled. Mounted unless `mount: false`. */
function createExpandedMessage({ mount = true } = {}) {
    const parts = thinkParts(loadThinkMessage('open'));
    const clicks = installNativeThinkToggle(parts.block);
    if (mount) document.body.appendChild(parts.msg);
    return { ...parts, clicks };
}

/** Real finished reply whose think block the user collapsed natively; expanding it re-inserts the captured think body. */
function createCollapsedMessage({ mount = true } = {}) {
    const parts = thinkParts(loadThinkMessage('closed'));
    const clicks = installNativeThinkToggle(parts.block, thinkBodyNodes(thinkParts(loadThinkMessage('open')).block));
    if (mount) document.body.appendChild(parts.msg);
    return { ...parts, clicks };
}

/** Fresh chrome.runtime.onMessage stub with a fireable listener set. */
function createOnMessageStub() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        callListeners: (...args) => [...listeners].forEach((fn) => fn(...args)),
        listenerCount: () => listeners.size,
    };
}

let onMessage;
let sendMessage;
let HideThinking;

/** Queue the values every GET_SETTINGS round trip resolves with. */
function respondWith(values) {
    sendMessage.mockImplementation((_message, callback) => {
        const response = { ok: true, values };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

/** Let the pending sendMessage promise chains and MutationObserver deliveries settle. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Storage-change payload shape: { key: { oldValue, newValue } }. */
function change(key, newValue, oldValue) {
    return { [key]: { oldValue, newValue } };
}

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
function broadcast(changes, area = 'local') {
    onMessage.callListeners(
        { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes },
        { id: 'test-extension-id' },
        () => {},
    );
}

/** Load a fresh HideThinking whose auto-start sees `values` as its settings. */
async function loadHideThinking(values = { [MASTER_KEY]: false, [OWN_KEY]: false }) {
    respondWith(values);
    vi.resetModules();
    await import('../../content/feature-toggle.js');
    HideThinking = (await import('../../content/hide-thinking.js')).default;
    await flush();
    return HideThinking;
}

describe('HideThinking', () => {
    beforeEach(async () => {
        document.body.innerHTML = '';
        onMessage = createOnMessageStub();
        sendMessage = vi.fn();
        chrome.runtime.onMessage = onMessage;
        chrome.runtime.sendMessage = sendMessage;
        await loadHideThinking();
    });

    afterEach(() => {
        if (HideThinking) HideThinking.disable();
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('fixture sanity: the expanded capture shows think steps, the collapsed one does not, and the toggle model flips between them', () => {
        const expanded = createExpandedMessage();
        const collapsed = createCollapsedMessage();
        expect(showsThinking(expanded.block)).toBe(true);
        expect(showsThinking(collapsed.block)).toBe(false);
        expect(expanded.statusSpan.textContent).toBe('已思考（用时 3 秒）');

        expanded.header.click();
        expect(showsThinking(expanded.block)).toBe(false);
        expect(Array.from(expanded.block.children)).toEqual([expanded.header, expanded.spacer, expanded.footer]);
        expanded.header.click();
        expect(showsThinking(expanded.block)).toBe(true);
    });

    describe('isExpanded()', () => {
        it('returns false for null input', () => {
            expect(HideThinking.isExpanded(null)).toBe(false);
        });

        it('returns false for undefined input', () => {
            expect(HideThinking.isExpanded(undefined)).toBe(false);
        });

        it('returns a strict boolean true (not merely truthy) for an expanded think block', () => {
            const { block } = createExpandedMessage();
            expect(HideThinking.isExpanded(block)).toBe(true);
        });

        it('returns a strict boolean false (not merely falsy) for a natively collapsed think block', () => {
            const { block } = createCollapsedMessage();
            expect(HideThinking.isExpanded(block)).toBe(false);
        });
    });

    describe('tryCollapseButton()', () => {
        it('collapses a connected expanded block by clicking its header once', () => {
            const { block, clicks } = createExpandedMessage();
            HideThinking.tryCollapseButton(block);
            expect(clicks).toHaveBeenCalledOnce();
            expect(showsThinking(block), 'the page did not collapse the block, so the click missed the header').toBe(false);
        });

        it('does not click an already collapsed block', () => {
            const { block, clicks } = createCollapsedMessage();
            HideThinking.tryCollapseButton(block);
            expect(clicks).not.toHaveBeenCalled();
        });

        it('does not click when the block is disconnected from the DOM', () => {
            const { block, clicks } = createExpandedMessage({ mount: false });
            HideThinking.tryCollapseButton(block);
            expect(clicks).not.toHaveBeenCalled();
            expect(showsThinking(block)).toBe(true);
        });

        it('does not click when the block is already marked data-ht-collapsed', () => {
            const { block, clicks } = createExpandedMessage();
            block.dataset.htCollapsed = '1';
            HideThinking.tryCollapseButton(block);
            expect(clicks).not.toHaveBeenCalled();
            expect(showsThinking(block)).toBe(true);
        });

        it('leaves the block untouched and unmarked when its header is gone', () => {
            const { block, header } = createExpandedMessage();
            header.remove();
            expect(() => HideThinking.tryCollapseButton(block)).not.toThrow();
            expect(block.hasAttribute('data-ht-collapsed')).toBe(false);
            expect(showsThinking(block)).toBe(true);
        });

        it('sets dataset.htCollapsed to exactly the string "1" after collapsing', () => {
            const { block } = createExpandedMessage();
            HideThinking.tryCollapseButton(block);
            expect(block.dataset.htCollapsed).toBe('1');
        });
    });

    describe('applyToExisting()', () => {
        it('collapses every expanded think block on the page and skips collapsed ones', () => {
            const expanded1 = createExpandedMessage();
            const expanded2 = createExpandedMessage();
            const collapsed = createCollapsedMessage();

            HideThinking.applyToExisting();

            expect(expanded1.clicks).toHaveBeenCalledOnce();
            expect(expanded2.clicks).toHaveBeenCalledOnce();
            expect(collapsed.clicks).not.toHaveBeenCalled();
            expect(showsThinking(expanded1.block)).toBe(false);
            expect(showsThinking(expanded2.block)).toBe(false);
        });

        it('marks only the think block, never the user message or a reply without thinking', () => {
            const { userMessage, assistantMessage } = loadMessagesWithoutThinkBlock();
            document.body.appendChild(userMessage);
            const expanded = createExpandedMessage();
            document.body.appendChild(assistantMessage);

            HideThinking.applyToExisting();

            expect(Array.from(document.querySelectorAll('[data-ht-collapsed]'))).toEqual([expanded.block]);
        });

        it('still collapses the block after DeepSeek rotates every hashed class', () => {
            const { msg, block, clicks } = createExpandedMessage();
            stripHashedClasses(msg);
            expect(block.className, 'fixture: the block kept no hashed class').toBe('');

            HideThinking.applyToExisting();

            expect(clicks).toHaveBeenCalledOnce();
            expect(showsThinking(block)).toBe(false);
        });
    });

    describe('scanRoot()', () => {
        it('collapses an expanded block inside a newly added subtree', () => {
            const wrapper = document.createElement('div');
            const { msg, block, clicks } = createExpandedMessage({ mount: false });
            wrapper.appendChild(msg);
            document.body.appendChild(wrapper);
            HideThinking.scanRoot(wrapper);
            expect(clicks).toHaveBeenCalledOnce();
            expect(showsThinking(block)).toBe(false);
        });

        it('does not crash when passed a text node (non-Element)', () => {
            const textNode = document.createTextNode('hello');
            document.body.appendChild(textNode);
            expect(() => HideThinking.scanRoot(textNode)).not.toThrow();
        });

        it('collapses an expanded block passed directly as root (self-match)', () => {
            const { block, clicks } = createExpandedMessage();
            HideThinking.scanRoot(block);
            expect(clicks).toHaveBeenCalledOnce();
            expect(showsThinking(block)).toBe(false);
        });

        it('leaves blocks outside the scanned root alone', () => {
            const expanded = createExpandedMessage();
            const { userMessage } = loadMessagesWithoutThinkBlock();
            document.body.appendChild(userMessage);

            HideThinking.scanRoot(userMessage);

            expect(expanded.clicks).not.toHaveBeenCalled();
            expect(document.querySelector('[data-ht-collapsed]')).toBeNull();
        });
    });

    describe('restoreAll()', () => {
        it('removes the data-ht-collapsed attribute and re-expands the block', () => {
            const { block, clicks } = createExpandedMessage();
            HideThinking.tryCollapseButton(block);
            expect(block.hasAttribute('data-ht-collapsed')).toBe(true);
            clicks.mockClear();

            HideThinking.restoreAll();

            expect(block.hasAttribute('data-ht-collapsed')).toBe(false);
            expect(clicks).toHaveBeenCalledOnce();
            expect(showsThinking(block)).toBe(true);
        });

        it('does not click the header of a block disconnected during iteration', () => {
            const first = createExpandedMessage();
            const second = createExpandedMessage();
            HideThinking.tryCollapseButton(first.block);
            HideThinking.tryCollapseButton(second.block);
            first.clicks.mockClear();
            second.clicks.mockClear();
            first.header.addEventListener('click', () => second.msg.remove());

            HideThinking.restoreAll();

            expect(first.clicks).toHaveBeenCalledOnce();
            expect(second.clicks).not.toHaveBeenCalled();
        });

        it('does not throw when a marked container has no header child', () => {
            const container = document.createElement('div');
            container.setAttribute('data-ht-collapsed', '1');
            document.body.appendChild(container);

            expect(() => HideThinking.restoreAll()).not.toThrow();
            expect(container.hasAttribute('data-ht-collapsed')).toBe(false);
        });
    });

    describe('enable() / disable()', () => {
        it('enable() collapses existing blocks and starts observer', () => {
            const { block, clicks } = createExpandedMessage();

            HideThinking.enable();

            expect(HideThinking.enabled).toBe(true);
            expect(HideThinking._observer).not.toBeNull();
            expect(clicks).toHaveBeenCalledOnce();
            expect(showsThinking(block)).toBe(false);
        });

        it('disable() re-expands all blocks that were collapsed by enable()', () => {
            const { block, clicks } = createExpandedMessage();

            HideThinking.enable();
            expect(clicks).toHaveBeenCalledTimes(1);
            clicks.mockClear();

            HideThinking.disable();
            expect(HideThinking.enabled).toBe(false);
            expect(HideThinking._observer).toBeNull();
            expect(clicks).toHaveBeenCalledTimes(1);
            expect(showsThinking(block)).toBe(true);
        });

        it('observer collapses a think-block message added after enable()', async () => {
            HideThinking.enable();
            const { block, clicks } = createExpandedMessage();
            await flush();
            expect(clicks).toHaveBeenCalledOnce();
            expect(showsThinking(block)).toBe(false);
        });

        it('observer collapses a block whose header and think step render after the empty block mounted', async () => {
            const { msg, block, clicks } = createExpandedMessage({ mount: false });
            const children = Array.from(block.children);
            children.forEach((child) => child.remove());
            HideThinking.enable();
            document.body.appendChild(msg);
            await flush();

            children.forEach((child) => block.appendChild(child));
            await flush();

            expect(clicks).toHaveBeenCalledOnce();
            expect(showsThinking(block)).toBe(false);
        });

        it('does not double-enable when enable() is called twice', () => {
            HideThinking.enable();
            const observer = HideThinking._observer;
            HideThinking.enable();
            expect(HideThinking._observer).toBe(observer);
        });

        it('observer does not re-collapse a block the user re-expands after enable() collapsed it', async () => {
            const collapsedByEnable = createExpandedMessage();
            HideThinking.enable();
            collapsedByEnable.clicks.mockClear();

            collapsedByEnable.header.click();
            expect(showsThinking(collapsedByEnable.block), 'fixture: the user click re-expanded the block').toBe(true);
            await flush();

            expect(collapsedByEnable.clicks).toHaveBeenCalledOnce();
            expect(showsThinking(collapsedByEnable.block)).toBe(true);

            const added = createExpandedMessage();
            await flush();
            expect(added.clicks).toHaveBeenCalledOnce();
            expect(showsThinking(added.block)).toBe(false);
        });

        it('observer does not re-collapse a natively collapsed block the user expands', async () => {
            const collapsed = createCollapsedMessage();
            HideThinking.enable();
            expect(collapsed.clicks).not.toHaveBeenCalled();

            collapsed.header.click();
            expect(showsThinking(collapsed.block), 'fixture: the user click expanded the block').toBe(true);
            await flush();

            expect(collapsed.clicks, 'the extension clicked the header again after the user expanded the block').toHaveBeenCalledOnce();
            expect(showsThinking(collapsed.block)).toBe(true);
        });

        it('sets enabled to true when enable() is called from disabled state', () => {
            expect(HideThinking.enabled).toBe(false);
            HideThinking.enable();
            expect(HideThinking.enabled).toBe(true);
        });

        it('does not create a second observer when _startObserver is called again', () => {
            HideThinking.enable();
            const firstObserver = HideThinking._observer;
            HideThinking._startObserver();
            expect(HideThinking._observer).toBe(firstObserver);
        });

        it('observer skips scanRoot when enabled is set to false without stopping observer', async () => {
            HideThinking.enable();
            HideThinking.enabled = false;

            const { block, clicks } = createExpandedMessage();
            await flush();

            expect(clicks).not.toHaveBeenCalled();
            expect(showsThinking(block)).toBe(true);
        });

        it('observer does not process text nodes as elements', async () => {
            HideThinking.enable();
            const scanRootSpy = vi.spyOn(HideThinking, 'scanRoot');
            scanRootSpy.mockClear();

            document.body.appendChild(document.createTextNode('just text'));
            await flush();

            expect(scanRootSpy).not.toHaveBeenCalled();
            scanRootSpy.mockRestore();
        });

        it('observer fires callback when a child element is added (childList: true)', async () => {
            HideThinking.enable();
            const spy = vi.spyOn(HideThinking, 'scanRoot');
            spy.mockClear();

            const el = document.createElement('div');
            document.body.appendChild(el);
            await flush();

            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        it('does not throw when _stopObserver is called with no active observer', () => {
            expect(HideThinking._observer).toBeNull();
            expect(() => HideThinking._stopObserver()).not.toThrow();
        });

        it('disable() is a no-op when already disabled, leaving marked elements untouched', () => {
            HideThinking.enable();
            HideThinking.disable();
            expect(HideThinking.enabled).toBe(false);

            const { block, clicks } = createExpandedMessage();
            block.setAttribute('data-ht-collapsed', '1');

            HideThinking.disable();

            expect(block.hasAttribute('data-ht-collapsed')).toBe(true);
            expect(clicks).not.toHaveBeenCalled();
        });
    });

    describe('settings broadcasts', () => {
        it('enables when dsHideThinking turns on while master is enabled', async () => {
            await loadHideThinking({ [MASTER_KEY]: true, [OWN_KEY]: false });
            expect(HideThinking.enabled).toBe(false);

            broadcast(change(OWN_KEY, true, false));

            expect(HideThinking.enabled).toBe(true);
        });

        it('disables when dsHideThinking turns off', async () => {
            await loadHideThinking({ [MASTER_KEY]: true, [OWN_KEY]: true });
            expect(HideThinking.enabled).toBe(true);

            broadcast(change(OWN_KEY, false, true));

            expect(HideThinking.enabled).toBe(false);
        });

        it('disables when the master switch turns off', async () => {
            await loadHideThinking({ [MASTER_KEY]: true, [OWN_KEY]: true });
            expect(HideThinking.enabled).toBe(true);

            broadcast(change(MASTER_KEY, false, true));

            expect(HideThinking.enabled).toBe(false);
        });
    });
});

describe('StorageManager hideThinking', () => {
    it('defaults hideThinking to false', async () => {
        const settings = await StorageManager.getSettings();
        expect(settings.hideThinking).toBe(false);
    });

    it('persists hideThinking via saveHideThinking()', async () => {
        await StorageManager.saveHideThinking(true);
        const settings = await StorageManager.getSettings();
        expect(settings.hideThinking).toBe(true);
    });
});
