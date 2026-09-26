/**
 * Scenario: a prefix recompute that started in the previous chat must not overwrite the prefix of the chat the user navigated to.
 *
 * Product invariant: once all pending work settles, the injected prefix is the content of the preset the overlay shows for the current chat (no preset shown -> no preset content injected).
 *
 * Cross-module state under test: content-script.js starts ChatBinding.updatePromptPrefixFromBinding() fire-and-forget (storage broadcast, ACTIVE_PRESET_CHANGED, the overlay's optimistic recompute); the binding controller's navigation handler writes the same state.promptPrefix for the new chat; the overlay displays the new chat's preset.
 *
 * Timing: the recompute is started in chat A and its settings read (one macrotask per chrome.storage read in the in-memory fake) is still in flight when the navigation begins in the same tick. Nothing is delayed or faked beyond the storage fake's natural async reads.
 *
 * Harness (real modules, mocked trust boundaries only): test/helpers/overlay-consistency-harness.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { contentScript, preset, settle, transports, shownLabel, shownValue, injected, navigateTo, setUpOverlayScenario, openChat } from '../helpers/overlay-consistency-harness.js';

const CHAT_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const CHAT_B = 'bbbbbbbb-2222-2222-2222-222222222222';
const CHAT_C = 'cccccccc-3333-3333-3333-333333333333';

const A = preset('preset-A', 'Alpha', 'PREFIX-A', true);
const B = preset('preset-B', 'Bravo', 'PREFIX-B', true);
const P = preset('preset-P', 'Pinned', 'PREFIX-P', true);

describe('navigation while a prefix recompute from the previous chat is in flight', () => {
    let tearDown;
    beforeEach(async () => {
        tearDown = await setUpOverlayScenario();
        chrome.runtime.sendMessage = vi.fn(transports.success);
    });
    afterEach(() => tearDown());

    async function openChatABoundToA(extraMap = {}) {
        await openChat(`/a/chat/s/${CHAT_A}`, [A, B, P], { [CHAT_A]: 'preset-A', ...extraMap });
        expect(shownValue(), 'sanity: chat A shows its bound preset').toBe('preset-A');
        expect(injected(), 'sanity: chat A injects A').toContain('PREFIX-A');
    }

    /** Starts the recompute in chat A (as content-script.js does: not awaited), then navigates in the same tick, before the recompute's settings read resolves. */
    async function navigateWhileRecomputeInFlight(path) {
        const stale = contentScript.updatePromptPrefixFromBinding();
        await navigateTo(path);
        await stale;
        await settle();
    }

    it('chat A (bound A) -> chat B (bound B): overlay shows B and B is injected, not A', async () => {
        await openChatABoundToA({ [CHAT_B]: 'preset-B' });

        await navigateWhileRecomputeInFlight(`/a/chat/s/${CHAT_B}`);

        expect(shownValue(), 'overlay shows chat B\'s bound preset').toBe('preset-B');
        expect(shownLabel()).toBe('Bravo');
        const text = injected();
        expect.soft(text, 'overlay shows B, so B\'s content must be injected').toContain('PREFIX-B');
        expect.soft(text, 'the stale recompute from chat A must not inject A\'s content in chat B').not.toContain('PREFIX-A');
    });

    it('chat A (bound A) -> unbound chat C: overlay shows no preset and nothing of A is injected', async () => {
        await openChatABoundToA();

        await navigateWhileRecomputeInFlight(`/a/chat/s/${CHAT_C}`);

        expect(shownValue(), 'unbound chat C shows no preset').toBe('');
        expect(injected(), 'overlay shows no preset, so no preset content may be injected').not.toMatch(/PREFIX-[ABP]/);
    });

    it('chat A (bound A) -> new-chat page with a pinned default P: overlay shows P and P is injected, not A', async () => {
        await StorageManager.savePinnedPresetId('preset-P');
        await openChatABoundToA();

        await navigateWhileRecomputeInFlight('/a/chat/s');

        expect(shownValue(), 'new-chat page preselects the pinned default').toBe('preset-P');
        const text = injected();
        expect.soft(text, 'overlay shows P, so P\'s content must be injected').toContain('PREFIX-P');
        expect.soft(text, 'the stale recompute from chat A must not inject A\'s content on the new-chat page').not.toContain('PREFIX-A');
    });

    it('chat A (bound A) -> new-chat page with nothing pinned: overlay shows no preset and nothing of A is injected', async () => {
        await openChatABoundToA();

        await navigateWhileRecomputeInFlight('/a/chat/s');

        expect(shownValue(), 'new-chat page without a pinned default shows no preset').toBe('');
        expect(injected(), 'overlay shows no preset, so no preset content may be injected').not.toMatch(/PREFIX-[ABP]/);
    });
});
