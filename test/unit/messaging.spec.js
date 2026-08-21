/**
 * Tests for utils/messaging.js — broadcastActivePreset
 *
 * Contract under test (decision D2): broadcastActivePreset queries
 * `{url: '*://chat.deepseek.com/*'}` and sends the ACTIVE_PRESET_CHANGED
 * message to EVERY matching tab, concurrently. A single tab's failure must
 * not block delivery to the others and must not reject the overall call.
 *
 * messaging.js uses `window.DSVMessaging` global assignment and then a
 * guarded `module.exports`. In Node/Vitest the module.exports path is
 * taken, so we can import it directly.
 *
 * The chrome.tabs mock is provided by vitest.setup.js (jest-chrome + in-memory
 * storage mock). We configure chrome.tabs.query / sendMessage via vi.fn().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { broadcastActivePreset } = await import('../../utils/messaging.js');

const message = (presetId, presetContent) => ({
    action: 'ACTIVE_PRESET_CHANGED',
    presetId,
    presetContent,
});

/** Observable delivery: which tab ids received which payload. */
const deliveries = (sendMessage) =>
    sendMessage.mock.calls.map(([tabId, payload]) => ({ tabId, payload }));

const deliveredTabIds = (sendMessage) =>
    sendMessage.mock.calls.map(([tabId]) => tabId).sort((a, b) => a - b);

describe('broadcastActivePreset', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('delivers ACTIVE_PRESET_CHANGED to every matching chat.deepseek.com tab', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([
            { id: 42, url: 'https://chat.deepseek.com/a/chat/s/abc' },
            { id: 77, url: 'https://chat.deepseek.com/' },
            { id: 99, url: 'https://chat.deepseek.com/a/chat/s/xyz' },
        ]);
        chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await broadcastActivePreset('preset-1', 'Hello world');

        expect(chrome.tabs.query).toHaveBeenCalledWith({ url: '*://chat.deepseek.com/*' });
        expect(deliveredTabIds(chrome.tabs.sendMessage)).toEqual([42, 77, 99]);
        for (const tabId of [42, 77, 99]) {
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
                tabId,
                message('preset-1', 'Hello world'),
            );
        }
    });

    it('delivers an empty presetId (selection cleared) to every matching tab', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([
            { id: 42, url: 'https://chat.deepseek.com/' },
            { id: 77, url: 'https://chat.deepseek.com/' },
        ]);
        chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await broadcastActivePreset('', '');

        expect(deliveries(chrome.tabs.sendMessage)).toEqual([
            { tabId: 42, payload: message('', '') },
            { tabId: 77, payload: message('', '') },
        ]);
    });

    it('still delivers to the remaining tabs when one tab rejects, and resolves', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([
            { id: 42, url: 'https://chat.deepseek.com/' },
            { id: 77, url: 'https://chat.deepseek.com/' },
            { id: 99, url: 'https://chat.deepseek.com/' },
        ]);
        chrome.tabs.sendMessage = vi.fn().mockImplementation((tabId) =>
            tabId === 77
                ? Promise.reject(new Error('Could not establish connection'))
                : Promise.resolve({}),
        );

        await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();

        expect(deliveredTabIds(chrome.tabs.sendMessage)).toEqual([42, 77, 99]);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, message('preset-1', 'Hello'));
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, message('preset-1', 'Hello'));
    });

    it('still delivers to the remaining tabs when the FIRST tab rejects', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([
            { id: 42, url: 'https://chat.deepseek.com/' },
            { id: 77, url: 'https://chat.deepseek.com/' },
        ]);
        chrome.tabs.sendMessage = vi.fn().mockImplementation((tabId) =>
            tabId === 42
                ? Promise.reject(new Error('Receiving end does not exist'))
                : Promise.resolve({}),
        );

        await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(77, message('preset-1', 'Hello'));
    });

    it('skips a tab with no id but still delivers to the tabs that have one', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([
            { url: 'https://chat.deepseek.com/' },
            { id: 77, url: 'https://chat.deepseek.com/' },
        ]);
        chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await broadcastActivePreset('preset-1', 'Hello');

        expect(deliveries(chrome.tabs.sendMessage)).toEqual([
            { tabId: 77, payload: message('preset-1', 'Hello') },
        ]);
    });

    it('resolves without sending when no tab matches', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([]);
        chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();

        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('swallows a tabs.query rejection without throwing and sends nothing', async () => {
        chrome.tabs.query = vi.fn().mockRejectedValue(new Error('tabs API error'));
        chrome.tabs.sendMessage = vi.fn();

        await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
});
