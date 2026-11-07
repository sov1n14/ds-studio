import { test, expect } from './fixtures.js';
import { CONVERSATIONS, MESSAGE_IN_VIEW_SELECTOR } from './helpers/conversations.js';
import { exportMarkdown, withoutExportTimestamp } from './helpers/export.js';
import { DSSelectors } from './helpers/selectors.js';

// Markdown export, triggered with the popup's EXPORT_MARKDOWN message and captured as a real download.
// Spec: docs/spec/04-features.md section 3 (file name, "> **Thinking Process:**" blockquote, cite links).

test.setTimeout(180_000);

const THINKING_HEADING = '> **Thinking Process:**';
const FILE_NAME_PATTERN = /^deepseek-chat-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.md$/;
const CITE_LINK_PATTERN = /\[\[link-\d+\]\]\(https?:\/\/[^)]+\)/;
const REPLIES_WITH_THINKING = 5;

function countOccurrences(text, needle) {
    return text.split(needle).length - 1;
}

/** First sentence-sized fragment of a mounted thinking body, used to prove its text is exported. */
async function firstThinkingFragment(page) {
    const text = await page.locator(`${DSSelectors.THINK_CONTENT_SELECTOR} p`).first().textContent();
    return text.trim().slice(0, 40);
}

function mountedThinkingBodies(page) {
    return page.locator(`${MESSAGE_IN_VIEW_SELECTOR} ${DSSelectors.THINK_CONTENT_SELECTOR}`).count();
}

test.describe('markdown export', () => {
    test('downloads deepseek-chat-YYYYMMDD-HHMMSS.md stamped with the export time', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);

        const before = new Date();
        before.setMilliseconds(0);
        const { fileName } = await exportMarkdown(page, { includeThinking: true, includeReferences: true });
        const after = new Date();

        const match = FILE_NAME_PATTERN.exec(fileName);
        expect(match, `file name "${fileName}" follows deepseek-chat-YYYYMMDD-HHMMSS.md`).not.toBeNull();
        const [, y, mo, d, h, mi, s] = match.map(Number);
        const stamped = new Date(y, mo - 1, d, h, mi, s);
        expect(stamped.getTime(), 'file name time is not before the export started').toBeGreaterThanOrEqual(before.getTime());
        expect(stamped.getTime(), 'file name time is not after the download arrived').toBeLessThanOrEqual(after.getTime());
    });

    test('includeThinking adds one thinking section per reply and leaving it off drops them', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        const fragment = await firstThinkingFragment(page);
        expect(fragment.length, 'a mounted thinking body has text to look for').toBeGreaterThan(10);

        const withThinking = await exportMarkdown(page, { includeThinking: true, includeReferences: true });
        expect(countOccurrences(withThinking.content, THINKING_HEADING), 'one thinking section per reply').toBe(REPLIES_WITH_THINKING);
        expect(withThinking.content, 'thinking text shown on the page is exported').toContain(fragment);

        const withoutThinking = await exportMarkdown(page, { includeThinking: false, includeReferences: true });
        expect(countOccurrences(withoutThinking.content, THINKING_HEADING), 'no thinking section').toBe(0);
        expect(withoutThinking.content, 'thinking text is not exported').not.toContain(fragment);
    });

    test('thinking collapsed by "Hide Thinking Process" exports identically to expanded thinking (U3 regression)', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        await expect.poll(() => mountedThinkingBodies(page), { message: 'thinking bodies are mounted while the feature is off' }).toBeGreaterThan(0);
        const expanded = await exportMarkdown(page, { includeThinking: true, includeReferences: true });

        await settings.set({ dsHideThinking: true });
        await expect.poll(() => mountedThinkingBodies(page), { message: 'the feature has collapsed every thinking block before exporting' }).toBe(0);
        const collapsed = await exportMarkdown(page, { includeThinking: true, includeReferences: true });

        expect(countOccurrences(collapsed.content, THINKING_HEADING), 'collapsed thinking is still exported for every reply').toBe(REPLIES_WITH_THINKING);
        expect(withoutExportTimestamp(collapsed.content), 'export with collapsed thinking equals export with expanded thinking').toBe(withoutExportTimestamp(expanded.content));
    });

    test('includeReferences keeps cite links and leaving it off drops them', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        await openConversation(CONVERSATIONS.thinkingWithSearch);
        await expect(page.locator(DSSelectors.MARKDOWN_CITE_SELECTOR).first(), 'the reply shows cite markers (precondition)').toBeAttached();

        const withReferences = await exportMarkdown(page, { includeThinking: true, includeReferences: true });
        expect(withReferences.content, 'cite markers become [[link-N]](url) links').toMatch(CITE_LINK_PATTERN);

        const withoutReferences = await exportMarkdown(page, { includeThinking: true, includeReferences: false });
        expect(withoutReferences.content, 'no cite link is exported').not.toContain('[[link-');
    });
});
