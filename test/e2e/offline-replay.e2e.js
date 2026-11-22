import { test, expect } from './fixtures.js';
import { MESSAGE_IN_VIEW_SELECTOR } from './helpers/conversations.js';
import { DSSelectors } from './helpers/selectors.js';

// Own tests of the HAR replay of the offline lane (helpers/har-replay.js): the recorded session renders in the browser, conversations are chosen from the recording by role,
// and a request the recording cannot answer is aborted inside the browser and counted apart from the escaped requests of the request guard.
// The purpose recordings (one per account) add a long thread, a conversation with code blocks and their own chat lists.
// The probe host uses the reserved `.invalid` TLD, which no resolver answers.

const MISS_PROBE_URL = 'https://replay-probe.invalid/probe';
const CODE_BLOCK_SELECTOR = `.${DSSelectors.CODE_BLOCK_CLASS}`;
const SIDEBAR_LINK_SELECTOR = DSSelectors.SIDEBAR_CHAT_LINK_SELECTOR;

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

    test('the "longThread" conversation of the purpose recordings opens and renders its messages, and its page and history are answered by the replay, not counted as misses', async ({ page, openPurpose }) => {
        const failedUrls = [];
        page.on('requestfailed', (request) => failedUrls.push(new URL(request.url()).pathname));
        const conversation = await openPurpose('longThread');
        expect(await page.locator(MESSAGE_IN_VIEW_SELECTOR).count(), 'messages are rendered').toBeGreaterThan(0);
        expect(await page.locator(MESSAGE_IN_VIEW_SELECTOR).count(), 'no more messages than the purpose recording holds').toBeLessThanOrEqual(conversation.messageCount);
        expect(failedUrls.filter((pathname) => pathname.endsWith('/chat/history_messages') || pathname.startsWith('/a/chat/s/')), 'no document or history request of the conversation failed').toEqual([]);
    });

    test('the "withCodeBlocks" conversation of the purpose recordings renders a code block', async ({ page, openPurpose }) => {
        const conversation = await openPurpose('withCodeBlocks');
        expect(conversation.codeBlockReplyCount, 'the role picks a conversation holding code').toBeGreaterThan(0);
        // The list opens at its end and mounts only the messages in view: scroll up through it until a mounted reply holds a code block.
        await expect.poll(async () => {
            if (await page.locator(CODE_BLOCK_SELECTOR).count() > 0) return true;
            await page.mouse.move(640, 360);
            await page.mouse.wheel(0, -1500);
            return false;
        }, { message: 'a code block is rendered', timeout: 30_000 }).toBe(true);
    });

    test('the chat list of a purpose recording shows its own sessions in the sidebar', async ({ page, deepseekReplay }) => {
        const [{ purpose }] = deepseekReplay.purposeConversations;
        const { sessionIds } = await deepseekReplay.useSidebarOf(page, purpose);
        await page.reload();
        await expect.poll(() => page.locator(SIDEBAR_LINK_SELECTOR).count(), { message: 'the sidebar lists as many sessions as the purpose recording holds' }).toBe(sessionIds.length);
        const hrefs = await page.locator(SIDEBAR_LINK_SELECTOR).evaluateAll((links) => links.map((link) => link.getAttribute('href')));
        const missingCount = sessionIds.filter((id) => !hrefs.some((href) => href.endsWith(id))).length;
        expect(missingCount, 'every session of the purpose recording is listed').toBe(0);
    });
});
