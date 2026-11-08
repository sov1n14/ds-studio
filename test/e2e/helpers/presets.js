// Prompt presets (prompt groups) seeded for a spec and picked through the in-page preset overlay.

import { expect } from '@playwright/test';
import { evaluateInWorker } from './extension.js';
import { PRESET_OVERLAY_SELECTOR } from './extension-ui.js';
import { expectNeverWithin } from './observation.js';

// Keys the extension writes while a preset is picked, restored by the settings session.
const KEYS_WRITTEN_BY_PICKING = ['activePresetId', 'pinnedPresetId', 'dsPresetTombstones', 'dsLocalAuth', 'chatPresetMapMeta', 'syncConflictPending'];

// Picking a preset in a conversation (or sending from a new chat) binds the chat; the binding map is stored in numbered chunks.
const CHAT_MAP_META_KEY = 'chatPresetMapMeta';
const CHAT_MAP_CHUNK_PREFIX = 'chatPresetMap_';

// How long the overlay is watched to prove a preset name never appears in it.
const OVERLAY_NEGATIVE_WINDOW_MS = 2_000;

/** Builds a preset whose content is a unique marker, so a spec can tell exactly where the preset content landed. */
export function createTestPreset(label) {
    const stamp = Date.now();
    return Object.freeze({
        id: 'preset-e2e-' + label + '-' + stamp,
        name: 'E2E ' + label + ' ' + stamp,
        content: 'E2E-PRESET-MARKER-' + label + '-' + stamp,
        createdAt: stamp,
        updatedAt: stamp,
        globalPromptEnabled: false,
    });
}

/** Snapshots the chat-binding chunks that exist now plus the next one, so a binding created during the test is undone. */
async function trackChatBindings(settings, context) {
    const chunkCount = await evaluateInWorker(context, async (metaKey) => {
        const counts = await Promise.all(['sync', 'local'].map(async (area) => (await chrome.storage[area].get(metaKey))[metaKey]?.chunkCount ?? 0));
        return Math.max(...counts);
    }, CHAT_MAP_META_KEY);
    const chunkKeys = Array.from({ length: chunkCount + 1 }, (_, i) => CHAT_MAP_CHUNK_PREFIX + i);
    await settings.track([...KEYS_WRITTEN_BY_PICKING, ...chunkKeys]);
}

/** Makes `preset` the only preset (in both storage areas, as synced presets are read sync-first) with nothing picked or pinned; every touched key is restored after the test. */
export async function seedOnlyPreset(settings, context, preset) {
    await seedOnlyPresets(settings, context, [preset]);
}

/** Makes `presets` the only presets, in this order, with nothing picked or pinned; same storage handling as `seedOnlyPreset`. */
export async function seedOnlyPresets(settings, context, presets) {
    const ids = presets.map((preset) => preset.id);
    await trackChatBindings(settings, context);
    await settings.setInBothAreas({
        dsPresetIndex: ids,
        dsPresetOrderMeta: { order: ids, orderUpdatedAt: Math.max(...presets.map((preset) => preset.updatedAt)) },
        ...Object.fromEntries(presets.map((preset) => ['dsPreset_' + preset.id, preset])),
        activePresetId: '',
        pinnedPresetId: '',
    });
}

/** Additionally removes, after the test, every prompt group the extension creates during it (one added through the popup gets an id the test cannot know in advance). */
export async function trackPresetsCreatedDuringTest(settings) {
    await settings.trackNewKeys('dsPreset_');
}

/** The in-page preset overlay. */
export function presetOverlay(page) {
    return page.locator(PRESET_OVERLAY_SELECTOR);
}

/** Fails when the overlay of `page` shows `name` within the observation window. */
export async function expectOverlayNeverShows(page, name, message) {
    await expectNeverWithin(page, ({ selector, text }) => document.querySelector(selector)?.textContent.includes(text) ?? false, { selector: PRESET_OVERLAY_SELECTOR, text: name }, OVERLAY_NEGATIVE_WINDOW_MS, message);
}

/** Opens the overlay's preset list and clicks the option that `chooseOption(options)` narrows to. */
export async function pickPresetOption(page, chooseOption) {
    const trigger = presetOverlay(page).getByRole('button');
    await trigger.click();
    const menu = page.locator('#' + await trigger.getAttribute('aria-controls'));
    await expect(menu, 'the preset list opens').toBeVisible();
    await chooseOption(menu.getByRole('option')).click();
}

/** Picks `preset` in the overlay and waits until the overlay shows it. */
export async function pickPreset(page, preset) {
    await pickPresetOption(page, (options) => options.filter({ hasText: preset.name }));
    await expect(presetOverlay(page), 'the overlay shows the picked preset').toContainText(preset.name);
}
