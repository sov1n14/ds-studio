import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import HideThinking from '../../content/hide-thinking.js';
import StorageManager from '../../utils/storage-manager.js';

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

describe('HideThinking', () => {
    beforeEach(() => {
        HideThinking.disable();
        HideThinking.enabled = false;
        HideThinking._masterEnabled = false;
        document.body.innerHTML = '';
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

    describe('storage listener', () => {
        it('enables when dsHideThinking turns on while master is enabled', async () => {
            HideThinking._masterEnabled = true;
            HideThinking.enabled = false;
            await chrome.storage.local.set({
                [StorageManager.KEYS.IS_ENABLED]: true,
                [HideThinking.STORAGE_KEY]: false,
            });
            await chrome.storage.local.set({ [HideThinking.STORAGE_KEY]: true });
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(HideThinking.enabled).toBe(true);
        });

        it('disables when dsHideThinking turns off', async () => {
            HideThinking._masterEnabled = true;
            HideThinking.enable();
            await chrome.storage.local.set({ [HideThinking.STORAGE_KEY]: false });
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(HideThinking.enabled).toBe(false);
        });

        it('disables when master switch turns off', async () => {
            HideThinking._masterEnabled = true;
            HideThinking.enable();
            await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
            await new Promise((resolve) => setTimeout(resolve, 10));
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
