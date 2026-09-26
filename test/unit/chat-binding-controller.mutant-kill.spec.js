import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import '../../utils/storage-manager.js';
import { createChatBindingController } from '../../content/chat-binding-controller.js';
import { createChatMapWriterHarness, restoreChromeBoundaries } from '../helpers/chat-map-writer-harness.js';

// Behaviour contracts of the chat-binding state machine that the broader binding specs leave unasserted: initial state, dependency validation, settings defaults, the new-chat wait timer, prefix resolution edge cases, overlay sync and popstate wiring. Only trust boundaries are doubled: chrome.* (via the chat-map writer harness) and the injected overlay, whose displayed active id is recorded as the observable output.

const UUID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const UUID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const NEW_CHAT_PATH = '/a/chat/s';
const chatPath = (uuid) => `${NEW_CHAT_PATH}/${uuid}`;
const NEW_CHAT_UUID_WAIT_MS = 5000;

function makeOverlay() {
    const overlay = { activeId: null, updateActiveId(id) { overlay.activeId = id; } };
    return overlay;
}

function makeController({ overlay = makeOverlay(), isContextValid = () => true, getPresetOverlay } = {}) {
    const controller = createChatBindingController({
        getPresetOverlay: getPresetOverlay ?? (() => overlay),
        isExtensionContextValid: isContextValid,
    });
    return { controller, overlay, state: controller.state };
}

describe('initial state', () => {
    it('a fresh controller starts disabled, with empty prompts, global prompt enabled and no chat binding', () => {
        const { state } = makeController();
        expect(state).toEqual({
            isEnabled: false,
            promptPrefix: '',
            globalDefaultPrompt: '',
            isGlobalPromptEnabled: true,
            isShowSystemTime: false,
            isInjecting: false,
            currentChatUuid: null,
            chatPresetMap: {},
            pendingPresetId: null,
            awaitingNewChatUuid: false,
            awaitingNewChatUuidTimer: null,
        });
    });
});

describe('createChatBindingController dependency validation', () => {
    const fn = () => {};

    it('throws a descriptive error naming getPresetOverlay when deps is missing', () => {
        expect(() => createChatBindingController()).toThrow(/createChatBindingController.*getPresetOverlay/);
    });

    it('throws a descriptive error naming getPresetOverlay when it is not a function', () => {
        expect(() => createChatBindingController({ getPresetOverlay: 'overlay', isExtensionContextValid: fn }))
            .toThrow(/createChatBindingController.*getPresetOverlay/);
    });

    it('throws a descriptive error naming isExtensionContextValid when it is not a function', () => {
        expect(() => createChatBindingController({ getPresetOverlay: fn }))
            .toThrow(/createChatBindingController.*isExtensionContextValid/);
    });

    it('builds a controller when both dependencies are functions', () => {
        expect(createChatBindingController({ getPresetOverlay: fn, isExtensionContextValid: fn }).state).toBeTypeOf('object');
    });
});

describe('applyInitialSettings defaults', () => {
    const base = { isEnabled: true, promptPresets: [], chatPresetMap: {} };

    it('missing globalDefaultPrompt, isShowSystemTime and globalPromptEnabled fall back to empty, off and enabled', () => {
        const { controller, state } = makeController();
        Object.assign(state, { globalDefaultPrompt: 'stale', isShowSystemTime: true, isGlobalPromptEnabled: false });
        controller.applyInitialSettings({ ...base });
        expect(state.globalDefaultPrompt).toBe('');
        expect(state.isShowSystemTime).toBe(false);
        expect(state.isGlobalPromptEnabled).toBe(true);
    });

    it('explicit isShowSystemTime true and a globalDefaultPrompt are applied as given', () => {
        const { controller, state } = makeController();
        controller.applyInitialSettings({ ...base, isShowSystemTime: true, globalDefaultPrompt: 'Be brief.' });
        expect(state.isShowSystemTime).toBe(true);
        expect(state.globalDefaultPrompt).toBe('Be brief.');
    });
});

describe('markChatCreationAttempt wait window', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('is a no-op when the page already has a chat uuid', () => {
        const { controller, state } = makeController();
        state.currentChatUuid = UUID_A;
        controller.markChatCreationAttempt();
        expect(state.awaitingNewChatUuid).toBe(false);
    });

    it('a repeated attempt restarts the wait window instead of keeping the first deadline', () => {
        const { controller, state } = makeController();
        controller.markChatCreationAttempt();
        vi.advanceTimersByTime(3000);
        controller.markChatCreationAttempt();
        vi.advanceTimersByTime(NEW_CHAT_UUID_WAIT_MS - 1);
        expect(state.awaitingNewChatUuid, 'still waiting just before the window of the LAST attempt ends').toBe(true);
        vi.advanceTimersByTime(1);
        expect(state.awaitingNewChatUuid).toBe(false);
    });
});

describe('binding resolution against real storage', () => {
    const originalStorageManager = window.StorageManager;
    const listeners = [];
    let h;

    async function seedPresets(presets) {
        const item = { dsPresetIndex: presets.map(p => p.id) };
        for (const p of presets) item[`dsPreset_${p.id}`] = { ...p, name: p.id, createdAt: 1000, updatedAt: 1000 };
        await chrome.storage.local.set(item);
        await chrome.storage.sync.set(item);
    }

    beforeEach(async () => {
        h = await createChatMapWriterHarness({ clientCount: 1 });
        window.StorageManager = h.clients[0];
        await seedPresets([
            { id: 'p1', content: 'First preset.' },
            { id: 'p2', content: 'Second preset.' },
        ]);
        const add = window.addEventListener.bind(window);
        vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
            listeners.push([type, fn]);
            return add(type, fn, opts);
        });
        setPathname(NEW_CHAT_PATH);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        for (const [type, fn] of listeners.splice(0)) window.removeEventListener(type, fn);
        restoreChromeBoundaries();
        window.StorageManager = originalStorageManager;
    });

    describe('updatePromptPrefixFromBinding', () => {
        it('clears the prefix when the bound preset id is not among the presets', async () => {
            const { controller, state } = makeController();
            Object.assign(state, { currentChatUuid: UUID_A, chatPresetMap: { [UUID_A]: 'ghost' }, promptPrefix: 'stale' });
            await controller.updatePromptPrefixFromBinding();
            expect(state.promptPrefix).toBe('');
        });
    });

    describe('handleChatChange: new-chat page', () => {
        it('ends any pending new-chat wait and shows no active preset in the overlay when nothing is pinned', async () => {
            const { controller, state, overlay } = makeController();
            controller.markChatCreationAttempt();
            expect(state.awaitingNewChatUuid).toBe(true);
            await controller.handleChatChange();
            expect(state.awaitingNewChatUuid).toBe(false);
            expect(overlay.activeId).toBe('');
        });
    });

    describe('handleChatChange: chat uuid arrives', () => {
        // Arrange the "user sent the first message on the new-chat page" state through the real API.
        function startNewChat(pendingPresetId) {
            const made = makeController();
            made.state.pendingPresetId = pendingPresetId;
            made.controller.markChatCreationAttempt();
            setPathname(chatPath(UUID_A));
            return made;
        }

        it('auto-binds the pending preset by id, not the first preset in the list', async () => {
            const { controller, state, overlay } = startNewChat('p2');
            await controller.handleChatChange();
            expect(state.promptPrefix).toBe('Second preset.');
            expect((await h.readStored()).map).toEqual({ [UUID_A]: 'p2' });
            expect(overlay.activeId, 'overlay shows the preset the new chat was bound to').toBe('p2');
            expect(state.awaitingNewChatUuid).toBe(false);
        });

        it('clears the prefix when the pending preset id is not among the presets', async () => {
            const { controller, state } = startNewChat('ghost');
            state.promptPrefix = 'stale';
            await controller.handleChatChange();
            expect(state.promptPrefix).toBe('');
        });

        it('with no pending preset: clears the prefix and stores no binding', async () => {
            const { controller, state } = startNewChat(null);
            state.promptPrefix = 'stale';
            await controller.handleChatChange();
            expect(state.promptPrefix).toBe('');
            expect((await h.readStored()).map).not.toHaveProperty(UUID_A);
        });

        it('navigating from one existing chat to another never auto-binds the pending preset', async () => {
            // Reachable when a second navigation lands while the first uuid's handling is still awaiting storage: the wait flag is still set but the page already had a uuid.
            const { controller, state } = makeController();
            Object.assign(state, { currentChatUuid: UUID_A, awaitingNewChatUuid: true, pendingPresetId: 'p1', promptPrefix: 'stale' });
            setPathname(chatPath(UUID_B));
            await controller.handleChatChange();
            expect(state.promptPrefix).toBe('');
            expect((await h.readStored()).map).not.toHaveProperty(UUID_B);
        });
    });

    describe('handleChatChange: existing chat', () => {
        it('the overlay shows the chat\'s bound preset after navigation', async () => {
            await h.seedChatMap([{ [UUID_B]: 'p2' }]);
            const { controller, state, overlay } = makeController();
            setPathname(chatPath(UUID_B));
            await controller.handleChatChange();
            expect(state.promptPrefix).toBe('Second preset.');
            expect(overlay.activeId).toBe('p2');
        });

        it('a repeated call for the chat already shown changes nothing', async () => {
            await h.seedChatMap([{ [UUID_B]: 'p2' }]);
            const { controller, state } = makeController();
            setPathname(chatPath(UUID_B));
            await controller.handleChatChange();
            expect(state.promptPrefix).toBe('Second preset.');
            await h.seedChatMap([{}]);
            await controller.handleChatChange();
            expect(state.promptPrefix, 'same uuid must not re-resolve the binding').toBe('Second preset.');
            expect(state.chatPresetMap).toEqual({ [UUID_B]: 'p2' });
        });
    });

    describe('setupNavigationDetection', () => {
        it('popstate to another path processes the chat change while the extension context is valid', async () => {
            await h.seedChatMap([{ [UUID_A]: 'p1' }]);
            const { controller, state, overlay } = makeController();
            controller.setupNavigationDetection();
            setPathname(chatPath(UUID_A));
            window.dispatchEvent(new PopStateEvent('popstate'));
            await vi.waitFor(() => expect(overlay.activeId).toBe('p1'));
            expect(state.currentChatUuid).toBe(UUID_A);
            expect(state.promptPrefix).toBe('First preset.');
        });

        it('popstate is ignored once the extension context is invalidated', async () => {
            const { controller, state, overlay } = makeController({ isContextValid: () => false });
            controller.setupNavigationDetection();
            setPathname(chatPath(UUID_A));
            window.dispatchEvent(new PopStateEvent('popstate'));
            await new Promise(r => setTimeout(r, 50));
            expect(state.currentChatUuid).toBeNull();
            expect(overlay.activeId).toBeNull();
        });

        it('a failed chat change is logged with the [DSS] chat-binding prefix instead of escaping', async () => {
            const failure = new Error('overlay unavailable');
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const { controller } = makeController({ getPresetOverlay: () => { throw failure; } });
            setPathname(chatPath(UUID_A));
            const checkForNavigation = controller.setupNavigationDetection();
            setPathname(NEW_CHAT_PATH);
            checkForNavigation();
            await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith('[DSS] chat-binding handleChatChange 失敗:', failure));
        });
    });
});
