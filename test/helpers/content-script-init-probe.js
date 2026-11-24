/**
 * 等待 content/content-script.js 的 initSettings() 可觀察地完成，供以 import 載入內容腳本的測試在動到 state 前呼叫。
 *
 * 為何不用「onMessage 監聽數 >= 2」：設定變更監聽在 initSettings() 一開始就註冊，初始化期間送達的 DSS_SETTINGS_CHANGED 先暫存、於初始化尾端依序重播，所以監聽數只代表「已開始」，不代表「已完成」；之後才落地的 applyInitialSettings 與 handleChatChange 會覆寫測試剛寫入的 state。
 *
 * 做法：每個 tick 送出一則帶哨兵 globalDefaultPrompt 的 DSS_SETTINGS_CHANGED（不寫 storage），直到 state.globalDefaultPrompt 等於哨兵；哨兵只會在初始化完成後（重播或即時處理）才寫入，因此看見哨兵即代表初始化已完成。
 * 探針不留痕跡：等待期間以存取子記錄哨兵寫入前的值，結束時把 globalDefaultPrompt 還原成一般資料屬性與該值；還原後若仍是哨兵即拋出 Setup 錯誤。
 */
const INIT_PROBE_PROMPT = '__DSS_TEST_INIT_PROBE__';
const INIT_TIMEOUT_MS = 3000;

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

function sendInitProbe() {
    chrome.runtime.onMessage.callListeners(
        { type: 'DSS_SETTINGS_CHANGED', area: 'local', changes: { globalDefaultPrompt: { newValue: INIT_PROBE_PROMPT } } },
        {},
        () => {}
    );
}

/**
 * @param {{ state: object }} contentScript content-script.js 的測試匯出（其 state 即 ChatBinding.state）。
 */
export async function waitForContentScriptInit(contentScript) {
    const { state } = contentScript;
    let currentValue = state.globalDefaultPrompt;
    let valueBeforeProbe;
    // 記錄哨兵覆寫掉的值，以便結束時還原（含哨兵寫入後又被其他重播覆寫、再次寫入哨兵的情況）
    Object.defineProperty(state, 'globalDefaultPrompt', {
        configurable: true,
        enumerable: true,
        get: () => currentValue,
        set: (value) => {
            if (value === INIT_PROBE_PROMPT && currentValue !== INIT_PROBE_PROMPT) valueBeforeProbe = currentValue;
            currentValue = value;
        },
    });

    const deadline = Date.now() + INIT_TIMEOUT_MS;
    let isInitDone = false;
    try {
        while (!isInitDone && Date.now() < deadline) {
            // 監聽尚未註冊時探針會遺失、初始化中會被暫存，故每個 tick 重送
            sendInitProbe();
            isInitDone = currentValue === INIT_PROBE_PROMPT;
            if (!isInitDone) await nextTick();
        }
    } finally {
        const restoredValue = currentValue === INIT_PROBE_PROMPT ? valueBeforeProbe : currentValue;
        Object.defineProperty(state, 'globalDefaultPrompt', { configurable: true, enumerable: true, writable: true, value: restoredValue });
    }

    if (!isInitDone) {
        throw new Error(`Setup: content-script.js initSettings() did not finish within ${INIT_TIMEOUT_MS}ms (a DSS_SETTINGS_CHANGED init probe sent every tick never reached state.globalDefaultPrompt).`);
    }
    if (state.globalDefaultPrompt === INIT_PROBE_PROMPT) {
        throw new Error('Setup: the content-script init probe left its sentinel in state.globalDefaultPrompt after restore.');
    }
}
