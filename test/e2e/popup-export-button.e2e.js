import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { evaluateInWorker } from './helpers/extension.js';
import { humanPause, runUnpaced } from './helpers/human.js';
import { expectNoDownloadWithin } from './helpers/observation.js';
import { closeExtensionPages, openPopup, waitForPopupFullyBound } from './helpers/popup.js';

// The popup Export button (docs/spec/02-popup-ui.md:19 "triggers Markdown export on the active chat.deepseek.com tab"), clicked in the popup the way a user does.
// Expected output: docs/spec/04-features.md:37-46 (title, turns, "## User" / "## DeepSeek" headings, "> **Thinking Process:**" blockquote, file name) and docs/FEATURES.md:271-276 (export options).
// export.e2e.js covers the content-script side by sending EXPORT_MARKDOWN itself; this spec covers the popup side: its button, its tab lookup and its two export checkboxes.
// The kept chat is only read (exported), never sent to, renamed or deleted.

test.setTimeout(180_000);

const EXPORT_DOWNLOAD_TIMEOUT_MS = 120_000;
const NO_DOWNLOAD_WINDOW_MS = 5_000;
const REPLIES = 5;
const TITLE_LINE = /^# DeepSeek Chat Export$/m;
const USER_HEADING = /^## User[ \t]*$/gm;
const DEEPSEEK_HEADING = /^## DeepSeek[ \t]*$/gm;
const TURN_SEPARATOR = /^---[ \t]*$/gm;
const THINKING_HEADING = '> **Thinking Process:**';
const FILE_NAME_PATTERN = /^deepseek-chat-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.md$/;
const DEEPSEEK_TAB_PATTERN = '*://chat.deepseek.com/*';

function countMatches(text, pattern) {
    return (text.match(pattern) ?? []).length;
}

/** The body of every "## DeepSeek" section, up to the next "## User" heading or the end of the file. */
function replySections(markdown) {
    return markdown.split(DEEPSEEK_HEADING).slice(1).map((section) => section.split(USER_HEADING)[0]);
}

/**
 * Line index of the thinking heading, of the first quoted thinking line after it, and of the first answer line (non-empty, not quoted, not a separator) after the thinking.
 * -1 marks a part the section lacks.
 */
function replyLayout(section) {
    const lines = section.split('\n').map((line) => line.trim());
    const heading = lines.indexOf(THINKING_HEADING);
    const isQuotedText = (line) => line.startsWith('>') && line.replace(/^>\s*/, '') !== '';
    const thinkingText = heading === -1 ? -1 : lines.findIndex((line, i) => i > heading && isQuotedText(line));
    const isAnswer = (line) => line !== '' && !line.startsWith('>') && !/^---$/.test(line);
    const answer = lines.findIndex((line, i) => i > Math.max(heading, thinkingText) && isAnswer(line));
    return { heading, thinkingText, answer };
}

/** Clicks the popup Export button and resolves the file the DeepSeek page downloads, with the click time window. */
async function clickExportAndDownload(popup, deepSeekPage) {
    const downloadPromise = deepSeekPage.waitForEvent('download', { timeout: EXPORT_DOWNLOAD_TIMEOUT_MS });
    const clickedAt = new Date();
    clickedAt.setMilliseconds(0);
    await popup.locator('#exportMdBtn').click();
    const download = await downloadPromise;
    const arrivedAt = new Date();
    return { fileName: download.suggestedFilename(), content: await readFile(await download.path(), 'utf8'), clickedAt, arrivedAt };
}

/** Pins both export options in sync and local (the popup reads synced settings sync-first), then opens the popup over the kept chat. */
async function openPopupOverKeptChat({ context, extensionId, settings, openConversation }, { includeThinking, includeReferences }) {
    await settings.set({ isEnabled: true });
    await settings.setInBothAreas({ includeThinking, includeReferences });
    await openConversation(CONVERSATIONS.fiveThinkingReplies);
    const popup = await openPopup(context, extensionId, { activeTabUrlPart: CONVERSATIONS.fiveThinkingReplies });
    await waitForPopupFullyBound(popup);
    const thinkingBox = popup.locator('#includeThinkingToggle');
    const referencesBox = popup.locator('#includeReferencesToggle');
    if (includeThinking) await expect(thinkingBox, 'the popup shows "Include Thinking Process" on (precondition)').toBeChecked();
    else await expect(thinkingBox, 'the popup shows "Include Thinking Process" off (precondition)').not.toBeChecked();
    if (includeReferences) await expect(referencesBox, 'the popup shows "Include Reference Links" on (precondition)').toBeChecked();
    else await expect(referencesBox, 'the popup shows "Include Reference Links" off (precondition)').not.toBeChecked();
    return popup;
}

test.describe('popup export button', () => {
    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('Export in the popup over a DeepSeek chat downloads deepseek-chat-YYYYMMDD-HHmmss.md holding five User/DeepSeek turns, each reply with its thinking blockquote before its answer', async ({ page, context, extensionId, settings, openConversation }) => {
        const popup = await openPopupOverKeptChat({ context, extensionId, settings, openConversation }, { includeThinking: true, includeReferences: true });

        const { fileName, content, clickedAt, arrivedAt } = await clickExportAndDownload(popup, page);

        const match = FILE_NAME_PATTERN.exec(fileName);
        expect(match, `file name "${fileName}" follows deepseek-chat-YYYYMMDD-HHmmss.md`).not.toBeNull();
        const [, y, mo, d, h, mi, s] = match.map(Number);
        const stampedAt = new Date(y, mo - 1, d, h, mi, s).getTime();
        expect(stampedAt, 'file name time is not before the click').toBeGreaterThanOrEqual(clickedAt.getTime());
        expect(stampedAt, 'file name time is not after the download arrived').toBeLessThanOrEqual(arrivedAt.getTime());

        expect(content, 'the file carries the "# DeepSeek Chat Export" title line').toMatch(TITLE_LINE);
        expect(countMatches(content, USER_HEADING), 'one "## User" heading per turn').toBe(REPLIES);
        expect(countMatches(content, DEEPSEEK_HEADING), 'one "## DeepSeek" heading per reply').toBe(REPLIES);
        expect(countMatches(content, TURN_SEPARATOR), 'turns are separated by "---" rules').toBeGreaterThanOrEqual(REPLIES - 1);

        replySections(content).forEach((section, index) => {
            const { heading, thinkingText, answer } = replyLayout(section);
            const reply = `reply ${index + 1} of ${REPLIES}`;
            expect(heading, `${reply} has a "${THINKING_HEADING}" heading`).toBeGreaterThanOrEqual(0);
            expect(thinkingText, `${reply} has quoted thinking text under the heading`).toBeGreaterThan(heading);
            expect(answer, `${reply} has answer text after its thinking`).toBeGreaterThan(thinkingText);
        });
    });

    test('Export with "Include Thinking Process" off in the popup downloads the five replies without any thinking section', async ({ page, context, extensionId, settings, openConversation }) => {
        const popup = await openPopupOverKeptChat({ context, extensionId, settings, openConversation }, { includeThinking: false, includeReferences: true });

        const { fileName, content } = await clickExportAndDownload(popup, page);

        expect(fileName, 'file name follows deepseek-chat-YYYYMMDD-HHmmss.md').toMatch(FILE_NAME_PATTERN);
        expect(countMatches(content, DEEPSEEK_HEADING), 'one "## DeepSeek" heading per reply').toBe(REPLIES);
        expect(content, 'no thinking section is exported').not.toContain(THINKING_HEADING);
        replySections(content).forEach((section, index) => {
            expect(replyLayout(section).answer, `reply ${index + 1} of ${REPLIES} still has answer text`).toBeGreaterThanOrEqual(0);
        });
    });

    test('Export in the popup with no DeepSeek tab open shows the notice to use the feature on chat.deepseek.com and downloads nothing', async ({ context, extensionId }) => {
        const deepSeekTabs = await evaluateInWorker(context, (pattern) => chrome.tabs.query({ url: pattern }).then((tabs) => tabs.length), DEEPSEEK_TAB_PATTERN);
        expect(deepSeekTabs, 'no DeepSeek tab is open (precondition)').toBe(0);
        const popup = await openPopup(context, extensionId);
        await waitForPopupFullyBound(popup);
        // The notice wording lives only in the locale tables (docs/ does not state it), so the expected text is the popup's own localized copy.
        const expectedNotice = await popup.evaluate(() => ({ title: dsI18n.t('notOnDeepseekTitle'), message: dsI18n.t('notOnDeepseekMessage') }));

        // The person's pause comes before the window opens, so the Export click lands at its start and the whole window watches for a download.
        await humanPause();
        const noDownload = expectNoDownloadWithin(context, NO_DOWNLOAD_WINDOW_MS, 'Export without a DeepSeek tab');
        await runUnpaced(() => popup.locator('#exportMdBtn').click());

        await expect(popup.locator('#modalOverlay'), 'the notice dialog is shown').toBeVisible();
        await expect(popup.locator('#modalTitle'), 'the notice carries its localized title').toHaveText(expectedNotice.title);
        await expect(popup.locator('#modalMessage'), 'the notice carries its localized message').toHaveText(expectedNotice.message);
        await expect(popup.locator('#modalMessage'), 'the notice names the page where export works').toContainText('chat.deepseek.com');
        await popup.locator('#modalActions .modal-btn--primary').click();
        await expect(popup.locator('#modalOverlay'), 'the notice closes on OK').toBeHidden();
        await noDownload;
    });
});
