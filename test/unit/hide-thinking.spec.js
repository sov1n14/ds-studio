/**
 * content/hide-thinking.js — collapse behavior plus toggle gating.
 *
 * Settings surface: the module reads no storage. Master switch + its own key
 * (dsHideThinking) are gated by content/feature-toggle.js, which fetches the
 * initial values with DSS_GET_SETTINGS and reacts to DSS_SETTINGS_CHANGED
 * broadcasts from background. Tests drive both through chrome.runtime stubs.
 *
 * feature-toggle holds its registry and shared onMessage listener in module
 * scope, so each test loads a fresh module graph (vi.resetModules + dynamic
 * import) bound to that test's stubs -- same pattern as width-feature.spec.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';
import '../../content/ds-selectors.js';
const { THINK_BLOCK_CLASS, THINK_HEADER_TOGGLE_CLASS } = require('../../content/ds-selectors.js');
import '../../utils/storage-manager.js';
import StorageManager from '../../utils/storage-manager.js';

const MASTER_KEY = 'isEnabled';
const OWN_KEY = StorageManager.KEYS.HIDE_THINKING;

function createExpandedContainer() {
    const container = document.createElement('div');
    container.className = THINK_BLOCK_CLASS;
    const header = document.createElement('div');
    header.className = THINK_HEADER_TOGGLE_CLASS;
    header.click = vi.fn(() => {
        // simulate DeepSeek toggling: remove think-content child to mark collapsed
        const content = container.querySelector('.ds-think-content');
        if (content) content.remove();
    });
    const content = document.createElement('div');
    content.className = 'ds-think-content';
    container.appendChild(header);
    container.appendChild(content);
    return container;
}

function createCollapsedContainer() {
    const container = document.createElement('div');
    container.className = THINK_BLOCK_CLASS;
    const header = document.createElement('div');
    header.className = THINK_HEADER_TOGGLE_CLASS;
    header.click = vi.fn();
    container.appendChild(header);
    // No .ds-think-content child = collapsed
    return container;
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

/** Let the pending sendMessage promise chains settle. */
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

    describe('isExpanded()', () => {
        it('returns false for null input', () => {
            expect(HideThinking.isExpanded(null)).toBe(false);
        });

        it('returns false for undefined input', () => {
            expect(HideThinking.isExpanded(undefined)).toBe(false);
        });

        it('returns a strict boolean true (not merely truthy) for an expanded container', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            const result = HideThinking.isExpanded(container);
            expect(result).toBe(true);
        });

        it('returns a strict boolean false (not merely falsy) for a collapsed container', () => {
            const container = createCollapsedContainer();
            document.body.appendChild(container);
            const result = HideThinking.isExpanded(container);
            expect(result).toBe(false);
        });
    });

    describe('tryCollapseButton()', () => {
        it('clicks an expanded button that is connected to the DOM', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            HideThinking.tryCollapseButton(container);
            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            expect(header.click).toHaveBeenCalledOnce();
        });

        it('does not click an already collapsed button', () => {
            const container = createCollapsedContainer();
            document.body.appendChild(container);
            HideThinking.tryCollapseButton(container);
            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            expect(header.click).not.toHaveBeenCalled();
        });

        it('does not click when element is disconnected from DOM', () => {
            const container = createExpandedContainer();
            HideThinking.tryCollapseButton(container);
            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            expect(header.click).not.toHaveBeenCalled();
        });

        it('does not click when already marked data-ht-collapsed', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            container.dataset.htCollapsed = '1';
            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            HideThinking.tryCollapseButton(container);
            expect(header.click).not.toHaveBeenCalled();
        });

        it('does not click when container has no header element', () => {
            const container = document.createElement('div');
            container.className = THINK_BLOCK_CLASS;
            const content = document.createElement('div');
            content.className = 'ds-think-content';
            container.appendChild(content);
            document.body.appendChild(container);
            // No crash expected, no click expected
            expect(() => HideThinking.tryCollapseButton(container)).not.toThrow();
        });

        it('sets dataset.htCollapsed to exactly the string "1" after collapsing', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            HideThinking.tryCollapseButton(container);
            expect(container.dataset.htCollapsed).toBe('1');
        });
    });

    describe('applyToExisting()', () => {
        it('collapses every expanded thinking button on the page', () => {
            const expanded1 = createExpandedContainer();
            const expanded2 = createExpandedContainer();
            const collapsed = createCollapsedContainer();
            document.body.append(expanded1, expanded2, collapsed);

            HideThinking.applyToExisting();

            expect(expanded1.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click).toHaveBeenCalledOnce();
            expect(expanded2.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click).toHaveBeenCalledOnce();
            expect(collapsed.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click).not.toHaveBeenCalled();
        });
    });

    describe('scanRoot()', () => {
        it('finds expanded buttons inside a newly added subtree', () => {
            const wrapper = document.createElement('div');
            const container = createExpandedContainer();
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);
            HideThinking.scanRoot(wrapper);
            expect(container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click).toHaveBeenCalledOnce();
        });

        it('does not crash when passed a text node (non-Element)', () => {
            const textNode = document.createTextNode('hello');
            document.body.appendChild(textNode);
            expect(() => HideThinking.scanRoot(textNode)).not.toThrow();
        });

        it('collapses an expanded container passed directly as root (self-match)', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            HideThinking.scanRoot(container);
            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            expect(header.click).toHaveBeenCalledOnce();
        });

        it('does not treat root as a container when root lacks the container class', () => {
            const root = document.createElement('div');
            const thinkContent = document.createElement('div');
            thinkContent.className = 'ds-think-content';
            const header = document.createElement('div');
            header.className = THINK_HEADER_TOGGLE_CLASS;
            header.click = vi.fn();
            root.appendChild(header);
            root.appendChild(thinkContent);
            document.body.appendChild(root);

            HideThinking.scanRoot(root);

            expect(header.click).not.toHaveBeenCalled();
            expect(root.dataset.htCollapsed).toBeUndefined();
        });
    });

    describe('restoreAll()', () => {
        it('removes the data-ht-collapsed attribute from elements', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            HideThinking.tryCollapseButton(container);
            expect(container.hasAttribute('data-ht-collapsed')).toBe(true);

            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            header.click.mockClear();

            HideThinking.restoreAll();
            expect(container.hasAttribute('data-ht-collapsed')).toBe(false);
        });

        it('does not click header for elements disconnected during iteration', () => {
            const container1 = createExpandedContainer();
            const container2 = createExpandedContainer();
            document.body.appendChild(container1);
            document.body.appendChild(container2);

            HideThinking.tryCollapseButton(container1);
            HideThinking.tryCollapseButton(container2);

            const header1 = container1.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            const header2 = container2.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            header1.click.mockClear();
            header2.click.mockClear();

            header1.click.mockImplementation(() => container2.remove());

            HideThinking.restoreAll();

            expect(header1.click).toHaveBeenCalledOnce();
            expect(header2.click).not.toHaveBeenCalled();
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
            const container = createExpandedContainer();
            document.body.appendChild(container);

            HideThinking.enable();

            expect(HideThinking.enabled).toBe(true);
            expect(HideThinking._observer).not.toBeNull();
            expect(container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click).toHaveBeenCalledOnce();
        });

        it('disable() re-expands all blocks that were collapsed by enable()', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);

            HideThinking.enable();
            expect(header.click).toHaveBeenCalledTimes(1); // collapsed by enable

            header.click.mockClear();

            HideThinking.disable();
            expect(HideThinking.enabled).toBe(false);
            expect(HideThinking._observer).toBeNull();
            expect(header.click).toHaveBeenCalledTimes(1); // re-expanded by disable
        });

        it('observer collapses buttons added after enable()', async () => {
            HideThinking.enable();
            const container = createExpandedContainer();
            document.body.appendChild(container);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click).toHaveBeenCalledOnce();
        });

        it('does not double-enable when enable() is called twice', () => {
            HideThinking.enable();
            const observer = HideThinking._observer;
            HideThinking.enable();
            expect(HideThinking._observer).toBe(observer);
        });

        it('observer ignores mutations that do not add container elements', async () => {
            const expandedContainer = createExpandedContainer();
            const newContainer = createExpandedContainer();
            document.body.appendChild(expandedContainer);
            document.body.appendChild(newContainer);

            HideThinking.enable();

            // Reset click counts after enable() has already clicked them
            expandedContainer.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click.mockClear();
            newContainer.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click.mockClear();

            // Simulate user manually re-expanding by adding back the .ds-think-content child.
            // This triggers a childList mutation, but the added node is .ds-think-content (not a
            // container), so scanRoot will not attempt to collapse the parent container.
            // Additionally, the container still has data-ht-collapsed='1' which guards against
            // re-collapse even if the observer were to find it.
            const content = document.createElement('div');
            content.className = 'ds-think-content';
            expandedContainer.appendChild(content);

            // Wait for any potential mutation observer callbacks
            await new Promise((resolve) => setTimeout(resolve, 50));

            // The re-expanded container should NOT be clicked again
            expect(expandedContainer.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click).not.toHaveBeenCalled();

            // Now add a new container to verify the observer is still working for childList mutations
            const anotherContainer = createExpandedContainer();
            document.body.appendChild(anotherContainer);
            await new Promise((resolve) => setTimeout(resolve, 0));

            // This new container SHOULD be clicked because it was added to the DOM
            expect(anotherContainer.querySelector('.' + THINK_HEADER_TOGGLE_CLASS).click).toHaveBeenCalledOnce();
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

            const container = createExpandedContainer();
            document.body.appendChild(container);
            await new Promise(resolve => setTimeout(resolve, 0));

            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);
            expect(header.click).not.toHaveBeenCalled();
        });

        it('observer does not process text nodes as elements', async () => {
            HideThinking.enable();
            const scanRootSpy = vi.spyOn(HideThinking, 'scanRoot');
            scanRootSpy.mockClear();

            document.body.appendChild(document.createTextNode('just text'));
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(scanRootSpy).not.toHaveBeenCalled();
            scanRootSpy.mockRestore();
        });

        it('observer fires callback when a child element is added (childList: true)', async () => {
            HideThinking.enable();
            const spy = vi.spyOn(HideThinking, 'scanRoot');
            spy.mockClear();

            const el = document.createElement('div');
            document.body.appendChild(el);
            await new Promise(resolve => setTimeout(resolve, 0));

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

            const container = createExpandedContainer();
            document.body.appendChild(container);
            container.setAttribute('data-ht-collapsed', '1');
            const header = container.querySelector('.' + THINK_HEADER_TOGGLE_CLASS);

            HideThinking.disable();

            expect(container.hasAttribute('data-ht-collapsed')).toBe(true);
            expect(header.click).not.toHaveBeenCalled();
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
