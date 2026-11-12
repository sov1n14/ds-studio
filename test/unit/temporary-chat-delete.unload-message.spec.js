/**
 * 情境：分頁卸載（beforeunload）時，content script 把追蹤中的臨時對話交給 service worker，不再自己刪除。
 *
 * 使用者裁示（原文）："The browser's refresh button deletes temporary conversations." This is inherently unexpected behavior; refreshing should not clear temporary conversations.
 *
 * 瀏覽器工具列的重新整理按鈕既不觸發 Navigation API 的 navigate 事件，也沒有 F5 / Ctrl+R 的 keydown，頁面只看得到 beforeunload，與關閉分頁無從分辨。因此需求是：追蹤中的臨時對話 S 在 beforeunload 時送出一則 runtime 訊息 { type: DSS_TEMP_CHAT.DSS_MSG_TAB_UNLOADING, uuid: S }（有無 token 皆同），頁面不發任何刪除請求，sessionStorage 的追蹤保留；由 service worker 等寬限期決定是否刪除（見 test/unit/service-worker.unload-grace.scenario.spec.js）。重新整理後的新頁面以同一份 sessionStorage 還原 S 並送出 DSS_HEARTBEAT 認領。
 *
 * 不送交接訊息的情況（行為未變，作為守門）：網址不是追蹤中的對話、沒有追蹤、F5 / Ctrl+R keydown 之後、dss-intentional-reload 之後。
 *
 * 真實模組：temporary-chat-delete 全家（vitest.setup.js 預載）、content/temporary-chat-delete-api.js、utils/deepseek-api.js、content/temporary-chat-heartbeat.js，共用同一個 state。事件一律派送到 window / document，走真的監聽器。只替換信任邊界：chrome.runtime.sendMessage（含設定路由）、fetch、window.navigation（EventTarget，本檔從不派送 navigate）、往 MAIN world 的 window.postMessage（吞掉並記錄）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPathname } from '../helpers/set-pathname.js';
import { unloadHandOffs, unloadHandOff } from '../helpers/tab-unload-handoff.js';
import '../../utils/deepseek-api.js';
import RealDeleteApi from '../../content/temporary-chat-delete-api.js';
import '../../content/temporary-chat-heartbeat.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

globalThis.TemporaryChatDeleteApi = RealDeleteApi;

const S = '26c81320-1ce0-4172-bd5e-cb5b7a55f332'; // 追蹤中的臨時對話
const O = 'efe1f51f-b924-4170-bfdd-db050e0db38f'; // 未追蹤的其他對話
const TOKEN = 'Bearer unload-token';
const T = () => globalThis.DSS_TEMP_CHAT;
const UUID_KEY = () => T().DSS_TEMP_CHAT_UUID_KEY;

let settingsStore;
let fetchMock;
let postMessageSpy;

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

/** 頁面發出的每個刪除請求（DeepSeek 刪除端點的 fetch 或 MAIN world 的 fiber 刪除），不分 uuid。 */
function pageDeleteRequests() {
    const fetches = fetchMock.mock.calls
        .filter(([url]) => String(url).includes('/api/v0/chat_session/delete'))
        .map(([, init]) => ({ channel: 'fetch', body: init.body }));
    const fiber = postMessageSpy.mock.calls
        .filter(([message]) => message?.type === T().DSS_FIBER_DELETE_MESSAGE_TYPE)
        .map(([message]) => ({ channel: 'fiber', sessionId: message.sessionId }));
    return [...fetches, ...fiber];
}

/** 從第 fromCall 個 runtime 訊息起，要求 service worker 處理刪除的訊息（卸載交接以外的刪除路由）。 */
function deleteRouteMessages(fromCall) {
    const types = [T().DSS_MSG_REMOVE_OPEN_UUID, T().DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE, T().DSS_MSG_RELEASE_LEASE, T().DSS_MSG_REMOVE_PENDING_DELETE];
    return chrome.runtime.sendMessage.mock.calls.slice(fromCall).map(([message]) => message).filter((message) => types.includes(message?.type));
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

/** 頁面停在 path，追蹤 trackedUuid（null 表示沒有追蹤），持有 token，開關開啟，監聽器生效。 */
function arrangePage(path, trackedUuid, token) {
    setPathname(path);
    if (trackedUuid) sessionStorage.setItem(UUID_KEY(), trackedUuid);
    Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: trackedUuid, capturedAuthToken: token });
    globalThis.TemporaryChatEnabledFlag.__setCache(true);
    TemporaryChatDelete.attachListeners();
}

beforeEach(() => {
    TemporaryChatDelete.detachListeners();
    globalThis.TemporaryChatHeartbeat.stop();
    Object.assign(TemporaryChatDelete.state, globalThis.__DSS_TempChatDelete_tracking.createState());
    sessionStorage.clear();
    settingsStore = { [T().DSS_TEMP_CHAT_STORAGE_KEY]: true };
    installBackground();
    window.navigation = new EventTarget();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    TemporaryChatDelete.detachListeners();
    globalThis.TemporaryChatHeartbeat.stop();
    vi.restoreAllMocks();
    delete window.navigation;
    sessionStorage.clear();
    setPathname('/');
    chrome.runtime.sendMessage = vi.fn();
});

describe('beforeunload on the tracked temporary conversation hands it to the service worker', () => {
    it.each([
        ['with a captured auth token', TOKEN],
        ['without a captured auth token', null],
    ])('%s: sends one unload message for S, deletes nothing from the page and keeps the sessionStorage tracking', async (_label, token) => {
        arrangePage('/a/chat/s/' + S, S, token);
        const callsBefore = chrome.runtime.sendMessage.mock.calls.length;

        window.dispatchEvent(new Event('beforeunload'));
        await settle();

        expect(unloadHandOffs(chrome.runtime.sendMessage), 'beforeunload on tracked S must send exactly one DSS_MSG_TAB_UNLOADING message carrying S').toEqual([unloadHandOff(S)]);
        expect(pageDeleteRequests(), 'the page must not delete S itself; the service worker decides after its grace period').toEqual([]);
        expect(deleteRouteMessages(callsBefore), 'the unload must not use the navigation delete routes (remove, retry, release)').toEqual([]);
        expect(sessionStorage.getItem(UUID_KEY()), 'the sessionStorage tracking of S must survive the unload so a reloaded page can restore S').toBe(S);
    });
});

describe('beforeunload sends no unload message when the page must not hand anything off (unchanged guards)', () => {
    it.each([
        ['the page shows an untracked conversation O while S is tracked', '/a/chat/s/' + O, S, () => {}],
        ['nothing is tracked on a conversation page', '/a/chat/s/' + O, null, () => {}],
        ['after the F5 keydown', '/a/chat/s/' + S, S, () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }))],
        ['after the Ctrl+R keydown', '/a/chat/s/' + S, S, () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true }))],
        ['after dss-intentional-reload', '/a/chat/s/' + S, S, () => window.dispatchEvent(new Event('dss-intentional-reload'))],
    ])('%s', async (_label, path, trackedUuid, before) => {
        arrangePage(path, trackedUuid, TOKEN);
        const callsBefore = chrome.runtime.sendMessage.mock.calls.length;

        before();
        window.dispatchEvent(new Event('beforeunload'));
        await settle();

        expect(unloadHandOffs(chrome.runtime.sendMessage), 'no unload message may be sent').toEqual([]);
        expect(pageDeleteRequests(), 'no delete may be sent from the page').toEqual([]);
        expect(deleteRouteMessages(callsBefore), 'no navigation delete route may be used').toEqual([]);
        expect(sessionStorage.getItem(UUID_KEY()), 'the sessionStorage tracking must stay as it was').toBe(trackedUuid);
    });
});

describe('reload by the browser toolbar button (beforeunload only, no navigate event, no keydown)', () => {
    it('page A hands S off and keeps tracking; page B loaded on the same sessionStorage restores S and claims it with a DSS_HEARTBEAT within the 10 s grace period; no page deletes S', async () => {
        arrangePage('/a/chat/s/' + S, S, TOKEN);

        window.dispatchEvent(new Event('beforeunload'));
        await settle();
        expect(pageDeleteRequests(), 'the reload must not delete S from page A').toEqual([]);
        expect(sessionStorage.getItem(UUID_KEY()), 'page A must leave S in sessionStorage for the reloaded page').toBe(S);
        expect(unloadHandOffs(chrome.runtime.sendMessage, S), 'page A must hand S to the service worker on unload').toEqual([unloadHandOff(S)]);

        // 頁面 A 結束：監聽器與計時器隨頁面消失；頁面 B 的記憶體是全新的，只有 sessionStorage 延續
        TemporaryChatDelete.detachListeners();
        globalThis.TemporaryChatHeartbeat.stop();
        Object.assign(TemporaryChatDelete.state, globalThis.__DSS_TempChatDelete_tracking.createState());
        const callsBeforePageB = chrome.runtime.sendMessage.mock.calls.length;
        vi.useFakeTimers();
        try {
            await TemporaryChatDelete.init();
            await vi.advanceTimersByTimeAsync(9999);
        } finally {
            vi.useRealTimers();
        }

        const heartbeatsFromPageB = chrome.runtime.sendMessage.mock.calls.slice(callsBeforePageB).map(([message]) => message).filter((message) => message?.type === T().DSS_MSG_HEARTBEAT);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid, 'page B must restore S from sessionStorage').toBe(S);
        expect(heartbeatsFromPageB, 'page B must claim S with a DSS_HEARTBEAT before the 10 s grace period ends').toContainEqual({ type: T().DSS_MSG_HEARTBEAT, uuid: S });
        expect(pageDeleteRequests(), 'neither page may delete S').toEqual([]);
    });
});

describe('beforeunload hand-off when the runtime cannot take the message', () => {
    // 規則來源：docs/spec/04-features.md「beforeunload … Does nothing when the extension context is invalidated (chrome.runtime.id missing)」；chrome-extension-coding-guidelines：DOM 事件監聽器內的失敗要 catch 並以 console.error('[DSS] <context>:', err) 記錄。
    const DSS_ERROR_CONTEXT = /^\[DSS\] \S.*:$/;
    let windowErrors;
    let errorSpy;
    let unhandled;
    const onUnhandled = (reason) => { unhandled.push(reason); };
    const onWindowError = (event) => { windowErrors.push(event.error ?? event.message); };

    beforeEach(() => {
        windowErrors = [];
        unhandled = [];
        window.addEventListener('error', onWindowError);
        process.on('unhandledRejection', onUnhandled);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        window.removeEventListener('error', onWindowError);
        process.off('unhandledRejection', onUnhandled);
    });

    /** 頁面停在追蹤中的 S；之後的 DSS_MSG_TAB_UNLOADING 交給 failUnload 處理，其他 runtime 訊息照常回應。 */
    function arrangeUnloadFailure(failUnload) {
        arrangePage('/a/chat/s/' + S, S, TOKEN);
        const background = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = vi.fn((message) => (message?.type === T().DSS_MSG_TAB_UNLOADING ? failUnload() : background(message)));
    }

    it('logs one [DSS] console.error with the rejection when the unload message is rejected (no receiving end), and no rejection escapes', async () => {
        const rejection = new Error('Could not establish connection. Receiving end does not exist.');
        arrangeUnloadFailure(() => Promise.reject(rejection));

        window.dispatchEvent(new Event('beforeunload'));
        await settle();

        expect(unloadHandOffs(chrome.runtime.sendMessage), 'the page must still try to hand S to the service worker').toEqual([unloadHandOff(S)]);
        expect(errorSpy, 'a rejected hand-off must be reported as console.error("[DSS] <context>:", err)').toHaveBeenCalledWith(expect.stringMatching(DSS_ERROR_CONTEXT), rejection);
        expect(unhandled, 'the rejected hand-off must not escape as an unhandled promise rejection').toEqual([]);
        expect(windowErrors, 'the beforeunload listener must not throw').toEqual([]);
        expect(sessionStorage.getItem(UUID_KEY()), 'the tracking of S must survive a failed hand-off').toBe(S);
    });

    it('logs one [DSS] console.error with the error when sendMessage throws synchronously, and the beforeunload listener does not throw', async () => {
        const thrown = new Error('sendMessage threw synchronously');
        arrangeUnloadFailure(() => { throw thrown; });

        window.dispatchEvent(new Event('beforeunload'));
        await settle();

        expect(errorSpy, 'a synchronous sendMessage throw must be reported as console.error("[DSS] <context>:", err)').toHaveBeenCalledWith(expect.stringMatching(DSS_ERROR_CONTEXT), thrown);
        expect(windowErrors, 'the synchronous throw must not escape the beforeunload listener').toEqual([]);
        expect(unhandled, 'no unhandled promise rejection may escape').toEqual([]);
        expect(sessionStorage.getItem(UUID_KEY()), 'the tracking of S must survive a failed hand-off').toBe(S);
    });

    it('does nothing when the extension context is invalidated (chrome.runtime.id gone, sendMessage throws as Chrome does): no message attempt, no console.error, no listener error', async () => {
        arrangePage('/a/chat/s/' + S, S, TOKEN);
        const extensionId = chrome.runtime.id;
        chrome.runtime.id = undefined;
        chrome.runtime.sendMessage = vi.fn(() => { throw new Error('Extension context invalidated.'); });
        try {
            window.dispatchEvent(new Event('beforeunload'));
            await settle();
        } finally {
            chrome.runtime.id = extensionId;
        }

        expect(unloadHandOffs(chrome.runtime.sendMessage), 'an invalidated context must not even try to send the unload message').toEqual([]);
        expect(errorSpy, 'an invalidated context must give up silently').not.toHaveBeenCalled();
        expect(windowErrors, 'the beforeunload listener must not throw').toEqual([]);
        expect(pageDeleteRequests(), 'no delete may be sent from the page').toEqual([]);
        expect(sessionStorage.getItem(UUID_KEY()), 'the tracking of S must survive').toBe(S);
    });

    it('does nothing when chrome.runtime itself is gone: no console.error and no listener error', async () => {
        arrangePage('/a/chat/s/' + S, S, TOKEN);
        const runtime = chrome.runtime;
        chrome.runtime = undefined;
        try {
            window.dispatchEvent(new Event('beforeunload'));
            await settle();
        } finally {
            chrome.runtime = runtime;
        }

        expect(windowErrors, 'a missing chrome.runtime must not make the beforeunload listener throw').toEqual([]);
        expect(errorSpy, 'a missing chrome.runtime must be handled silently').not.toHaveBeenCalled();
        expect(pageDeleteRequests(), 'no delete may be sent from the page').toEqual([]);
        expect(sessionStorage.getItem(UUID_KEY()), 'the tracking of S must survive').toBe(S);
    });
});
