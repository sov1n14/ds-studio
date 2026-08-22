/**
 * Tests for StorageManager.pruneOrphanChatBindings — orphan chat-binding cleanup.
 *
 * Contract under test (requirement, not implementation):
 *   1. initialize() drops every chatPresetMap entry whose preset id is absent
 *      from dsPresetIndex.
 *   2. Bindings pointing at a preset id still present in dsPresetIndex survive.
 *   3. The mutator performs NO storage write when nothing needs pruning.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const LIVE = { id: 'p-live', name: 'Live', content: 'c', createdAt: 1000, updatedAt: 1000 };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('pruneOrphanChatBindings via initialize()', () => {
    it('removes chatPresetMap entries whose preset id is absent from dsPresetIndex', async () => {
        await StorageManager.savePromptPresets([LIVE]);
        await StorageManager.bindChatToPreset('uuid-orphan', 'p-deleted');

        await StorageManager.initialize();

        const map = await StorageManager.getChatPresetMap();
        expect(map['uuid-orphan']).toBeUndefined();
    });

    it('keeps chatPresetMap entries whose preset id is still in dsPresetIndex', async () => {
        await StorageManager.savePromptPresets([LIVE]);
        await StorageManager.bindChatToPreset('uuid-live', LIVE.id);
        await StorageManager.bindChatToPreset('uuid-orphan', 'p-deleted');

        await StorageManager.initialize();

        expect(await StorageManager.getChatPresetMap()).toEqual({ 'uuid-live': LIVE.id });
    });
});

describe('pruneOrphanChatBindings — mutator write contract', () => {
    it('writes nothing when every binding is still valid', async () => {
        await StorageManager.savePromptPresets([LIVE]);
        await StorageManager.bindChatToPreset('uuid-live', LIVE.id);

        const syncSet = vi.spyOn(chrome.storage.sync, 'set');
        const localSet = vi.spyOn(chrome.storage.local, 'set');
        const syncRemove = vi.spyOn(chrome.storage.sync, 'remove');

        await StorageManager.pruneOrphanChatBindings([LIVE.id]);

        expect(syncSet).not.toHaveBeenCalled();
        expect(localSet).not.toHaveBeenCalled();
        expect(syncRemove).not.toHaveBeenCalled();
        expect(await StorageManager.getChatPresetMap()).toEqual({ 'uuid-live': LIVE.id });
    });

    it('writes the pruned map when an orphan binding exists', async () => {
        await StorageManager.savePromptPresets([LIVE]);
        await StorageManager.bindChatToPreset('uuid-live', LIVE.id);
        await StorageManager.bindChatToPreset('uuid-orphan', 'p-deleted');

        await StorageManager.pruneOrphanChatBindings([LIVE.id]);

        expect(await StorageManager.getChatPresetMap()).toEqual({ 'uuid-live': LIVE.id });
    });
});
