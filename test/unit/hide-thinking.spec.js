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
import '../../utils/settings-message-constants.js';
import '../../content/ds-selectors.js';
import '../../utils/storage-manager.js';
import StorageManager from '../../utils/storage-manager.js';

const MASTER_KEY = 'isEnabled';
const OWN_KEY = StorageManager.KEYS.HIDE_THINKING;

function createExpandedContainer() {
    const container = document.createElement('div');
    container.className = '_74c0879';
    const header = document.createElement('div');
    header.className = '_245c867';
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
    container.className = '_74c0879';
    const header = document.createElement('div');
    header.className = '_245c867';
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

    describe('tryCollapseButton()', () => {
        it('clicks an expanded button that is connected to the DOM', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            HideThinking.tryCollapseButton(container);
            const header = container.querySelector('._245c867');
            expect(header.click).toHaveBeenCalledOnce();
        });

        it('does not click an already collapsed button', () => {
            const container = createCollapsedContainer();
            document.body.appendChild(container);
            HideThinking.tryCollapseButton(container);
            const header = container.querySelector('._245c867');
            expect(header.click).not.toHaveBeenCalled();
        });

        it('does not click when element is disconnected from DOM', () => {
            const container = createExpandedContainer();
            HideThinking.tryCollapseButton(container);
            const header = container.querySelector('._245c867');
            expect(header.click).not.toHaveBeenCalled();
        });

        it('does not click when already marked data-ht-collapsed', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            container.dataset.htCollapsed = '1';
            const header = container.querySelector('._245c867');
            HideThinking.tryCollapseButton(container);
            expect(header.click).not.toHaveBeenCalled();
        });

        it('does not click when container has no header element', () => {
            const container = document.createElement('div');
            container.className = '_74c0879';
            const content = document.createElement('div');
            content.className = 'ds-think-content';
            container.appendChild(content);
            document.body.appendChild(container);
            // No crash expected, no click expected
            expect(() => HideThinking.tryCollapseButton(container)).not.toThrow();
        });
    });

    describe('applyToExisting()', () => {
        it('collapses every expanded thinking button on the page', () => {
            const expanded1 = createExpandedContainer();
            const expanded2 = createExpandedContainer();
            const collapsed = createCollapsedContainer();
            document.body.append(expanded1, expanded2, collapsed);

            HideThinking.applyToExisting();

            expect(expanded1.querySelector('._245c867').click).toHaveBeenCalledOnce();
            expect(expanded2.querySelector('._245c867').click).toHaveBeenCalledOnce();
            expect(collapsed.querySelector('._245c867').click).not.toHaveBeenCalled();
        });
    });

    describe('scanRoot()', () => {
        it('finds expanded buttons inside a newly added subtree', () => {
            const wrapper = document.createElement('div');
            const container = createExpandedContainer();
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);
            HideThinking.scanRoot(wrapper);
            expect(container.querySelector('._245c867').click).toHaveBeenCalledOnce();
        });
    });

    describe('enable() / disable()', () => {
        it('enable() collapses existing blocks and starts observer', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);

            HideThinking.enable();

            expect(HideThinking.enabled).toBe(true);
            expect(HideThinking._observer).not.toBeNull();
            expect(container.querySelector('._245c867').click).toHaveBeenCalledOnce();
        });

        it('disable() re-expands all blocks that were collapsed by enable()', () => {
            const container = createExpandedContainer();
            document.body.appendChild(container);
            const header = container.querySelector('._245c867');

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
            expect(container.querySelector('._245c867').click).toHaveBeenCalledOnce();
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
            expandedContainer.querySelector('._245c867').click.mockClear();
            newContainer.querySelector('._245c867').click.mockClear();

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
            expect(expandedContainer.querySelector('._245c867').click).not.toHaveBeenCalled();

            // Now add a new container to verify the observer is still working for childList mutations
            const anotherContainer = createExpandedContainer();
            document.body.appendChild(anotherContainer);
            await new Promise((resolve) => setTimeout(resolve, 0));

            // This new container SHOULD be clicked because it was added to the DOM
            expect(anotherContainer.querySelector('._245c867').click).toHaveBeenCalledOnce();
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
