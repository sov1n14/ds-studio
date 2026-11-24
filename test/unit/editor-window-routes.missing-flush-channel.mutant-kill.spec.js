/**
 * background/editor-window-routes.js install() when the flush request channel (utils/editor-flush-channel.js) is missing.
 *
 * Requirement (file header of the route module, docs/ARCHITECTURE.md "Editor Window Auto-Close"): the route depends on utils/editor-flush-channel.js being loaded first; when the channel is absent, install() fails at once with an error that names DSSEditorFlushChannel, instead of registering a route that cannot ask the editor to save before closing it.
 *
 * Trust boundary only: the channel is made absent by removing globalThis.DSSEditorFlushChannel. chrome.runtime.onMessage.addListener is observed so the test can assert that no listener was registered.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../background/route-dispatch.js';
import '../../utils/message-constants.js';
import '../../utils/editor-flush-channel.js';
import '../../background/editor-window-routes.js';

describe('editor-window-routes install() without the flush request channel', () => {
    let savedChannel;
    let addListenerSpy;

    beforeEach(() => {
        savedChannel = globalThis.DSSEditorFlushChannel;
        addListenerSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(() => {});
    });

    afterEach(() => {
        addListenerSpy.mockRestore();
        globalThis.DSSEditorFlushChannel = savedChannel;
    });

    it('throws an error that names DSSEditorFlushChannel, and registers no listener', () => {
        delete globalThis.DSSEditorFlushChannel;
        let thrown;
        try {
            globalThis.DSSEditorWindowRoutes.install();
        } catch (err) {
            thrown = err;
        }

        expect(thrown, 'install() throws when the flush channel is missing').toBeInstanceOf(Error);
        expect(thrown.message, 'the error names the missing global').toContain('DSSEditorFlushChannel');
        expect(addListenerSpy, 'chrome.runtime.onMessage listeners registered by a failed install()').not.toHaveBeenCalled();
    });

    it('control: with the channel present, install() registers its listener without throwing', () => {
        expect(() => globalThis.DSSEditorWindowRoutes.install(), 'install() with the real channel').not.toThrow();
        expect(addListenerSpy, 'chrome.runtime.onMessage listeners registered').toHaveBeenCalledTimes(1);
    });
});
