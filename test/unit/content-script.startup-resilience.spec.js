/**
 * content/content-script.js startup must survive a failing initial chat-binding step.
 *
 * Requirement (from the directive, not from the implementation): on first load, when the initial chat-change handling rejects (here: the page opens on a chat bound to a preset that no longer exists, so the stale-binding unbind is dispatched to the service worker, which is unreachable), the failure is logged on the '[DSS]' console.error boundary and startup continues. In particular SPA navigation detection is still wired: a later navigation to another chat is detected and that chat's binding is applied.
 *
 * Boundaries doubled: chrome.storage (setup in-memory mock, seeded with the durable chat-map layout) and chrome.runtime.sendMessage, which rejects every chat-map dispatch with the real "Receiving end does not exist." error. content-script.js and everything it wires are the real modules, loaded fresh so its load-time initSettings() runs under these conditions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import { writeChatMapLayout, NO_RECEIVER } from '../helpers/chat-map-writer-harness.js';

const STALE_UUID = '99999999-9999-9999-9999-999999999999';
const FRESH_UUID = '12121212-3434-5656-7878-909090909090';
const LIVE = { id: 'p-live', name: 'Live', content: 'Live preset content.', createdAt: 1000, updatedAt: 1000 };

const chatMapTypes = () => new Set(Object.values(globalThis.DSS_CHAT_MAP_MSG));
const chatMapCalls = () => chrome.runtime.sendMessage.mock.calls.filter(([msg]) => chatMapTypes().has(msg?.type));

async function waitUntil(predicate, label, ms = 3000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
}

async function seedStorage() {
    const presetItems = { dsPresetIndex: [LIVE.id], [`dsPreset_${LIVE.id}`]: LIVE };
    await chrome.storage.local.set(presetItems);
    await chrome.storage.sync.set(presetItems);
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [
        { [STALE_UUID]: 'p-deleted', [FRESH_UUID]: LIVE.id },
    ]);
}

describe('content-script startup when the initial chat-binding step fails', () => {
    let errorSpy;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // SW unreachable for chat-map dispatches only; every other message keeps the setup default.
        chrome.runtime.sendMessage.mockImplementation((msg) => (
            chatMapTypes().has(msg?.type) ? Promise.reject(new Error(NO_RECEIVER)) : undefined
        ));
    });

    afterEach(() => {
        chrome.runtime.sendMessage.mockReset();
        vi.restoreAllMocks();
        setPathname('/');
    });

    it('still detects a later SPA navigation and applies the new chat\'s binding', async () => {
        vi.resetModules();
        await import('../../utils/storage-manager.js');
        await seedStorage();
        setPathname(`/a/chat/s/${STALE_UUID}`);
        const contentScript = (await import('../../content/content-script.js')).default;

        // Guard against a vacuous pass: the initial step must really have attempted (and failed) the stale unbind.
        const isUnbindAttempted = await waitUntil(() => chatMapCalls().some(([msg]) => msg.type === DSS_CHAT_MAP_MSG.UNBIND), 'initial unbind');
        expect(isUnbindAttempted, 'precondition: the initial chat-change step must dispatch the stale-binding unbind').toBe(true);
        await waitUntil(() => chatMapCalls().length >= 2, 'no-receiver retry');
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(contentScript.state.currentChatUuid, 'precondition: the initial step ran for the stale chat').toBe(STALE_UUID);

        window.history.pushState({}, '', `/a/chat/s/${FRESH_UUID}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
        document.body.appendChild(document.createElement('div'));

        const isNavigationHandled = await waitUntil(() => contentScript.state.currentChatUuid === FRESH_UUID, 'navigation', 1500);
        expect(isNavigationHandled, 'navigation after a failed initial chat-binding step must still be detected').toBe(true);
        await waitUntil(() => contentScript.state.promptPrefix === LIVE.content, 'binding applied', 1500);
        expect(contentScript.state.promptPrefix, 'the new chat\'s bound preset must be applied').toBe(LIVE.content);

        const dssErrors = errorSpy.mock.calls.filter((args) => String(args[0]).includes('[DSS]'));
        expect(dssErrors.length, 'the initial chat-binding failure must be logged on the [DSS] console.error boundary').toBeGreaterThan(0);
    });
});
