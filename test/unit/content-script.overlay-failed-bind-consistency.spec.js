/**
 * Scenario: a failed chat-map write from the in-page overlay must leave "what the overlay displays" and "what will be injected" in agreement.
 *
 * Product invariant: for any chat, the preset the overlay shows as selected is the preset whose settings shape the injected prefix -- its own content AND its per-preset globalPromptEnabled flag, which decides whether the global default prompt is part of the injection.
 *
 * Cross-module state under test: the overlay (content/preset-overlay.controller.js) writes the global activePresetId; the binding controller (content/chat-binding-controller.js) reads activePresetId back through a DSS_SETTINGS_CHANGED broadcast to decide isGlobalPromptEnabled, and reads chatPresetMap to decide the own-content prefix.
 *
 * Harness (real modules, mocked trust boundaries only): test/helpers/overlay-consistency-harness.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GLOBAL, preset, settle, transports, FAILURE_MODES, storedMap, shownLabel, shownValue, clickOption, storedActivePresetId, injected, navigateTo, unrelatedPresetEditArrives, setUpOverlayScenario, openChat } from '../helpers/overlay-consistency-harness.js';

const CHAT_X = '11111111-1111-1111-1111-111111111111';
const CHAT_Y = '22222222-2222-2222-2222-222222222222';

describe('overlay selection vs injected prefix after a chat-map write from the overlay', () => {
    let tearDown;
    beforeEach(async () => { tearDown = await setUpOverlayScenario(); });
    afterEach(() => tearDown());

    /** Chat X is bound to A and currently open; the overlay shows A and A drives the injection. */
    const openChatXBoundTo = (presets, boundId) => openChat(`/a/chat/s/${CHAT_X}`, presets, { [CHAT_X]: boundId });

    // A includes the global default prompt, B excludes it: display and injection disagree observably if B's flag leaks.
    const A = preset('preset-A', 'Alpha', 'PREFIX-A', true);
    const B = preset('preset-B', 'Bravo', 'PREFIX-B', false);
    const C = preset('preset-C', 'Charlie', 'PREFIX-C', true);

    async function expectChatXShowsAndInjectsA() {
        expect(shownLabel(), 'sanity: chat X opens showing its bound preset').toBe('Alpha');
        expect(injected(), 'sanity: chat X injects A with the global prompt').toContain(GLOBAL);
        expect(await storedActivePresetId(), 'sanity: opening chat X records A as the active preset').toBe('preset-A');
    }

    it.each(FAILURE_MODES)('rejected bind on a bound chat (%s): overlay shows A and the injection is exactly A\'s', async (mode) => {
        await openChatXBoundTo([A, B, C], 'preset-A');
        await expectChatXShowsAndInjectsA();

        chrome.runtime.sendMessage = vi.fn(transports[mode]);
        clickOption('preset-B');
        await settle();

        expect(chrome.runtime.sendMessage, 'guard: the bind must actually have been dispatched').toHaveBeenCalled();
        expect(storedMap()[CHAT_X], 'the failed bind left the stored binding on A').toBe('preset-A');
        expect.soft(shownLabel(), 'overlay label must roll back to A').toBe('Alpha');
        expect.soft(shownValue(), 'aria-selected must roll back to A').toBe('preset-A');
        const text = injected();
        expect.soft(text, 'own-content prefix must be A\'s').toContain('PREFIX-A');
        expect.soft(text, 'B\'s content must not be injected').not.toContain('PREFIX-B');
        expect.soft(text, 'overlay shows A (globalPromptEnabled: true), so the global default prompt must be injected; B\'s flag must not apply').toContain(GLOBAL);
        expect.soft(await storedActivePresetId(), 'activePresetId feeds isGlobalPromptEnabled; the failed choice B must not stay persisted').toBe('preset-A');
    });

    it('rejected bind, then navigating to an unbound chat: overlay and injection agree and neither reflects B', async () => {
        await openChatXBoundTo([A, B, C], 'preset-A');
        await expectChatXShowsAndInjectsA();

        chrome.runtime.sendMessage = vi.fn(transports['rejection (SW unreachable)']);
        clickOption('preset-B');
        await settle();
        chrome.runtime.sendMessage = vi.fn(transports.success);

        await navigateTo(`/a/chat/s/${CHAT_Y}`);
        await unrelatedPresetEditArrives(C);

        expect.soft(shownValue(), 'unbound chat Y shows no preset').toBe('');
        const text = injected();
        expect.soft(text, 'no preset content is injected in an unbound chat').not.toMatch(/PREFIX-[ABC]/);
        expect.soft(text, 'no preset shown -> legacy flag (true) decides; B\'s false flag must not strip the global prompt').toContain(GLOBAL);
        expect.soft(await storedActivePresetId(), 'the failed choice B must not be the persisted activePresetId').not.toBe('preset-B');
    });

    it('rejected bind, then opening a new chat: overlay and injection agree and neither reflects B', async () => {
        await openChatXBoundTo([A, B, C], 'preset-A');
        await expectChatXShowsAndInjectsA();

        chrome.runtime.sendMessage = vi.fn(transports['rejection (SW unreachable)']);
        clickOption('preset-B');
        await settle();
        chrome.runtime.sendMessage = vi.fn(transports.success);

        await navigateTo('/a/chat/s');
        await unrelatedPresetEditArrives(C);

        expect.soft(shownValue(), 'new chat without a pinned preset shows no preset').toBe('');
        const text = injected();
        expect.soft(text, 'no preset content is injected').not.toMatch(/PREFIX-[ABC]/);
        expect.soft(text, 'no preset shown -> legacy flag (true) decides; B\'s false flag must not strip the global prompt').toContain(GLOBAL);
        expect.soft(await storedActivePresetId(), 'the failed choice B must not be the persisted activePresetId').not.toBe('preset-B');
    });

    it.each(FAILURE_MODES)('rejected unbind on a bound chat (%s): overlay shows A and the injection is exactly A\'s', async (mode) => {
        // A excludes the global prompt; "no preset" falls back to the legacy flag (default true), so a leaked '' is observable.
        const aOff = preset('preset-A', 'Alpha', 'PREFIX-A', false);
        await openChatXBoundTo([aOff, B], 'preset-A');
        expect(shownLabel(), 'sanity: chat X opens showing its bound preset').toBe('Alpha');
        expect(injected(), 'sanity: A excludes the global prompt').not.toContain(GLOBAL);

        chrome.runtime.sendMessage = vi.fn(transports[mode]);
        clickOption('');
        await settle();

        expect(chrome.runtime.sendMessage, 'guard: the unbind must actually have been dispatched').toHaveBeenCalled();
        expect(storedMap()[CHAT_X], 'the failed unbind left the stored binding on A').toBe('preset-A');
        expect.soft(shownLabel(), 'overlay label must roll back to A').toBe('Alpha');
        expect.soft(shownValue(), 'aria-selected must roll back to A').toBe('preset-A');
        const text = injected();
        expect.soft(text, 'own-content prefix must be A\'s').toContain('PREFIX-A');
        expect.soft(text, 'overlay shows A (globalPromptEnabled: false), so the global default prompt must NOT be injected; the "none" fallback must not apply').not.toContain(GLOBAL);
        expect.soft(await storedActivePresetId(), 'the failed "none" choice must not stay persisted as activePresetId').toBe('preset-A');
    });

    it('control: a successful bind keeps B displayed, injected, and persisted', async () => {
        await openChatXBoundTo([A, B, C], 'preset-A');
        await expectChatXShowsAndInjectsA();

        chrome.runtime.sendMessage = vi.fn(transports.success);
        clickOption('preset-B');
        await settle();

        expect(storedMap()[CHAT_X]).toBe('preset-B');
        expect(shownLabel()).toBe('Bravo');
        expect(shownValue()).toBe('preset-B');
        const text = injected();
        expect(text).toContain('PREFIX-B');
        expect(text).not.toContain('PREFIX-A');
        expect(text, 'B has globalPromptEnabled: false').not.toContain(GLOBAL);
        expect(await storedActivePresetId()).toBe('preset-B');
    });
});
