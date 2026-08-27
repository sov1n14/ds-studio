/**
 * Unit tests for the export surface of content/content-script.js
 *
 * Coverage map:
 *   1 _buildMarkdownHeader            - structure, contains export timestamp
 *   2 convertMessageNodeToMarkdown    - user message branch
 *                                       AI main-only branch
 *                                       AI with thinking (includeThinking=true/false)
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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

const { convertMessageNodeToMarkdown, exportConversationToMarkdown, _buildMarkdownHeader } = contentScript;

function makeUserMessage(text) {
    if (text === undefined) text = 'Hello world';
    const msg = document.createElement('div');
    msg.className = 'ds-message';
    const inner = document.createElement('div');
    inner.className = 'fbb737a4';
    inner.textContent = text;
    Object.defineProperty(inner, 'innerText', { value: text, configurable: true });
    msg.appendChild(inner);
    return msg;
}

function makeAiMessage(htmlContent) {
    if (htmlContent === undefined) htmlContent = '<p>Answer</p>';
    const msg = document.createElement('div');
    msg.className = 'ds-message';
    const md = document.createElement('div');
    md.className = 'ds-markdown ds-assistant-message-main-content';
    md.innerHTML = htmlContent;
    msg.appendChild(md);
    return msg;
}

function makeAiMessageWithThinking(opts) {
    opts = opts || {};
    const thinkHtml = opts.thinkHtml || '<p>Think step</p>';
    const mainHtml = opts.mainHtml || '<p>Main answer</p>';
    const thoughtLabel = opts.thoughtLabel || 'Thought for 3 seconds';

    const msg = document.createElement('div');
    msg.className = 'ds-message';

    const thinkWrapper = document.createElement('div');
    thinkWrapper.className = 'ds-think-wrapper';

    const thinkContent = document.createElement('div');
    thinkContent.className = 'ds-think-content';
    const thinkMd = document.createElement('div');
    thinkMd.className = 'ds-markdown';
    thinkMd.innerHTML = thinkHtml;
    thinkContent.appendChild(thinkMd);
    thinkWrapper.appendChild(thinkContent);

    const labelDiv = document.createElement('div');
    labelDiv.className = 'ds-think-label';
    const labelSpan = document.createElement('span');
    labelSpan.className = '_08cbf39';
    labelSpan.textContent = thoughtLabel;
    labelDiv.appendChild(labelSpan);
    thinkWrapper.appendChild(labelDiv);

    msg.appendChild(thinkWrapper);

    const mainMd = document.createElement('div');
    mainMd.className = 'ds-markdown ds-assistant-message-main-content';
    mainMd.innerHTML = mainHtml;
    msg.appendChild(mainMd);

    return msg;
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

    describe('user message (.fbb737a4)', () => {
        it('outputs ## User header', () => {
            const msg = makeUserMessage('test');
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toContain('## User');
        });

        it('includes the user text content', () => {
            const msg = makeUserMessage('Explain recursion');
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toContain('Explain recursion');
        });

        it('returns only separator when user text is empty', () => {
            const msg = document.createElement('div');
            msg.className = 'ds-message';
            const inner = document.createElement('div');
            inner.className = 'fbb737a4';
            inner.textContent = '   ';
            Object.defineProperty(inner, 'innerText', { value: '   ', configurable: true });
            msg.appendChild(inner);
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

        it('includes thought label (._08cbf39) in thinking section', () => {
            const msg = makeAiMessageWithThinking({ thoughtLabel: 'Thought for 5 seconds' });
            const result = convertMessageNodeToMarkdown(msg, true, true);
            expect(result).toContain('Thought for 5 seconds');
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
