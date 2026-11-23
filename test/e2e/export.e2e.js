import { test, expect } from './fixtures.js';
import { MESSAGE_IN_VIEW_SELECTOR } from './helpers/conversations.js';
import { exportMarkdown, withoutExportTimestamp } from './helpers/export.js';
import { DSSelectors } from './helpers/selectors.js';

// Markdown export, triggered with the popup's EXPORT_MARKDOWN message and captured as a real download.
// Spec: docs/spec/04-features.md section 3 (file name, "> **Thinking Process:**" blockquote, cite links).
// The offline lane exports recorded conversations: the one with the most thinking replies (`withThinking`), the one with the most search replies (`withSearch`) and the purpose-recording one with the most replies holding a code block (`withCodeBlocks`); the expected thinking-section count and code blocks come from the recording itself.
// Code blocks: docs/spec/04-features.md section 3 and docs/architecture/EXPORT.md (`md-code-block` → fenced code block with its language).

test.setTimeout(180_000);

const THINKING_HEADING = '> **Thinking Process:**';
const FILE_NAME_PATTERN = /^deepseek-chat-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.md$/;
const CITE_LINK_PATTERN = /\[\[link-\d+\]\]\(https?:\/\/[^)]+\)/;

/** The number of replies with a thinking block in the recorded conversation the thinking tests export. */
function repliesWithThinking(deepseekReplay) {
    return deepseekReplay.requireConversation('withThinking').thinkingReplyCount;
}

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

const ANSWER_FRAGMENT_TYPES = new Set(['RESPONSE', 'TEMPLATE_RESPONSE']);
// 圍欄開頭行：可縮排（清單內的區塊），三個以上反引號或波浪號，其後為資訊字串
const FENCE_OPENER = /^( *)(`{3,}|~{3,})(.*)$/;
const SECTION_HEADING = /^## (User|DeepSeek)[ \t]*$/;

/** 去掉行首至多 `indent` 個空白，對應開頭圍欄的縮排。 */
function stripIndent(line, indent) {
    const leading = /^ */.exec(line)[0].length;
    return line.slice(Math.min(leading, indent));
}

/**
 * 依出現順序列出 Markdown 中已閉合的圍欄程式碼區塊 `{ section, language, body }`。
 * section 為區塊之前、圍欄外最近的 "## User" / "## DeepSeek" 標題（沒有時為 null），language 為開頭圍欄資訊字串的第一個字，body 為去掉開頭縮排後的內容行。
 */
function fencedCodeBlocks(markdown) {
    const blocks = [];
    let section = null;
    let open = null;
    for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
        if (open !== null) {
            const closer = line.trim();
            const isCloser = closer.length >= open.fence.length && closer === open.fence[0].repeat(closer.length);
            if (isCloser) {
                blocks.push({ section: open.section, language: open.language, body: open.lines.join('\n') });
                open = null;
            } else {
                open.lines.push(stripIndent(line, open.indent));
            }
            continue;
        }
        const heading = SECTION_HEADING.exec(line);
        if (heading) {
            section = heading[1];
            continue;
        }
        const opener = FENCE_OPENER.exec(line);
        // 反引號圍欄的資訊字串不得含反引號，否則是行內程式碼而非圍欄
        if (opener && !(opener[2][0] === '`' && opener[3].includes('`'))) {
            open = { section, indent: opener[1].length, fence: opener[2], language: opener[3].trim().split(/\s+/)[0], lines: [] };
        }
    }
    return blocks;
}

/** 錄製歷史（`deepseekReplay.historyOf`）中每則回覆的回答片段所含的程式碼區塊，依對話順序排列。 */
function recordedReplyCodeBlocks(history) {
    const messages = history?.data?.biz_data?.chat_messages ?? [];
    return messages
        .filter((message) => message.role === 'ASSISTANT')
        .flatMap((reply) => (reply.fragments ?? []).filter((fragment) => ANSWER_FRAGMENT_TYPES.has(fragment.type)))
        .flatMap((fragment) => fencedCodeBlocks(fragment.content ?? ''));
}

/** 逐一比對預期與匯出的程式碼區塊，只回報區塊序號與不同的部分（語言或程式碼），不帶出對話內容。 */
function codeBlockMismatches(expected, exported) {
    return expected.flatMap((block, index) => {
        const actual = exported[index];
        if (actual === undefined) return [`block ${index + 1}: missing`];
        const parts = [];
        if (actual.language !== block.language) parts.push(`block ${index + 1}: language differs`);
        if (actual.body !== block.body) parts.push(`block ${index + 1}: code differs`);
        return parts;
    });
}

test.describe('markdown export', { tag: '@offline' }, () => {
    test('downloads deepseek-chat-YYYYMMDD-HHMMSS.md stamped with the export time', async ({ page, settings, openRecorded }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        await openRecorded('withThinking');

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

    test('includeThinking adds one thinking section per reply and leaving it off drops them', async ({ page, settings, deepseekReplay, openRecorded }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        await openRecorded('withThinking');
        const fragment = await firstThinkingFragment(page);
        expect(fragment.length, 'a mounted thinking body has text to look for').toBeGreaterThan(10);

        const withThinking = await exportMarkdown(page, { includeThinking: true, includeReferences: true });
        expect(countOccurrences(withThinking.content, THINKING_HEADING), 'one thinking section per reply').toBe(repliesWithThinking(deepseekReplay));
        expect(withThinking.content, 'thinking text shown on the page is exported').toContain(fragment);

        const withoutThinking = await exportMarkdown(page, { includeThinking: false, includeReferences: true });
        expect(countOccurrences(withoutThinking.content, THINKING_HEADING), 'no thinking section').toBe(0);
        expect(withoutThinking.content, 'thinking text is not exported').not.toContain(fragment);
    });

    test('thinking collapsed by "Hide Thinking Process" exports identically to expanded thinking (U3 regression)', async ({ page, settings, deepseekReplay, openRecorded }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        await openRecorded('withThinking');
        await expect.poll(() => mountedThinkingBodies(page), { message: 'thinking bodies are mounted while the feature is off' }).toBeGreaterThan(0);
        const expanded = await exportMarkdown(page, { includeThinking: true, includeReferences: true });

        await settings.set({ dsHideThinking: true });
        await expect.poll(() => mountedThinkingBodies(page), { message: 'the feature has collapsed every thinking block before exporting' }).toBe(0);
        const collapsed = await exportMarkdown(page, { includeThinking: true, includeReferences: true });

        expect(countOccurrences(collapsed.content, THINKING_HEADING), 'collapsed thinking is still exported for every reply').toBe(repliesWithThinking(deepseekReplay));
        expect(withoutExportTimestamp(collapsed.content), 'export with collapsed thinking equals export with expanded thinking').toBe(withoutExportTimestamp(expanded.content));
    });

    test('includeReferences keeps cite links and leaving it off drops them', async ({ page, settings, openRecorded }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        await openRecorded('withSearch');
        await expect(page.locator(DSSelectors.MARKDOWN_CITE_SELECTOR).first(), 'the reply shows cite markers (precondition)').toBeAttached();

        const withReferences = await exportMarkdown(page, { includeThinking: true, includeReferences: true });
        expect(withReferences.content, 'cite markers become [[link-N]](url) links').toMatch(CITE_LINK_PATTERN);

        const withoutReferences = await exportMarkdown(page, { includeThinking: true, includeReferences: false });
        expect(withoutReferences.content, 'no cite link is exported').not.toContain('[[link-');
    });

    test('each code block of the replies is exported as a fenced code block with its language and its code unchanged', async ({ page, settings, deepseekReplay, openPurpose }) => {
        await settings.set({ isEnabled: true, dsHideThinking: false });
        const conversation = await openPurpose('withCodeBlocks');
        const recorded = recordedReplyCodeBlocks(deepseekReplay.historyOf(conversation.id));
        expect(recorded.length, 'the recorded replies hold code blocks (precondition)').toBeGreaterThan(0);

        // 不匯出思考過程，回覆段落中的圍欄區塊便只來自回答本身
        const { content } = await exportMarkdown(page, { includeThinking: false, includeReferences: true });
        const exported = fencedCodeBlocks(content).filter((block) => block.section === 'DeepSeek');

        expect(exported.length, 'one fenced code block under "## DeepSeek" per recorded code block').toBe(recorded.length);
        expect(codeBlockMismatches(recorded, exported), 'every exported code block keeps its language and code, in conversation order').toEqual([]);
    });
});
