import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import '../../utils/storage-manager.js';
import { createChatBindingController } from '../../content/chat-binding-controller.js';

// These specs drive the binding state machine through its real public surface:
// the controller factory plus its exported methods (handleChatChange,
// updatePromptPrefixFromBinding, markChatCreationAttempt) and its exported live
// state object -- the same object content-script.js consumes in production.
// State is arranged by assigning onto that real state object and asserted by
// reading it back, so no test-only mirror (__getState/__setState) is involved.

let controller;
let overlayActiveId;

function makeController() {
    overlayActiveId = null;
    return createChatBindingController({
        getPresetOverlay: () => ({ updateActiveId: (id) => { overlayActiveId = id; } }),
        isExtensionContextValid: () => true,
    });
}

const s = () => controller.state;

describe('handleChatChange (2.2.x, 2.3.x, 2.4.x, 2.7.x scenarios)', () => {
    async function seedBinding(uuid, presetId) {
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
        controller = makeController();

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

    it('handles navigation to a new chat with no UUID (clears state)', async () => {
        setPathname('/a/chat/s');
        Object.assign(s(), { currentChatUuid: null, pendingPresetId: 'p1' });
        await controller.handleChatChange();

        expect(s().currentChatUuid).toBeNull();
        expect(s().promptPrefix).toBe('');
        expect(s().pendingPresetId).toBeNull();
    });

    it('sets promptPrefix from bound preset on UUID navigation (2.2.x)', async () => {
        await seedBinding('550e8400-e29b-41d4-a716-446655440000', 'p1');
        setPathname('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');
        await controller.handleChatChange();

        expect(s().currentChatUuid).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(s().promptPrefix).toBe('You are helpful.');
    });

    it('cleans up stale binding when bound preset no longer exists (2.7.x)', async () => {
        await seedBinding('b0ba0ba0-b0ba-b0ba-b0ba-b0ba0ba0ba0b', 'defunct');
        setPathname('/a/chat/s/b0ba0ba0-b0ba-b0ba-b0ba-b0ba0ba0ba0b');
        await controller.handleChatChange();

        expect(s().currentChatUuid).toBe('b0ba0ba0-b0ba-b0ba-b0ba-b0ba0ba0ba0b');
        expect(s().promptPrefix).toBe('');

        const map = await StorageManager.getChatPresetMap();
        expect(map).not.toHaveProperty('b0ba0ba0-b0ba-b0ba-b0ba-b0ba0ba0ba0b');
    });

    it('auto-binds pendingPresetId when awaitingNewChatUuid is true (2.4.x)', async () => {
        setPathname('/a/chat/s');
        Object.assign(s(), {
            currentChatUuid: null,
            pendingPresetId: 'p1',
            awaitingNewChatUuid: true,
        });

        setPathname('/a/chat/s/a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5');
        Object.assign(s(), {
            currentChatUuid: null,
            awaitingNewChatUuid: true,
            pendingPresetId: 'p1',
        });
        await controller.handleChatChange();

        expect(s().currentChatUuid).toBe('a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5');
        expect(s().awaitingNewChatUuid).toBe(false);
        expect(s().promptPrefix).toBe('You are helpful.');
    });

    it('does NOT auto-bind when awaitingNewChatUuid is false (2.4.x negative)', async () => {
        setPathname('/a/chat/s');
        Object.assign(s(), {
            currentChatUuid: null,
            pendingPresetId: 'p1',
            awaitingNewChatUuid: false,
        });

        setPathname('/a/chat/s/c0c0a0a0-d1d1-e2e2-f3f3-aaaaaaaabbbb');
        await controller.handleChatChange();

        expect(s().currentChatUuid).toBe('c0c0a0a0-d1d1-e2e2-f3f3-aaaaaaaabbbb');
        expect(s().promptPrefix).toBe('');
    });

    it('reloads chatPresetMap from storage on each navigation', async () => {
        Object.assign(s(), {
            currentChatUuid: null,
            chatPresetMap: { '00000000-0000-0000-0000-000000000000': 'old-preset' },
        });

        await StorageManager.mutateChatPresetMap(map => {
            map['11111111-1111-1111-1111-111111111111'] = 'p1';
            return map;
        });

        setPathname('/a/chat/s/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        await controller.handleChatChange();

        expect(s().chatPresetMap).toEqual({ '11111111-1111-1111-1111-111111111111': 'p1' });
    });

    it('clears prefix when navigating from UUID page to non-chat page', async () => {
        Object.assign(s(), {
            currentChatUuid: 'f0f0f0f0-e1e1-d2d2-c3c3-b4b4b4b4b4b4',
            promptPrefix: 'some prefix',
        });

        setPathname('/');
        await controller.handleChatChange();

        expect(s().currentChatUuid).toBeNull();
        expect(s().promptPrefix).toBe('');
        expect(s().pendingPresetId).toBeNull();
    });

    it('uses pendingPresetId when there is no currentChatUuid yet', async () => {
        await seedPreset('p1', 'Helper', 'You are helpful.');

        // Scenario: no chat is active yet (new-chat page, currentChatUuid null),
        // and the user picked a preset before a UUID was assigned (pendingPresetId
        // holds that choice). This is the ONLY case where pendingPresetId is used.
        Object.assign(s(), {
            currentChatUuid: null,
            chatPresetMap: {},
            pendingPresetId: 'p1',
        });

        await controller.updatePromptPrefixFromBinding();

        expect(s().promptPrefix).toBe('You are helpful.');
    });

    it('does NOT fall back to stale pendingPresetId once a chat is bound (currentChatUuid set, no map entry) - regression for the fixed bug', async () => {
        await seedPreset('p1', 'Helper', 'You are helpful.');

        // Scenario: currentChatUuid is already set (chat active), chatPresetMap has
        // no entry for this chat, but pendingPresetId still holds a stale value from
        // ACTIVE_PRESET_CHANGED. Once a chat is active, binding must come solely from
        // chatPresetMap; the pending value must be ignored, leaving promptPrefix empty.
        Object.assign(s(), {
            currentChatUuid: 'some-chat-uuid',
            chatPresetMap: {},
            pendingPresetId: 'p1',
        });

        await controller.updatePromptPrefixFromBinding();

        expect(s().promptPrefix).toBe('');
    });
});

describe('2.7.2: awaitingNewChatUuid 5-second timeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        controller = makeController();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears awaitingNewChatUuid after 5 seconds', () => {
        Object.assign(s(), { currentChatUuid: null });
        controller.markChatCreationAttempt();
        expect(s().awaitingNewChatUuid).toBe(true);

        vi.advanceTimersByTime(5000);
        expect(s().awaitingNewChatUuid).toBe(false);
    });
});
