import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

const s = () => contentScript.__getState();

describe('handleChatChange (2.2.x, 2.3.x, 2.4.x, 2.7.x scenarios)', () => {
    async function seedBinding(uuid, presetId) {
        // 使用分塊式 storage API 以相容於 getChatPresetMap()
        await StorageManager.mutateChatPresetMap(map => {
            map[uuid] = presetId;
            return map;
        });
    }

    async function seedPreset(id, name, content) {
        const item = {
            activePresetId: id,
            dsPresetIndex: [id],
            [`dsPreset_${id}`]: { id, name, content, createdAt: 1000, updatedAt: 1000 },
        };
        await chrome.storage.local.set(item);
        await chrome.storage.sync.set(item);
    }

    beforeEach(async () => {
        await new Promise(r => setTimeout(r, 0));
        contentScript.__resetState();

        await chrome.storage.local.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId',
            'dsPreset_p1', 'dsPreset_p2', 'syncInitialized',
        ]);
        await chrome.storage.sync.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId',
            'dsPreset_p1', 'dsPreset_p2', 'syncInitialized',
        ]);

        await seedPreset('p1', 'Helper', 'You are helpful.');
    });

    function setPathname(path) {
        window.history.replaceState({}, '', path);
    }

    it('handles navigation to a new chat with no UUID (clears state)', async () => {
        setPathname('/a/chat/s');
        contentScript.__setState({ currentChatUuid: null, pendingPresetId: 'p1' });
        await contentScript.handleChatChange();

        expect(s().currentChatUuid).toBeNull();
        expect(s().promptPrefix).toBe('');
        expect(s().pendingPresetId).toBeNull();
    });

    it('sets promptPrefix from bound preset on UUID navigation — 2.2.x', async () => {
        await seedBinding('550e8400-e29b-41d4-a716-446655440000', 'p1');
        setPathname('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');
        await contentScript.handleChatChange();

        expect(s().currentChatUuid).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(s().promptPrefix).toBe('You are helpful.');
    });

    it('cleans up stale binding when bound preset no longer exists — 2.7.x', async () => {
        await seedBinding('b0ba0ba0-b0ba-b0ba-b0ba-b0ba0ba0ba0b', 'defunct');
        setPathname('/a/chat/s/b0ba0ba0-b0ba-b0ba-b0ba-b0ba0ba0ba0b');
        await contentScript.handleChatChange();

        expect(s().currentChatUuid).toBe('b0ba0ba0-b0ba-b0ba-b0ba-b0ba0ba0ba0b');
        expect(s().promptPrefix).toBe('');

        const map = await StorageManager.getChatPresetMap();
        expect(map).not.toHaveProperty('b0ba0ba0-b0ba-b0ba-b0ba-b0ba0ba0ba0b');
    });

    it('auto-binds pendingPresetId when awaitingNewChatUuid is true — 2.4.x', async () => {
        setPathname('/a/chat/s');
        contentScript.__setState({
            currentChatUuid: null,
            pendingPresetId: 'p1',
            awaitingNewChatUuid: true,
        });

        setPathname('/a/chat/s/a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5');
        contentScript.__setState({
            currentChatUuid: null,
            awaitingNewChatUuid: true,
            pendingPresetId: 'p1',
        });
        await contentScript.handleChatChange();

        expect(s().currentChatUuid).toBe('a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5');
        expect(s().awaitingNewChatUuid).toBe(false);
        expect(s().promptPrefix).toBe('You are helpful.');
    });

    it('does NOT auto-bind when awaitingNewChatUuid is false — 2.4.x negative', async () => {
        setPathname('/a/chat/s');
        contentScript.__setState({
            currentChatUuid: null,
            pendingPresetId: 'p1',
            awaitingNewChatUuid: false,
        });

        setPathname('/a/chat/s/c0c0a0a0-d1d1-e2e2-f3f3-aaaaaaaabbbb');
        await contentScript.handleChatChange();

        expect(s().currentChatUuid).toBe('c0c0a0a0-d1d1-e2e2-f3f3-aaaaaaaabbbb');
        expect(s().promptPrefix).toBe('');
    });

    it('reloads chatPresetMap from storage on each navigation', async () => {
        contentScript.__setState({
            currentChatUuid: null,
            chatPresetMap: { '00000000-0000-0000-0000-000000000000': 'old-preset' },
        });

        await StorageManager.mutateChatPresetMap(map => {
            map['11111111-1111-1111-1111-111111111111'] = 'p1';
            return map;
        });

        setPathname('/a/chat/s/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        await contentScript.handleChatChange();

        expect(s().chatPresetMap).toEqual({ '11111111-1111-1111-1111-111111111111': 'p1' });
    });

    it('clears prefix when navigating from UUID page to non-chat page', async () => {
        contentScript.__setState({
            currentChatUuid: 'f0f0f0f0-e1e1-d2d2-c3c3-b4b4b4b4b4b4',
            promptPrefix: 'some prefix',
        });

        setPathname('/');
        await contentScript.handleChatChange();

        expect(s().currentChatUuid).toBeNull();
        expect(s().promptPrefix).toBe('');
        expect(s().pendingPresetId).toBeNull();
    });

    it('uses pendingPresetId when there is no currentChatUuid yet', async () => {
        // Seed a preset so it can be looked up by updatePromptPrefixFromBinding
        await seedPreset('p1', 'Helper', 'You are helpful.');

        // Scenario: no chat is active yet (new-chat page, currentChatUuid null),
        // and the user picked a preset from the dropdown before a UUID was assigned
        // (pendingPresetId holds that choice). This is the ONLY case where
        // pendingPresetId should be consulted.
        contentScript.__setState({
            currentChatUuid: null,
            chatPresetMap: {},
            pendingPresetId: 'p1',
        });

        await contentScript.updatePromptPrefixFromBinding();

        expect(s().promptPrefix).toBe('You are helpful.');
    });

    it('does NOT fall back to stale pendingPresetId once a chat is bound (currentChatUuid set, no map entry) — regression for the fixed bug', async () => {
        // Seed a preset so a fallback WOULD be resolvable if the bug were present
        await seedPreset('p1', 'Helper', 'You are helpful.');

        // Scenario: currentChatUuid is already set (chat is active), chatPresetMap
        // has never been populated for this chat, but pendingPresetId still holds a
        // stale value left over from ACTIVE_PRESET_CHANGED. Once a chat is active,
        // its prompt-set binding must be determined solely by chatPresetMap — the
        // pending value must be ignored, leaving promptPrefix empty.
        contentScript.__setState({
            currentChatUuid: 'some-chat-uuid',
            chatPresetMap: {},
            pendingPresetId: 'p1',
        });

        await contentScript.updatePromptPrefixFromBinding();

        expect(s().promptPrefix).toBe('');
    });
});

describe('2.7.2: awaitingNewChatUuid 5-second timeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        contentScript.__resetState();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears awaitingNewChatUuid after 5 seconds', () => {
        contentScript.__setState({ currentChatUuid: null });
        contentScript.markChatCreationAttempt();
        expect(s().awaitingNewChatUuid).toBe(true);

        vi.advanceTimersByTime(5000);
        expect(s().awaitingNewChatUuid).toBe(false);
    });
});
