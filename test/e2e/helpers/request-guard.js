// The catch-all route of the offline E2E lane: no request reaches a real network host.

// Schemes that leave the machine; every other scheme (chrome-extension:, data:, blob:, about:, chrome:, devtools:) is served inside the browser.
const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

/** Whether a request to `url` would leave the machine. */
export function isNetworkUrl(url) {
    try {
        return NETWORK_SCHEMES.has(new URL(url).protocol);
    } catch {
        return false;
    }
}

/**
 * Creates the guard of one browser context. Register `guard.handle` with `context.route` for every url (a glob of two stars, a slash and one star) before any other route: Playwright runs the latest route first,
 * so the guard sees only what no test-installed route fulfilled, aborted or left to `fallback`.
 * A network request that arrives is aborted and recorded as escaped; one that uses no network goes on to the browser.
 * `takeEscaped()` drains the urls recorded since the last take (a test asserts it is empty); `escapedCount()` is the total over the guard's lifetime.
 */
export function createRequestGuard() {
    let pending = [];
    let total = 0;
    return {
        async handle(route) {
            const url = route.request().url();
            if (!isNetworkUrl(url)) return route.fallback();
            pending.push(url);
            total += 1;
            return route.abort('blockedbyclient');
        },
        escapedUrls: () => [...pending],
        escapedCount: () => total,
        takeEscaped() {
            const taken = pending;
            pending = [];
            return taken;
        },
    };
}
