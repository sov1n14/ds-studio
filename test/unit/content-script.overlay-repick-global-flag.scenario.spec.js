/**
 * Scenario (I-07): on a new conversation, re-picking in the in-page overlay the prompt group that is already the stored activePresetId must still inject that group's global-prompt choice.
 *
 * Requirement (docs/FEATURES.md "Global Prompt"): each prompt group remembers its own global-prompt switch; "messages sent under A carry the global prompt" when A's switch is on, and only with the blank option or an unbound conversation does the device-level (legacy) switch decide.
 *
 * Cross-module state under test: the overlay (content/preset-overlay.controller.js) writes activePresetId and the prefix; the binding controller (content/chat-binding-controller.js) owns isGlobalPromptEnabled, which content-script.js reads when it injects.
 *
 * Why the in-memory fake hid the bug: real Chrome fires no chrome.storage.onChanged event for a write that changes nothing (verified in Chrome 156, local and sync), so re-saving the same activePresetId produces no DSS_SETTINGS_CHANGED broadcast. The harness option `isUnchangedWriteSilent` reproduces that; without it the fake reports every write as a change.
 *
 * Harness (real modules, mocked trust boundaries only): test/helpers/overlay-consistency-harness.js. The one exception is the getSettings-rejection case: StorageManager reads chrome.storage in callback form and resolves `{}` on any storage error, so no storage-boundary failure can make getSettings reject; that case stubs StorageManager.getSettings directly, as the I-07 dispatch requires.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GLOBAL, preset, settle, shownValue, clickOption, storedActivePresetId, injected, navigateTo, setUpOverlayScenario, openChat } from '../helpers/overlay-consistency-harness.js';
import { CONTEXT_INVALIDATED } from '../helpers/chat-map-writer-harness.js';

const NEW_CHAT = '/a/chat/s';
const QUOTA = 'QUOTA_BYTES_PER_ITEM quota exceeded';
// G switches the global prompt on; the device-level switch is off, so "no group" and "group G" differ observably in the injection.
const G = preset('preset-G', 'Golf', 'PREFIX-G', true);

/** Device-level switch off, a global prompt text and master switch on, in both areas as a synced profile holds them. */
async function seedDeviceSettings() {
    const items = { globalPromptEnabled: false, globalDefaultPrompt: GLOBAL, isEnabled: true };
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    await settle();
}

/** Opens a new chat, picks G once (a real change of activePresetId), then opens another new chat; G is now the stored activePresetId. */
async function storeGThenOpenNewChat() {
    await openChat(NEW_CHAT, [G], {});
    expect(shownValue(), 'sanity: a new chat without a pinned group shows no group').toBe('');
    expect(injected(), 'sanity: no group shown, the device-level switch (off) decides').not.toContain(GLOBAL);

    clickOption('preset-G');
    await settle();
    expect(injected(), 'sanity: the first pick of G injects its content').toContain('PREFIX-G');
    expect(injected(), 'sanity: the first pick of G (switch on) injects the global prompt').toContain(GLOBAL);
    expect(await storedActivePresetId(), 'sanity: the first pick stores G as activePresetId').toBe('preset-G');

    await navigateTo(NEW_CHAT);
    expect(shownValue(), 'sanity: the next new chat shows no group').toBe('');
    const text = injected();
    expect(text, 'sanity: the next new chat injects no group content').not.toContain('PREFIX-G');
    expect(text, 'sanity: the next new chat falls back to the device-level switch (off)').not.toContain(GLOBAL);
}

/** Replaces chrome.storage.{local,sync}.set for writes that carry activePresetId; every other write goes through. Returns the restore. */
function interceptActivePresetIdWrites(failure) {
    const areas = [chrome.storage.local, chrome.storage.sync];
    const originals = areas.map((area) => area.set);
    areas.forEach((area, i) => {
        area.set = (items, callback) => ('activePresetId' in items ? failure(callback) : originals[i].call(area, items, callback));
    });
    return () => areas.forEach((area) => { delete area.set; });
}

// How real chrome.storage.set reports each failure: the promise form rejects; the callback form exposes lastError only while its own callback runs.
const writeFailures = {
    'rejection (quota error)': (callback) => {
        if (!callback) return Promise.reject(new Error(QUOTA));
        setTimeout(() => {
            chrome.runtime.lastError = { message: QUOTA };
            try { callback(); } finally { delete chrome.runtime.lastError; }
        }, 0);
        return undefined;
    },
    'synchronous throw (context invalidated)': () => { throw new Error(CONTEXT_INVALIDATED); },
    'timeout (never settles)': (callback) => (callback ? undefined : new Promise(() => {})),
};

describe("I-07: re-picking the stored group on a new chat injects that group's global-prompt choice", () => {
    let tearDown;
    // Rejections still unhandled when checked; one handled a tick late fires rejectionHandled and leaves the list.
    let unhandled;
    const onUnhandled = (reason, promise) => { unhandled.set(promise, reason); };
    const onHandledLate = (promise) => { unhandled.delete(promise); };
    const unhandledReasons = () => [...unhandled.values()];

    beforeEach(async () => {
        tearDown = await setUpOverlayScenario({ isUnchangedWriteSilent: true });
        unhandled = new Map();
        process.on('unhandledRejection', onUnhandled);
        process.on('rejectionHandled', onHandledLate);
        await seedDeviceSettings();
    });
    afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
        process.off('rejectionHandled', onHandledLate);
        tearDown();
    });

    it("success: re-picking G sends G's content and the global prompt", async () => {
        await storeGThenOpenNewChat();

        clickOption('preset-G');
        await settle();

        expect(shownValue(), 'the overlay shows G').toBe('preset-G');
        const text = injected();
        expect(text, "the send carries G's content").toContain('PREFIX-G');
        expect(text, "G's switch is on, so the send carries the global prompt (docs/FEATURES.md: messages sent under A carry the global prompt)").toContain(GLOBAL);
    });

    it.each(Object.keys(writeFailures))("saveActivePresetId write fails (%s): the send still carries G's content and the global prompt", async (mode) => {
        await storeGThenOpenNewChat();

        const restore = interceptActivePresetIdWrites(writeFailures[mode]);
        try {
            clickOption('preset-G');
            await settle();
        } finally {
            restore();
        }

        expect.soft(unhandledReasons(), 'the failed write must not surface as an unhandled rejection').toEqual([]);
        expect(await storedActivePresetId(), 'guard: the failed write leaves G stored').toBe('preset-G');
        expect(shownValue(), 'the overlay shows G').toBe('preset-G');
        const text = injected();
        expect(text, "the send carries G's content").toContain('PREFIX-G');
        expect(text, "the overlay shows G and G is still stored, so G's switch (on) decides: the send carries the global prompt").toContain(GLOBAL);
    });

    it("getSettings rejects while the global-prompt flag refreshes: no unhandled rejection and the send still carries G's content", async () => {
        await storeGThenOpenNewChat();

        // The pick's own prefix recompute is its first settings read (pre-fix code makes exactly that one); every later read in the window belongs to the global-prompt refresh and rejects.
        const readSettings = StorageManager.getSettings.bind(StorageManager);
        let reads = 0;
        let rejectedReads = 0;
        const getSettings = vi.spyOn(StorageManager, 'getSettings').mockImplementation((...args) => {
            reads += 1;
            if (reads === 1) return readSettings(...args);
            rejectedReads += 1;
            return Promise.reject(new Error('settings read failed'));
        });
        try {
            clickOption('preset-G');
            await settle();
        } finally {
            getSettings.mockRestore();
        }

        expect.soft(unhandledReasons(), 'the failed settings read must not surface as an unhandled rejection').toEqual([]);
        expect.soft(shownValue(), 'the overlay shows G').toBe('preset-G');
        expect.soft(injected(), "the send carries G's content").toContain('PREFIX-G');
        expect(rejectedReads, 'guard: the re-pick must refresh the global-prompt flag, so at least one settings read after the prefix recompute must have rejected').toBeGreaterThan(0);
    });

    it('companion: re-picking the blank option on a new chat sends neither group content nor the global prompt', async () => {
        await openChat(NEW_CHAT, [G], {});
        clickOption('preset-G');
        await settle();
        clickOption('');
        await settle();
        expect(await storedActivePresetId(), 'sanity: the blank option is the stored activePresetId').toBe('');

        await navigateTo(NEW_CHAT);
        clickOption('');
        await settle();

        expect(shownValue(), 'the overlay shows no group').toBe('');
        const text = injected();
        expect(text, 'no group content is sent').not.toContain('PREFIX-G');
        expect(text, 'no group shown, so the device-level switch (off) decides: no global prompt').not.toContain(GLOBAL);
    });
});
