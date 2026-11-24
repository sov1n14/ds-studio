/**
 * Load-order contract of the background route files: install() of each route file needs globalThis.DSSRouteDispatch (background/route-dispatch.js), and clipboard-routes also needs globalThis.DSSRuntimeMessageErrors (utils/runtime-message-errors.js).
 *
 * When a required global is missing, install() throws an Error whose message names the file to load first, and registers no onMessage listener. A broken load order in the service worker therefore fails at startup with a fix hint instead of a TypeError on undefined.
 *
 * Each route source is evaluated against a view of globalThis that hides one named global; every other global is read through to the real one, and writes land in the view, so no spec state leaks into the real globalThis. Assertions read the thrown message and the listener registrations at the chrome.runtime.onMessage trust boundary.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';
import '../../utils/runtime-message-errors.js';
import '../../utils/temporary-chat-message-types.js';
import '../../utils/temporary-chat-constants.js';
import '../../utils/storage-manager.keys.js';
import '../../utils/editor-flush-channel.js';
import '../../background/route-dispatch.js';

const ROOT = path.resolve(__dirname, '../..');

/** Evaluates the route file with globalThis replaced by a view that hides hiddenGlobal and returns the published routes object. */
function loadRouteHiding(file, publishedName, hiddenGlobal) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const published = {};
    const view = new Proxy(globalThis, {
        get: (target, key) => {
            if (key === hiddenGlobal) return undefined;
            if (key in published) return published[key];
            return target[key];
        },
        set: (target, key, value) => {
            published[key] = value;
            return true;
        },
    });
    new Function('globalThis', 'module', source)(view, undefined);
    return published[publishedName];
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('background route files: install() without a required global', () => {
    it.each([
        ['background/clipboard-routes.js', 'DSSClipboardRoutes', 'DSSRouteDispatch', 'background/route-dispatch.js'],
        ['background/editor-window-routes.js', 'DSSEditorWindowRoutes', 'DSSRouteDispatch', 'background/route-dispatch.js'],
        ['background/notification-routes.js', 'DSSNotificationRoutes', 'DSSRouteDispatch', 'background/route-dispatch.js'],
        ['background/pending-store-routes.js', 'DSSPendingStoreRoutes', 'DSSRouteDispatch', 'background/route-dispatch.js'],
        ['background/settings-routes.js', 'DSSSettingsRoutes', 'DSSRouteDispatch', 'background/route-dispatch.js'],
        ['background/clipboard-routes.js', 'DSSClipboardRoutes', 'DSSRuntimeMessageErrors', 'utils/runtime-message-errors.js'],
    ])('%s (%s) install() throws a hint naming the file to load first when %s is missing (%s)', (file, publishedName, hiddenGlobal, fixFile) => {
        const routes = loadRouteHiding(file, publishedName, hiddenGlobal);
        const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener');
        let thrown = null;
        try {
            routes.install();
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.message).toContain('[DSS] ' + path.basename(file, '.js'));
        expect(thrown.message).toContain(fixFile);
        expect(addSpy).not.toHaveBeenCalled();
    });
});
