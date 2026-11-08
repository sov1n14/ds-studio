// Negative assertions over a bounded observation window.

const POLL_INTERVAL_MS = 50;

/**
 * Fails when `forbidden(arg)` becomes truthy in the page within `durationMs`; passes when the window ends without it.
 * The window is the assertion itself (proving something does NOT happen), never a wait for something to happen.
 * @param {import('@playwright/test').Page} page
 */
export async function expectNeverWithin(page, forbidden, arg, durationMs, message) {
    try {
        await page.waitForFunction(forbidden, arg, { timeout: durationMs, polling: POLL_INTERVAL_MS });
    } catch (error) {
        if (error?.name === 'TimeoutError') return;
        throw error;
    }
    throw new Error(`${message}: the forbidden state appeared within ${durationMs} ms`);
}

/**
 * Fails when any page of `context` (open now or opened during the window) starts a download within `durationMs`; passes when the window ends without one.
 * Like `expectNeverWithin`, the window is the assertion itself.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function expectNoDownloadWithin(context, durationMs, message) {
    const downloads = [];
    const record = (download) => downloads.push(download.suggestedFilename());
    const watch = (page) => page.on('download', record);
    context.pages().forEach(watch);
    context.on('page', watch);
    try {
        await new Promise((resolve) => setTimeout(resolve, durationMs));
    } finally {
        context.off('page', watch);
        context.pages().forEach((page) => page.off('download', record));
    }
    if (downloads.length > 0) {
        throw new Error(`${message}: ${downloads.length} download(s) started within ${durationMs} ms: ${JSON.stringify(downloads)}`);
    }
}

/**
 * Fails when `context` opens a page within `durationMs` whose URL, read when the window ends, contains `urlPart`; passes otherwise.
 * The URL is read at the end because a window can open on about:blank before it loads its target. Like `expectNeverWithin`, the window is the assertion itself.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function expectNoPageWithin(context, urlPart, durationMs, message) {
    const opened = [];
    const record = (page) => opened.push(page);
    context.on('page', record);
    try {
        await new Promise((resolve) => setTimeout(resolve, durationMs));
    } finally {
        context.off('page', record);
    }
    const matching = opened.map((page) => page.url()).filter((url) => url.includes(urlPart));
    if (matching.length > 0) {
        throw new Error(`${message}: ${matching.length} page(s) opened within ${durationMs} ms: ${JSON.stringify(matching)}`);
    }
}
