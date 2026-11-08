// Access to the DS studio service worker of a persistent Chrome context.
// MV3 workers stop when idle, so every call re-resolves the live worker instead of caching a handle.

const EXTENSION_SCHEME = 'chrome-extension://';
const WAKE_TIMEOUT_MS = 15_000;
const CLOSED_TARGET = /Target closed|has been closed|destroyed/i;

// Extension ids seen per context, so an idle (stopped) worker can be woken through its own page.
const knownIds = new WeakMap();

// 已被 reloadExtension 淘汰的舊 worker 物件；Playwright 可能在新 worker 出現後仍短暫列出舊物件，因此明確排除。
const retiredWorkers = new WeakSet();

function findLiveWorker(context) {
    return context.serviceWorkers().find((worker) => worker.url().startsWith(EXTENSION_SCHEME) && !retiredWorkers.has(worker)) ?? null;
}

function remember(context, worker) {
    knownIds.set(context, new URL(worker.url()).host);
    return worker;
}

async function wakeWorker(context, extensionId) {
    const pending = context.waitForEvent('serviceworker', {
        predicate: (worker) => worker.url().startsWith(`${EXTENSION_SCHEME}${extensionId}/`),
        timeout: WAKE_TIMEOUT_MS,
    });
    const page = await context.newPage();
    try {
        await page.goto(`${EXTENSION_SCHEME}${extensionId}/manifest.json`);
        return findLiveWorker(context) ?? await pending;
    } finally {
        pending.catch(() => {});
        await page.close();
    }
}

/**
 * Returns the running service worker of the extension, waking it when it has gone idle.
 * Never returns a page-origin worker (DeepSeek registers its own service worker).
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function getExtensionWorker(context) {
    const live = findLiveWorker(context);
    if (live) return remember(context, live);
    const extensionId = knownIds.get(context);
    if (extensionId) return remember(context, await wakeWorker(context, extensionId));
    const first = await context.waitForEvent('serviceworker', {
        predicate: (worker) => worker.url().startsWith(EXTENSION_SCHEME),
        timeout: WAKE_TIMEOUT_MS,
    });
    return remember(context, first);
}

/**
 * 從目前的 service worker 呼叫 `chrome.runtime.reload()` 重新載入擴充功能，等待並回傳重新載入後的新 worker。
 * 持久設定檔可能沿用快取的舊版 service worker 腳本；重新載入讓 Chrome 從磁碟讀取目前的擴充功能檔案，storage 不受影響。
 * 須在開啟任何 DeepSeek 分頁前呼叫：重新載入會使既有分頁的 content script 失去與擴充功能的連線。
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function reloadExtension(context) {
    const old = await getExtensionWorker(context);
    const extensionId = new URL(old.url()).host;
    // 先註冊等待，再觸發重新載入，避免新 worker 在註冊前就已出現而錯過事件。
    const pending = context.waitForEvent('serviceworker', {
        predicate: (worker) => worker !== old && worker.url().startsWith(`${EXTENSION_SCHEME}${extensionId}/`),
        timeout: WAKE_TIMEOUT_MS,
    });
    retiredWorkers.add(old);
    try {
        // 以 setTimeout 延後觸發，讓 evaluate 先回傳；舊 worker 隨即關閉，回傳前關閉的錯誤可忽略。
        await old.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 0); });
    } catch (error) {
        if (!CLOSED_TARGET.test(String(error?.message))) {
            pending.catch(() => {});
            throw error;
        }
    }
    return remember(context, await pending);
}

/**
 * Evaluates `fn(arg)` inside the extension service worker, re-resolving the worker once
 * when the first attempt hits a worker that stopped between resolution and evaluation.
 */
export async function evaluateInWorker(context, fn, arg) {
    try {
        return await (await getExtensionWorker(context)).evaluate(fn, arg);
    } catch (error) {
        if (!CLOSED_TARGET.test(String(error?.message))) throw error;
        return (await getExtensionWorker(context)).evaluate(fn, arg);
    }
}

/**
 * Returns the id of the single tab whose URL contains `urlPart`.
 * Throws when none or several match, so a message never reaches the wrong tab.
 */
export async function findTabId(context, urlPart) {
    const matches = await evaluateInWorker(context, async (part) => {
        const tabs = await chrome.tabs.query({});
        return tabs.filter((tab) => (tab.url || '').includes(part)).map((tab) => ({ id: tab.id, url: tab.url }));
    }, urlPart);
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one tab with URL containing "${urlPart}", found ${matches.length}: ${JSON.stringify(matches)}`);
    }
    return matches[0].id;
}

/** Sends `message` from the service worker to the content script of tab `tabId`; resolves the response. */
export async function sendToTab(context, tabId, message) {
    return evaluateInWorker(context, ({ id, payload }) => chrome.tabs.sendMessage(id, payload), { id: tabId, payload: message });
}

/**
 * Evaluates `fn(arg)` in a page of the extension origin that runs no extension script (its manifest.json), then closes that page.
 * For state that lives in the extension origin but not in the service worker, such as the localStorage the popup shares with the editor window.
 */
export async function evaluateInExtensionOrigin(context, extensionId, fn, arg) {
    const page = await context.newPage();
    try {
        await page.goto(`${EXTENSION_SCHEME}${extensionId}/manifest.json`);
        return await page.evaluate(fn, arg);
    } finally {
        await page.close();
    }
}

/** 經由 service worker 以 `chrome.windows.getAll` 列出所有瀏覽器視窗（不另開分頁，因此不會改變視窗焦點）；每筆含 `id`、`type`、`focused` 與各分頁網址 `tabUrls`（無權讀取的分頁為空字串）。 */
export async function listWindows(context) {
    return evaluateInWorker(context, async () => (await chrome.windows.getAll({ populate: true })).map((win) => ({
        id: win.id,
        type: win.type,
        focused: win.focused,
        tabUrls: (win.tabs || []).map((tab) => tab.url || tab.pendingUrl || ''),
    })));
}
