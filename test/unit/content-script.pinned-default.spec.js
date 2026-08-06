import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

const s = () => contentScript.__getState();

// Contract under test: a pinned "default" prompt group preselects a NEW
// conversation, but must never override an EXISTING conversation's group
// (whether previously bound or never bound). A stale/deleted pinned id
// falls back to the pre-existing reset behavior on the new-chat path.
describe('pinned default preset preselection (new-chat path only)', () => {
    async function seedPreset(id, name, content) {
        const item = {
            dsPresetIndex: [id],
            [`dsPreset_${id}`]: { id, name, content, createdAt: 1000, updatedAt: 1000 },
        };
        await chrome.storage.local.set(item);
        await chrome.storage.sync.set(item);
    }

    async function seedBinding(uuid, presetId) {
        await StorageManager.mutateChatPresetMap(map => {
            map[uuid] = presetId;
            return map;
        });
    }

    function setPathname(path) {
        window.history.replaceState({}, '', path);
    }

    beforeEach(async () => {
        await new Promise(r => setTimeout(r, 0));
        contentScript.__resetState();

        await chrome.storage.local.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId', 'pinnedPresetId',
            'dsPreset_p1', 'dsPreset_p2', 'syncInitialized',
        ]);
        await chrome.storage.sync.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId', 'pinnedPresetId',
            'dsPreset_p1', 'dsPreset_p2', 'syncInitialized',
        ]);

        await seedPreset('p1', 'Helper', 'You are helpful.');
    });

    it('1. preselects the pinned group on a NEW conversation (no chat id in URL)', async () => {
        await StorageManager.savePinnedPresetId('p1');
        setPathname('/a/chat/s');

        await contentScript.handleChatChange();

        expect(s().pendingPresetId).toBe('p1');
        expect(s().promptPrefix).toBe('You are helpful.');
        const active = await StorageManager._get(['activePresetId']);
        expect(active.activePresetId).toBe('p1');
    });

    it('2a. does NOT override a chat that already has a bound group when a pinned default exists', async () => {
        await seedPreset('p2', 'Other', 'Other content.');
        await StorageManager.savePinnedPresetId('p1');
        await seedBinding('550e8400-e29b-41d4-a716-446655440000', 'p2');
        setPathname('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

        await contentScript.handleChatChange();

        expect(s().promptPrefix).toBe('Other content.');
        const map = await StorageManager.getChatPresetMap();
        expect(map['550e8400-e29b-41d4-a716-446655440000']).toBe('p2');
    });

    it('2b. does NOT bind a pinned default onto a chat that has never had a group bound', async () => {
        await StorageManager.savePinnedPresetId('p1');
        setPathname('/a/chat/s/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

        await contentScript.handleChatChange();

        expect(s().promptPrefix).toBe('');
        const map = await StorageManager.getChatPresetMap();
        expect(map).not.toHaveProperty('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it('3. falls back to reset behavior on a NEW conversation when the pinned id no longer resolves to a group', async () => {
        await StorageManager.savePinnedPresetId('deleted-group');
        setPathname('/a/chat/s');

        await contentScript.handleChatChange();

        expect(s().pendingPresetId).toBeNull();
        expect(s().promptPrefix).toBe('');
    });

    it('4. behaves exactly as the pre-existing reset when nothing is pinned', async () => {
        setPathname('/a/chat/s');

        await contentScript.handleChatChange();

        expect(s().pendingPresetId).toBeNull();
        expect(s().promptPrefix).toBe('');
    });
});
