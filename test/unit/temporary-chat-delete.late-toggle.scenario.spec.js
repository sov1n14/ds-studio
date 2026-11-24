/**
 * Scenario: the temporary-conversation switch turned on AFTER the DeepSeek page loaded.
 *
 * User-ruled requirement (verbatim): "after opening a temporary conversation, switching conversations, switching tabs, or redirecting pages must clear the page. Existing conversations should not be cleared, and refreshing the page should not clear it." Clarified: "switching tabs" means closing the tab; switching to another browser tab must NOT delete.
 *
 * User-ruled requirement on the page token: while the switch is off, the token stays in this tab's memory; it is not sent to the service worker and not written to storage. The moment the switch is turned on, the tab hands the held token to the service worker (DSS_SET_LAST_AUTH_TOKEN). With the switch on from load, the token is handed over when the page posts it.
 *
 * Live facts this file encodes: DeepSeek sends POST /api/v0/chat_session/create with the authorization header on every page load, so the MAIN-world hook captures the token and posts DSS_AUTH_CAPTURED during page load. The hook posts it again only when the token value changes, so a later request with the same token posts nothing. A user who turns the switch on after load therefore turns it on after the only DSS_AUTH_CAPTURED of the page load was posted.
 *
 * User path driven: the REAL main-world hook (content/censor-xhr-hook.js) and history hook run against a fake XHR through test/helpers/deepseek-page-harness.js; their window messages reach the REAL content modules (temporary-chat-delete family, TemporaryChatEnabledFlag, TemporaryChatDeleteApi, DSSDeepSeekApi) sharing one real state object. Mocked trust boundaries only: chrome.runtime.sendMessage, fetch (the delete request), window.navigation (an EventTarget), document.visibilityState, and the outbound window.postMessage (swallowed; the harness has no MAIN-world receiver for it).
 *
 * Observable outputs: runtime messages carrying the page token (DSS_SET_LAST_AUTH_TOKEN), the unload hand-off to the service worker (DSS_TEMP_CHAT.DSS_MSG_TAB_UNLOADING), and delete requests for a uuid (POST /api/v0/chat_session/delete fetch, its keepalive flag and authorization header, or a DSS_FIBER_DELETE_SESSION post). Each late-toggle leave is paired with the same leave after an early toggle (switch on at load), so the late path is held to the shape the working path produces.
 *
 * 瀏覽器工具列的重新整理按鈕不觸發 navigate 事件，也沒有 keydown，頁面只看得到 beforeunload，與關閉分頁相同。所以 beforeunload 一律不從頁面刪除，而是把追蹤中的對話交給 service worker，由它在寬限期後決定（test/unit/service-worker.unload-grace.scenario.spec.js）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import { bootDeepSeekPage, AUTH_TOKEN } from '../helpers/deepseek-page-harness.js';
import { unloadHandOffs, unloadHandOff } from '../helpers/tab-unload-handoff.js';
import '../../utils/deepseek-api.js';
import RealDeleteApi from '../../content/temporary-chat-delete-api.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

globalThis.TemporaryChatDeleteApi = RealDeleteApi;

const U = '26c81320-1ce0-4172-bd5e-cb5b7a55f332'; // new temporary conversation, created by the page-load create
const U2 = 'a596cafc-7297-48fb-bf19-f20747ce7d98'; // session created by the route create after pushState
const X = 'da794fe0-243a-4ba5-817a-b88ff327e634'; // existing conversation
const T = () => globalThis.DSS_TEMP_CHAT;

let settingsStore;
let fetchMock;
let postMessageSpy;
let page;
let clockMs = 0;

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

/** Delete fetches for uuid, with the flags that decide whether they survive unload. */
function deleteFetchesFor(uuid) {
    return fetchMock.mock.calls
        .filter(([url]) => String(url).includes('/api/v0/chat_session/delete'))
        .filter(([, init]) => JSON.parse(init.body).chat_session_id === uuid)
        .map(([, init]) => ({ keepalive: init.keepalive, authorization: init.headers?.authorization }));
}

/** Every delete request issued for uuid, over either delete channel. */
function deleteRequestsFor(uuid) {
    const fiber = postMessageSpy.mock.calls
        .filter(([message]) => message?.type === T().DSS_FIBER_DELETE_MESSAGE_TYPE && message.sessionId === uuid)
        .map(() => ({ channel: 'fiber' }));
    return [...deleteFetchesFor(uuid).map((f) => ({ channel: 'fetch', ...f })), ...fiber];
}

async function at(ms) {
    await vi.advanceTimersByTimeAsync(ms - clockMs);
    clockMs = ms;
}

/** The user flips the in-page switch (content/temporary-chat-toggle.js dispatches this event). */
function flipSwitch(isOn) {
    window.dispatchEvent(new CustomEvent(T().DSS_TEMP_CHAT_CHANGED_EVENT, { detail: { isEnabled: isOn } }));
}

async function loadPage(path, isSwitchOn) {
    setPathname(path);
    settingsStore[T().DSS_TEMP_CHAT_STORAGE_KEY] = isSwitchOn;
    await TemporaryChatDelete.init();
    page = bootDeepSeekPage(window);
}

/**
 * Homepage load; the page-load create returns U (the hook captures the token here). With isLate the switch is off at load and turned on at 1200 ms; otherwise it is on from load. Then the first send in U, pushState to U, route create U2 (live S-B order).
 */
async function openTemporaryConversation(isLate) {
    await loadPage('/', !isLate);
    const create = page.createSession(U);
    await at(180);
    create.respond();
    await at(1200);
    if (isLate) flipSwitch(true);
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
}

function dispatchNavigate(destinationUrl, navigationType, extra = {}) {
    window.navigation.dispatchEvent(Object.assign(new Event('navigate', { cancelable: true }), { destination: { url: destinationUrl }, navigationType, hashChange: false, ...extra }));
}

async function beforeUnload() {
    window.dispatchEvent(new Event('beforeunload'));
    await at(clockMs + 10);
}

const CLOSE_TAB = 'closing the tab (beforeunload, no reload signal)';
const NAVIGATE_AWAY = 'full-page navigation away by a link (cross-document navigate push, then beforeunload)';

/** Leaves after which U must be deleted: in-page on a navigation away, by the service worker after a tab close. */
const DELETING_LEAVES = {
    [CLOSE_TAB]: beforeUnload,
    [NAVIGATE_AWAY]: async () => {
        dispatchNavigate('https://www.deepseek.com/', 'push', { canIntercept: false, userInitiated: true });
        await beforeUnload();
    },
};

/** Leaves that must keep U. */
const KEEPING_LEAVES = {
    'F5 reload (keydown F5, then beforeunload)': async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
        await beforeUnload();
    },
    'Ctrl+R reload (keydown Ctrl+R, then beforeunload)': async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true }));
        await beforeUnload();
    },
    // 真實的工具列重新整理：只有 beforeunload，沒有 navigate 事件，也沒有 keydown
    'reload button (beforeunload only: the browser fires no navigate event and no keydown)': beforeUnload,
    'switching to another browser tab (visibilitychange to hidden)': async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        await at(clockMs + 3500);
    },
};

beforeEach(() => {
    vi.useFakeTimers();
    clockMs = 0;
    TemporaryChatDelete.detachListeners();
    window.removeEventListener('message', TemporaryChatDelete.handleSessionMessage);
    Object.assign(TemporaryChatDelete.state, globalThis.__DSS_TempChatDelete_tracking.createState());
    sessionStorage.clear();
    settingsStore = {};
    installBackground();
    window.navigation = new EventTarget();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    TemporaryChatDelete.detachListeners();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.navigation;
    delete document.visibilityState;
    delete document.hidden;
    sessionStorage.clear();
    setPathname('/');
    chrome.runtime.sendMessage = vi.fn();
});

describe.each([
    ['early toggle (control: switch on at page load)', false],
    ['late toggle (switch turned on after page load)', true],
])('%s', (_label, isLate) => {
    it('hands U to the service worker without deleting it from the page when the tab is closed (beforeunload, no reload signal)', async () => {
        await openTemporaryConversation(isLate);

        await DELETING_LEAVES[CLOSE_TAB]();

        expect(deleteRequestsFor(U), 'the page must not delete U on unload; the service worker decides after its grace period').toEqual([]);
        expect(unloadHandOffs(chrome.runtime.sendMessage), 'closing the tab must send exactly one unload message, carrying U').toEqual([unloadHandOff(U)]);
    });

    // The early-toggle path deletes U in-page on the navigate event (a DSS_FIBER_DELETE_SESSION post); the late-toggle path must issue an in-page delete too.
    it('issues an in-page delete for U on a full-page navigation away by a link (cross-document navigate push, then beforeunload)', async () => {
        await openTemporaryConversation(isLate);

        await DELETING_LEAVES[NAVIGATE_AWAY]();

        expect(deleteRequestsFor(U), 'navigating the page away must issue a delete request for U from the page (fetch or fiber delete)').not.toEqual([]);
    });

    it.each(Object.keys(KEEPING_LEAVES))('issues no delete for U on %s', async (leave) => {
        await openTemporaryConversation(isLate);

        await KEEPING_LEAVES[leave]();

        expect(deleteRequestsFor(U), 'a reload or a tab switch must keep temporary conversation U').toEqual([]);
        expect(sessionStorage.getItem(T().DSS_TEMP_CHAT_UUID_KEY), 'the tab must still remember U as its temporary conversation').toBe(U);
    });
});

/** DSS_SET_LAST_AUTH_TOKEN messages sent to the service worker, from runtime-message call index fromCall on. */
function tokenRelays(fromCall = 0) {
    return chrome.runtime.sendMessage.mock.calls.slice(fromCall).map(([message]) => message).filter((message) => message?.type === 'DSS_SET_LAST_AUTH_TOKEN');
}

/** Every runtime message whose content includes the page token, whatever its type. */
function messagesCarryingToken() {
    return chrome.runtime.sendMessage.mock.calls.map(([message]) => message).filter((message) => JSON.stringify(message ?? null).includes(AUTH_TOKEN));
}

/** Homepage load; the page-load create returns U, so the hook posts the page token once. */
async function loadHomepageWithPageToken(isSwitchOn) {
    await loadPage('/', isSwitchOn);
    const create = page.createSession(U);
    await at(180);
    create.respond();
    await at(1200);
}

describe('page token hand-off to the service worker', () => {
    it('switch off at load: the token the page posted reaches no runtime message (it stays in the tab)', async () => {
        await loadHomepageWithPageToken(false);

        expect(messagesCarryingToken(), 'with the switch off, no runtime message may carry the page token').toEqual([]);
    });

    it('switch turned on after the page posted the token: the held token is relayed once via DSS_SET_LAST_AUTH_TOKEN at switch-on', async () => {
        await loadHomepageWithPageToken(false);
        const callsBeforeSwitchOn = chrome.runtime.sendMessage.mock.calls.length;

        flipSwitch(true);
        await at(1300);

        expect(tokenRelays(callsBeforeSwitchOn), 'turning the switch on must hand the held page token to the service worker exactly once').toEqual([{ type: 'DSS_SET_LAST_AUTH_TOKEN', token: AUTH_TOKEN }]);
    });

    it('switch on from load: the token is relayed once via DSS_SET_LAST_AUTH_TOKEN when the page posts it', async () => {
        await loadHomepageWithPageToken(true);

        expect(tokenRelays(), 'with the switch on, the page token must reach the service worker when the page posts it').toEqual([{ type: 'DSS_SET_LAST_AUTH_TOKEN', token: AUTH_TOKEN }]);
    });
});

describe('late toggle on an existing conversation opened before the switch', () => {
    /** Existing X loaded with the switch off (page-load create returns U, token captured); switch turned on; the user sends in X. */
    async function sendInExistingAfterLateToggle() {
        await loadPage('/a/chat/s/' + X, false);
        const create = page.createSession(U);
        await at(180);
        create.respond();
        await at(1200);
        flipSwitch(true);
        await at(1500);
        const completion = page.sendCompletion(X);
        await at(1650);
        completion.respond();
        await at(3200);
    }

    it.each(Object.keys(DELETING_LEAVES))('never deletes X when leaving by %s', async (leave) => {
        await sendInExistingAfterLateToggle();

        await DELETING_LEAVES[leave]();

        expect(deleteRequestsFor(X), 'existing conversation X must never be deleted').toEqual([]);
        expect(unloadHandOffs(chrome.runtime.sendMessage, X), 'existing conversation X must never be handed to the service worker').toEqual([]);
    });
});
