import { test, expect } from './fixtures.js';

// Negative control of the offline lane: the zero-escaped-requests assertion of fixtures.js means something only if a network request would be caught.
// The probe host uses the reserved `.invalid` TLD, which no resolver answers, so even a broken guard cannot reach a real host.

const PROBE_URL = 'http://guard-probe.invalid/';

test.describe('offline lane network guard', { tag: '@offline' }, () => {
    test('a page request to a network host is aborted by the guard and recorded as escaped, not left to DNS', async ({ context, offlineLane }) => {
        const page = await context.newPage();
        try {
            const failure = await page.goto(PROBE_URL).then(() => null, (error) => String(error.message));
            // ERR_BLOCKED_BY_CLIENT is the guard's abort; without the guard the resolver rule answers ERR_NAME_NOT_RESOLVED.
            expect(failure, 'the request is aborted by the guard').toContain('ERR_BLOCKED_BY_CLIENT');
            expect(offlineLane.guard.escapedUrls(), 'the guard records the url').toEqual([PROBE_URL]);
        } finally {
            await page.close();
            // The recorded request is this test's subject, so it is taken here; any other request would still fail the test in the fixture.
            offlineLane.guard.takeEscaped();
        }
    });

    test('an extension page loads without any request counted as escaped', async ({ context, extensionId, offlineLane }) => {
        const page = await context.newPage();
        try {
            await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
            await expect(page.locator('#presetSelectValue'), 'the popup rendered').not.toHaveText('');
            expect(offlineLane.guard.escapedUrls(), 'no request escaped while the popup loaded').toEqual([]);
        } finally {
            await page.close();
        }
    });
});
