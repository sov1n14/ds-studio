/**
 * background/unload-grace.js 的載入順序與相依缺失契約（單元測試，每個測試在測試 realm 重新載入模組，不經 vm）。
 *
 * 規則來源：chrome-extension-coding-guidelines「Error reporting」：呼叫端無法復原的缺失相依要 throw，訊息指名缺少的東西與修法；timer callback 內的失敗要 catch 並以 console.error('[DSS] <context>:', err) 記錄。docs/spec/04-features.md Unload Grace：install({ runGuardedQueueJob, scheduleRetryAlarm }) 由 service worker 於頂層呼叫；DSS_TAB_UNLOADING 啟動 10 000 ms 寬限計時。
 *
 * 只替換信任邊界：chrome.runtime.onMessage（setup 的 mock event，本檔記下 install 註冊的監聽器並依 Chrome 方式呼叫）、chrome.tabs.query、fetch、計時器（vi fake timers）。待刪佇列使用真的 background/pending-store.js 與記憶體 chrome.storage。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/deepseek-api.js';
import TemporaryChatPendingStore from '../../background/pending-store.js';

const GRACE_MS = 10000;
const S = '26c81320-1ce0-4172-bd5e-cb5b7a55f332';
const T = () => globalThis.DSS_TEMP_CHAT;
const deps = () => ({ runGuardedQueueJob: (job) => job(), scheduleRetryAlarm: async () => {} });

let installedListeners;
let UnloadGrace;
let errorSpy;
const savedGlobals = {};

function saveGlobal(name) {
    savedGlobals[name] = globalThis[name];
}

/** install 並回傳它註冊的 onMessage 監聽器。 */
function installAndCapture(installDeps) {
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener');
    try {
        UnloadGrace.install(installDeps);
    } finally {
        installedListeners.push(...addSpy.mock.calls.map(([fn]) => fn));
        addSpy.mockRestore();
    }
    return installedListeners[installedListeners.length - 1];
}

/** 送出 S 的卸載訊息，推進到寬限期滿並讓到期工作跑完。 */
async function unloadAndExpire(listener) {
    listener({ type: T().DSS_MSG_TAB_UNLOADING, uuid: S }, { id: chrome.runtime.id }, () => {});
    await vi.advanceTimersByTimeAsync(GRACE_MS + 1000);
}

// 每個測試重新載入模組，如同每次 service worker 啟動都重新執行 unload-grace.js
beforeEach(async () => {
    vi.resetModules();
    UnloadGrace = (await import('../../background/unload-grace.js')).default;
    installedListeners = [];
    ['TemporaryChatPendingStore', 'DSSDeepSeekApi', 'DSS_TEMP_CHAT'].forEach(saveGlobal);
    globalThis.TemporaryChatPendingStore = TemporaryChatPendingStore;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    chrome.tabs.query = vi.fn(async () => []);
    globalThis.fetch = vi.fn(async () => ({ ok: true }));
});

afterEach(() => {
    vi.useRealTimers();
    installedListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
    Object.entries(savedGlobals).forEach(([name, value]) => { globalThis[name] = value; });
    vi.restoreAllMocks();
});

describe('install() names the missing service worker functions', () => {
    it.each([
        ['no argument', undefined],
        ['an empty object', {}],
        ['only runGuardedQueueJob', { runGuardedQueueJob: async () => {} }],
        ['only scheduleRetryAlarm', { scheduleRetryAlarm: async () => {} }],
        ['non-function values', { runGuardedQueueJob: 'job', scheduleRetryAlarm: 1 }],
    ])('throws for %s, naming runGuardedQueueJob and scheduleRetryAlarm, and registers no message listener', (_label, installDeps) => {
        const before = chrome.runtime.onMessage.listenerCount();

        expect(() => installAndCapture(installDeps), 'the error must name both functions install() needs').toThrow(/runGuardedQueueJob.*scheduleRetryAlarm/);
        expect(chrome.runtime.onMessage.listenerCount(), 'a failed install must not register the unload route').toBe(before);
    });

    it('installs the unload route when both functions are given', () => {
        const before = chrome.runtime.onMessage.listenerCount();

        installAndCapture(deps());

        expect(chrome.runtime.onMessage.listenerCount(), 'a valid install registers exactly one message listener').toBe(before + 1);
    });
});

describe('install() names utils/temporary-chat-constants.js when its message types are missing', () => {
    it.each([
        ['DSS_TEMP_CHAT is absent', () => undefined],
        ['DSS_MSG_TAB_UNLOADING is absent', () => ({ ...savedGlobals.DSS_TEMP_CHAT, DSS_MSG_TAB_UNLOADING: undefined })],
        ['DSS_MSG_HEARTBEAT is absent', () => ({ ...savedGlobals.DSS_TEMP_CHAT, DSS_MSG_HEARTBEAT: undefined })],
    ])('throws when %s', (_label, makeConstants) => {
        globalThis.DSS_TEMP_CHAT = makeConstants();

        expect(() => installAndCapture(deps()), 'the error must name the file to load first').toThrow('utils/temporary-chat-constants.js');
    });
});

describe('grace expiry reports a missing load-order dependency as a [DSS] console.error naming the file', () => {
    it('names background/pending-store.js when TemporaryChatPendingStore is not loaded', async () => {
        vi.useFakeTimers();
        const listener = installAndCapture(deps());
        globalThis.TemporaryChatPendingStore = undefined;

        await unloadAndExpire(listener);

        expect(errorSpy, 'the expiry failure must be logged as console.error("[DSS] <context>:", err) whose message names background/pending-store.js')
            .toHaveBeenCalledWith(expect.stringMatching(/^\[DSS\] \S.*:$/), expect.objectContaining({ message: expect.stringContaining('background/pending-store.js') }));
        expect(globalThis.fetch, 'no delete may be sent').not.toHaveBeenCalled();
    });

    it('names utils/deepseek-api.js when DSSDeepSeekApi is not loaded, and keeps S queued', async () => {
        await TemporaryChatPendingStore.setLastAuthToken('Bearer install-spec');
        await TemporaryChatPendingStore.addPendingDelete(S);
        vi.useFakeTimers();
        const listener = installAndCapture(deps());
        globalThis.DSSDeepSeekApi = undefined;

        await unloadAndExpire(listener);

        expect(errorSpy, 'the expiry failure must be logged as console.error("[DSS] <context>:", err) whose message names utils/deepseek-api.js')
            .toHaveBeenCalledWith(expect.stringMatching(/^\[DSS\] \S.*:$/), expect.objectContaining({ message: expect.stringContaining('utils/deepseek-api.js') }));
        expect(globalThis.fetch, 'no delete may be sent').not.toHaveBeenCalled();
        vi.useRealTimers();
        expect((await TemporaryChatPendingStore.getPendingDeletes()).map((e) => e.chatUuid), 'S must stay queued').toContain(S);
    });
});
