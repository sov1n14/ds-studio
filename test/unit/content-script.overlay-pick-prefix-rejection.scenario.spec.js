/**
 * Scenario: on a new conversation, a group selection recomputes the prompt prefix; when the settings read of that recompute rejects, the failure must be caught and logged like every other step of the same flow, not escape as an unhandled promise rejection. Two entry points select a group: a pick in the in-page overlay group dropdown, and the ACTIVE_PRESET_CHANGED message the popup sends to the content script.
 *
 * Requirement (user ruling): catch the error and log it to the console, the same as the other steps of the same flow. The sibling steps of the pick (saveActivePresetId, the global-prompt refresh) report a failure on the '[DSS]' console.error boundary (test/unit/preset-overlay.controller.persistence.spec.js R3; chrome-extension-coding-guidelines section 2 "Error reporting"); the sibling switch recompute of the ACTIVE_PRESET_CHANGED handler reports on the same boundary.
 *
 * Cross-module state under test: the overlay (content/preset-overlay.controller.js) or the message handler in content/content-script.js writes pendingPresetId into the shared binding state and asks the binding controller (content/chat-binding-controller.js) to recompute the prefix that content-script.js injects.
 *
 * Harness (real modules, mocked trust boundaries only): test/helpers/overlay-consistency-harness.js. The popup message enters through the real chrome.runtime.onMessage listener that content-script.js registers (the trust boundary), with the wire shape utils/tab-control.js broadcasts. StorageManager reads chrome.storage in callback form and resolves `{}` on any storage error, so no storage-boundary failure can make getSettings reject; this spec stubs StorageManager.getSettings directly, as test/unit/content-script.overlay-repick-global-flag.scenario.spec.js does, and rejects only the reads made by updatePromptPrefixFromBinding (selected by call stack) so the sibling steps succeed and every observed rejection or log line belongs to the prefix recompute.
 *
 * Setup: G is already the stored activePresetId and the fake runs with real-Chrome onChanged semantics (`isUnchangedWriteSilent`), so the same-value saveActivePresetId of the selection fires no DSS_SETTINGS_CHANGED broadcast and the selection itself is the only caller of the prefix recompute.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GLOBAL, preset, settle, shownValue, clickOption, storedActivePresetId, injected, navigateTo, setUpOverlayScenario, openChat, contentScript } from '../helpers/overlay-consistency-harness.js';

const NEW_CHAT = '/a/chat/s';
const G = preset('preset-G', 'Golf', 'PREFIX-G', true);

async function seedDeviceSettings() {
    const items = { globalPromptEnabled: false, globalDefaultPrompt: GLOBAL, isEnabled: true };
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    await settle();
}

/** Picks G once on a new chat (stores it as activePresetId), then opens another new chat that shows no group and injects no group content. */
async function storeGThenOpenNewChat() {
    await openChat(NEW_CHAT, [G], {});
    clickOption('preset-G');
    await settle();
    expect(await storedActivePresetId(), 'sanity: the first pick stores G as activePresetId').toBe('preset-G');

    await navigateTo(NEW_CHAT);
    expect(shownValue(), 'sanity: the next new chat shows no group').toBe('');
    expect(contentScript.state.pendingPresetId ?? null, 'sanity: the next new chat starts with no pending group').not.toBe('preset-G');
    expect(injected(), 'sanity: the next new chat injects no group content').not.toContain('PREFIX-G');
}

const pickGInOverlay = () => clickOption('preset-G');

/** The popup selects G: the message utils/tab-control.js broadcasts, delivered through the real chrome.runtime.onMessage listener of the content script. */
const popupSelectsG = () => {
    chrome.runtime.onMessage.callListeners({ action: 'ACTIVE_PRESET_CHANGED', presetId: 'preset-G', presetContent: 'PREFIX-G' }, {}, () => {});
};

describe('a rejected prefix recompute after a group selection on a new chat is caught and logged', () => {
    let tearDown;
    let unhandled;
    const onUnhandled = (reason, promise) => { unhandled.set(promise, reason); };
    const onHandledLate = (promise) => { unhandled.delete(promise); };
    const unhandledReasons = () => [...unhandled.values()];
    // Errors handed to the reads made by updatePromptPrefixFromBinding during the selection.
    let prefixReadErrors;

    /** Runs `select` while every settings read issued by updatePromptPrefixFromBinding rejects; all other reads go through. */
    async function selectWhilePrefixRecomputeRejects(select) {
        const readSettings = StorageManager.getSettings.bind(StorageManager);
        const getSettings = vi.spyOn(StorageManager, 'getSettings').mockImplementation((...args) => {
            if (!String(new Error().stack).includes('updatePromptPrefixFromBinding')) return readSettings(...args);
            const err = new Error(`prefix recompute read #${prefixReadErrors.length + 1} failed`);
            prefixReadErrors.push(err);
            return Promise.reject(err);
        });
        try {
            select();
            await settle();
        } finally {
            getSettings.mockRestore();
        }
        expect(prefixReadErrors.length, 'guard: the selection must recompute the prefix, so at least one prefix-recompute settings read must have rejected').toBeGreaterThan(0);
    }

    function expectNoUnhandledRejection() {
        expect(unhandledReasons().map((r) => String(r?.message ?? r)), 'the prefix recompute rejection must be caught inside the selection, as its sibling steps are').toEqual([]);
    }

    function clearConsoleErrorSpy() {
        expect(vi.isMockFunction(console.error), 'precondition: the harness spies console.error').toBe(true);
        console.error.mockClear();
    }

    function expectEveryPrefixErrorLogged() {
        const dssCalls = console.error.mock.calls.filter((args) => String(args[0]).includes('[DSS]'));
        const isLogged = (err) => dssCalls.some((args) => args.some((a) => a === err || (typeof a === 'string' && a.includes(err.message))));
        expect(prefixReadErrors.filter((err) => !isLogged(err)).map((err) => err.message), 'every rejected prefix recompute must be reported through console.error with the [DSS] prefix and the error').toEqual([]);
    }

    beforeEach(async () => {
        tearDown = await setUpOverlayScenario({ isUnchangedWriteSilent: true });
        unhandled = new Map();
        prefixReadErrors = [];
        process.on('unhandledRejection', onUnhandled);
        process.on('rejectionHandled', onHandledLate);
        await seedDeviceSettings();
        await storeGThenOpenNewChat();
    });
    afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
        process.off('rejectionHandled', onHandledLate);
        tearDown();
    });

    describe('overlay pick', () => {
        it('(1) the rejected recompute does not escape the pick as an unhandled rejection', async () => {
            await selectWhilePrefixRecomputeRejects(pickGInOverlay);

            expectNoUnhandledRejection();
        });

        it('(2) the rejected recompute is logged on the [DSS] console.error boundary with its error', async () => {
            clearConsoleErrorSpy();

            await selectWhilePrefixRecomputeRejects(pickGInOverlay);

            expectEveryPrefixErrorLogged();
        });

        it('(3) the pending group is still set, so a later successful recompute injects G', async () => {
            await selectWhilePrefixRecomputeRejects(pickGInOverlay);

            expect(contentScript.state.pendingPresetId, 'the pick sets the pending group even though the recompute failed').toBe('preset-G');
            expect(shownValue(), 'the overlay shows G').toBe('preset-G');

            await contentScript.updatePromptPrefixFromBinding();
            expect(injected(), 'a later successful recompute uses the pending group: the send carries the content of G').toContain('PREFIX-G');
        });
    });

    describe('popup ACTIVE_PRESET_CHANGED message', () => {
        it('(4) the rejected recompute does not escape the message handler as an unhandled rejection', async () => {
            await selectWhilePrefixRecomputeRejects(popupSelectsG);

            expectNoUnhandledRejection();
        });

        it('(5) the rejected recompute is logged on the [DSS] console.error boundary with its error', async () => {
            clearConsoleErrorSpy();

            await selectWhilePrefixRecomputeRejects(popupSelectsG);

            expectEveryPrefixErrorLogged();
        });
    });
});
