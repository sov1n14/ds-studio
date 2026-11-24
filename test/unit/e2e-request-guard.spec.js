/**
 * test/e2e/helpers/request-guard.js — the catch-all route of the offline E2E lane.
 *
 * Requirement (lead decision, offline harness stage 1): the lane never reaches a real network host. The guard is the route registered first on the browser context,
 * so it runs last: a request that no test-installed route fulfilled or aborted reaches it. A network request (http, https, ws, wss, ftp) that arrives is aborted
 * and recorded as escaped, so a test fails when the count is not zero. Requests that use no network (chrome-extension:, data:, blob:, about:, chrome:, devtools:)
 * pass on to the browser untouched and are never recorded.
 */
import { describe, it, expect } from 'vitest';
import { createRequestGuard, isNetworkUrl } from '../e2e/helpers/request-guard.js';

/** A stand-in for a Playwright Route: records which resolution the guard chose. */
function fakeRoute(url) {
    const route = {
        resolution: null,
        request: () => ({ url: () => url }),
        abort: async (reason) => { route.resolution = { kind: 'abort', reason }; },
        fallback: async () => { route.resolution = { kind: 'fallback' }; },
        continue: async () => { route.resolution = { kind: 'continue' }; },
        fulfill: async () => { route.resolution = { kind: 'fulfill' }; },
    };
    return route;
}

describe('isNetworkUrl(url)', () => {
    it('is true for the schemes that leave the machine', () => {
        for (const url of ['https://chat.deepseek.com/', 'http://example.test/a?b=1', 'ws://host/socket', 'wss://host/socket', 'ftp://host/file', 'HTTPS://UPPER.test/']) {
            expect(isNetworkUrl(url), url).toBe(true);
        }
    });

    it('is false for schemes served inside the browser', () => {
        for (const url of ['chrome-extension://abc/popup/popup.html', 'data:text/html,<p>x</p>', 'blob:chrome-extension://abc/uuid', 'about:blank', 'chrome://version', 'devtools://devtools/bundled/x.html']) {
            expect(isNetworkUrl(url), url).toBe(false);
        }
    });
});

describe('createRequestGuard()', () => {
    it('aborts a network request that reaches it and records its url', async () => {
        const guard = createRequestGuard();
        const route = fakeRoute('https://chat.deepseek.com/api/v0/chat/completion');
        await guard.handle(route);
        expect(route.resolution).toEqual({ kind: 'abort', reason: 'blockedbyclient' });
        expect(guard.escapedUrls()).toEqual(['https://chat.deepseek.com/api/v0/chat/completion']);
        expect(guard.escapedCount()).toBe(1);
    });

    it('passes a request that uses no network on to the browser and records nothing', async () => {
        const guard = createRequestGuard();
        const route = fakeRoute('chrome-extension://abc/popup/popup.html');
        await guard.handle(route);
        expect(route.resolution).toEqual({ kind: 'fallback' });
        expect(guard.escapedCount()).toBe(0);
    });

    it('never lets a network request continue to the real network', async () => {
        const guard = createRequestGuard();
        for (const url of ['https://a.test/', 'http://b.test/', 'wss://c.test/']) {
            const route = fakeRoute(url);
            await guard.handle(route);
            expect(route.resolution.kind, url).toBe('abort');
        }
    });

    it('counts every escaped request and keeps the order', async () => {
        const guard = createRequestGuard();
        for (const url of ['https://a.test/1', 'chrome-extension://abc/x', 'https://a.test/2', 'https://a.test/1']) {
            await guard.handle(fakeRoute(url));
        }
        expect(guard.escapedUrls()).toEqual(['https://a.test/1', 'https://a.test/2', 'https://a.test/1']);
        expect(guard.escapedCount()).toBe(3);
    });

    it('takeEscaped() hands back what escaped since the last take and starts again, while the total keeps growing', async () => {
        const guard = createRequestGuard();
        await guard.handle(fakeRoute('https://a.test/1'));
        await guard.handle(fakeRoute('https://a.test/2'));
        expect(guard.takeEscaped()).toEqual(['https://a.test/1', 'https://a.test/2']);
        expect(guard.takeEscaped()).toEqual([]);
        await guard.handle(fakeRoute('https://a.test/3'));
        expect(guard.takeEscaped()).toEqual(['https://a.test/3']);
        expect(guard.escapedCount()).toBe(3);
    });

    it('escapedUrls() returns a copy, so a caller cannot rewrite the record', async () => {
        const guard = createRequestGuard();
        await guard.handle(fakeRoute('https://a.test/1'));
        guard.escapedUrls().push('https://forged.test/');
        expect(guard.escapedUrls()).toEqual(['https://a.test/1']);
    });

    it('keeps one record per guard: a second guard starts at zero', async () => {
        const first = createRequestGuard();
        await first.handle(fakeRoute('https://a.test/1'));
        expect(createRequestGuard().escapedCount()).toBe(0);
    });
});
