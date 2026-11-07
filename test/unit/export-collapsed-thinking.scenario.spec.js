// @vitest-environment jsdom
/**
 * Scenario: exporting a conversation whose think block is collapsed on screen.
 *
 * Requirement (user report): with "export includes thinking" on, the exported Markdown contains the thinking process even when the think block is collapsed, whether the user collapsed it or "hide thinking" did. Collapsing is a display-layer choice and MUST NOT change the export, and the export MUST NOT change the display: a collapsed block is collapsed again afterwards, an expanded one stays expanded. With "export includes thinking" off, the export never expands a collapsed block.
 *
 * Why the scenario form: DeepSeek's native collapse unmounts the think body (the captured think-closed snapshot holds no .ds-think-content), so the thinking only exists on the page while the block is expanded. The defect lives between real modules sharing the page DOM (content-script export, the scroll harvest, hide-thinking's observer), so none of them is mocked. Only trust boundaries are stubbed: chrome.runtime (settings for hide-thinking), Blob / URL (the download), and the incomplete-export toast global.
 *
 * Runs under jsdom: the think-block selectors are structural (multi-level :has()), which happy-dom mis-evaluates. jsdom has no innerText, so the spec installs a textContent-backed getter for its own run.
 *
 * DOM: real DeepSeek messages from test/helpers/think-block-fixtures.js inside the virtual-list structure the harvest scans. DeepSeek's header toggle is modelled by installNativeThinkToggle: a header click detaches or re-inserts the think body nodes. The conversation fits the viewport (scrollHeight === clientHeight), so every message is mounted and the harvest needs no scrolling.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';
import '../../content/ds-selectors.js';
import '../../utils/storage-manager.js';
import StorageManager from '../../utils/storage-manager.js';
import '../../content/harvest.toast.js';
import '../../content/harvest.dom.js';
import '../../content/harvest.js';
import contentScript from '../../content/content-script.js';
import { loadThinkMessage, loadMessagesWithoutThinkBlock, thinkParts, thinkBodyNodes, installNativeThinkToggle } from '../helpers/think-block-fixtures.js';

const { exportConversationToMarkdown } = contentScript;

const hadOwnInnerText = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'innerText');
beforeAll(() => {
    if (!hadOwnInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    }
});
afterAll(() => {
    if (!hadOwnInnerText) delete HTMLElement.prototype.innerText;
});

/** True when the block shows its think body the way the captured expanded snapshot does. */
function showsThinking(block) {
    return block.querySelector('.ds-think-content') !== null;
}

/** Expected thinking content derived from the captured expanded block: the header status label and the text of every think step. */
function expectedThinkingTexts() {
    const { block, statusSpan } = thinkParts(loadThinkMessage('open'));
    const steps = Array.from(block.querySelectorAll('.ds-think-content .ds-markdown')).map((el) => el.textContent.trim()).filter(Boolean);
    return { status: statusSpan.textContent.trim(), steps };
}

/** Non-blank lines of the exported thinking section (each starts with "> "), without the section title; empty when the section is missing. */
function thinkingLines(markdown) {
    const lines = markdown.split('\n');
    const start = lines.indexOf('> **Thinking Process:**');
    if (start === -1) return [];
    const out = [];
    for (let i = start + 1; i < lines.length && lines[i].startsWith('>'); i++) {
        if (lines[i].slice(1).trim() !== '') out.push(lines[i]);
    }
    return out;
}

/**
 * Mounts a finished two-message conversation (real user prompt, real reply with a think block) in the virtual-list structure the harvest scans; the container does not overflow.
 * `state`: 'expanded' leaves the think block open; 'collapsed' collapses it through its header the way hide-thinking and the user do.
 */
function mountConversation(state) {
    const scrollArea = document.createElement('div');
    scrollArea.className = 'ds-virtual-list ds-scroll-area';
    Object.defineProperty(scrollArea, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });
    scrollArea.scrollBy = () => {};
    scrollArea.scrollTo = () => {};
    const listItems = document.createElement('div');
    listItems.className = 'ds-virtual-list-items';
    const visibleItems = document.createElement('div');
    visibleItems.className = 'ds-virtual-list-visible-items';
    listItems.appendChild(visibleItems);
    scrollArea.appendChild(listItems);

    const { userMessage } = loadMessagesWithoutThinkBlock();
    const parts = thinkParts(loadThinkMessage('open'));
    [userMessage, parts.msg].forEach((msg, key) => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-virtual-list-item-key', String(key));
        wrapper.appendChild(msg);
        visibleItems.appendChild(wrapper);
    });
    document.body.appendChild(scrollArea);

    const clicks = installNativeThinkToggle(parts.block);
    if (state === 'collapsed') {
        parts.header.click();
        clicks.mockClear();
    }
    return { ...parts, clicks };
}

/** Records every think step node mounted into `block` from now on (any route, not only a header click). */
function watchBodyMounts(block) {
    const mounted = [];
    const observer = new MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach((node) => {
            if (node.nodeType === 1 && (node.matches('.ds-think-content') || node.querySelector('.ds-think-content'))) mounted.push(node);
        }));
    });
    observer.observe(block, { childList: true, subtree: true });
    return {
        stop() {
            observer.takeRecords().forEach((record) => record.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && (node.matches('.ds-think-content') || node.querySelector('.ds-think-content'))) mounted.push(node);
            }));
            observer.disconnect();
            return mounted;
        },
    };
}

/** Runs the real export (real Harvest) under fake timers, so no assertion depends on a delay value; returns the downloaded Markdown. */
async function runExport(includeThinking) {
    let markdown = null;
    const OrigBlob = globalThis.Blob;
    globalThis.Blob = class CapturingBlob {
        constructor(parts) { markdown = parts.join(''); }
    };
    vi.useFakeTimers();
    try {
        const pending = exportConversationToMarkdown(includeThinking, true);
        await vi.runAllTimersAsync();
        await pending;
    } finally {
        vi.useRealTimers();
        globalThis.Blob = OrigBlob;
    }
    expect(markdown, 'harness: the export produced no download').not.toBeNull();
    expect(markdown, 'harness: the harvest did not complete on a non-overflowing conversation').not.toContain('Export may be incomplete');
    return markdown;
}

/** Let MutationObserver deliveries and pending promise chains settle (real timers). */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

let alertSpy;

beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:fake'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('showHarvestToastIncomplete', vi.fn());
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    window.DSstudio = window.DSstudio || {};
    delete window.DSstudio.GoToTop;
    delete window.DSstudio.PreventAutoScroll;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('export with a natively collapsed think block', () => {
    it('harness: the real Harvest module is installed and the collapsed fixture shows no think body', () => {
        expect(typeof window.DSstudio.Harvest?.harvestAllMessages).toBe('function');
        const { block } = mountConversation('collapsed');
        expect(showsThinking(block)).toBe(false);
        expect(thinkBodyNodes(block)).toEqual([]);
    });

    it('includes the full thinking section when "include thinking" is on, then leaves the block collapsed as it was', async () => {
        const { status, steps } = expectedThinkingTexts();
        expect(steps, 'fixture: the expanded capture holds three think steps').toHaveLength(3);
        const { block, header, spacer, footer } = mountConversation('collapsed');
        const headerHtml = header.outerHTML;

        const markdown = await runExport(true);
        await flush();
        const lines = thinkingLines(markdown);

        expect(markdown, 'harness: the reply itself was exported').toContain('## DeepSeek');
        expect(lines, 'the exported Markdown has no thinking status label for the collapsed block').toContain('> ' + status);
        expect(lines[0]).toBe('> ' + status);
        steps.forEach((step) => expect(lines, 'think step missing from the export: ' + step).toContain('> ' + step));
        expect(showsThinking(block), 'the export left the collapsed block expanded on screen').toBe(false);
        expect(Array.from(block.children), 'the collapsed block does not hold exactly header, spacer and footer after the export').toEqual([header, spacer, footer]);
        expect(header.outerHTML, 'the export changed the header markup').toBe(headerHtml);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('exports the same thinking section as the same block expanded', async () => {
        mountConversation('expanded');
        const expandedLines = thinkingLines(await runExport(true));
        expect(expandedLines.length, 'harness: the expanded block exports a thinking section').toBeGreaterThan(0);

        document.body.innerHTML = '';
        mountConversation('collapsed');
        const collapsedLines = thinkingLines(await runExport(true));

        expect(collapsedLines, 'collapsing the block on screen changed the exported thinking section').toEqual(expandedLines);
    });

    it('never expands the collapsed block when "include thinking" is off', async () => {
        const { block, clicks } = mountConversation('collapsed');
        const watcher = watchBodyMounts(block);

        const markdown = await runExport(false);
        await flush();

        expect(watcher.stop(), 'the think body was mounted during an export that excludes thinking').toEqual([]);
        expect(clicks, 'the header was clicked during an export that excludes thinking').not.toHaveBeenCalled();
        expect(showsThinking(block)).toBe(false);
        expect(markdown).not.toContain('Thinking Process');
        expect(markdown, 'harness: the reply itself was exported').toContain('## DeepSeek');
    });
});

describe('export with an expanded think block', () => {
    it('exports the thinking section and leaves the block expanded with the same body nodes', async () => {
        const { status, steps } = expectedThinkingTexts();
        const { block, clicks } = mountConversation('expanded');
        const bodyBefore = thinkBodyNodes(block);
        expect(bodyBefore.length, 'fixture: the expanded block shows its body').toBeGreaterThan(0);

        const lines = thinkingLines(await runExport(true));
        await flush();

        expect(lines[0]).toBe('> ' + status);
        steps.forEach((step) => expect(lines, 'think step missing from the export: ' + step).toContain('> ' + step));
        expect(showsThinking(block), 'the export collapsed a block the user had expanded').toBe(true);
        expect(thinkBodyNodes(block)).toEqual(bodyBefore);
        expect(clicks, 'the export toggled a block that was already expanded').not.toHaveBeenCalled();
    });
});

/** Fresh chrome.runtime.onMessage stub with a fireable listener set. */
function createOnMessageStub() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        callListeners: (...args) => [...listeners].forEach((fn) => fn(...args)),
        listenerCount: () => listeners.size,
    };
}

describe('scenario: hide-thinking enabled with its observer running', () => {
    let HideThinking;

    /** Loads a fresh feature-toggle + hide-thinking pair whose settings say master on and hide thinking on, the way the content script starts on the live page. */
    async function loadEnabledHideThinking() {
        const values = { isEnabled: true, [StorageManager.KEYS.HIDE_THINKING]: true };
        chrome.runtime.onMessage = createOnMessageStub();
        chrome.runtime.sendMessage = vi.fn((_message, callback) => {
            const response = { ok: true, values };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
        vi.resetModules();
        await import('../../content/feature-toggle.js');
        HideThinking = (await import('../../content/hide-thinking.js')).default;
        await flush();
        expect(HideThinking.enabled, 'harness: hide-thinking started enabled from its settings').toBe(true);
    }

    afterEach(() => {
        if (HideThinking) HideThinking.disable();
        HideThinking = null;
    });

    it('exports the thinking of a block hide-thinking collapsed, leaves it collapsed, and hide-thinking can still restore it', async () => {
        const { status, steps } = expectedThinkingTexts();
        await loadEnabledHideThinking();
        const { block } = mountConversation('expanded');
        await flush();
        expect(showsThinking(block), 'fixture: hide-thinking collapsed the newly rendered block').toBe(false);

        const lines = thinkingLines(await runExport(true));
        await flush();
        await flush();

        expect(lines, 'the exported Markdown has no thinking status label for the block hide-thinking collapsed').toContain('> ' + status);
        expect(lines[0]).toBe('> ' + status);
        steps.forEach((step) => expect(lines, 'think step missing from the export: ' + step).toContain('> ' + step));
        expect(showsThinking(block), 'the block hide-thinking collapsed is expanded after the export').toBe(false);

        HideThinking.disable();
        expect(showsThinking(block), 'turning hide-thinking off no longer re-expands the block after the export').toBe(true);
    });
});
