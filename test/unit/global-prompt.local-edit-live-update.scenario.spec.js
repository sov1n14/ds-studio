/**
 * Scenario (global prompt, local edit reaches an open tab): user decision D-45, "It should take effect immediately."
 *
 * Requirement: when the user edits the global default prompt on this device, a DeepSeek tab that is already open injects the new text on its next send, without a reload. This holds when chrome.storage.sync accepts the write and when sync rejects it and the save falls back to chrome.storage.local. Cross-device sync is out of scope.
 *
 * Real modules: the editor save (popup/editor/editor.storage.js saveContent), StorageManager, background/settings-routes.js (its own chrome.storage.onChanged listener and key filter decide what is broadcast), and content/content-script.js with every content module, evaluated fresh per test. test/helpers/chrome-storage-change-events.js relaySettingsChanged is deliberately not used: it forwards every area and key and would hide a broken key filter in settings-routes.js.
 *
 * Mocked trust boundaries only: chrome.storage (test/fixtures/chrome-storage-mock.js, both areas, with real Chrome onChanged semantics via silenceUnchangedWrites), chrome.tabs.query and chrome.tabs.sendMessage (deliver to the chrome.runtime.onMessage listeners of the content script, by copy and asynchronously), chrome.runtime.sendMessage (content-to-SW requests answered with no response) and navigator (desktop device profile).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import '../../background/settings-routes.js';
import { setPathname } from '../helpers/set-pathname.js';
import { silenceUnchangedWrites } from '../helpers/chrome-storage-change-events.js';

const NEW_CHAT = '/a/chat/s';
const TAB = { id: 41, url: 'https://chat.deepseek.com/a/chat/s' };
const OLD_TEXT = 'OLD-GLOBAL-RULE answer in haiku';
const NEW_TEXT = 'NEW-GLOBAL-RULE answer in limerick';
// Non-touch Windows desktop (UA, platform and touch points of a real Edge install).
const DESKTOP = { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0' };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await wait(250); for (let i = 0; i < 30; i++) await wait(0); };

/** Seeds both storage areas the way an earlier save on this device left them: master switch on, device-level global toggle on, global prompt OLD_TEXT, no prompt groups. */
async function seed() {
    const items = { isEnabled: true, [StorageManager.KEYS.GLOBAL_PROMPT_ENABLED]: true, [StorageManager.KEYS.GLOBAL_DEFAULT_PROMPT]: OLD_TEXT, dsPresetIndex: [] };
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
}

let cs;
let contentListeners;
let swListeners;

/** Evaluates content-script.js on `pathname` and waits until initSettings() has registered its settings listener; records the listeners it adds. */
async function loadContentScript(pathname) {
    setPathname(pathname);
    const event = chrome.runtime.onMessage;
    const originalAdd = event.addListener;
    event.addListener = (fn) => { contentListeners.push(fn); originalAdd(fn); };
    try {
        vi.resetModules();
        cs = (await import('../../content/content-script.js')).default;
        for (let i = 0; i < 500 && contentListeners.length < 2; i++) await wait(0);
    } finally {
        event.addListener = originalAdd;
    }
    if (contentListeners.length < 2) throw new Error('Timed out waiting for content-script.js initSettings() to register its DSS_SETTINGS_CHANGED listener.');
    await settle();
}

/** Installs the real settings routes as the service worker does, recording the listeners so afterEach can remove them. */
function installServiceWorkerRoutes() {
    const events = [chrome.runtime.onMessage, chrome.storage.onChanged];
    const originals = events.map((e) => e.addListener);
    events.forEach((e, i) => { e.addListener = (fn) => { swListeners.push([e, fn]); originals[i](fn); }; });
    try {
        globalThis.DSSSettingsRoutes.install();
    } finally {
        events.forEach((e, i) => { e.addListener = originals[i]; });
    }
}

/** What the open tab sends next: a page textarea holding `text`, passed through the injector of the content script. */
const nextSend = (text = 'user message') => {
    const ta = document.createElement('textarea');
    ta.value = text;
    cs.injectPrefix(ta);
    return ta.value;
};

const saveGlobalFromEditor = (value) => globalThis.__DS_Editor_storage.saveContent({ type: 'global' }, value);

describe('a local edit of the global prompt takes effect on an already-open tab (D-45)', () => {
    let restoreNotify;
    const originals = { runtimeSend: chrome.runtime.sendMessage, tabsQuery: chrome.tabs.query, tabsSend: chrome.tabs.sendMessage };

    beforeEach(async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.entries(DESKTOP).forEach(([key, value]) => Object.defineProperty(navigator, key, { configurable: true, get: () => value }));
        contentListeners = [];
        swListeners = [];
        cs = null;
        // Content-to-SW requests (chat map, settings fetches) get no response, as when no route answers.
        chrome.runtime.sendMessage = vi.fn(async () => undefined);
        chrome.tabs.query = vi.fn(async () => [structuredClone(TAB)]);
        // Delivers a SW-to-tab message only to the content script of that tab, by copy and on a later task, as Chrome messaging does.
        chrome.tabs.sendMessage = vi.fn(async (tabId, message) => {
            await wait(0);
            if (tabId !== TAB.id) throw new Error('Could not establish connection. Receiving end does not exist.');
            contentListeners.forEach((fn) => fn(structuredClone(message), { id: chrome.runtime.id }, () => {}));
            return undefined;
        });
        await seed();
        restoreNotify = silenceUnchangedWrites();
        await loadContentScript(NEW_CHAT);
        installServiceWorkerRoutes();
    });

    afterEach(() => {
        if (cs) {
            Object.assign(cs.state, { isEnabled: false, isInjecting: true });
            clearTimeout(cs.state.awaitingNewChatUuidTimer);
            cs.PresetOverlay.unmount();
            cs.PresetOverlay.scheduleFindAndMount = () => {};
        }
        contentListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
        swListeners.forEach(([event, fn]) => event.removeListener(fn));
        chrome.storage.sync.setQuotaError(false);
        restoreNotify();
        Object.assign(chrome.runtime, { sendMessage: originals.runtimeSend });
        Object.assign(chrome.tabs, { query: originals.tabsQuery, sendMessage: originals.tabsSend });
        Object.keys(DESKTOP).forEach((key) => delete navigator[key]);
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        setPathname('/');
    });

    it('control: before any edit, the open tab injects the stored global prompt', () => {
        const text = nextSend();

        expect(text, 'the harness observes the global prompt in the injected text').toContain(OLD_TEXT);
        expect(text, 'the user text is kept').toContain('user message');
    });

    it('an edit saved while sync accepts the write changes what the open tab injects on its next send', async () => {
        await saveGlobalFromEditor(NEW_TEXT);
        await settle();

        const text = nextSend();
        expect(text, 'the next send carries the edited global prompt').toContain(NEW_TEXT);
        expect(text, 'the next send no longer carries the previous global prompt').not.toContain(OLD_TEXT);
    });

    it('an edit saved while sync rejects the write (local fallback) still changes what the open tab injects', async () => {
        chrome.storage.sync.setQuotaError(true);

        await saveGlobalFromEditor(NEW_TEXT);
        await settle();

        const syncCopy = await chrome.storage.sync.get(StorageManager.KEYS.GLOBAL_DEFAULT_PROMPT);
        expect(syncCopy[StorageManager.KEYS.GLOBAL_DEFAULT_PROMPT], 'precondition: sync rejected the write and still holds the old text').toBe(OLD_TEXT);
        const text = nextSend();
        expect(text, 'the next send carries the edited global prompt').toContain(NEW_TEXT);
        expect(text, 'the next send no longer carries the previous global prompt').not.toContain(OLD_TEXT);
    });
});
