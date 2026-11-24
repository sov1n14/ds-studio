/**
 * Resident page-token capture on a freshly loaded content script (v4.39.9).
 *
 * Requirement (user ruling, quoted in test/unit/temporary-chat-delete.late-toggle.scenario.spec.js): while the temporary-conversation switch is off, the token the page posts stays in this tab's memory; turning the switch on hands it to the service worker once (DSS_SET_LAST_AUTH_TOKEN), and closing the tab afterwards hands the temporary conversation to the service worker (DSS_TEMP_CHAT.DSS_MSG_TAB_UNLOADING), which deletes it with that token after its grace period; the page itself sends no delete on unload. Only messages posted by this window are trusted: a message posted by another frame must never cause a token relay.
 *
 * Why every case loads the entry inside the test body: the main-world hook posts DSS_AUTH_CAPTURED only when the token value changes, so the capture that matters happens at page load, through listeners that the entry's load-time init() attaches. A spec that static-imports content/temporary-chat-delete.js keeps the import-time listeners of that one instance alive for the whole file, so a later init() call that fails to attach its listener is masked by the stale one. Here each case runs vi.resetModules() and imports the entry, so its auto-start init() is the only init of the instance under test, and afterEach removes every window listener attached during the case, so no listener of an earlier instance can hold a token for a later one.
 *
 * Page side: the REAL main-world hook through test/helpers/deepseek-page-harness.js. Mocked trust boundaries only: chrome.runtime.sendMessage, fetch (the delete request), window.navigation (an EventTarget), the outbound window.postMessage (swallowed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import { bootDeepSeekPage, AUTH_TOKEN } from '../helpers/deepseek-page-harness.js';
import { unloadHandOffs, unloadHandOff } from '../helpers/tab-unload-handoff.js';
import '../../utils/deepseek-api.js';
import RealDeleteApi from '../../content/temporary-chat-delete-api.js';

globalThis.TemporaryChatDeleteApi = RealDeleteApi;

const U = '26c81320-1ce0-4172-bd5e-cb5b7a55f332'; // new temporary conversation, created by the page-load create
const U2 = 'a596cafc-7297-48fb-bf19-f20747ce7d98'; // session created by the route create after pushState
const FORGED_TOKEN = 'Bearer forged-by-another-frame';
const T = () => globalThis.DSS_TEMP_CHAT;

let settingsStore;
let fetchMock;
let instance;
let page;
let windowListeners;
let savedFlag;
let clockMs;

function installBackground() {
    chrome.runtime.sendMessage = vi.fn(async (message) => {
        if (message?.type === globalThis.DSS_SETTINGS_MSG.GET_SETTINGS) {
            const values = {};
            (message.keys || []).forEach((key) => {
                if (key in settingsStore) values[key] = settingsStore[key];
            });
            return { ok: true, values };
        }
        return { ok: true };
    });
}

/** DSS_SET_LAST_AUTH_TOKEN messages sent to the service worker, from runtime-message call index fromCall on. */
function tokenRelays(fromCall = 0) {
    return chrome.runtime.sendMessage.mock.calls.slice(fromCall).map(([message]) => message).filter((message) => message?.type === 'DSS_SET_LAST_AUTH_TOKEN');
}

/** Delete fetches for uuid, with the flags that decide whether they survive unload. */
function deleteFetchesFor(uuid) {
    return fetchMock.mock.calls
        .filter(([url]) => String(url).includes('/api/v0/chat_session/delete'))
        .filter(([, init]) => JSON.parse(init.body).chat_session_id === uuid)
        .map(([, init]) => ({ keepalive: init.keepalive, authorization: init.headers?.authorization }));
}

async function at(ms) {
    await vi.advanceTimersByTimeAsync(ms - clockMs);
    clockMs = ms;
}

/** The user flips the in-page switch (content/temporary-chat-toggle.js dispatches this event). */
function flipSwitch(isOn) {
    window.dispatchEvent(new CustomEvent(T().DSS_TEMP_CHAT_CHANGED_EVENT, { detail: { isEnabled: isOn } }));
}

/** A page load: a fresh content-script instance (its auto-start init() runs here), then the DeepSeek page boots. */
async function loadFreshPage(path, isSwitchOn) {
    setPathname(path);
    settingsStore[T().DSS_TEMP_CHAT_STORAGE_KEY] = isSwitchOn;
    vi.resetModules();
    await import('../../content/temporary-chat-enabled-flag.js');
    instance = (await import('../../content/temporary-chat-delete.js')).default;
    // init() reads the switch through the settings route (an async runtime message); let it settle on real timers
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(instance.readEnabledFlag(), 'precondition: the fresh instance read the switch state of this page load').toBe(isSwitchOn);
    expect(instance.state.capturedAuthToken, 'precondition: the fresh instance holds no token before the page posts one').toBeNull();
    vi.useFakeTimers();
    page = bootDeepSeekPage(window);
}

/** Homepage load; the page-load create returns U, so the hook posts the page token once (at 180 ms). */
async function loadHomepageWithPageToken(isSwitchOn) {
    await loadFreshPage('/', isSwitchOn);
    const create = page.createSession(U);
    await at(180);
    create.respond();
    await at(1200);
}

beforeEach(() => {
    clockMs = 0;
    settingsStore = {};
    sessionStorage.clear();
    installBackground();
    window.navigation = new EventTarget();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    savedFlag = globalThis.TemporaryChatEnabledFlag;
    // Record every window listener attached during the case, so afterEach can remove the resident ones the entry never detaches
    windowListeners = [];
    const addListener = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation(function (type, listener, options) {
        windowListeners.push([type, listener, options]);
        return addListener.call(this, type, listener, options);
    });
});

afterEach(() => {
    instance?.detachListeners();
    windowListeners.forEach(([type, listener, options]) => window.removeEventListener(type, listener, options));
    instance = null;
    globalThis.TemporaryChatEnabledFlag = savedFlag;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.navigation;
    document.body.innerHTML = '';
    sessionStorage.clear();
    setPathname('/');
    chrome.runtime.sendMessage = vi.fn();
});

describe('switch off at page load, turned on after the page posted its token (fresh content-script load)', () => {
    it('turning the switch on relays the page token held since page load, once, via DSS_SET_LAST_AUTH_TOKEN', async () => {
        await loadHomepageWithPageToken(false);
        expect(tokenRelays(), 'with the switch off, the page token must stay in the tab').toEqual([]);
        const callsBeforeSwitchOn = chrome.runtime.sendMessage.mock.calls.length;

        flipSwitch(true);
        await at(1300);

        expect(tokenRelays(callsBeforeSwitchOn), 'turning the switch on must hand the token the page posted at load to the service worker exactly once').toEqual([{ type: 'DSS_SET_LAST_AUTH_TOKEN', token: AUTH_TOKEN }]);
    });

    it('closing the tab after the late switch-on hands U to the service worker, which already holds the page token, and deletes nothing from the page', async () => {
        await loadHomepageWithPageToken(false);
        flipSwitch(true);
        await at(1500);
        const completion = page.sendCompletion(U);
        await at(1600);
        page.pushState('/a/chat/s/' + U);
        await at(1630);
        const routeCreate = page.createSession(U2);
        await at(1700);
        completion.respond();
        await at(1800);
        routeCreate.respond();
        await at(3300);

        window.dispatchEvent(new Event('beforeunload'));
        await at(3310);

        expect(tokenRelays(), 'the service worker received the page token once, at the switch-on, so it can delete U later').toEqual([{ type: 'DSS_SET_LAST_AUTH_TOKEN', token: AUTH_TOKEN }]);
        expect(deleteFetchesFor(U), 'the page must not delete U on unload; the service worker decides after its grace period').toEqual([]);
        expect(unloadHandOffs(chrome.runtime.sendMessage), 'closing the tab must send exactly one unload message, carrying U').toEqual([unloadHandOff(U)]);
    });
});

describe('messages posted by another frame (switch on from load)', () => {
    it('a DSS_AUTH_CAPTURED posted by another frame relays nothing: no runtime message after it carries any token', async () => {
        await loadHomepageWithPageToken(true);
        expect(tokenRelays(), 'precondition: with the switch on, the page token was relayed once when the page posted it').toEqual([{ type: 'DSS_SET_LAST_AUTH_TOKEN', token: AUTH_TOKEN }]);
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        expect(frame.contentWindow, 'precondition: the frame is a different window from the content-script window').not.toBe(window);
        const callsBeforeFrameMessage = chrome.runtime.sendMessage.mock.calls.length;

        window.dispatchEvent(new MessageEvent('message', { data: { type: T().DSS_AUTH_CAPTURED_TYPE, authorization: FORGED_TOKEN }, source: frame.contentWindow }));
        await at(1300);

        expect(tokenRelays(callsBeforeFrameMessage), 'a message from another frame must not trigger any DSS_SET_LAST_AUTH_TOKEN, neither of its own token nor of the held page token').toEqual([]);
    });
});
