/**
 * Tests for utils/messaging.js — broadcastActivePreset
 *
 * messaging.js uses `window.DSVMessaging` global assignment and then a
 * guarded `module.exports`. In Node/Vitest the module.exports path is
 * taken, so we can import it directly.
 *
 * The chrome.tabs mock is provided by vitest.setup.js (jest-chrome + in-memory
 * storage mock). We configure chrome.tabs.query / sendMessage via vi.fn().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// messaging.js assigns to window.DSVMessaging; in happy-dom `window` exists.
// We import the module path; the guarded module.exports is exercised.
const { broadcastActivePreset } = await import('../../utils/messaging.js');

describe('broadcastActivePreset', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('sends ACTIVE_PRESET_CHANGED only to a chat.deepseek.com active tab', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([
            { id: 42, url: 'https://chat.deepseek.com/a/chat/s/abc' },
        ]);
        chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await broadcastActivePreset('preset-1', 'Hello world');

        expect(chrome.tabs.query).toHaveBeenCalledWith({ url: '*://chat.deepseek.com/*' });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
            action: 'ACTIVE_PRESET_CHANGED',
            presetId: 'preset-1',
            presetContent: 'Hello world',
        });
    });

    it('does not call sendMessage when no tabs are returned', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([]);
        chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await broadcastActivePreset('preset-1', 'Hello');

        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('swallows tabs API rejection without throwing', async () => {
        chrome.tabs.query = vi.fn().mockRejectedValue(new Error('tabs API error'));
        chrome.tabs.sendMessage = vi.fn();

        await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('swallows sendMessage rejection without throwing', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([
            { id: 42, url: 'https://chat.deepseek.com/' },
        ]);
        chrome.tabs.sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection'));

        await expect(broadcastActivePreset('preset-1', 'Hello')).resolves.toBeUndefined();
    });

    it('does not call sendMessage when tab has no id', async () => {
        chrome.tabs.query = vi.fn().mockResolvedValue([
            { url: 'https://chat.deepseek.com/' },
        ]);
        chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        await broadcastActivePreset('preset-1', 'Hello');

        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

});
