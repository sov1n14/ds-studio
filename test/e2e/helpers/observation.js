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
