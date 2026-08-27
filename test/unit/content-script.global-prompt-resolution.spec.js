/**
 * Tests for the RESOLUTION side of the per-preset global-prompt-enabled feature.
 *
 * Scope: verifies that isGlobalPromptEnabled is derived from
 * StorageManager.resolveGlobalPromptEnabled(activePreset, legacyGlobalFlag), i.e. from
 * the active preset's own globalPromptEnabled field, rather than solely from the
 * legacy device-local globalPromptEnabled settings key, and that this resolution:
 *   - discriminates correctly between two different active presets (headline criterion),
 *   - takes effect on the next injected message when the active preset is switched via
 *     the in-page overlay, with no page reload,
 *   - takes effect when the change arrives as a background DSS_SETTINGS_CHANGED
 *     broadcast (cross-device sync / another context), with no page reload,
 *   - still yields to the isEnabled master switch,
 *   - defaults to enabled when a preset object omits the field entirely,
 *   - does not affect whether the preset's own content prefix is injected,
 *   - still excludes an empty globalDefaultPrompt regardless of the resolved flag.
 *
 * Companion specs, NOT modified, and NOT covering the resolution side:
 *   - content-script.global-prompt-gating.spec.js   (drives isGlobalPromptEnabled directly
 *     via direct state writes and asserts the gate itself, which this change does not alter)
 *   - content-script.injection-prefix.spec.js        (general buildInjectionPrefix/injectPrefix
 *     behavior, unrelated to preset-based resolution)
 *
 * Deliberately uses REAL chrome.storage (via the in-memory mock) and REAL StorageManager /
 * PresetOverlay code paths rather than mocking StorageManager.getSettings, so that the
 * assertions exercise actual end-to-end behavior (the injected textarea string) instead of
 * an internal call sequence. Storage is seeded directly, then the DSS_SETTINGS_CHANGED
 * broadcast that background/settings-routes.js would send is delivered by the test,
 * since no background page runs here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

function makeTextarea(value) {
    const ta = document.createElement('textarea');
    ta.value = value;
    return ta;
}

async function flush(times = 10) {
    for (let i = 0; i < times; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

// Deterministic replacement for a fixed tick-count guess. content-script.js
// registers TWO chrome.runtime.onMessage listeners: the popup message router,
// synchronously at module load, and the DSS_SETTINGS_CHANGED broadcast receiver
// as the LAST statement of the un-awaited initSettings() bootstrap started at
// module-import time. Until that second listener exists, any broadcast the test
// delivers (cross-device / remote change simulation) reaches nobody and is lost
// forever -- the mock does not replay past messages to late listeners.
// Waiting for the count to reach 2 is therefore an exact signal that the entire
// bootstrap chain (including the isEnabled / globalDefaultPrompt /
// isGlobalPromptEnabled assignments that precede it) has settled, removing the
// race instead of merely outlasting it with a bigger magic number.
async function waitForContentScriptBootstrap() {
    const maxTicks = 500;
    for (let i = 0; i < maxTicks; i++) {
        if (chrome.runtime.onMessage.listenerCount() >= 2) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Timed out waiting for content-script.js initSettings() to register its DSS_SETTINGS_CHANGED listener (bootstrap never completed).');
}

// Delivers the broadcast background/settings-routes.js would send after a
// storage write. No background page runs in this suite, so the test plays that
// role: seed chrome.storage first (the content script re-reads it), then hand
// the content script the changed-keys notification.
function broadcastSettingsChanged(changes, area = 'local') {
    chrome.runtime.onMessage.callListeners(
        { type: 'DSS_SETTINGS_CHANGED', area, changes },
        {},
        () => {}
    );
}

// Deterministic replacement for flush() at points where the test must observe
// an async DSS_SETTINGS_CHANGED -> refreshGlobalPromptEnabled() round trip
// completing, rather than guessing how many ticks that chain needs.
async function waitUntilState(predicate, description) {
    const maxTicks = 500;
    for (let i = 0; i < maxTicks; i++) {
        if (predicate(contentScript.state)) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("Timed out waiting for: " + description);
}

async function waitUntilGlobalPromptEnabledIs(expected) {
    await waitUntilState(
        (s) => s.isGlobalPromptEnabled === expected,
        "isGlobalPromptEnabled to become " + expected
    );
}

// Drains BOTH fire-and-forget async chains a DSS_SETTINGS_CHANGED broadcast /
// onSelectChange event can trigger (refreshGlobalPromptEnabled() AND
// updatePromptPrefixFromBinding(), see applySettingsChanged() in
// content/content-script.js and onSelectChange() in
// content/preset-overlay.controller.js) before the test proceeds --
// otherwise whichever chain resolves slower keeps running in the background
// and can land during a LATER test, clobbering that later test own-content-
// prefix or global-prompt-enabled state (observed: a dangling promise from an
// earlier onSelectChange re-fetching storage two tests later and stamping
// whatever preset currently owns that id onto promptPrefix).
async function waitUntilPresetSwitchSettled(expectedGlobalPromptEnabled, expectedOwnPrefix) {
    await waitUntilState(
        (s) => s.isGlobalPromptEnabled === expectedGlobalPromptEnabled && s.promptPrefix === expectedOwnPrefix,
        "isGlobalPromptEnabled=" + expectedGlobalPromptEnabled + " and promptPrefix=" + JSON.stringify(expectedOwnPrefix)
    );
}

async function seedPresets(presets, activeId) {
    const item = { dsPresetIndex: presets.map((p) => p.id) };
    presets.forEach((p) => { item[`dsPreset_${p.id}`] = p; });
    if (activeId !== undefined) item.activePresetId = activeId;
    await chrome.storage.local.set(item);
    await chrome.storage.sync.set(item);
}

describe('isGlobalPromptEnabled resolution from the active preset (per-preset flag)', () => {
    beforeEach(async () => {
        // Wait for the module-load-time initSettings() bootstrap to fully settle
        // before resetting state -- otherwise its delayed isEnabled /
        // globalDefaultPrompt / isGlobalPromptEnabled assignments can land AFTER
        // state writes run in the test body and silently clobber it mid-test.
        await waitForContentScriptBootstrap();
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, isShowSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    });

    it('[Req 1 and 4] a remote or cross-device change to the active preset globalPromptEnabled flag is reflected on the next injected message, without reload', async () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'Global instruction';

        await seedPresets([
            { id: 'preset-A', name: 'A', content: '', createdAt: 1, updatedAt: 1, globalPromptEnabled: true },
        ], 'preset-A');
        await flush();

        const ta1 = makeTextarea('first message');
        expect(contentScript.injectPrefix(ta1)).toBe(true);
        expect(ta1.value).toContain('Global instruction');

        const flippedPreset = { id: 'preset-A', name: 'A', content: '', createdAt: 1, updatedAt: 2, globalPromptEnabled: false };
        await chrome.storage.sync.set({ 'dsPreset_preset-A': flippedPreset });
        await chrome.storage.local.set({ 'dsPreset_preset-A': flippedPreset });
        broadcastSettingsChanged({ 'dsPreset_preset-A': { newValue: flippedPreset } });
        // Deterministically wait for the broadcast -> refreshGlobalPromptEnabled()
        // round trip to actually settle, rather than guessing a tick count.
        await waitUntilGlobalPromptEnabledIs(false);

        const ta2 = makeTextarea('second message');
        expect(contentScript.injectPrefix(ta2)).toBe(true);
        expect(ta2.value).not.toContain('Global instruction');
    });

    it('[Req 2, 3, 8] switching the active preset via the overlay changes the global-prompt segment on the very next message, while the preset own content prefix is always included', async () => {
        contentScript.state.isEnabled = true;
        contentScript.state.currentChatUuid = null;
        contentScript.state.chatPresetMap = {};
        contentScript.state.pendingPresetId = null;
        contentScript.state.globalDefaultPrompt = 'Global system instruction';

        await seedPresets([
            { id: 'preset-A', name: 'A', content: 'Prefix A', createdAt: 1, updatedAt: 1, globalPromptEnabled: true },
            { id: 'preset-B', name: 'B', content: 'Prefix B', createdAt: 1, updatedAt: 1, globalPromptEnabled: false },
        ]);
        await flush();

        contentScript.PresetOverlay.onSelectChange('preset-A');
        broadcastSettingsChanged({ activePresetId: { newValue: 'preset-A' } });
        // Wait for both broadcast-triggered chains (own-prefix resolution AND
        // global-prompt-enabled resolution) to fully settle before asserting or
        // moving on, so neither survives as a dangling promise into a later test.
        await waitUntilPresetSwitchSettled(true, 'Prefix A');

        const ta1 = makeTextarea('message one');
        expect(contentScript.injectPrefix(ta1)).toBe(true);
        expect(ta1.value).toContain('Global system instruction');
        expect(ta1.value).toContain('Prefix A');

        contentScript.PresetOverlay.onSelectChange('preset-B');
        broadcastSettingsChanged({ activePresetId: { newValue: 'preset-B' } });
        // Wait for both broadcast-triggered chains to fully settle (see above).
        await waitUntilPresetSwitchSettled(false, 'Prefix B');

        const ta2 = makeTextarea('message two');
        expect(contentScript.injectPrefix(ta2)).toBe(true);
        expect(ta2.value).not.toContain('Global system instruction');
        expect(ta2.value).toContain('Prefix B');
    });

    it('[Req 5] the isEnabled master switch still blocks all injection even when the resolved active preset has globalPromptEnabled true', async () => {
        contentScript.state.isEnabled = false;
        contentScript.state.globalDefaultPrompt = 'Global instruction';

        await seedPresets([
            { id: 'preset-A', name: 'A', content: 'Own prefix', createdAt: 1, updatedAt: 1, globalPromptEnabled: true },
        ], 'preset-A');
        await flush();

        const ta = makeTextarea('message');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('message');
    });

    it('[Req 6] a preset object with no globalPromptEnabled field at all is treated as enabled, even overriding a stale legacy device flag', async () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'Global instruction';

        // Stale legacy device-local flag says disabled; the active preset omits the field
        // entirely, so the resolver must default that preset to enabled and NOT fall back
        // to the stale legacy value.
        await chrome.storage.local.set({ globalPromptEnabled: false });

        await seedPresets([
            { id: 'preset-A', name: 'A', content: '', createdAt: 1, updatedAt: 1 },
        ], 'preset-A');
        await flush();

        const ta = makeTextarea('message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toContain('Global instruction');
    });

    it('[Req 7] an empty globalDefaultPrompt yields no global-prompt segment even when the resolved flag is true, existing behavior preserved', async () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = '';

        await seedPresets([
            { id: 'preset-A', name: 'A', content: '', createdAt: 1, updatedAt: 1, globalPromptEnabled: true },
        ], 'preset-A');
        await flush();

        expect(contentScript.buildInjectionPrefix()).toBe('');
    });

    // ── Regression tests: SPA navigation must not leave isGlobalPromptEnabled stale ──
    // Root cause under test: resolveGlobalPromptEnabledFromSettings() keys off
    // settings.activePresetId only, but handleChatChange() does NOT always keep
    // activePresetId in sync with the actual bound preset for the destination chat
    // (see handleChatChange() in content/chat-binding-controller.js), and
    // refreshGlobalPromptEnabled() only runs from applySettingsChanged(), i.e. only from
    // a DSS_SETTINGS_CHANGED broadcast, never from direct SPA navigation. These tests drive the real handleChatChange()
    // export the same way setupNavigationDetection() does (URL change -> handleChatChange()),
    // via window.history.replaceState + calling handleChatChange() directly, exactly as
    // content-script.binding.spec.js already does for this module.

    async function seedBinding(uuid, presetId) {
        await StorageManager.mutateChatPresetMap(map => {
            map[uuid] = presetId;
            return map;
        });
    }

    it('[BUG regression] navigating from a chat bound to a preset with globalPromptEnabled:false to an UNBOUND chat must fall back to the legacy device flag (true), not the stale preset flag', async () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'Global instruction';
        contentScript.state.currentChatUuid = null;
        contentScript.state.chatPresetMap = {};
        contentScript.state.pendingPresetId = null;

        // Legacy device-local flag is the OPPOSITE of preset A's own flag, so the two
        // cannot be confused for one another in the assertions below.
        await chrome.storage.local.set({ globalPromptEnabled: true });
        await chrome.storage.sync.set({ globalPromptEnabled: true });

        await seedPresets([
            { id: 'preset-A', name: 'A', content: 'Prefix A', createdAt: 1, updatedAt: 1, globalPromptEnabled: false },
        ]);
        await flush();

        const chat1 = '11111111-1111-1111-1111-111111111111';
        await seedBinding(chat1, 'preset-A');
        setPathname(`/a/chat/s/${chat1}`);
        await contentScript.handleChatChange();
        await flush();

        // Sanity check: chat 1 is bound to preset A (globalPromptEnabled:false), so the
        // global prompt is correctly omitted here.
        const ta1 = makeTextarea('message in chat 1');
        expect(contentScript.injectPrefix(ta1)).toBe(true);
        expect(ta1.value).not.toContain('Global instruction');
        expect(ta1.value).toContain('Prefix A');

        // SPA navigation (no popup interaction) to chat 2, which has NO chatPresetMap entry.
        const chat2 = '22222222-2222-2222-2222-222222222222';
        setPathname(`/a/chat/s/${chat2}`);
        await contentScript.handleChatChange();
        await flush();

        const ta2 = makeTextarea('message in chat 2');
        expect(contentScript.injectPrefix(ta2)).toBe(true);
        // Chat 2 has no bound preset: the active preset must resolve to none, so the
        // legacy device flag (true) applies and the global prompt IS injected. It must
        // NOT still reflect preset A's stale false flag left over from chat 1.
        expect(ta2.value).toContain('Global instruction');
        expect(ta2.value).not.toContain('Prefix A');
    });

    it('[BUG regression] navigating from a bound chat to a brand-new chat with no pinned preset also leaves the stale preset flag active', async () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'Global instruction';
        contentScript.state.currentChatUuid = null;
        contentScript.state.chatPresetMap = {};
        contentScript.state.pendingPresetId = null;

        await chrome.storage.local.set({ globalPromptEnabled: true });
        await chrome.storage.sync.set({ globalPromptEnabled: true });

        await seedPresets([
            { id: 'preset-A', name: 'A', content: 'Prefix A', createdAt: 1, updatedAt: 1, globalPromptEnabled: false },
        ]);
        await flush();

        const chat1 = '33333333-3333-3333-3333-333333333333';
        await seedBinding(chat1, 'preset-A');
        setPathname(`/a/chat/s/${chat1}`);
        await contentScript.handleChatChange();
        await flush();

        const ta1 = makeTextarea('message in chat 1');
        expect(contentScript.injectPrefix(ta1)).toBe(true);
        expect(ta1.value).not.toContain('Global instruction');

        // Navigate to a brand-new chat (no UUID in the URL) with no pinnedPresetId set.
        setPathname('/a/chat/s');
        await contentScript.handleChatChange();
        await flush();

        const ta2 = makeTextarea('message in new chat');
        expect(contentScript.injectPrefix(ta2)).toBe(true);
        expect(ta2.value).toContain('Global instruction');
    });
});
