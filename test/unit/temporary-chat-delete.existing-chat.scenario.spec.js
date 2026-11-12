/**
 * Scenario: the temporary-conversation switch must never mark or delete an EXISTING conversation.
 *
 * Requirement (docs/FEATURES.md, Temporary Conversation): "Existing conversations opened from the
 * history list are never marked and never deleted -- even with the toggle on, entering and leaving
 * a history conversation does not delete it." Only a new conversation created from the homepage is
 * marked, and leaving it deletes it.
 *
 * Marking rule under test: a conversation U is temporary only when a create response in this page
 * load returned U AND the first message sent in U went out with the switch on, in either order.
 * Cases 7 to 9 drive the switch-change and repeated-send edges of that rule.
 *
 * Live facts this file encodes (POC capture 2026-11-08, scenarios S-A and S-B):
 *   - DeepSeek sends POST /api/v0/chat_session/create (body "{}") on EVERY page load and route
 *     change, conversation pages included; each response creates a different, empty session
 *     (id at data.biz_data.chat_session.id).
 *   - S-A (the bug): page loaded at an existing /a/chat/s/X, the user sent within about 1 s of load;
 *     the completion body carried chat_session_id X; the extension tracked X and deleted it on leave.
 *   - S-B (legit): on the homepage create returned N, the user sent, DeepSeek pushStated to
 *     /a/chat/s/N, fired another route create, then the completion (chat_session_id N); N was
 *     tracked and deleted on leave.
 *
 * User path driven: the REAL main-world hook (content/censor-xhr-hook.js + content/sse-parser.js)
 * runs against a fake XHR at the network trust boundary (test/helpers/deepseek-page-harness.js);
 * its window messages reach the REAL content modules (temporary-chat-delete entry, tracking,
 * coordinator, handlers, TemporaryChatEnabledFlag, TemporaryChatDeleteApi, DSSDeepSeekApi), which
 * share one real state object. Mocked trust boundaries only: chrome.runtime.sendMessage (settings
 * route + background messages), fetch (the delete request), window.navigation (an EventTarget the
 * harness fires navigate on before each pushState commits), and the outbound window.postMessage to the
 * MAIN-world fiber delete script. Route changes run through the REAL content/temporary-chat-history-hook.js.
 *
 * Observable outputs: DSS_TRACK_FOR_DELETION messages sent to background (which uuid), and delete
 * requests on leave -- a POST /api/v0/chat_session/delete fetch or a DSS_FIBER_DELETE_SESSION post.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import { bootDeepSeekPage } from '../helpers/deepseek-page-harness.js';
import { unloadHandOffs } from '../helpers/tab-unload-handoff.js';
import '../../utils/deepseek-api.js';
import RealDeleteApi from '../../content/temporary-chat-delete-api.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

globalThis.TemporaryChatDeleteApi = RealDeleteApi;

const X = 'da794fe0-243a-4ba5-817a-b88ff327e634'; // existing conversation (live S-A id)
const N = '26c81320-1ce0-4172-bd5e-cb5b7a55f332'; // session created by a create call
const N2 = 'a596cafc-7297-48fb-bf19-f20747ce7d98'; // session created by the route create after pushState
const Y = 'efe1f51f-b924-4170-bfdd-db050e0db38f'; // another existing conversation
const Z = 'cccccccc-1111-2222-3333-444444444444'; // a third conversation, leave target

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

/** Every uuid the content side asked background to track for deletion. */
function trackedUuids() {
    return chrome.runtime.sendMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.type === T().DSS_MSG_TRACK_FOR_DELETION)
        .map((message) => message.uuid);
}

/** Every delete request issued for uuid, over either delete channel. */
function deleteRequestsFor(uuid) {
    const fetches = fetchMock.mock.calls
        .filter(([url]) => String(url).includes('/api/v0/chat_session/delete'))
        .filter(([, init]) => JSON.parse(init.body).chat_session_id === uuid)
        .map(([, init]) => ({ channel: 'fetch', keepalive: init.keepalive }));
    const fiber = postMessageSpy.mock.calls
        .filter(([message]) => message?.type === T().DSS_FIBER_DELETE_MESSAGE_TYPE && message.sessionId === uuid)
        .map(() => ({ channel: 'fiber' }));
    return [...fetches, ...fiber];
}

/** Advance the fake clock to absolute time ms, relative to the scenario start. */
async function at(ms) {
    await vi.advanceTimersByTimeAsync(ms - clockMs);
    clockMs = ms;
}

/** A DeepSeek client-side route change (history-list click or new-chat URL commit), through the real history hook. */
function spaNavigate(path) {
    page.pushState(path);
}

const LEAVES = {
    'closing the tab (beforeunload)': async () => {
        window.dispatchEvent(new Event('beforeunload'));
        await at(clockMs + 10);
    },
    'SPA navigation to the homepage': async () => {
        spaNavigate('/');
        await at(clockMs + 3500); // past the fiber-delete fallback window
    },
    'SPA navigation to another conversation': async () => {
        spaNavigate('/a/chat/s/' + Z);
        await at(clockMs + 3500);
    },
};

/** Page load at path with the switch on or off: content script init, then the hook boots. */
async function loadPage(path, isSwitchOn) {
    setPathname(path);
    settingsStore[T().DSS_TEMP_CHAT_STORAGE_KEY] = isSwitchOn;
    await TemporaryChatDelete.init();
    page = bootDeepSeekPage(window);
}

beforeEach(() => {
    vi.useFakeTimers();
    clockMs = 0;
    TemporaryChatDelete.detachListeners();
    // The import-time auto init() already registered the resident session observer; drop it so every case depends on the listener its own init() registers.
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
    sessionStorage.clear();
    setPathname('/');
    chrome.runtime.sendMessage = vi.fn();
});

/** Live S-A: existing conversation X loaded, page-load create returns N, user sends to X at completionAtMs. */
async function sendOnExistingConversation(completionAtMs) {
    await loadPage('/a/chat/s/' + X, true);
    const create = page.createSession(N);
    await at(180);
    create.respond();
    await at(completionAtMs);
    const completion = page.sendCompletion(X);
    await at(completionAtMs + 150);
    completion.respond();
    await at(completionAtMs + 1500); // 1.5 s later: the outcome must not depend on any time window
}

describe('existing conversation opened with the switch on (live S-A)', () => {
    describe.each([
        ['case 1: completion 300 ms after the page-load create', 300],
        ['case 2: completion 900 ms after the page-load create', 900],
    ])('%s', (_label, completionAtMs) => {
        it('never tracks the existing conversation X', async () => {
            await sendOnExistingConversation(completionAtMs);

            expect(trackedUuids(), 'existing conversation X must never be sent as DSS_TRACK_FOR_DELETION').not.toContain(X);
            expect(sessionStorage.getItem(T().DSS_TEMP_CHAT_UUID_KEY), 'the tab must not remember X as its temporary conversation').not.toBe(X);
        });

        it.each(Object.keys(LEAVES))('issues no delete for X when leaving by %s', async (leave) => {
            await sendOnExistingConversation(completionAtMs);

            await LEAVES[leave]();

            expect(deleteRequestsFor(X), 'leaving existing conversation X must not delete it').toEqual([]);
        });
    });
});

describe('new conversation created from the homepage (controls, live S-B)', () => {
    /** Case 3 timeline, copied from live S-B: create, pushState to N, route create, completion N, route create response. */
    async function sendFromHomeCompletionAfterPushState() {
        await loadPage('/', true);
        const create = page.createSession(N);
        await at(174);
        create.respond();
        await at(356);
        spaNavigate('/a/chat/s/' + N);
        await at(386);
        const routeCreate = page.createSession(N2);
        await at(491);
        const completion = page.sendCompletion(N);
        await at(559);
        routeCreate.respond();
        await at(600);
        completion.respond();
        await at(2100);
    }

    /** Case 4: completion fires while the URL is still the homepage, pushState to N follows. */
    async function sendFromHomeCompletionBeforePushState() {
        await loadPage('/', true);
        const create = page.createSession(N);
        await at(174);
        create.respond();
        await at(300);
        const completion = page.sendCompletion(N);
        await at(400);
        spaNavigate('/a/chat/s/' + N);
        await at(430);
        const routeCreate = page.createSession(N2);
        await at(450);
        completion.respond();
        await at(600);
        routeCreate.respond();
        await at(2100);
    }

    describe.each([
        ['case 3: pushState to N, then completion for N', sendFromHomeCompletionAfterPushState],
        ['case 4: completion for N on the homepage, then pushState to N', sendFromHomeCompletionBeforePushState],
    ])('%s', (_label, scenario) => {
        it('tracks the new conversation N and not the unvisited route-create session N2', async () => {
            await scenario();

            expect(trackedUuids(), 'new conversation N must be tracked for deletion').toContain(N);
            expect(trackedUuids(), 'the route-create session N2 was never visited and must not be tracked').not.toContain(N2);
        });

        it.each(Object.keys(LEAVES))('requests deletion of N, in-page or through the service worker, when leaving by %s', async (leave) => {
            await scenario();

            await LEAVES[leave]();

            expect(deleteRequestsFor(N).length + unloadHandOffs(chrome.runtime.sendMessage, N).length, 'leaving new temporary conversation N must request its deletion (a tab close hands it to the service worker)').toBeGreaterThan(0);
        });
    });
});

describe('case 5: an unfinished homepage send must not mark the next existing conversation', () => {
    /** Home: create N, completion for N with the URL still at the homepage, no pushState to N; later the user opens existing Y. */
    async function openExistingAfterUnfinishedHomeSend() {
        await loadPage('/', true);
        const create = page.createSession(N);
        await at(180);
        create.respond();
        await at(300);
        const completion = page.sendCompletion(N);
        await at(450);
        completion.respond();
        await at(2300);
        spaNavigate('/a/chat/s/' + Y);
        await at(3800);
    }

    it('never tracks the existing conversation Y', async () => {
        await openExistingAfterUnfinishedHomeSend();

        expect(trackedUuids(), 'existing conversation Y must never be sent as DSS_TRACK_FOR_DELETION').not.toContain(Y);
    });

    it.each(Object.keys(LEAVES))('issues no delete for Y when leaving by %s', async (leave) => {
        await openExistingAfterUnfinishedHomeSend();

        await LEAVES[leave]();

        expect(deleteRequestsFor(Y), 'leaving existing conversation Y must not delete it').toEqual([]);
    });
});

describe('case 6: switch off', () => {
    async function sendOnExistingConversationSwitchOff() {
        await loadPage('/a/chat/s/' + X, false);
        const create = page.createSession(N);
        await at(180);
        create.respond();
        await at(300);
        const completion = page.sendCompletion(X);
        await at(450);
        completion.respond();
        await at(1800);
    }

    it('tracks nothing', async () => {
        await sendOnExistingConversationSwitchOff();

        expect(trackedUuids()).toEqual([]);
    });

    it.each(Object.keys(LEAVES))('issues no delete for X when leaving by %s', async (leave) => {
        await sendOnExistingConversationSwitchOff();

        await LEAVES[leave]();

        expect(deleteRequestsFor(X)).toEqual([]);
    });
});

/** The user flips the in-page temporary-conversation switch (content/temporary-chat-toggle.js dispatches this event). */
function flipSwitch(isOn) {
    window.dispatchEvent(new CustomEvent(T().DSS_TEMP_CHAT_CHANGED_EVENT, { detail: { isEnabled: isOn } }));
}

describe('case 7: switch turned on after the page-load create, then the first send in the new session', () => {
    /** Home with the switch off: page-load create returns N; the user turns the switch on, then sends the first message. */
    async function switchOnAfterPageLoadCreate() {
        await loadPage('/', false);
        const create = page.createSession(N);
        await at(180);
        create.respond();
        await at(1200);
        flipSwitch(true);
        await at(1500);
        const completion = page.sendCompletion(N);
        await at(1600);
        spaNavigate('/a/chat/s/' + N);
        await at(1630);
        const routeCreate = page.createSession(N2);
        await at(1700);
        completion.respond();
        await at(1800);
        routeCreate.respond();
        await at(3300);
    }

    it('tracks the new conversation N and not the route-create session N2', async () => {
        await switchOnAfterPageLoadCreate();

        expect(trackedUuids(), 'N was created by this page load and first sent with the switch on').toContain(N);
        expect(trackedUuids()).not.toContain(N2);
    });

    // The content script holds the token the page posted at load, while the switch was off (resident capture), so an SPA leave deletes N in-page.
    // A tab close sends the unload message (DSS_MSG_TAB_UNLOADING) and the no-token path sends DSS_SCHEDULE_DELETE_RETRY; both hand N to the service worker for deletion.
    it.each(Object.keys(LEAVES))('requests deletion of N, in-page or through the service worker, when leaving by %s', async (leave) => {
        await switchOnAfterPageLoadCreate();

        await LEAVES[leave]();

        const handedToServiceWorker = chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message?.type === T().DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE && message.chatUuid === N);
        expect(deleteRequestsFor(N).length + handedToServiceWorker.length + unloadHandOffs(chrome.runtime.sendMessage, N).length, 'leaving new temporary conversation N must request its deletion').toBeGreaterThan(0);
    });
});

describe('case 8: conversation started with the switch off, switched on mid-way, another message sent', () => {
    /** Home with the switch off: create N, first send in N, pushState to N; later the user turns the switch on and sends again in N. */
    async function switchOnMidConversation() {
        await loadPage('/', false);
        const create = page.createSession(N);
        await at(180);
        create.respond();
        await at(300);
        const first = page.sendCompletion(N);
        await at(400);
        spaNavigate('/a/chat/s/' + N);
        await at(430);
        const routeCreate = page.createSession(N2);
        await at(450);
        first.respond();
        await at(600);
        routeCreate.respond();
        await at(2000);
        flipSwitch(true);
        await at(2500);
        const second = page.sendCompletion(N);
        await at(2650);
        second.respond();
        await at(4000);
    }

    it('never tracks N', async () => {
        await switchOnMidConversation();

        expect(trackedUuids(), 'the first message in N went out with the switch off, so N is a normal conversation').not.toContain(N);
    });

    it.each(Object.keys(LEAVES))('issues no delete for N when leaving by %s', async (leave) => {
        await switchOnMidConversation();

        await LEAVES[leave]();

        expect(deleteRequestsFor(N), 'leaving N must not delete a conversation started with the switch off').toEqual([]);
    });
});

describe('case 9: repeated sends in the temporary conversation mark it once', () => {
    /** Home with the switch on: create N, first send on the homepage, pushState to N, then two more sends in N. */
    async function firstSendBeforePushStateThenTwoMore() {
        await loadPage('/', true);
        const create = page.createSession(N);
        await at(174);
        create.respond();
        await at(300);
        const first = page.sendCompletion(N);
        await at(400);
        spaNavigate('/a/chat/s/' + N);
        await at(430);
        const routeCreate = page.createSession(N2);
        await at(450);
        first.respond();
        await at(600);
        routeCreate.respond();
        await at(3000);
        page.sendCompletion(N).respond();
        await at(6000);
        page.sendCompletion(N).respond();
        await at(7000);
    }

    /** Home with the switch on: create N, pushState to N, then three sends in N. */
    async function pushStateThenThreeSends() {
        await loadPage('/', true);
        const create = page.createSession(N);
        await at(174);
        create.respond();
        await at(356);
        spaNavigate('/a/chat/s/' + N);
        await at(386);
        const routeCreate = page.createSession(N2);
        await at(491);
        const first = page.sendCompletion(N);
        await at(559);
        routeCreate.respond();
        await at(600);
        first.respond();
        await at(3000);
        page.sendCompletion(N).respond();
        await at(6000);
        page.sendCompletion(N).respond();
        await at(7000);
    }

    it.each([
        ['first send on the homepage, then pushState to N, then two more sends', firstSendBeforePushStateThenTwoMore],
        ['pushState to N, then three sends', pushStateThenThreeSends],
    ])('%s: DSS_TRACK_FOR_DELETION for N is sent exactly once', async (_label, scenario) => {
        await scenario();

        expect(trackedUuids().filter((uuid) => uuid === N)).toEqual([N]);
        expect(trackedUuids()).not.toContain(N2);
    });
});
