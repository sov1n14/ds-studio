/**
 * Which preset the in-page overlay shows as selected after a background
 * DSS_SETTINGS_CHANGED broadcast (content-script.js -> applySettingsChanged ->
 * PresetOverlay.render(presets, resolveActivePresetIdFrom(settings))).
 *
 * Covered here (P3):
 *   - a chatPresetMap entry pointing at a preset that has since been DELETED must
 *     stop being shown: the overlay falls back to "no selection", it may not keep
 *     displaying the dead preset's name or id,
 *   - a brand-new conversation (no chat uuid) with pendingPresetId === null must
 *     show the pinned preset.
 *
 * Uses the REAL storage mock, the REAL StorageManager and the REAL overlay
 * controller, and asserts what the rendered dropdown actually displays (label
 * text + aria-selected option), not internal calls. The broadcast that
 * background/settings-routes.js would send is delivered by the test, because no
 * background page runs in this suite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

const overlay = contentScript.PresetOverlay;

const DEAD_PRESET  = { id: 'preset-dead', name: 'Alpha',  content: 'Alpha content',  createdAt: 1, updatedAt: 1 };
const LIVE_PRESET  = { id: 'preset-live', name: 'Bravo',  content: 'Bravo content',  createdAt: 1, updatedAt: 1 };
const PINNED_PRESET= { id: 'preset-pin',  name: 'Pinned', content: 'Pinned content', createdAt: 1, updatedAt: 1 };

const CHAT_UUID = '44444444-4444-4444-4444-444444444444';

async function flush(times = 20) {
    for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

// content-script.js registers its DSS_SETTINGS_CHANGED listener as the LAST
// statement of the un-awaited initSettings() bootstrap; the popup router is
// registered synchronously at module load. Count >= 2 therefore means the
// bootstrap finished and a broadcast delivered now will be received.
async function waitForContentScriptBootstrap() {
    for (let i = 0; i < 500; i++) {
        if (chrome.runtime.onMessage.listenerCount() >= 2) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Timed out waiting for content-script.js initSettings() to register its DSS_SETTINGS_CHANGED listener.');
}

function broadcastSettingsChanged(changes, area = 'local') {
    chrome.runtime.onMessage.callListeners(
        { type: 'DSS_SETTINGS_CHANGED', area, changes },
        {},
        () => {}
    );
}

async function seedPresets(presets) {
    const item = { dsPresetIndex: presets.map((p) => p.id) };
    presets.forEach((p) => { item[`dsPreset_${p.id}`] = p; });
    await chrome.storage.local.set(item);
    await chrome.storage.sync.set(item);
}

/** data-value of the option the rebuilt menu marks as selected (null = none). */
function getRenderedSelectedValue() {
    const selected = overlay.dropdown.menu.querySelector('[aria-selected="true"]');
    return selected ? (selected.getAttribute('data-value') || '') : null;
}

function getRenderedOptionValues() {
    return [...overlay.dropdown.menu.querySelectorAll('.dss-preset-option')]
        .map((li) => li.getAttribute('data-value') || '');
}

const getLabelText = () => overlay.dropdown.label.textContent;

describe('overlay selected preset after a DSS_SETTINGS_CHANGED broadcast', () => {
    let target;

    beforeEach(async () => {
        await waitForContentScriptBootstrap();
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, isShowSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
        target = document.createElement('div');
        document.body.appendChild(target);
        overlay.mountTo(target);
    });

    afterEach(() => {
        overlay.unmount();
        if (target.parentNode) target.parentNode.removeChild(target);
    });

    it('[P3] stops showing a bound preset that has been deleted, rendering no selection instead of the dead id', async () => {
        contentScript.state.isEnabled = true;
        contentScript.state.currentChatUuid = CHAT_UUID;
        contentScript.state.chatPresetMap = { [CHAT_UUID]: DEAD_PRESET.id };
        contentScript.state.pendingPresetId = null;

        await seedPresets([DEAD_PRESET, LIVE_PRESET]);
        broadcastSettingsChanged({ dsPresetIndex: { newValue: [DEAD_PRESET.id, LIVE_PRESET.id] } });
        await flush();

        // Sanity: while it exists, the bound preset IS the shown selection --
        // without this the assertions below could pass on an overlay that never
        // showed anything at all.
        expect(getRenderedSelectedValue()).toBe(DEAD_PRESET.id);
        expect(getLabelText()).toBe(DEAD_PRESET.name);

        // The preset is deleted elsewhere (popup / another device) and the chat
        // binding is left dangling.
        await chrome.storage.local.remove([`dsPreset_${DEAD_PRESET.id}`]);
        await chrome.storage.sync.remove([`dsPreset_${DEAD_PRESET.id}`]);
        await chrome.storage.local.set({ dsPresetIndex: [LIVE_PRESET.id] });
        await chrome.storage.sync.set({ dsPresetIndex: [LIVE_PRESET.id] });
        broadcastSettingsChanged({ dsPresetIndex: { newValue: [LIVE_PRESET.id] } });
        await flush();

        expect(getRenderedOptionValues()).not.toContain(DEAD_PRESET.id);
        expect(getRenderedSelectedValue()).not.toBe(DEAD_PRESET.id);
        expect(getLabelText()).not.toBe(DEAD_PRESET.name);
    });

    it('[P3] shows the pinned preset on a brand-new conversation when pendingPresetId is null', async () => {
        contentScript.state.isEnabled = true;
        contentScript.state.currentChatUuid = null;
        contentScript.state.chatPresetMap = {};
        contentScript.state.pendingPresetId = null;

        await seedPresets([PINNED_PRESET, LIVE_PRESET]);
        await StorageManager.savePinnedPresetId(PINNED_PRESET.id);
        broadcastSettingsChanged({ dsPresetIndex: { newValue: [PINNED_PRESET.id, LIVE_PRESET.id] } });
        await flush();

        expect(getRenderedSelectedValue()).toBe(PINNED_PRESET.id);
        expect(getLabelText()).toBe(PINNED_PRESET.name);
    });
});
