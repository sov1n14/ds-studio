/**
 * background/settings-routes.js -- settings message routes + change broadcast.
 *
 * Contract under test (derived from requirements; the implementation does not
 * exist yet and was not read):
 *  - install() registers a chrome.runtime.onMessage handler for
 *    DSS_GET_SETTINGS / DSS_SET_SETTINGS and a chrome.storage.onChanged
 *    handler that broadcasts DSS_SETTINGS_CHANGED to chat.deepseek.com tabs.
 *  - Every handled request eventually calls sendResponse; unknown types are
 *    left alone so the pre-existing DSS_SCHEDULE_DELETE_RETRY listener still
 *    sees them.
 *
 * Mechanics: the shared chrome mock callListeners() discards listener return
 * values, so "return true" is unobservable -- assertions go through the
 * sendResponse spy handed to callListeners as the third argument.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import '../../utils/temporary-chat-constants.js';
import StorageManager from '../../utils/storage-manager.js';
import { resetStorageOnChangedListeners } from '../setup/vitest.setup.js';
import '../../utils/settings-message-constants.js';
import '../../background/settings-routes.js';

const MSG = () => globalThis.DSS_SETTINGS_MSG;

/** Drain the setTimeout(0)-based storage mock and promise chains. */
const flush = async (ticks = 6) => {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Fire a runtime message and return the sendResponse spy once settled. */
async function send(message) {
    const sendResponse = vi.fn();
    chrome.runtime.onMessage.callListeners(message, { id: 'test-extension-id' }, sendResponse);
    await flush();
    return sendResponse;
}

/** Fire a storage change and let the broadcast settle. */
async function change(changes, area) {
    chrome.storage.onChanged.callListeners(changes, area);
    await flush();
}

describe('background/settings-routes', () => {
    // Installed once: chrome.runtime.onMessage listeners cannot be unregistered
    // through the mock, so re-installing per test would double every response.
    beforeAll(() => {
        resetStorageOnChangedListeners();
        globalThis.DSSSettingsRoutes.install();
    });

    beforeEach(async () => {
        // The global beforeEach in vitest.setup.js clears storage, which itself
        // emits an onChanged notification; drain that broadcast before resetting
        // the tab spies so it cannot pollute a test call record.
        chrome.tabs.query.mockResolvedValue([]);
        chrome.tabs.sendMessage.mockResolvedValue(undefined);
        await flush();
        chrome.tabs.query.mockReset();
        chrome.tabs.sendMessage.mockReset();
        chrome.tabs.query.mockResolvedValue([]);
        chrome.tabs.sendMessage.mockResolvedValue(undefined);
    });

    describe('DSS_GET_SETTINGS', () => {
        it('returns stored values for present keys and StorageManager defaults for absent ones', async () => {
            await chrome.storage.local.set({ dsHideThinking: true });

            const sendResponse = await send({ type: MSG().GET_SETTINGS, keys: ['dsHideThinking', 'dsChatWidth'] });

            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse.mock.calls[0][0]).toEqual({
                ok: true,
                values: {
                    dsHideThinking: true,
                    dsChatWidth: StorageManager.DEFAULTS.dsChatWidth,
                },
            });
        });

        // B9: the read path must never hand out the legacy raw 'default' value.
        // popup and content/websearch-toggle each re-implement "'default' means 'on'";
        // normalizing here is what lets both drop their private copy.
        it('normalizes a legacy dsWebSearchToggle value of "default" to "on"', async () => {
            await chrome.storage.local.set({ dsWebSearchToggle: 'default' });

            const sendResponse = await send({ type: MSG().GET_SETTINGS, keys: ['dsWebSearchToggle'] });

            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true, values: { dsWebSearchToggle: 'on' } });
        });

        it.each([
            ['an unset dsWebSearchToggle', undefined, 'on'],
            ['a stored "off"', 'off', 'off'],
            ['a stored "on"', 'on', 'on'],
        ])('passes through %s', async (_label, stored, expected) => {
            if (stored !== undefined) await chrome.storage.local.set({ dsWebSearchToggle: stored });

            const sendResponse = await send({ type: MSG().GET_SETTINGS, keys: ['dsWebSearchToggle'] });

            expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true, values: { dsWebSearchToggle: expected } });
        });

        it.each([
            ['a non-array keys field', { type: 'DSS_GET_SETTINGS', keys: 'dsHideThinking' }],
            ['an empty keys array', { type: 'DSS_GET_SETTINGS', keys: [] }],
            ['a missing keys field', { type: 'DSS_GET_SETTINGS' }],
        ])('rejects %s without hanging the caller', async (_label, message) => {
            const sendResponse = await send(message);

            expect(sendResponse).toHaveBeenCalledTimes(1);
            const response = sendResponse.mock.calls[0][0];
            expect(response.ok).toBe(false);
            expect(response.error).toBeTruthy();
        });
    });

    describe('DSS_SET_SETTINGS', () => {
        it('writes the values to chrome.storage.local and acknowledges', async () => {
            const sendResponse = await send({
                type: MSG().SET_SETTINGS,
                values: { dsHideThinking: true, dsChatWidth: 55 },
            });

            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true });
            await expect(chrome.storage.local.get(['dsHideThinking', 'dsChatWidth']))
                .resolves.toEqual({ dsHideThinking: true, dsChatWidth: 55 });
        });

        it('reports ok:false with an error when the storage write fails', async () => {
            vi.spyOn(chrome.storage.local, 'set').mockImplementationOnce((items, callback) => {
                if (typeof callback === 'function') {
                    chrome.runtime.lastError = { message: 'storage boom' };
                    callback();
                    delete chrome.runtime.lastError;
                    return undefined;
                }
                return Promise.reject(new Error('storage boom'));
            });

            const sendResponse = await send({ type: MSG().SET_SETTINGS, values: { dsHideThinking: true } });

            expect(sendResponse).toHaveBeenCalledTimes(1);
            const response = sendResponse.mock.calls[0][0];
            expect(response.ok).toBe(false);
            expect(response.error).toBeTruthy();
        });

        it.each([
            ['a non-object values field', { type: 'DSS_SET_SETTINGS', values: 'nope' }],
            ['an empty values object', { type: 'DSS_SET_SETTINGS', values: {} }],
        ])('rejects %s', async (_label, message) => {
            const sendResponse = await send(message);

            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse.mock.calls[0][0].ok).toBe(false);
        });
    });

    describe('unknown message types', () => {
        it('never responds, leaving the message for the other onMessage listeners', async () => {
            const sendResponse = await send({ type: 'DSS_SCHEDULE_DELETE_RETRY', chatId: 'abc' });

            expect(sendResponse).not.toHaveBeenCalled();
        });
    });

    describe('DSS_SETTINGS_CHANGED broadcast', () => {
        it('forwards a watched local change verbatim to every chat.deepseek.com tab', async () => {
            chrome.tabs.query.mockResolvedValue([{ id: 11 }, { id: 22 }]);
            const changes = { dsHideThinking: { oldValue: false, newValue: true } };

            await change(changes, 'local');

            expect(chrome.tabs.query).toHaveBeenCalledWith({ url: '*://chat.deepseek.com/*' });
            const expected = { type: 'DSS_SETTINGS_CHANGED', area: 'local', changes };
            expect(chrome.tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([11, 22]);
            expect(chrome.tabs.sendMessage.mock.calls[0][1]).toEqual(expected);
            expect(chrome.tabs.sendMessage.mock.calls[1][1]).toEqual(expected);
        });

        it('does not even query tabs when no changed key is watched', async () => {
            await change({ someUnrelatedKey: { oldValue: 1, newValue: 2 } }, 'local');

            expect(chrome.tabs.query).not.toHaveBeenCalled();
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });

        it('skips tabs that carry no id', async () => {
            chrome.tabs.query.mockResolvedValue([{ id: 11 }, {}, { id: 33 }]);

            await change({ dsHideThinking: { oldValue: false, newValue: true } }, 'local');

            expect(chrome.tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([11, 33]);
        });

        it('keeps delivering to the other tabs when one tab rejects, and survives for later changes', async () => {
            chrome.tabs.query.mockResolvedValue([{ id: 11 }, { id: 22 }]);
            chrome.tabs.sendMessage.mockImplementation((tabId) => (tabId === 11
                ? Promise.reject(new Error('no receiving end'))
                : Promise.resolve(undefined)));

            await change({ dsHideThinking: { oldValue: false, newValue: true } }, 'local');

            expect(chrome.tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([11, 22]);

            chrome.tabs.sendMessage.mockReset();
            chrome.tabs.sendMessage.mockResolvedValue(undefined);
            await change({ dsChatWidth: { oldValue: 70, newValue: 60 } }, 'local');
            expect(chrome.tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([11, 22]);
        });

        it.each([
            ['a dsPreset_ key', 'dsPreset_abc123'],
            ['a chatPresetMap_ chunk key', 'chatPresetMap_0'],
        ])('forwards %s changed in the sync area', async (_label, key) => {
            chrome.tabs.query.mockResolvedValue([{ id: 11 }]);
            const changes = { [key]: { oldValue: undefined, newValue: { id: 'abc123' } } };

            await change(changes, 'sync');

            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(11, {
                type: 'DSS_SETTINGS_CHANGED',
                area: 'sync',
                changes,
            });
        });

        it('ignores an unwatched sync-area key', async () => {
            await change({ someUnrelatedKey: { oldValue: 1, newValue: 2 } }, 'sync');

            expect(chrome.tabs.query).not.toHaveBeenCalled();
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });

        it('forwards the temporary-chat enabled flag change from the local area', async () => {
            chrome.tabs.query.mockResolvedValue([{ id: 11 }]);

            await change({ [globalThis.DSS_TEMP_CHAT_STORAGE_KEY]: { oldValue: false, newValue: true } }, 'local');

            expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        });
    });
});
