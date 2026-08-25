/**
 * RED-phase spec for utils/window-control.js (backlog B11 / decision D5).
 *
 * D5: the editor window must be a TRUE singleton. The window id is persisted
 * outside the popup closure (chrome.storage.session), so a second click focuses
 * the window that is already open; when that second click targets a DIFFERENT
 * prompt group, the existing window must navigate to the new url instead of
 * showing the previous group content.
 *
 * Contract under test — openSingletonWindow({url, createOptions, storageKey}):
 *   - no stored id -> windows.create({url, ...createOptions}), persist the new
 *     id under storageKey, resolve {window, created:true}
 *   - stored id, alive, same url -> windows.update(id,{focused:true}), no
 *     navigation, resolve {window, created:false}
 *   - stored id, alive, different url -> focus + tabs.update(tabId,{url}),
 *     resolve {window, created:false}
 *   - stored id, window gone (windows.get rejects) -> create + persist, created:true
 *   - storage read failure -> still opens a window (availability over dedupe)
 *     and logs a '[DSS]'-prefixed console.error
 *
 * chrome.storage.session is absent from test/setup/vitest.setup.js by design;
 * this spec installs its own stub additively and removes it afterwards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { openSingletonWindow } = await import('../../utils/window-control.js');

const STORAGE_KEY = 'dss-editor-window-id';
const URL_GROUP_A = 'chrome-extension://test-extension-id/editor/editor.html?group=a';
const URL_GROUP_B = 'chrome-extension://test-extension-id/editor/editor.html?group=b';
const CREATE_OPTIONS = { type: 'popup', width: 900, height: 700 };

const loggedDssError = (spy) =>
    spy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('[DSS]')),
    );

/** A chrome.windows.Window as returned with populate:true. */
const windowWithTab = (windowId, tabId, url) => ({
    id: windowId,
    tabs: [{ id: tabId, active: true, windowId, url }],
});

describe('DSSWindowControl.openSingletonWindow', () => {
    let sessionStore;
    let errorSpy;

    beforeEach(() => {
        sessionStore = {};
        chrome.storage.session = {
            get: vi.fn(async (key) => (key in sessionStore ? { [key]: sessionStore[key] } : {})),
            set: vi.fn(async (items) => {
                Object.assign(sessionStore, items);
            }),
            remove: vi.fn(async (key) => {
                delete sessionStore[key];
            }),
        };
        chrome.windows.get = vi.fn();
        chrome.windows.create = vi.fn();
        chrome.windows.update = vi.fn(async (id) => ({ id }));
        chrome.tabs.update = vi.fn(async (id, props) => ({ id, ...props }));
        chrome.tabs.query = vi.fn().mockResolvedValue([]);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        delete chrome.storage.session;
        vi.restoreAllMocks();
    });

    it('publishes openSingletonWindow on globalThis.DSSWindowControl', () => {
        expect(typeof globalThis.DSSWindowControl?.openSingletonWindow).toBe('function');
    });

    it('creates the window and persists its id when nothing is stored', async () => {
        const created = windowWithTab(11, 101, URL_GROUP_A);
        chrome.windows.create.mockResolvedValue(created);

        const result = await openSingletonWindow({
            url: URL_GROUP_A,
            createOptions: CREATE_OPTIONS,
            storageKey: STORAGE_KEY,
        });

        expect(chrome.windows.create).toHaveBeenCalledWith({ url: URL_GROUP_A, ...CREATE_OPTIONS });
        expect(result).toEqual({ window: created, created: true });
        expect(sessionStore[STORAGE_KEY]).toBe(11);
    });

    it('focuses the stored window instead of creating a second one', async () => {
        sessionStore[STORAGE_KEY] = 11;
        const existing = windowWithTab(11, 101, URL_GROUP_A);
        chrome.windows.get.mockResolvedValue(existing);

        const result = await openSingletonWindow({
            url: URL_GROUP_A,
            createOptions: CREATE_OPTIONS,
            storageKey: STORAGE_KEY,
        });

        expect(chrome.windows.create).not.toHaveBeenCalled();
        expect(chrome.windows.get).toHaveBeenCalledWith(11, expect.anything());
        expect(chrome.windows.update).toHaveBeenCalledWith(11, { focused: true });
        expect(result).toEqual({ window: existing, created: false });
    });

    it('does not navigate when the stored window already shows the requested url', async () => {
        sessionStore[STORAGE_KEY] = 11;
        chrome.windows.get.mockResolvedValue(windowWithTab(11, 101, URL_GROUP_A));

        await openSingletonWindow({
            url: URL_GROUP_A,
            createOptions: CREATE_OPTIONS,
            storageKey: STORAGE_KEY,
        });

        expect(chrome.tabs.update).not.toHaveBeenCalled();
    });

    it('navigates the existing window to the new url when a different group is requested', async () => {
        sessionStore[STORAGE_KEY] = 11;
        const existing = windowWithTab(11, 101, URL_GROUP_A);
        chrome.windows.get.mockResolvedValue(existing);
        // Either route to the window tab is acceptable; both return the same tab.
        chrome.tabs.query.mockResolvedValue(existing.tabs);

        const result = await openSingletonWindow({
            url: URL_GROUP_B,
            createOptions: CREATE_OPTIONS,
            storageKey: STORAGE_KEY,
        });

        expect(chrome.windows.create).not.toHaveBeenCalled();
        expect(chrome.tabs.update).toHaveBeenCalledWith(101, { url: URL_GROUP_B });
        expect(chrome.windows.update).toHaveBeenCalledWith(11, { focused: true });
        expect(result).toEqual({ window: existing, created: false });
    });

    it('creates and re-persists when the stored window no longer exists', async () => {
        sessionStore[STORAGE_KEY] = 11;
        chrome.windows.get.mockRejectedValue(new Error('No window with id: 11.'));
        const created = windowWithTab(22, 202, URL_GROUP_B);
        chrome.windows.create.mockResolvedValue(created);

        const result = await openSingletonWindow({
            url: URL_GROUP_B,
            createOptions: CREATE_OPTIONS,
            storageKey: STORAGE_KEY,
        });

        expect(chrome.windows.create).toHaveBeenCalledWith({ url: URL_GROUP_B, ...CREATE_OPTIONS });
        expect(result).toEqual({ window: created, created: true });
        expect(sessionStore[STORAGE_KEY]).toBe(22);
    });

    it('still opens a window and logs a [DSS] error when the storage read fails', async () => {
        chrome.storage.session.get = vi.fn().mockRejectedValue(new Error('session storage error'));
        const created = windowWithTab(33, 303, URL_GROUP_A);
        chrome.windows.create.mockResolvedValue(created);

        const result = await openSingletonWindow({
            url: URL_GROUP_A,
            createOptions: CREATE_OPTIONS,
            storageKey: STORAGE_KEY,
        });

        expect(result).toEqual({ window: created, created: true });
        expect(chrome.windows.create).toHaveBeenCalledWith({ url: URL_GROUP_A, ...CREATE_OPTIONS });
        expect(loggedDssError(errorSpy)).toBe(true);
    });
});
