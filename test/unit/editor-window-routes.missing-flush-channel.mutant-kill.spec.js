/**
 * background/editor-window-routes.js install() when the flush request channel (utils/editor-flush-channel.js) is missing.
 *
 * Requirement (file header of the route module, docs/ARCHITECTURE.md "Editor Window Auto-Close"): the route depends on utils/editor-flush-channel.js being loaded first; when the channel is absent, install() throws a named load-order error that tells the developer which file to load, instead of registering a route that cannot ask the editor to save before closing it.
 *
 * Trust boundary only: the channel module is made absent by removing globalThis.DSSEditorFlushChannel and by planting an empty module for utils/editor-flush-channel.js in the Node require cache, the two places the route looks it up. chrome.runtime.onMessage.addListener is observed so the test can assert that no listener was registered.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';
import '../../background/editor-window-routes.js';

const CHANNEL_PATH = require.resolve('../../utils/editor-flush-channel.js');

describe('editor-window-routes install() without the flush request channel', () => {
    let savedGlobalChannel;
    let savedCacheEntry;
    let addListenerSpy;

    beforeEach(() => {
        savedGlobalChannel = globalThis.DSSEditorFlushChannel;
        savedCacheEntry = require.cache[CHANNEL_PATH];
        delete globalThis.DSSEditorFlushChannel;
        require.cache[CHANNEL_PATH] = { id: CHANNEL_PATH, filename: CHANNEL_PATH, loaded: true, exports: {}, children: [], paths: [] };
        addListenerSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(() => {});
    });

    afterEach(() => {
        addListenerSpy.mockRestore();
        if (savedCacheEntry) require.cache[CHANNEL_PATH] = savedCacheEntry; else delete require.cache[CHANNEL_PATH];
        if (savedGlobalChannel) globalThis.DSSEditorFlushChannel = savedGlobalChannel;
    });

    it('throws an error that names utils/editor-flush-channel.js as the file to load, and registers no listener', () => {
        let thrown;
        try {
            globalThis.DSSEditorWindowRoutes.install();
        } catch (err) {
            thrown = err;
        }

        expect(thrown, 'install() throws when the flush channel is missing').toBeInstanceOf(Error);
        expect(thrown.message, 'the error names the missing global').toContain('DSSEditorFlushChannel');
        expect(thrown.message, 'the error names the file to load before the route').toContain('utils/editor-flush-channel.js');
        expect(addListenerSpy, 'chrome.runtime.onMessage listeners registered by a failed install()').not.toHaveBeenCalled();
    });

    it('control: with the channel present, install() registers its listener without throwing', () => {
        require.cache[CHANNEL_PATH] = savedCacheEntry;
        if (!savedCacheEntry) delete require.cache[CHANNEL_PATH];

        expect(() => globalThis.DSSEditorWindowRoutes.install(), 'install() with the real channel').not.toThrow();
        expect(addListenerSpy, 'chrome.runtime.onMessage listeners registered').toHaveBeenCalledTimes(1);
    });
});
