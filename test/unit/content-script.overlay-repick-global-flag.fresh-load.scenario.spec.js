/**
 * Scenario (content-script wiring): on a new conversation, re-picking in the in-page overlay the group that is already the stored activePresetId must make the next send carry that group's global prompt, through the real wiring content/content-script.js builds between the overlay and the binding controller.
 *
 * Requirement (docs/FEATURES.md "Global Prompt"): each prompt group remembers its own global-prompt switch; messages sent under a group whose switch is on carry the global prompt, and with no group shown the device-level switch decides.
 *
 * Why this file loads content-script.js itself: content-script.js builds the overlay ctx (refreshGlobalPromptEnabled included) once, at load. content-script.overlay-repick-global-flag.scenario.spec.js gets its instance from the static import in overlay-consistency-harness.js, which runs before Stryker activates a mutant, so a mutant in that wiring never reaches its assertions. Here the module is evaluated inside beforeEach; a separate file keeps this second instance, with its observers and listeners, out of the sibling spec's window.
 *
 * Mocked trust boundaries only: in-memory chrome.storage with real Chrome onChanged semantics (no event for a write that changes nothing) and the SW settings relay. Every content module is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import { writeChatMapLayout } from '../helpers/chat-map-writer-harness.js';
import { relaySettingsChanged, silenceUnchangedWrites } from '../helpers/chrome-storage-change-events.js';

const NEW_CHAT = '/a/chat/s';
const GLOBAL = 'GLOBAL-INSTRUCTION';
// G switches the global prompt on; the device-level switch is off, so "no group" and "group G" differ observably in the injection.
const G = { id: 'preset-G', name: 'Golf', content: 'PREFIX-G', createdAt: 1, updatedAt: 1, globalPromptEnabled: true };

const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Device-level switch off, global prompt text and master switch on, preset G, no bindings; in both areas as a synced profile holds them. */
async function seedStorage() {
    const items = { globalPromptEnabled: false, globalDefaultPrompt: GLOBAL, isEnabled: true, dsPresetIndex: [G.id], [`dsPreset_${G.id}`]: G };
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [{}]);
}

async function waitForBootstrap() {
    for (let i = 0; i < 500; i++) {
        if (chrome.runtime.onMessage.listenerCount() >= 2) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Timed out waiting for content-script.js initSettings() to register its DSS_SETTINGS_CHANGED listener.');
}

describe('through the content-script wiring: a re-pick of the stored group on a new chat injects its global prompt', () => {
    let contentScript;
    let overlay;
    let target;
    let restoreNotify;

    const shownValue = () => overlay.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? '';
    const clickOption = (id) => overlay.dropdown.menu.querySelector(`.dss-preset-option[data-value="${id}"]`).click();
    const injected = () => {
        const ta = document.createElement('textarea');
        ta.value = 'user message';
        contentScript.injectPrefix(ta);
        return ta.value;
    };
    const navigateTo = async (path) => {
        setPathname(path);
        await contentScript.handleChatChange();
        await settle();
    };

    beforeEach(async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        restoreNotify = silenceUnchangedWrites();
        chrome.storage.onChanged.addListener(relaySettingsChanged);
        await seedStorage();
        setPathname(NEW_CHAT);
        // Evaluated here, not at import, so the ctx wiring content-script.js builds at load is part of this test.
        vi.resetModules();
        contentScript = (await import('../../content/content-script.js')).default;
        await waitForBootstrap();
        overlay = contentScript.PresetOverlay;
        target = document.createElement('div');
        document.body.appendChild(target);
        overlay.mountTo(target);
        overlay.render([G], '');
        await navigateTo(NEW_CHAT);
    });

    afterEach(() => {
        chrome.storage.onChanged.removeListener(relaySettingsChanged);
        restoreNotify();
        overlay?.unmount();
        target?.remove();
        vi.restoreAllMocks();
        setPathname('/');
    });

    it("re-picking G sends G's content and the global prompt although the in-memory flag was off before the pick", async () => {
        expect(shownValue(), 'sanity: a new chat without a pinned group shows no group').toBe('');
        expect(injected(), 'sanity: no group shown, the device-level switch (off) decides').not.toContain(GLOBAL);

        clickOption(G.id);
        await settle();
        expect(injected(), 'sanity: the first pick of G (switch on) injects the global prompt').toContain(GLOBAL);
        expect((await StorageManager.getSettings()).activePresetId, 'sanity: the first pick stores G as activePresetId').toBe(G.id);

        await navigateTo(NEW_CHAT);
        const before = injected();
        expect(before, 'sanity: the next new chat injects no group content').not.toContain('PREFIX-G');
        expect(before, 'precondition: the in-memory flag follows the device-level switch (off) while G, whose switch is on, stays stored').not.toContain(GLOBAL);

        clickOption(G.id);
        await settle();

        expect(shownValue(), 'the overlay shows G').toBe(G.id);
        const text = injected();
        expect(text, "the send carries G's content").toContain('PREFIX-G');
        expect(text, "the re-pick writes nothing new, so no storage broadcast arrives; G's switch (on) must still decide: the send carries the global prompt").toContain(GLOBAL);
    });
});
