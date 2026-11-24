/**
 * Scenario (content-script wiring): which group the preset overlay shows on a created chat after a bind flow fails at its chat-map write: the auto-bind of the created chat itself (F1), or the flow of another chat while the created chat still awaits its auto-bind (F2).
 *
 * Requirements: docs/architecture/content-navigation.md "Which Preset Id the Overlay Displays" and the derived rules in the header of chat-binding-controller.blank-flash-mutant-killers.awaiting-bind.spec.js; each case below names the paragraph it covers.
 *
 * Harness: test/helpers/awaiting-bind-overlay-harness.js holds the failure injection, read gate, sampling and trust-boundary doubles; this file assigns its isSampling, holdReadsOnPath and readHoldsLeft controls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import {
    A, G, BLANK, CASE_OPTIONS, CREATED, FAILURE_MODES, NEW_CHAT, OTHER, appendHeader, binds, chatPath, clickOption, cs, describeSamples, failedOps, failureOf, heldReads, loadContentScript,
    opsToFail, otherTabPicks, pressEnter, releaseHeldReads, samples, seed, settleUntilQuiet, setUpCase, shownValue, storedMap, takeSample, tearDownCase, wait, waitForHeldRead,
} from '../helpers/awaiting-bind-overlay-harness.js';

let isSampling;
let holdReadsOnPath;
// How many more settings reads the gate holds; Infinity holds every one.
let readHoldsLeft;
const testControls = { read: () => ({ isSampling, holdReadsOnPath, readHoldsLeft }), takeReadHold: () => { readHoldsLeft -= 1; } };

describe('the preset overlay while a created chat awaits its auto-bind, and after the bind flow ends', CASE_OPTIONS, () => {
    beforeEach(() => {
        isSampling = false;
        holdReadsOnPath = null;
        readHoldsLeft = Infinity;
        setUpCase(testControls);
    });

    afterEach(async () => {
        isSampling = false;
        holdReadsOnPath = null;
        await tearDownCase();
    });

    // F1, the own flow fails (docs/architecture/content-navigation.md "Which Preset Id the Overlay Displays": the controller clears the awaiting marker also when the bind flow fails, and from then on the chat resolves from chatPresetMap alone). The auto-bind write of X to G fails before the flow clears the pending pick, so X stays unbound; a later render of X must resolve from its absent binding (blank), not like the new-chat page (the pending G).
    it.each(FAILURE_MODES)('created chat X whose own auto-bind write to G fails ($name): a later render of X resolves from chatPresetMap and shows the blank option, not the pending G', async ({ mode }) => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, G.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: G is shown on the new chat before the send').toBe(G.id);
        expect((await StorageManager.getSettings()).activePresetId, 'precondition: the pick stored G as activePresetId, so the later write of A differs and fires onChanged').toBe(G.id);
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries G').toContain(G.content);

        opsToFail.push({ type: DSS_CHAT_MAP_MSG.BIND, mode });
        setPathname(chatPath(CREATED));
        const flowError = await failureOf(cs.handleChatChange());
        expect(flowError, 'precondition: the bind flow of X failed').toBeInstanceOf(Error);
        expect(failedOps.map(({ type, uuid, presetId }) => ({ type, uuid, presetId })), 'precondition: the failed write is the auto-bind of X to G').toEqual([{ type: DSS_CHAT_MAP_MSG.BIND, uuid: CREATED, presetId: G.id }]);
        await settleUntilQuiet();

        isSampling = true;
        await otherTabPicks(A.id);
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(samples.length, 'precondition: the write from the other tab triggered storage reads on X').toBeGreaterThan(1);
        expect(samples.every((s) => s.path === chatPath(CREATED)), 'precondition: every sample was taken on X').toBe(true);
        expect(shownValue(overlay), `the bind flow of X failed and X has no binding, so a later render resolves X from chatPresetMap and shows the blank option, not the pending G; samples: ${describeSamples(samples)}`).toBe(BLANK);
        expect(binds(), 'nothing was committed: the auto-bind write failed').toEqual([]);
        expect(await StorageManager.getChatPresetMap(), 'the stored chatPresetMap holds no binding for X').toEqual({});
    });

    // F2, another chat's flow fails (same docs paragraph: the controller clears the marker when the bind flow of the marked chat ends, not when another chat's flow fails; that failure leaves the pending pick uncleared and the auto-bind of the marked chat can still complete, so the marker stays). X stalls before its BIND; Y, bound to a deleted group, fails to clear that binding; the user returns to X, whose later flow stalls too, and another tab triggers a settings render of X. X still awaits its auto-bind to the pending G and resolves like the new-chat page, pending pick first, so from the return on, the navigation render included, X shows G; the auto-bind of X then completes, so X settles bound to G.
    it.each(FAILURE_MODES)('created chat X stalled before its auto-bind to G while the flow of chat Y fails ($name): back on X, from the return until X settles bound to G, X shows G at every step, never blank', async ({ mode }) => {
        await seed({ map: { [OTHER]: 'preset-deleted' }, settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, G.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: G is shown on the new chat before the send').toBe(G.id);
        expect((await StorageManager.getSettings()).activePresetId, 'precondition: the pick stored G as activePresetId, so the later write of A differs and fires onChanged').toBe(G.id);
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries G').toContain(G.content);

        // Hold the first two settings reads on X: the one of the bind flow of X (it stalls before its BIND) and the one of the later flow of X; a render read after them passes.
        holdReadsOnPath = chatPath(CREATED);
        readHoldsLeft = 2;
        setPathname(chatPath(CREATED));
        const createdFlow = cs.handleChatChange();
        await waitForHeldRead();

        // Y is bound to a deleted group, so its flow dispatches an UNBIND, which fails.
        opsToFail.push({ type: DSS_CHAT_MAP_MSG.UNBIND, mode });
        setPathname(chatPath(OTHER));
        const otherError = await failureOf(cs.handleChatChange());
        expect(otherError, 'precondition: the bind flow of Y failed').toBeInstanceOf(Error);
        expect(failedOps.map(({ type, uuid }) => ({ type, uuid })), 'precondition: the failed write is the UNBIND of Y').toEqual([{ type: DSS_CHAT_MAP_MSG.UNBIND, uuid: OTHER }]);
        await settleUntilQuiet();
        expect(heldReads.length, 'precondition: only the bind flow of X is held after Y fails').toBe(1);
        expect(binds(), 'precondition: X stalled before dispatching its BIND').toEqual([]);

        isSampling = true;
        setPathname(chatPath(CREATED));
        const backFlow = cs.handleChatChange();
        takeSample('after-back');
        for (let i = 0; i < 3000 && heldReads.length < 2; i++) await wait(1);
        expect(heldReads.length, 'precondition: the later flow of X is held too').toBe(2);
        await otherTabPicks(A.id);
        await settleUntilQuiet();
        takeSample('before-release');
        expect(heldReads.length, 'precondition: both flows of X are still held after the settings render').toBe(2);

        // Release the bind flow of X first, so its auto-bind to G lands, then the later flow of X.
        heldReads.shift()();
        for (let i = 0; i < 3000 && binds().length === 0; i++) await wait(1);
        releaseHeldReads();
        await Promise.all([failureOf(createdFlow), failureOf(backFlow)]);
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(binds(), 'precondition: the auto-bind of X to G completed after Y failed').toEqual([{ uuid: CREATED, presetId: G.id }]);
        expect(samples.every((s) => s.path === chatPath(CREATED)), 'precondition: every sample was taken on X').toBe(true);
        expect(samples[0].at, 'precondition: the first sample is the navigation render right after the return to X').toBe('after-back');
        expect(samples.length, 'precondition: the screen was sampled after returning to X').toBeGreaterThan(2);
        expect(samples.filter((s) => s.shown !== G.id), `the failed flow of Y did not clear the pending G and X still awaits its auto-bind to it, so X resolves like the new-chat page and must show G at every step from the return until it settles bound to G; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(shownValue(overlay), 'X settles bound to G').toBe(G.id);
        expect(storedMap[CREATED], 'the stored binding of X is G').toBe(G.id);
    });
});
