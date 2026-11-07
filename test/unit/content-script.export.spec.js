// @vitest-environment jsdom
/**
 * Unit tests for the export surface of content/content-script.js
 *
 * Runs under jsdom: the think-block selectors are structural (multi-level `:has()` anchored at .ds-message), which happy-dom mis-evaluates; jsdom matched Chrome on the captured DeepSeek snapshots. jsdom has no innerText, so the spec installs a textContent-backed getter for its own run.
 *
 * Message fixtures are copies of live DeepSeek markup (test/helpers/think-block-fixtures.js): a user message and a think-less reply from a finished conversation, and a finished reply whose expanded think block holds three think steps, a "搜索到 15 个网页" search row and a "浏览 4 个页面" row with four reference links.
 *
 * Coverage map:
 *   1 _buildMarkdownHeader            - structure, contains export timestamp
 *   2 convertMessageNodeToMarkdown    - user message branch
 *                                       AI main-only branch
 *                                       AI with thinking (includeThinking=true/false)
 *                                       think status label, reference row, order, hash rotation
 *                                       includeReferences flag forwarded
 *                                       null/empty node guard
 *                                       always appends --- separator
 *   3 exportConversationToMarkdown    - with Harvest: assembles from result.items in order
 *                                       with Harvest: footer carries correct reason clause per reason code
 *                                       with Harvest: footer does NOT say "timed out" for reason=stalled (Defect 1 regression)
 *                                       with Harvest: footer captured-count matches actual item count
 *                                       with Harvest: footer ABSENT and toast NOT called on isComplete:true
 *                                       with Harvest: toast called exactly once with (count, clause) on isComplete:false
 *                                       with Harvest: download still happens when isComplete:false (partial file kept)
 *                                       with Harvest: does not throw when HarvestPolicy is unavailable (Defect fallback)
 *                                       with Harvest: calls downloadMarkdown (no alert) when items present
 *                                       with Harvest: alerts and returns early when items is empty
 *                                       fallback (no Harvest): uses visible-DOM query
 *                                       fallback (no Harvest): alerts when no DOM messages
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';
import { loadThinkMessage, loadMessagesWithoutThinkBlock, thinkParts, stripHashedClasses } from '../helpers/think-block-fixtures.js';

const { convertMessageNodeToMarkdown, exportConversationToMarkdown, _buildMarkdownHeader } = contentScript;

// jsdom does not implement innerText; the export reads it for user messages.
const hadOwnInnerText = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'innerText');
beforeAll(() => {
    if (!hadOwnInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    }
});
afterAll(() => {
    if (!hadOwnInnerText) delete HTMLElement.prototype.innerText;
});

/** Real user message showing `text` as its prompt. */
function makeUserMessage(text) {
    if (text === undefined) text = 'Hello world';
    const { userMessage } = loadMessagesWithoutThinkBlock();
    userMessage.querySelector('.ds-collapsible-text span').textContent = text;
    return userMessage;
}

/** Real think-less reply whose answer markdown holds `htmlContent`. */
function makeAiMessage(htmlContent) {
    if (htmlContent === undefined) htmlContent = '<p>Answer</p>';
    const { assistantMessage } = loadMessagesWithoutThinkBlock();
    assistantMessage.querySelector('.ds-assistant-message-main-content').innerHTML = htmlContent;
    return assistantMessage;
}

/** Real finished reply with an expanded think block; the first think step, the answer and the header status label are replaceable. */
function makeAiMessageWithThinking(opts) {
    opts = opts || {};
    const msg = loadThinkMessage('open');
    const { block, statusSpan } = thinkParts(msg);
    if (opts.thinkHtml) block.querySelector('.ds-think-content .ds-markdown').innerHTML = opts.thinkHtml;
    if (opts.mainHtml) msg.querySelector('.ds-assistant-message-main-content').innerHTML = opts.mainHtml;
    if (opts.thoughtLabel) statusSpan.textContent = opts.thoughtLabel;
    return msg;
}

/** Non-blank lines of the exported thinking section (each starts with "> "), without the section title. */
function thinkingLines(markdown) {
    const lines = markdown.split('\n');
    const start = lines.indexOf('> **Thinking Process:**');
    const out = [];
    for (let i = start + 1; i < lines.length && lines[i].startsWith('>'); i++) {
        if (lines[i].slice(1).trim() !== '') out.push(lines[i]);
    }
    return out;
}

function installHarvestMock(overrides) {
    overrides = overrides || {};
    const defaults = {
        harvestAllMessages: vi.fn().mockResolvedValue({ items: [], isComplete: true }),
        showHarvestOverlay: vi.fn(),
        updateHarvestOverlay: vi.fn(),
        hideHarvestOverlay: vi.fn(),
    };
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.Harvest = Object.assign({}, defaults, overrides);
    return window.DSstudio.Harvest;
}

function removeHarvestMock() {
    if (window.DSstudio) {
        delete window.DSstudio.Harvest;
    }
}

function installHarvestPolicyMock() {
    const REASON_CLAUSES = {
        stalled: 'the conversation stopped loading new messages before the end was reached',
        scroll_interrupted: 'the page was scrolled by something else during the export',
        cancelled: 'the export was cancelled',
        no_container: 'the conversation scroll container could not be found',
        no_messages: 'no messages were found in the conversation',
    };
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.HarvestPolicy = {
        describeIncompleteReason: vi.fn(function (reason) {
            if (reason && REASON_CLAUSES[reason]) return REASON_CLAUSES[reason];
            if (reason) return 'an unrecognized condition occurred (' + reason + ')';
            return 'the export stopped early for an unspecified reason';
        }),
    };
    return window.DSstudio.HarvestPolicy;
}

function removeHarvestPolicyMock() {
    if (window.DSstudio) {
        delete window.DSstudio.HarvestPolicy;
    }
}

describe('_buildMarkdownHeader', () => {
    it('starts with the expected H1 title', () => {
        const header = _buildMarkdownHeader();
        expect(header).toMatch(/^# DeepSeek Chat Export/);
    });

    it('contains the "Exported at:" timestamp line', () => {
        const header = _buildMarkdownHeader();
        expect(header).toContain('Exported at:');
    });

    it('ends with the --- separator', () => {
        const header = _buildMarkdownHeader();
        expect(header.trimEnd()).toMatch(/---\s*$/);
    });
});

describe('convertMessageNodeToMarkdown', () => {
    it('returns empty string for null node', () => {
        expect(convertMessageNodeToMarkdown(null, true, true)).toBe('');
    });

    it('always appends --- separator line', () => {
        const msg = makeUserMessage('hi');
        const result = convertMessageNodeToMarkdown(msg, true, true);
        expect(result).toContain('---');
    });

    describe('user message', () => {
        it('outputs ## User header', () => {
            const msg = makeUserMessage('test');
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toContain('## User');
        });

        it('includes the user text content', () => {
            const msg = makeUserMessage('Explain recursion');
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toBe('## User\n\nExplain recursion\n\n---\n\n');
        });

        it('returns only separator when user text is empty', () => {
            const msg = makeUserMessage('   ');
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).not.toContain('## User');
            expect(result).toContain('---');
        });
    });

    describe('AI message (no thinking)', () => {
        it('outputs ## DeepSeek header', () => {
            const msg = makeAiMessage('<p>Answer</p>');
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toContain('## DeepSeek');
        });

        it('includes parsed main response text', () => {
            const msg = makeAiMessage('<p>Hello there</p>');
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toContain('Hello there');
        });

        it('does NOT include Thinking Process section when no think block exists', () => {
            const msg = makeAiMessage('<p>No thinking here</p>');
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).not.toContain('Thinking Process');
        });
    });

    describe('AI message with thinking block', () => {
        it('includes Thinking Process section when includeThinking=true', () => {
            const msg = makeAiMessageWithThinking({ thinkHtml: '<p>Step 1</p>' });
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toContain('Thinking Process');
            expect(result).toContain('Step 1');
        });

        it('excludes Thinking Process section when includeThinking=false', () => {
            const msg = makeAiMessageWithThinking({ thinkHtml: '<p>Step 1</p>' });
            const result = convertMessageNodeToMarkdown(msg, false, true);
            expect(result).not.toContain('Thinking Process');
            expect(result).not.toContain('Step 1');
        });

        it('still includes main answer when includeThinking=false', () => {
            const msg = makeAiMessageWithThinking({ mainHtml: '<p>Main answer text</p>' });
            const result = convertMessageNodeToMarkdown(msg, false, true);
            expect(result).toContain('Main answer text');
        });

        it('exports the header status label as the thought label, never the search-result count beside it', () => {
            const msg = makeAiMessageWithThinking({ thoughtLabel: 'Thought for 5 seconds' });
            const lines = thinkingLines(convertMessageNodeToMarkdown(msg, true, true));
            expect(lines[0]).toBe('> Thought for 5 seconds');
            expect(lines.filter((line) => line.includes('Thought for 5 seconds'))).toHaveLength(1);
            expect(lines.join('\n'), 'the search-result count row was exported as a thought label').not.toContain('搜索到 15 个网页');
        });

        it('exports status, think steps and the browse row with its links in page order', () => {
            const msg = makeAiMessageWithThinking();
            const browseRow = Array.from(thinkParts(msg).block.children).find((child) => child.textContent.startsWith('浏览 4 个页面'));
            const links = Array.from(browseRow.querySelectorAll('a')).map((a) => ' [' + a.textContent + '](' + a.href + ')').join('');
            expect(links, 'fixture: the browse row holds four reference links').toContain('[Reference page 4]');

            const lines = thinkingLines(convertMessageNodeToMarkdown(msg, true, true));

            expect(lines).toEqual([
                '> 已思考（用时 3 秒）',
                '> Placeholder think step 1.',
                '> Placeholder think step 2.',
                '> 浏览 4 个页面' + links,
                '> Placeholder think step 3.',
            ]);
        });

        it('exports the same thinking section after DeepSeek rotates every hashed class', () => {
            const expected = thinkingLines(convertMessageNodeToMarkdown(makeAiMessageWithThinking(), true, true));
            const rotated = stripHashedClasses(makeAiMessageWithThinking());
            expect(thinkParts(rotated).block.className, 'fixture: the block kept no hashed class').toBe('');

            expect(thinkingLines(convertMessageNodeToMarkdown(rotated, true, true))).toEqual(expected);
        });
    });

    describe('includeReferences flag', () => {
        function makeAiMessageWithCitation() {
            const msg = document.createElement('div');
            msg.className = 'ds-message';
            const md = document.createElement('div');
            md.className = 'ds-markdown';
            const a = document.createElement('a');
            a.href = 'https://example.com';
            const citeSpan = document.createElement('span');
            citeSpan.className = 'ds-markdown-cite';
            citeSpan.textContent = '1';
            a.appendChild(citeSpan);
            md.appendChild(a);
            msg.appendChild(md);
            return msg;
        }

        it('includes citation links when includeReferences=true', () => {
            const msg = makeAiMessageWithCitation();
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toContain('link-1');
        });

        it('omits citation links when includeReferences=false', () => {
            const msg = makeAiMessageWithCitation();
            const result = convertMessageNodeToMarkdown(msg, true, false);
            expect(result).not.toContain('link-1');
        });
    });
});

describe('exportConversationToMarkdown', () => {
    let downloadSpy;
    let alertSpy;
    let toastSpy;

    beforeEach(() => {
        document.body.innerHTML = '';
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: '', globalDefaultPrompt: '', isGlobalPromptEnabled: true, isShowSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn().mockReturnValue('blob:fake'),
            revokeObjectURL: vi.fn(),
        });
        downloadSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            const el = document.createElement.wrappedFunction
                ? document.createElement.wrappedFunction(tag)
                : Object.getPrototypeOf(document).createElement.call(document, tag);
            return el;
        });
        downloadSpy.mockRestore();

        alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        toastSpy = vi.fn();
        vi.stubGlobal('showHarvestToastIncomplete', toastSpy);

        removeHarvestMock();
        removeHarvestPolicyMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        removeHarvestMock();
        removeHarvestPolicyMock();
        document.body.innerHTML = '';
    });

    describe('with Harvest module', () => {
        it('calls harvestAllMessages', async () => {
            const harvest = installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [makeUserMessage('hi')],
                    isComplete: true,
                }),
            });
            await exportConversationToMarkdown(true, true);
            expect(harvest.harvestAllMessages).toHaveBeenCalledOnce();
        });

        it('assembles Markdown from items in order (message 1 before message 2)', async () => {
            const msg1 = makeUserMessage('first');
            const msg2 = makeAiMessage('<p>second</p>');

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [msg1, msg2],
                    isComplete: true,
                }),
            });

            await exportConversationToMarkdown(true, true);

            const md1 = convertMessageNodeToMarkdown(msg1, true, true);
            const md2 = convertMessageNodeToMarkdown(msg2, true, true);
            expect(md1).toContain('first');
            expect(md2).toContain('second');
        });

        it('REGRESSION Defect1: footer for reason=stalled does NOT say timed out', async () => {
            installHarvestPolicyMock();
            const OrigBlob = global.Blob;
            let blobContent = '';
            global.Blob = class MockBlob {
                constructor(parts) { blobContent = parts.join(''); }
            };

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [makeUserMessage('partial msg')],
                    isComplete: false,
                    reason: 'stalled',
                }),
            });

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(blobContent).not.toContain('timed out');
            expect(blobContent).toContain(
                '> ⚠️ Export may be incomplete (1 messages captured): the conversation stopped loading new messages before the end was reached.'
            );
        });

        it('footer carries the correct clause for reason=scroll_interrupted', async () => {
            installHarvestPolicyMock();
            const OrigBlob = global.Blob;
            let blobContent = '';
            global.Blob = class MockBlob {
                constructor(parts) { blobContent = parts.join(''); }
            };

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [makeUserMessage('partial via interruption')],
                    isComplete: false,
                    reason: 'scroll_interrupted',
                }),
            });

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(blobContent).toContain(
                '> ⚠️ Export may be incomplete (1 messages captured): the page was scrolled by something else during the export.'
            );
        });

        it('footer carries the correct clause for reason=cancelled', async () => {
            installHarvestPolicyMock();
            const OrigBlob = global.Blob;
            let blobContent = '';
            global.Blob = class MockBlob {
                constructor(parts) { blobContent = parts.join(''); }
            };

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [makeUserMessage('a'), makeUserMessage('b'), makeUserMessage('c')],
                    isComplete: false,
                    reason: 'cancelled',
                }),
            });

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(blobContent).toContain(
                '> ⚠️ Export may be incomplete (3 messages captured): the export was cancelled.'
            );
        });

        it('footer captured-count matches the actual harvested item count (non-round number)', async () => {
            installHarvestPolicyMock();
            const OrigBlob = global.Blob;
            let blobContent = '';
            global.Blob = class MockBlob {
                constructor(parts) { blobContent = parts.join(''); }
            };

            const items = [];
            for (let i = 0; i < 7; i++) items.push(makeUserMessage('msg-' + i));
            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items,
                    isComplete: false,
                    reason: 'no_container',
                }),
            });

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(blobContent).toContain('(7 messages captured)');
        });

        it('footer is ABSENT and toast is NOT called when isComplete=true', async () => {
            installHarvestPolicyMock();
            const OrigBlob = global.Blob;
            let blobContent = '';
            global.Blob = class MockBlob {
                constructor(parts) { blobContent = parts.join(''); }
            };

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [makeUserMessage('full msg')],
                    isComplete: true,
                }),
            });

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(blobContent).not.toContain('⚠️ Export may be incomplete');
            expect(blobContent).toContain('full msg');
            expect(toastSpy).not.toHaveBeenCalled();
        });

        it('REGRESSION Defect2: calls showHarvestToastIncomplete exactly once with count and clause when isComplete=false', async () => {
            installHarvestPolicyMock();
            const OrigBlob = global.Blob;
            global.Blob = class MockBlob {
                constructor() {}
            };

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [makeUserMessage('a'), makeUserMessage('b')],
                    isComplete: false,
                    reason: 'stalled',
                }),
            });

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(toastSpy).toHaveBeenCalledOnce();
            expect(toastSpy).toHaveBeenCalledWith(
                2,
                'the conversation stopped loading new messages before the end was reached'
            );
        });

        it('still downloads (does not suppress) the partial file when isComplete=false', async () => {
            installHarvestPolicyMock();
            const createObjectURL = vi.fn().mockReturnValue('blob:fake');
            vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

            const OrigBlob = global.Blob;
            global.Blob = class MockBlob {
                constructor() {}
            };

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [makeUserMessage('partial')],
                    isComplete: false,
                    reason: 'stalled',
                }),
            });

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(createObjectURL).toHaveBeenCalledOnce();
            expect(alertSpy).not.toHaveBeenCalled();
        });

        it('does not throw when HarvestPolicy is unavailable, and still downloads with a footer', async () => {
            removeHarvestPolicyMock();

            const createObjectURL = vi.fn().mockReturnValue('blob:fake');
            vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

            const OrigBlob = global.Blob;
            let blobContent = '';
            global.Blob = class MockBlob {
                constructor(parts) { blobContent = parts.join(''); }
            };

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [makeUserMessage('partial')],
                    isComplete: false,
                    reason: 'stalled',
                }),
            });

            await expect(exportConversationToMarkdown(true, true)).resolves.not.toThrow();

            global.Blob = OrigBlob;

            expect(blobContent).toContain('⚠️ Export may be incomplete');
            expect(createObjectURL).toHaveBeenCalledOnce();
        });

        it('alerts and does NOT call Blob when harvest returns empty items', async () => {
            installHarvestPolicyMock();
            const OrigBlob = global.Blob;
            let blobCalled = false;
            global.Blob = class MockBlob {
                constructor() { blobCalled = true; }
            };

            installHarvestMock({
                harvestAllMessages: vi.fn().mockResolvedValue({
                    items: [],
                    isComplete: false,
                    reason: 'no_messages',
                }),
            });

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(alertSpy).toHaveBeenCalledOnce();
            expect(blobCalled).toBe(false);
        });
    });

    describe('fallback path (no Harvest module)', () => {
        beforeEach(() => {
            removeHarvestMock();
        });

        it('alerts when no .ds-message nodes exist in visible DOM', async () => {
            await exportConversationToMarkdown(true, true);
            expect(alertSpy).toHaveBeenCalledOnce();
        });

        it('calls Blob with visible messages content when messages exist in DOM', async () => {
            const visibleItems = document.createElement('div');
            visibleItems.className = 'ds-virtual-list-visible-items';
            const msg = makeUserMessage('fallback message');
            const wrapper = document.createElement('div');
            wrapper.appendChild(msg);
            visibleItems.appendChild(wrapper);
            document.body.appendChild(visibleItems);

            const OrigBlob = global.Blob;
            let blobContent = '';
            global.Blob = class MockBlob {
                constructor(parts) { blobContent = parts.join(''); }
            };

            await exportConversationToMarkdown(true, true);

            global.Blob = OrigBlob;

            expect(alertSpy).not.toHaveBeenCalled();
            expect(blobContent).toContain('fallback message');
        });
    });
});
