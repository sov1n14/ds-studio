import { test, expect } from './fixtures.js';
import { MESSAGE_IN_VIEW_SELECTOR } from './helpers/conversations.js';
import { DSSelectors } from './helpers/selectors.js';

// Own tests of the HAR replay of the offline lane (helpers/har-replay.js): the recorded session renders in the browser, conversations are chosen from the recording by role,
// and a request the recording cannot answer is aborted inside the browser and counted apart from the escaped requests of the request guard.
// The probe host uses the reserved `.invalid` TLD, which no resolver answers.

const MISS_PROBE_URL = 'https://replay-probe.invalid/probe';

test.describe('offline lane HAR replay', { tag: '@offline' }, () => {
    test('a recorded conversation chosen by role opens from its url and renders its messages, with a thinking block when the role is "withThinking"', async ({ page, deepseekReplay }) => {
        const conversation = deepseekReplay.requireConversation('withThinking');
        await page.goto(`https://chat.deepseek.com/a/chat/s/${conversation.id}`);
        // The message list is virtual: only the messages in view are mounted, so the count is bounded by the recording, not equal to it.
        await expect.poll(() => page.locator(MESSAGE_IN_VIEW_SELECTOR).count(), { message: 'the recorded messages are rendered' }).toBeGreaterThan(0);
        expect(await page.locator(MESSAGE_IN_VIEW_SELECTOR).count(), 'no more messages than the recording holds').toBeLessThanOrEqual(conversation.messageCount);
        await expect(page.locator(DSSelectors.THINK_BLOCK_SELECTOR).first(), 'the conversation chosen for thinking shows a thinking block').toBeAttached();
    });

    test('a request the recording cannot answer is aborted in the browser and recorded as a replay miss, not as an escaped request', async ({ page, offlineLane }) => {
        const outcome = await page.evaluate((url) => fetch(url).then(() => 'answered', () => 'aborted'), MISS_PROBE_URL);
        expect(outcome, 'the page sees a failed request').toBe('aborted');
        expect(offlineLane.replayMisses.take(), 'the replay lists the request').toContain('GET replay-probe.invalid/probe');
        expect(offlineLane.guard.escapedUrls(), 'the request guard saw nothing: the request never reached the network').toEqual([]);
    });
});
