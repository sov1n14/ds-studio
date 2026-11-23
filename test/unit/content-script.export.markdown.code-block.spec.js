// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../content/ds-selectors.js';
import '../../content/content-script.export.markdown.js';
import '../../content/censor-reply-restore.markdown.js';

// 匯出 Markdown 時的程式碼區塊轉換，夾具依 DeepSeek 實際渲染的結構建立（離線回放錄製的 withCodeBlocks 對話中探測所得，只取結構，程式碼文字為合成內容）：
//   div.md-code-block.md-code-block-light
//     div.md-code-block-banner-wrap > div.md-code-block-banner.md-code-block-banner-lite > div._121d384
//       div.d2a24f03 > span.d813de27      ← 語言標籤文字（沒有語言的區塊顯示 "text"）
//       div.d2a24f03._246a029 > div.efa13877 > 兩個 div.ds-button[role=button]（複製、下載，各含圖示與文字標籤）
//     pre（沒有 class、沒有 code 元素）
//       每行一個無 class 的 span，行內為 span.token.* 與裸文字節點
//       行與行之間是直接位於 pre 下的裸文字節點 "\n"
//     svg._9bc997d._33882ae、svg._9bc997d._28d7e84
// 區塊的父層為 div.ds-markdown.ds-assistant-message-main-content，前後各為一個 p。
// 擴充功能自己的復原回覆（censor-reply-restore）渲染的程式碼區塊沒有 banner：div.md-code-block.md-code-block-dark，有語言時另含 div.md-code-block-header > span.md-code-lang，其後為 pre > span（整段程式碼）；夾具直接由實際的復原渲染器產生。
// 規格：docs/spec/04-features.md 第 3 節與 docs/architecture/EXPORT.md（md-code-block → 帶語言的圍欄程式碼區塊）。
// 在 jsdom 下執行（DOM 結構相關的斷言，見 testing-pitfalls DOM Fixture Completeness）；jsdom 沒有 innerText，以 textContent 代替。

const { parseHtmlToMarkdown } = globalThis.__DS_ContentExport_markdown;
const restoreRenderer = globalThis.__DS_CensorReplyRestore_markdown;

const hadOwnInnerText = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'innerText');
beforeAll(() => {
    if (!hadOwnInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    }
});
afterAll(() => {
    if (!hadOwnInnerText) delete HTMLElement.prototype.innerText;
});

const COPY_LABEL = 'Copy';
const DOWNLOAD_LABEL = 'Download';

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 一行程式碼：字串為裸文字節點，[type, text] 為 span.token.<type>。 */
function lineHtml(tokens) {
    const inner = tokens.map((token) => (typeof token === 'string'
        ? escapeHtml(token)
        : `<span class="token ${token[0]}">${escapeHtml(token[1])}</span>`)).join('');
    return `<span>${inner}</span>`;
}

function bannerButtonHtml(label, extraClass) {
    return `<div class="ds-button ds-button--borderlessNeutral ds-button--borderless ds-button--capsule ds-button--xs ds-button--icon-relative-m ds-button--min-width${extraClass}" role="button">`
        + '<div class="ds-button__background"></div>'
        + '<div class="ds-button__icon"><svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"></path></svg></div>'
        + `<span class="ds-button__content"><span>${label}</span></span></div>`;
}

/** DeepSeek 渲染的一個程式碼區塊：banner 顯示 `label`，pre 內每行一個 span，行間為裸 "\n"；`labelCell` 取代語言標籤所在的 div。 */
function codeBlockHtml(label, lines, labelCell = `<div class="d2a24f03"><span class="d813de27">${label}</span></div>`) {
    return '<div class="md-code-block md-code-block-light">'
        + '<div class="md-code-block-banner-wrap"><div class="md-code-block-banner md-code-block-banner-lite"><div class="_121d384">'
        + labelCell
        + `<div class="d2a24f03 _246a029"><div class="efa13877">${bannerButtonHtml(COPY_LABEL, ' _64bb515')}${bannerButtonHtml(DOWNLOAD_LABEL, '')}</div></div>`
        + '</div></div></div>'
        + `<pre>${lines.map(lineHtml).join('\n')}</pre>`
        + '<svg class="_9bc997d _33882ae"><path d="M0 0"></path></svg>'
        + '<svg class="_9bc997d _28d7e84"><path d="M0 0"></path></svg>'
        + '</div>';
}

/** 復原回覆的本體：內容由實際的復原渲染器產生，容器 class 與 censor-reply-restore.dom.inject.js 建立的相同。 */
function restoredReplyHtml(markdownText) {
    return `<div class="ds-markdown ds-assistant-message-main-content restored-content">${restoreRenderer._renderMarkdown(markdownText)}</div>`;
}

/** 一則回覆的 Markdown 本體：段落與程式碼區塊交錯。 */
function replyHtml(parts) {
    return `<div class="ds-markdown ds-assistant-message-main-content">${parts.join('')}</div>`;
}

function toMarkdown(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return parseHtmlToMarkdown(doc.body.firstElementChild, { forceReferences: true });
}

const FENCE_OPENER = new RegExp('^(`{3,}|~{3,})(.*)$');

/** 列出 Markdown 中的圍欄程式碼區塊 `{ info, body }`，以及圍欄外的非空行 `outside`。 */
function splitFences(markdown) {
    const blocks = [];
    const outside = [];
    let open = null;
    for (const line of markdown.split('\n')) {
        if (open) {
            if (line.trim() === open.fence) {
                blocks.push({ info: open.info, body: open.lines.join('\n') });
                open = null;
            } else {
                open.lines.push(line);
            }
            continue;
        }
        const opener = FENCE_OPENER.exec(line.trim());
        if (opener) {
            open = { fence: opener[1], info: opener[2].trim(), lines: [] };
        } else if (line.trim() !== '') {
            outside.push(line.trim());
        }
    }
    return { blocks, outside, isUnclosed: open !== null };
}

// 兩行 JavaScript，行內有關鍵字、運算子、數字與標點 token
const JS_LINES = [
    [['keyword', 'const'], ' total ', ['operator', '='], ' ', ['number', '0'], ['punctuation', ';']],
    [['keyword', 'for'], ' ', ['punctuation', '('], ['keyword', 'const'], ' n ', ['keyword', 'of'], ' list', ['punctuation', ')'], ' total ', ['operator', '+='], ' n', ['punctuation', ';']],
];
const JS_CODE = 'const total = 0;\nfor (const n of list) total += n;';

// 三行 Python，第二行以四個空白縮排
const PY_LINES = [
    [['keyword', 'def'], ' ', ['function', 'add'], ['punctuation', '('], 'a', ['punctuation', ','], ' b', ['punctuation', ')'], ['punctuation', ':']],
    ['    ', ['keyword', 'return'], ' a ', ['operator', '+'], ' b'],
    [['builtin', 'print'], ['punctuation', '('], ['function', 'add'], ['punctuation', '('], ['number', '1'], ['punctuation', ','], ' ', ['number', '2'], ['punctuation', ')'], ['punctuation', ')']],
];
const PY_CODE = 'def add(a, b):\n    return a + b\nprint(add(1, 2))';

// 沒有語言的區塊，banner 顯示 "text"，行內沒有 token
const PLAIN_LINES = [['plain words only']];
const PLAIN_CODE = 'plain words only';

describe('export markdown: DeepSeek md-code-block', () => {
    it('fixture self-check: the pre holds the synthetic code as its text, with bare newline nodes between line spans', () => {
        const doc = new DOMParser().parseFromString(codeBlockHtml('python', PY_LINES), 'text/html');
        const pre = doc.querySelector('.md-code-block pre');
        expect(pre.textContent, 'the fixture renders the code text exactly').toBe(PY_CODE);
        expect(pre.getAttribute('class'), 'the pre carries no class, as on the live page').toBeNull();
        const bare = [...pre.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.data);
        expect(bare, 'line breaks are bare text nodes directly under pre').toEqual(['\n', '\n']);
    });

    it('exports a tokenized two-line JavaScript block with the banner language and each line once', () => {
        const markdown = toMarkdown(replyHtml(['<p>Before the code.</p>', codeBlockHtml('javascript', JS_LINES), '<p>After the code.</p>']));
        const { blocks, isUnclosed } = splitFences(markdown);

        expect(isUnclosed, 'every opened fence is closed').toBe(false);
        expect(blocks.length, 'one fenced code block').toBe(1);
        expect(blocks[0], 'the fence info string is the banner language and the body is the code exactly, each line once').toEqual({ info: 'javascript', body: JS_CODE });
    });

    it('keeps every line break and the indentation of a multi-line block', () => {
        const markdown = toMarkdown(replyHtml([codeBlockHtml('python', PY_LINES)]));
        const { blocks } = splitFences(markdown);

        expect(blocks.length, 'one fenced code block').toBe(1);
        expect(blocks[0].body.split('\n'), 'the body keeps the three source lines, the second indented by four spaces').toEqual(PY_CODE.split('\n'));
        expect(blocks[0].info, 'the fence info string is the language shown in the banner').toBe('python');
    });

    it('exports a block without a language as a fence with an empty info string, not the banner placeholder text', () => {
        const markdown = toMarkdown(replyHtml(['<p>Plain block below.</p>', codeBlockHtml('text', PLAIN_LINES)]));
        const { blocks } = splitFences(markdown);

        expect(blocks.length, 'one fenced code block').toBe(1);
        expect(blocks[0].info, 'a block without a language has an empty fence info string').toBe('');
        expect(blocks[0].body, 'the fenced body is the code exactly').toBe(PLAIN_CODE);
    });

    it('exports several blocks of one reply in order, each with its own language and code', () => {
        const markdown = toMarkdown(replyHtml([
            '<p>First.</p>', codeBlockHtml('javascript', JS_LINES),
            '<p>Second.</p>', codeBlockHtml('text', PLAIN_LINES),
            '<p>Third.</p>', codeBlockHtml('python', PY_LINES),
        ]));
        const { blocks } = splitFences(markdown);

        expect(blocks, 'three fenced blocks in reply order').toEqual([
            { info: 'javascript', body: JS_CODE },
            { info: '', body: PLAIN_CODE },
            { info: 'python', body: PY_CODE },
        ]);
    });

    it('keeps the banner chrome (language label, copy and download labels) out of the text around the fence', () => {
        const markdown = toMarkdown(replyHtml(['<p>Before the code.</p>', codeBlockHtml('javascript', JS_LINES), '<p>After the code.</p>']));
        const { outside } = splitFences(markdown);

        expect(outside, 'only the two paragraphs remain outside the fence').toEqual(['Before the code.', 'After the code.']);
    });

    it('exports a restored-reply code block, which has no banner, as a fence with an empty info string and the code exactly', () => {
        const html = restoredReplyHtml(['Restored intro.', '', '```', PY_CODE, '```'].join('\n'));
        const doc = new DOMParser().parseFromString(html, 'text/html');
        expect(doc.querySelector('.md-code-block pre'), 'fixture self-check: the restored block holds a pre').not.toBeNull();
        expect(doc.querySelector('.md-code-block-banner, .md-code-block-header'), 'fixture self-check: a restored block without a language has no banner and no header').toBeNull();

        const { blocks, isUnclosed } = splitFences(toMarkdown(html));

        expect(isUnclosed, 'every opened fence is closed').toBe(false);
        expect(blocks, 'one fenced block with an empty info string and the restored code, line breaks and indentation kept').toEqual([{ info: '', body: PY_CODE }]);
    });

    // 以下三則測試涵蓋 docs/architecture/EXPORT.md 記載的 banner 標籤規則（按鈕外第一個文字非空的 span，去除前後空白），作為 DeepSeek 版面變動時的防禦行為；夾具由實際 banner 夾具最小改動而來，並非在 DeepSeek 上觀察到的結構。
    it('exports a banner without a language label as an empty info string, without the button labels', () => {
        const markdown = toMarkdown(replyHtml([codeBlockHtml('', PY_LINES, '')]));

        expect(splitFences(markdown).blocks, 'one fence with an empty info string, since only button spans remain in the banner').toEqual([{ info: '', body: PY_CODE }]);
        expect(markdown, 'the copy button label stays out of the export').not.toContain(COPY_LABEL);
        expect(markdown, 'the download button label stays out of the export').not.toContain(DOWNLOAD_LABEL);
    });

    it('skips a whitespace-only span outside the buttons and takes the language from the next span', () => {
        const labelCell = '<div class="d2a24f03"><span class="d813de27">   </span><span class="d813de27">python</span></div>';
        const { blocks } = splitFences(toMarkdown(replyHtml([codeBlockHtml('', PY_LINES, labelCell)])));

        expect(blocks, 'the fence info string is the first non-blank label, not the blank span').toEqual([{ info: 'python', body: PY_CODE }]);
    });

    it('trims the spaces around the banner language label in the fence info string', () => {
        const markdown = toMarkdown(replyHtml([codeBlockHtml('  python  ', PY_LINES)]));
        // 直接讀圍欄開頭行的原文，不經 splitFences 的 trim，才看得出標籤是否已去除空白
        const openerInfos = markdown.split('\n').map((line) => FENCE_OPENER.exec(line)).filter(Boolean).map((match) => match[2]);

        expect(openerInfos[0], 'the opening fence line carries the trimmed language with no surrounding spaces').toBe('python');
        expect(splitFences(markdown).blocks, 'one fence holding the code exactly').toEqual([{ info: 'python', body: PY_CODE }]);
    });
});
