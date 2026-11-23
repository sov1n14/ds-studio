/**
 * Scenario (content-script wiring): which group the preset overlay shows while the chat DeepSeek created from a new-chat send is still waiting for its auto-bind, and after that bind flow ends.
 *
 * Requirements: docs/FEATURES.md "Conversation-Bound Prompt Groups" (a chat with a uuid shows the group it is bound to, and the group selected when the first message of a new chat is sent binds the created chat) and the v4.39.27 fix recorded in testing-pitfalls "Transient UI State" (a chat awaiting its bind resolves like the new-chat page, pending pick then pinned group, until the bind flow ends). Derived rules: (1) only the created chat that is awaiting its auto-bind and has no binding resolves like the new-chat page; any other chat shows its own binding, or the blank option when it has none, even while that auto-bind is in flight; (2) a chat that has a binding shows its bound group, even while its own auto-bind is still in flight; (3) once the bind flow ends, the created chat resolves from its binding alone, so a created chat left unbound shows the blank option, not the pinned group.
 *
 * Harness: test/helpers/awaiting-bind-overlay-harness.js holds the timing control, read gate, sampling and trust-boundary doubles; this file assigns its isSampling, holdReadsOnPath and readHoldsLeft controls. The failure paths of the bind flow live in chat-binding-controller.blank-flash-mutant-killers.failed-bind-flow.spec.js.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import {
    A, B, G, BLANK, CASE_OPTIONS, CREATED, NEW_CHAT, OTHER, appendHeader, binds, chatPath, clickOption, cs, describeSamples, heldBinds, heldReads, label, loadContentScript,
    otherTabPicks, preset, pressEnter, releaseHeldBind, releaseHeldReads, samples, seed, sendFirstMessageWithHeldBind, settleUntilQuiet, setUpCase, shownValue, storageReads, storedMap, takeSample, tearDownCase, waitForHeldRead,
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

    // Rule (1): the awaiting state belongs to the created chat only. Another chat opened while that bind is in flight shows its own binding, never the group picked for the created chat.
    it.each([
        { name: 'an unbound chat shows the blank option', map: {}, expected: BLANK },
        { name: 'a chat bound to B shows B', map: { [OTHER]: B.id }, expected: B.id },
    ])('switching to another chat while the created chat still awaits its bind to G: $name at every step, never G', async ({ map, expected }) => {
        await seed({ map, settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        const { overlay, createdFlow } = await sendFirstMessageWithHeldBind(G);
        expect(shownValue(overlay), 'precondition: the created chat shows the picked G while its bind is held').toBe(G.id);

        isSampling = true;
        setPathname(chatPath(OTHER));
        const otherFlow = cs.handleChatChange();
        takeSample('after-switch');
        await otherTabPicks(A.id);
        await settleUntilQuiet();
        expect(heldBinds.length, 'precondition: the BIND of the created chat is still held after the switch and the write from the other tab').toBe(1);
        releaseHeldBind();
        await Promise.all([createdFlow, otherFlow]);
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(samples.length, 'precondition: the screen was sampled after the switch').toBeGreaterThan(2);
        expect(samples.every((s) => s.path === chatPath(OTHER)), 'precondition: every sample was taken on the other chat').toBe(true);
        expect(samples.filter((s) => s.shown !== expected), `the other chat must show ${label(expected)} from the switch until it settles, never the G picked for the created chat; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(binds(), 'the created chat is still bound to G through the SW writer').toEqual([{ uuid: CREATED, presetId: G.id }]);
        expect(storedMap[OTHER], 'the other chat keeps its stored binding').toBe(map[OTHER]);
    });

    // Rule (2): a binding wins over the awaiting state. The user re-picks B on the created chat while its auto-bind to G is held; from the pick on, the overlay shows B.
    it('re-picking B on the created chat while its auto-bind to G is in flight: the overlay shows B at every step and the stored binding ends on B', async () => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        const { overlay, createdFlow } = await sendFirstMessageWithHeldBind(G);

        isSampling = true;
        clickOption(overlay, B.id);
        takeSample('after-pick');
        await settleUntilQuiet();
        expect(heldBinds.length, 'precondition: the auto-bind to G is still held after the re-pick').toBe(1);
        releaseHeldBind();
        await createdFlow;
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(samples.length, 'precondition: the screen was sampled after the re-pick').toBeGreaterThan(2);
        expect(samples.filter((s) => s.shown !== B.id), `the user bound the created chat to B by the later pick, so from that pick until it settles the overlay must show B; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(binds(), 'the SW writer committed the auto-bind to G, then the re-pick to B').toEqual([{ uuid: CREATED, presetId: G.id }, { uuid: CREATED, presetId: B.id }]);
        expect(storedMap[CREATED], 'the stored binding ends on the later pick B').toBe(B.id);
    });

    // Rule (3): after the bind flow ends, the created chat resolves from its binding alone. With a pinned group A and an explicit blank pick, nothing is bound, so the created chat shows the blank option, at once and on a later render.
    it('blank picked over a pinned group, then sent: once the bind flow ends the created chat shows the blank option, not the pinned group, and stays blank on a later render', async () => {
        await seed({ settings: { [StorageManager.KEYS.PINNED_PRESET_ID]: A.id, [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        expect(shownValue(overlay), 'precondition: the pinned group A is preselected on the new chat').toBe(A.id);
        clickOption(overlay, BLANK);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: the blank option is shown after the user picks it').toBe(BLANK);
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries no group prefix').not.toContain('PREFIX-');

        setPathname(chatPath(CREATED));
        await cs.handleChatChange();
        await settleUntilQuiet();
        expect(shownValue(overlay), 'the created chat has no binding, so once its bind flow ends it shows the blank option, not the pinned A').toBe(BLANK);

        await otherTabPicks(B.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'a later render of the unbound created chat still resolves from its absent binding: blank').toBe(BLANK);
        expect(binds(), 'nothing was bound: the user sent with the blank option').toEqual([]);
    });
    // 規則 (3)，X 的綁定流程停在 BIND 之前（docs/FEATURES.md「Conversation-Bound Prompt Groups」：新對話送出第一則訊息後，自動把當時選的群組綁到新對話；docs/architecture/content-navigation.md「Which Preset Id the Overlay Displays」）：建立的 X 停在 BIND 之前，綁 B 的 Y 的流程先跑完；使用者在 X 仍停住時回到 X，另一個分頁選 C，X 的流程才恢復。送出時選的是 G，所以 X 最後綁到 G、顯示 G；從回到 X 到穩定，浮動選單都不得顯示釘選的 A（顯示後又收回的值）。另一個分頁選 C 而非 B 或 G：Y 的流程把 B 存成全域 activePresetId，選 B 是同值寫入，Chrome 不發 onChanged，就不會在 X 的標記仍在時觸發重繪；選 G 則無法分辨最後的 G 來自 X 的綁定還是另一個分頁的選擇。
    it('created chat X stalled before its BIND, chat Y bound to B settles first, the user returns to X while X is still stalled and another tab picks C, then X resumes: X never shows the pinned A and ends bound to the G picked at the send', async () => {
        const C = preset('preset-C', 'PREFIX-C');
        await seed({ presets: [A, B, G, C], map: { [OTHER]: B.id }, settings: { [StorageManager.KEYS.PINNED_PRESET_ID]: A.id, [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        expect(shownValue(overlay), 'precondition: the pinned group A is preselected on the new chat').toBe(A.id);
        clickOption(overlay, G.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: G is shown on the new chat before the send').toBe(G.id);
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries G').toContain(G.content);

        // 持住 X 綁定流程的設定讀取，讓 X 停在 BIND 之前。
        holdReadsOnPath = chatPath(CREATED);
        setPathname(chatPath(CREATED));
        const createdFlow = cs.handleChatChange();
        await waitForHeldRead();
        holdReadsOnPath = null;

        // X 停住時，Y 的綁定流程跑完。
        setPathname(chatPath(OTHER));
        await cs.handleChatChange();
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: chat Y shows its bound B while X is stalled').toBe(B.id);
        expect(binds(), 'precondition: X stalled before dispatching its BIND').toEqual([]);

        // X 仍停住時回到 X，另一個分頁選 C，再放行 X 被持住的讀取。
        isSampling = true;
        setPathname(chatPath(CREATED));
        const backFlow = cs.handleChatChange();
        takeSample('after-back');
        await otherTabPicks(C.id);
        await settleUntilQuiet();
        expect(heldReads.length, 'precondition: X\'s settings read is still held after the return and the pick from the other tab').toBeGreaterThan(0);
        releaseHeldReads();
        await Promise.all([createdFlow, backFlow]);
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(samples.length, 'precondition: the screen was sampled after returning to X').toBeGreaterThan(2);
        expect(samples.every((s) => s.path === chatPath(CREATED)), 'precondition: every sample was taken on X').toBe(true);
        expect.soft(samples.filter((s) => s.shown === A.id), `X is bound to the G picked at the send, so from the return until it settles the overlay must never show the pinned A; samples: ${describeSamples(samples)}`).toEqual([]);
        expect.soft(binds(), 'G was picked when the first message was sent, so the stalled bind flow of X must still bind X to G after Y settled first').toEqual([{ uuid: CREATED, presetId: G.id }]);
        expect.soft(samples[samples.length - 1].shown, `X is bound to G, so it ends on G; samples: ${describeSamples(samples)}`).toBe(G.id);
        expect.soft(await StorageManager.getChatPresetMap(), 'the stored chatPresetMap holds Y bound to B and X bound to G').toEqual({ [OTHER]: B.id, [CREATED]: G.id });
    });

    // Navigation render at the send (docs/architecture/content-navigation.md "Navigation Detection" step 2: when the page had no UUID and awaitingNewChatUuid is set, the navigation-time overlay update is skipped, so what the new chat displayed stays displayed). No group is picked and none is pinned on arrival, so the new chat shows the blank option. The user then pins A in the popup: the content script does not re-render the overlay for a pinnedPresetId change, so it stays blank. The user toggles the global prompt switch with no active group, which writes globalPromptEnabled; the content script re-reads its settings for that, without re-rendering the overlay, so its last-read settings now hold the pin while the overlay shows blank. The send carries no group and the created chat stays unbound, so from the send until it settles it must show the blank option; the pinned A would be a value shown and then taken back.
    it('nothing picked on the new chat, A pinned from the popup and the global prompt switch toggled, then sent: the created chat shows the blank option at every step from the send, never the pinned A', async () => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: '', [StorageManager.KEYS.PINNED_PRESET_ID]: '' } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        expect(shownValue(overlay), 'precondition: nothing picked or pinned, so the new chat shows the blank option').toBe(BLANK);

        // The popup pins A: stored '' becomes A, so onChanged fires.
        await StorageManager.savePinnedPresetId(A.id);
        await settleUntilQuiet();
        expect((await StorageManager.getSettings()).pinnedPresetId, 'precondition: A is stored as the pinned group').toBe(A.id);
        expect(shownValue(overlay), 'precondition: pinning on the open new chat leaves the overlay on the blank option').toBe(BLANK);

        // The popup toggles the global prompt switch with no active group: stored false becomes true, so onChanged fires and the content script re-reads its settings.
        const readsBeforeToggle = storageReads;
        await StorageManager.saveGlobalPromptEnabled(true);
        await settleUntilQuiet();
        expect(storageReads, 'precondition: the global prompt switch change made the content script read storage').toBeGreaterThan(readsBeforeToggle);
        expect(shownValue(overlay), 'precondition: the global prompt switch change leaves the overlay on the blank option').toBe(BLANK);

        isSampling = true;
        takeSample('before-send');
        const ta = pressEnter('first message');
        setPathname(chatPath(CREATED));
        const createdFlow = cs.handleChatChange();
        takeSample('after-send-navigation');
        await createdFlow;
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(ta.value, 'precondition: the first send carries no group prefix').not.toContain('PREFIX-');
        expect(binds(), 'precondition: nothing was bound, the user sent with no group').toEqual([]);
        expect(samples.length, 'precondition: the screen was sampled from the send until the created chat settled').toBeGreaterThan(3);
        expect(samples.filter((s) => s.shown !== BLANK), `the new chat showed the blank option at the send and the created chat stays unbound, so from the send until it settles the overlay must show the blank option, never the pinned A; samples: ${describeSamples(samples)}`).toEqual([]);
    });
});
