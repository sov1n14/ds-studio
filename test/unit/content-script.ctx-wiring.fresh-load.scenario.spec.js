/**
 * Scenario (content-script wiring): the ctx objects content/content-script.js hands to PresetOverlay and PromptInjector at load decide what the overlay shows, which chat a pick binds, and what a send carries.
 *
 * Requirements (docs/FEATURES.md "Prompt Groups", "Global Prompt", "System Time"): a pick in a chat binds that chat; a group picked on a new chat stays shown until the first send and binds the chat DeepSeek then creates; a remounted overlay shows the group of the open chat and follows the master switch; one send carries the prefix once and, with system time on, one "Current Time:" line; the overlay stops tracking layout once the extension context is invalidated.
 *
 * Why every test loads content-script.js itself: the ctx wiring is built once, at load. Specs that import content-script.js statically evaluate it before Stryker activates a mutant, so a mutant there never reaches their assertions. Each test here evaluates the module inside the test; afterEach neutralizes the previous instance (message listeners removed, overlay remount and injector disabled), because a fresh load leaves them registered.
 *
 * Mocked trust boundaries only: in-memory chrome.storage with real Chrome onChanged semantics, the SW settings relay, the SW chat-map writer (promise-form sendMessage), navigator (device profile) and ResizeObserver. Every content module is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import { writeChatMapLayout } from '../helpers/chat-map-writer-harness.js';
import { relaySettingsChanged, silenceUnchangedWrites } from '../helpers/chrome-storage-change-events.js';

const HEADER_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/conversation-header.html'), 'utf8');
const NEW_CHAT = '/a/chat/s';
const X = 'aaaaaaaa-1111-1111-1111-111111111111';
const Y = 'bbbbbbbb-2222-2222-2222-222222222222';
const CREATED = 'cccccccc-3333-3333-3333-333333333333';
const preset = (id, content) => ({ id, name: id, content, createdAt: 1, updatedAt: 1 });
const A = preset('preset-A', 'PREFIX-A');
const B = preset('preset-B', 'PREFIX-B');
const G = preset('preset-G', 'PREFIX-G');
// Non-touch Windows desktop (UA, platform and touch points of a real Edge install), so the Enter path is the desktop one.
const DESKTOP = { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0' };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await wait(250); for (let i = 0; i < 30; i++) await wait(0); };

let storedMap;
let chatMapOps;
/** SW chat-map writer double: records each dispatch and commits it, as background/chat-map-routes.js would. */
async function serviceWorker(msg) {
    if (!Object.values(DSS_CHAT_MAP_MSG).includes(msg?.type)) return undefined;
    chatMapOps.push(structuredClone(msg));
    const next = { ...storedMap };
    if (msg.type === DSS_CHAT_MAP_MSG.BIND) next[msg.uuid] = msg.presetId;
    if (msg.type === DSS_CHAT_MAP_MSG.UNBIND) delete next[msg.uuid];
    storedMap = next;
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [next]);
    return { ok: true, map: { ...next } };
}
const binds = () => chatMapOps.filter((m) => m.type === DSS_CHAT_MAP_MSG.BIND).map(({ uuid, presetId }) => ({ uuid, presetId }));

async function seed({ presets = [A, B, G], map = {}, settings = {} } = {}) {
    const items = { isEnabled: true, globalPromptEnabled: false, dsPresetIndex: presets.map((p) => p.id), ...settings };
    presets.forEach((p) => { items[`dsPreset_${p.id}`] = p; });
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    storedMap = { ...map };
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [storedMap]);
}

function appendHeader() {
    const holder = document.createElement('div');
    holder.innerHTML = HEADER_HTML;
    return document.body.appendChild(holder.firstElementChild);
}

let cs;
let addedListeners;
/** Evaluates content-script.js on `pathname` and waits until initSettings() has registered its settings listener. */
async function loadContentScript(pathname) {
    setPathname(pathname);
    const event = chrome.runtime.onMessage;
    const originalAdd = event.addListener;
    event.addListener = (fn) => { addedListeners.push(fn); originalAdd(fn); };
    try {
        vi.resetModules();
        cs = (await import('../../content/content-script.js')).default;
        for (let i = 0; i < 500 && addedListeners.length < 2; i++) await wait(0);
    } finally {
        event.addListener = originalAdd;
    }
    if (addedListeners.length < 2) throw new Error('Timed out waiting for content-script.js initSettings() to register its DSS_SETTINGS_CHANGED listener.');
    await settle();
    return cs.PresetOverlay;
}

const shownValue = (overlay) => overlay.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? '';
const clickOption = (overlay, id) => overlay.dropdown.menu.querySelector(`.dss-preset-option[data-value="${id}"]`).click();
const injected = (text = 'user message') => {
    const ta = document.createElement('textarea');
    ta.value = text;
    cs.injectPrefix(ta);
    return ta.value;
};
const count = (text, needle) => text.split(needle).length - 1;

/**
 * Replaces the chat header the way a React re-render does, then runs the remount that content-script.js's body observer fans out to.
 * The remount is called directly: happy-dom 16 holds each MutationObserver callback only through a WeakRef, so the body observer content-script.js starts (and keeps no reference to) can be garbage-collected mid-test and never fire.
 */
async function rerenderHeader(overlay) {
    overlay.targetEl.remove();
    const fresh = appendHeader();
    overlay.findAndMount();
    await settle();
    expect(overlay.targetEl, 'precondition: the overlay remounted into the re-rendered header').toBe(fresh);
}

/** Focuses a page textarea holding `text`, records what DeepSeek's own Enter handler would receive, and presses Enter. */
function pressEnter(text) {
    const ta = document.createElement('textarea');
    const pageEnters = [];
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') pageEnters.push(ta.value); });
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return { ta, pageEnters };
}

describe('content-script ctx wiring, evaluated fresh per test', () => {
    let restoreNotify;
    const originalSendMessage = chrome.runtime.sendMessage;
    const originalResizeObserver = globalThis.ResizeObserver;

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.entries(DESKTOP).forEach(([key, value]) => Object.defineProperty(navigator, key, { configurable: true, get: () => value }));
        restoreNotify = silenceUnchangedWrites();
        chrome.storage.onChanged.addListener(relaySettingsChanged);
        chrome.runtime.sendMessage = vi.fn(serviceWorker);
        chatMapOps = [];
        addedListeners = [];
        cs = null;
    });

    afterEach(() => {
        if (cs) {
            // Disables this instance's document-level injector listeners and drops its overlay.
            Object.assign(cs.state, { isEnabled: false, isInjecting: true });
            clearTimeout(cs.state.awaitingNewChatUuidTimer);
            cs.PresetOverlay.unmount();
            // The instance's body observer fans out to this method; a no-op keeps its overlay from remounting into the next test's header.
            cs.PresetOverlay.scheduleFindAndMount = () => {};
        }
        addedListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
        chrome.storage.onChanged.removeListener(relaySettingsChanged);
        restoreNotify();
        chrome.runtime.sendMessage = originalSendMessage;
        globalThis.ResizeObserver = originalResizeObserver;
        Object.keys(DESKTOP).forEach((key) => delete navigator[key]);
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        setPathname('/');
    });

    it('a group picked on a new chat binds the chat DeepSeek creates after an Enter send', async () => {
        await seed();
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, G.id);
        await settle();
        expect(shownValue(overlay), 'sanity: G is shown on the new chat').toBe(G.id);

        const { ta } = pressEnter('first message');
        expect(ta.value, 'sanity: the send carries G').toContain('PREFIX-G');
        setPathname(`${NEW_CHAT}/${CREATED}`);
        await cs.handleChatChange();
        await settle();

        expect(binds(), 'the created chat is bound to G through the SW writer').toEqual([{ uuid: CREATED, presetId: G.id }]);
        expect(shownValue(overlay), 'the overlay keeps showing G for the created chat').toBe(G.id);
        expect(injected(), 'the next send in the created chat still carries G').toContain('PREFIX-G');
    });

    it('a pick in an open chat binds that chat to the picked group', async () => {
        await seed({ map: { [X]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(`${NEW_CHAT}/${X}`);
        expect(shownValue(overlay), 'sanity: chat X opens on its bound group A').toBe(A.id);

        clickOption(overlay, B.id);
        await settle();

        expect(binds(), 'the pick dispatches BIND(X, B)').toEqual([{ uuid: X, presetId: B.id }]);
        expect(storedMap[X], 'chat X is stored as bound to B').toBe(B.id);
        expect(injected(), 'the next send in chat X carries B').toContain('PREFIX-B');
        expect(injected(), 'the next send in chat X no longer carries A').not.toContain('PREFIX-A');
    });

    it('a remounted overlay on a bound chat shows the group that chat is bound to', async () => {
        await seed({ map: { [X]: A.id, [Y]: B.id } });
        appendHeader();
        const overlay = await loadContentScript(`${NEW_CHAT}/${X}`);
        expect(shownValue(overlay), 'sanity: chat X opens on its bound group A').toBe(A.id);

        await rerenderHeader(overlay);

        expect(shownValue(overlay), 'the remounted overlay shows A, the group chat X is bound to').toBe(A.id);
    });

    it('a remounted overlay on a new chat keeps showing the group picked before the first send', async () => {
        await seed();
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, G.id);
        await settle();
        expect(shownValue(overlay), 'sanity: G is shown on the new chat').toBe(G.id);

        await rerenderHeader(overlay);

        expect(shownValue(overlay), 'the remounted overlay still shows the pending group G').toBe(G.id);
        expect(injected(), 'and the send still carries G').toContain('PREFIX-G');
    });

    it.each([
        [true, ''],
        [false, 'none'],
    ])('a remounted overlay follows the master switch (isEnabled %s, display "%s")', async (isEnabled, display) => {
        await seed({ map: { [X]: A.id }, settings: { isEnabled } });
        appendHeader();
        const overlay = await loadContentScript(`${NEW_CHAT}/${X}`);

        await rerenderHeader(overlay);

        expect(overlay.wrapperEl.style.display, isEnabled ? 'master switch on: the remounted overlay is visible' : 'master switch off: the remounted overlay is hidden').toBe(display);
    });

    it('one Enter send reaches the page once and carries the prefix exactly once', async () => {
        await seed({ map: { [X]: A.id } });
        await loadContentScript(`${NEW_CHAT}/${X}`);

        const { pageEnters } = pressEnter('hello');
        await wait(200);

        expect(pageEnters.length, 'the page Enter handler receives exactly one Enter, the re-dispatched one').toBe(1);
        expect(count(pageEnters[0], 'PREFIX-A'), 'the text the page sends carries the prefix once').toBe(1);
        expect(count(pageEnters[0], '<system-reminder>'), 'the text the page sends carries one prefix block').toBe(1);
    });

    it('with system time on in storage, a send carries exactly one "Current Time:" line', async () => {
        await seed({ settings: { [StorageManager.KEYS.SHOW_SYSTEM_TIME]: true } });
        await loadContentScript(NEW_CHAT);

        const text = injected('hello');

        expect(text.match(/^Current Time: .+$/gm)?.length ?? 0, `exactly one timestamp line in ${JSON.stringify(text)}`).toBe(1);
        expect(text, 'the user text is kept').toContain('hello');
    });

    it('the overlay repositions on a container resize while the context is valid and stops observing once it is invalidated', async () => {
        const observers = [];
        globalThis.ResizeObserver = class {
            constructor(callback) { this.callback = callback; this.targets = []; this.isDisconnected = false; observers.push(this); }
            observe(target) { this.targets.push(target); }
            unobserve() {}
            disconnect() { this.isDisconnected = true; }
        };
        await seed({ map: { [X]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(`${NEW_CHAT}/${X}`);
        await wait(600);
        const observer = observers.find((o) => o.targets.includes(overlay.targetEl) && !o.isDisconnected);
        expect(observer, 'precondition: the mounted overlay observes its container').toBeTruthy();

        // Sentinel: placement writes visibility '' or 'hidden', never 'collapse'.
        overlay.wrapperEl.style.visibility = 'collapse';
        observer.callback([], observer);
        await wait(100);
        expect(overlay.wrapperEl.style.visibility, 'a resize while the context is valid repositions the overlay').not.toBe('collapse');
        expect(observer.isDisconnected, 'a resize while the context is valid keeps the observer').toBe(false);

        overlay.wrapperEl.style.visibility = 'collapse';
        chrome.runtime.id = undefined;
        observer.callback([], observer);
        await wait(100);
        chrome.runtime.id = 'test-extension-id';
        expect(observer.isDisconnected, 'a resize after invalidation disconnects the observer').toBe(true);
        expect(overlay.wrapperEl.style.visibility, 'a resize after invalidation does not reposition').toBe('collapse');
    });
});
