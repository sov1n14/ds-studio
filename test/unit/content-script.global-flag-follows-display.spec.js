/**
 * Scenario: with every chat-map write succeeding, the global-default-prompt inclusion follows the preset the overlay DISPLAYS for the current chat, after SPA navigation and a later unrelated settings broadcast.
 *
 * Product invariant: the display must match the result that will be injected. The displayed preset (chat map -> pending -> pinned) decides both the own-content prefix and, through its globalPromptEnabled flag, whether the global default prompt is injected; with no preset displayed the legacy device flag (globalPromptEnabled key) decides.
 *
 * Cross-module state under test: navigation (content/chat-binding-controller.js handleChatChange) decides what the overlay shows; a DSS_SETTINGS_CHANGED broadcast (content/content-script.js applySettingsChanged) re-resolves isGlobalPromptEnabled.
 *
 * Harness (real modules, mocked trust boundaries only): test/helpers/overlay-consistency-harness.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GLOBAL, preset, transports, shownLabel, shownValue, injected, navigateTo, unrelatedPresetEditArrives, setUpOverlayScenario, openChat } from '../helpers/overlay-consistency-harness.js';

const CHAT_X = '11111111-1111-1111-1111-111111111111';
const CHAT_Y = '22222222-2222-2222-2222-222222222222';
const CHAT_Z = '33333333-3333-3333-3333-333333333333';

// B excludes the global prompt; C and P include it; D is the unrelated preset whose edit triggers the broadcast (flag false so "last edited preset decides" is also caught).
const B = preset('preset-B', 'Bravo', 'PREFIX-B', false);
const C = preset('preset-C', 'Charlie', 'PREFIX-C', true);
const P = preset('preset-P', 'Pinned', 'PREFIX-P', true);
const D = preset('preset-D', 'Delta', 'PREFIX-D', false);
const ALL = [B, C, P, D];

async function setLegacyFlag(value) {
    await chrome.storage.local.set({ globalPromptEnabled: value });
    await chrome.storage.sync.set({ globalPromptEnabled: value });
}

describe('global default prompt follows the displayed preset after navigation (no write failures)', () => {
    let tearDown;
    beforeEach(async () => {
        tearDown = await setUpOverlayScenario();
        chrome.runtime.sendMessage = vi.fn(transports.success);
    });
    afterEach(() => tearDown());

    /** Open chat X bound to B: the overlay shows B and B's false flag strips the global prompt. */
    async function openChatXBoundToB(extraMap = {}) {
        await openChat(`/a/chat/s/${CHAT_X}`, ALL, { [CHAT_X]: 'preset-B', ...extraMap });
        expect(shownValue(), 'sanity: chat X shows its bound preset B').toBe('preset-B');
        const text = injected();
        expect(text, 'sanity: chat X injects B\'s content').toContain('PREFIX-B');
        expect(text, 'sanity: B (globalPromptEnabled: false) excludes the global prompt').not.toContain(GLOBAL);
    }

    it('bound chat X (B) -> unbound chat Y, then an unrelated preset edit: shows none and injects the global prompt (legacy flag true)', async () => {
        await setLegacyFlag(true);
        await openChatXBoundToB();

        await navigateTo(`/a/chat/s/${CHAT_Y}`);
        await unrelatedPresetEditArrives(D);

        expect(shownValue(), 'unbound chat Y displays no preset').toBe('');
        const text = injected();
        expect(text, 'no preset content is injected in an unbound chat').not.toMatch(/PREFIX-[BCPD]/);
        expect(text, 'overlay shows none -> legacy flag (true) decides; the previous chat\'s B (false) must not strip the global prompt').toContain(GLOBAL);
    });

    it('bound chat X (B) -> new chat without a pinned preset, then an unrelated preset edit: shows none and injects the global prompt (legacy flag true)', async () => {
        await setLegacyFlag(true);
        await openChatXBoundToB();

        await navigateTo('/a/chat/s');
        await unrelatedPresetEditArrives(D);

        expect(shownValue(), 'new chat without a pinned preset displays no preset').toBe('');
        const text = injected();
        expect(text, 'no preset content is injected in a new unpinned chat').not.toMatch(/PREFIX-[BCPD]/);
        expect(text, 'overlay shows none -> legacy flag (true) decides; the previous chat\'s B (false) must not strip the global prompt').toContain(GLOBAL);
    });

    it('bound chat X (B) -> bound chat Z (C), then an unrelated preset edit: shows C and injects the global prompt (C\'s flag true)', async () => {
        await setLegacyFlag(false); // only C's own flag can yield "included"
        await openChatXBoundToB({ [CHAT_Z]: 'preset-C' });

        await navigateTo(`/a/chat/s/${CHAT_Z}`);
        await unrelatedPresetEditArrives(D);

        expect(shownLabel(), 'chat Z displays its bound preset C').toBe('Charlie');
        expect(shownValue()).toBe('preset-C');
        const text = injected();
        expect(text, 'C\'s content is injected').toContain('PREFIX-C');
        expect(text, 'overlay shows C (globalPromptEnabled: true) -> the global prompt must be injected; B\'s false flag must not apply').toContain(GLOBAL);
    });

    it('bound chat X (B) -> new chat with pinned preset P, then an unrelated preset edit: shows P and injects the global prompt (P\'s flag true)', async () => {
        await setLegacyFlag(false); // only P's own flag can yield "included"
        await StorageManager.savePinnedPresetId('preset-P');
        await openChatXBoundToB();

        await navigateTo('/a/chat/s');
        await unrelatedPresetEditArrives(D);

        expect(shownLabel(), 'new chat displays the pinned preset P').toBe('Pinned');
        expect(shownValue()).toBe('preset-P');
        const text = injected();
        expect(text, 'P\'s content is injected').toContain('PREFIX-P');
        expect(text, 'overlay shows P (globalPromptEnabled: true) -> the global prompt must be injected; B\'s false flag must not apply').toContain(GLOBAL);
    });
});
