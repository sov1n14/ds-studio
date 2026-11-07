// Access to the DS studio service worker of a persistent Chrome context.
// MV3 workers stop when idle, so every call re-resolves the live worker instead of caching a handle.

const EXTENSION_SCHEME = 'chrome-extension://';
const WAKE_TIMEOUT_MS = 15_000;

// Extension ids seen per context, so an idle (stopped) worker can be woken through its own page.
const knownIds = new WeakMap();

function findLiveWorker(context) {
    return context.serviceWorkers().find((worker) => worker.url().startsWith(EXTENSION_SCHEME)) ?? null;
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
 * Evaluates `fn(arg)` inside the extension service worker, re-resolving the worker once
 * when the first attempt hits a worker that stopped between resolution and evaluation.
 */
export async function evaluateInWorker(context, fn, arg) {
    try {
        return await (await getExtensionWorker(context)).evaluate(fn, arg);
    } catch (error) {
        if (!/Target closed|has been closed|destroyed/i.test(String(error?.message))) throw error;
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
