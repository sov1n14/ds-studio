/**
 * Shared harness for content-script scenarios asserting "what the overlay displays" == "what will be injected".
 *
 * Real modules: content-script.js, ChatBinding, PresetOverlay, StorageManager, in-memory chrome.storage (clone semantics). Mocked trust boundaries only: chrome.runtime.sendMessage (the SW chat-map writer) and the settings relay the SW performs (chrome.storage.onChanged -> DSS_SETTINGS_CHANGED to the content script), played here because no service worker runs.
 */
import { vi } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';
import { setPathname } from './set-pathname.js';
import { writeChatMapLayout, NO_RECEIVER, CONTEXT_INVALIDATED } from './chat-map-writer-harness.js';

export { contentScript };
export const overlay = contentScript.PresetOverlay;
export const GLOBAL = 'GLOBAL-INSTRUCTION';

export const preset = (id, name, content, globalPromptEnabled) => ({ id, name, content, createdAt: 1, updatedAt: 1, globalPromptEnabled });

export async function flush(times = 30) {
    for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

// Rejections with NO_RECEIVER retry once after 100 ms inside the client, so wait past that before draining.
export async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flush();
}

async function waitForContentScriptBootstrap() {
    for (let i = 0; i < 500; i++) {
        if (chrome.runtime.onMessage.listenerCount() >= 2) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Timed out waiting for content-script.js initSettings() to register its DSS_SETTINGS_CHANGED listener.');
}

// Plays background/settings-routes.js: every committed storage change reaches the content script as DSS_SETTINGS_CHANGED.
const relaySettingsChanged = (changes, area) => {
    chrome.runtime.onMessage.callListeners({ type: 'DSS_SETTINGS_CHANGED', area, changes }, {}, () => {});
};

export async function seedPresets(presets) {
    const item = { dsPresetIndex: presets.map((p) => p.id) };
    presets.forEach((p) => { item[`dsPreset_${p.id}`] = p; });
    await chrome.storage.local.set(item);
    await chrome.storage.sync.set(item);
}

let map;
/** The chat map as the SW writer last committed it. */
export const storedMap = () => map;
export async function writeStoredMap(next) {
    map = { ...next };
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [map]);
}

// SW chat-map writer doubles (promise-form sendMessage).
export const transports = {
    success: async (msg) => {
        const next = { ...map };
        if (msg.type === DSS_CHAT_MAP_MSG.BIND) next[msg.uuid] = msg.presetId;
        if (msg.type === DSS_CHAT_MAP_MSG.UNBIND) delete next[msg.uuid];
        await writeStoredMap(next);
        return { ok: true, map: { ...next } };
    },
    'rejection (SW unreachable)': () => Promise.reject(new Error(NO_RECEIVER)),
    'synchronous throw (context invalidated)': () => { throw new Error(CONTEXT_INVALIDATED); },
    'writer refusal ({ ok: false })': async () => ({ ok: false, error: 'writer refused' }),
};
export const FAILURE_MODES = Object.keys(transports).filter((k) => k !== 'success');

export const shownLabel = () => overlay.dropdown.label.textContent;
export const shownValue = () => overlay.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? '';
export const clickOption = (id) => overlay.dropdown.menu.querySelector(`.dss-preset-option[data-value="${id}"]`).click();
export const storedActivePresetId = async () => (await StorageManager.getSettings()).activePresetId;

/** The exact text the injector would put in front of the next user message. */
export function injected() {
    const ta = document.createElement('textarea');
    ta.value = 'user message';
    contentScript.injectPrefix(ta);
    return ta.value;
}

export async function navigateTo(path) {
    setPathname(path);
    await contentScript.handleChatChange();
    await settle();
}

// An unrelated cross-device edit: any preset broadcast makes the content script re-resolve isGlobalPromptEnabled.
export async function unrelatedPresetEditArrives(p) {
    const edited = { ...p, content: p.content + ' (edited)', updatedAt: 2 };
    await chrome.storage.sync.set({ [`dsPreset_${edited.id}`]: edited });
    await chrome.storage.local.set({ [`dsPreset_${edited.id}`]: edited });
    await settle();
}

/** Call from beforeEach; returns the teardown to call from afterEach. */
export async function setUpOverlayScenario() {
    await waitForContentScriptBootstrap();
    map = {};
    Object.assign(contentScript.state, { isEnabled: true, promptPrefix: '', globalDefaultPrompt: GLOBAL, isGlobalPromptEnabled: true, isShowSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    const originalSendMessage = chrome.runtime.sendMessage;
    chrome.storage.onChanged.addListener(relaySettingsChanged);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const target = document.createElement('div');
    document.body.appendChild(target);
    overlay.mountTo(target);
    return () => {
        chrome.storage.onChanged.removeListener(relaySettingsChanged);
        chrome.runtime.sendMessage = originalSendMessage;
        errorSpy.mockRestore();
        overlay.unmount();
        target.remove();
    };
}

/** Seed presets and a chat map, then open `path`. */
export async function openChat(path, presets, chatMap) {
    await seedPresets(presets);
    await writeStoredMap(chatMap);
    overlay.render(presets, '');
    await navigateTo(path);
}
