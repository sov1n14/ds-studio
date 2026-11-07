// @vitest-environment jsdom
/**
 * content/harvest.think.js — _cloneMessageWithThinkingExpanded(msg) on the paths the export scenario spec does not reach.
 *
 * Requirement: the export clones a message with its thinking even when DeepSeek's native collapse has unmounted the think body. For each collapsed block (header present, no mounted body) the function clicks the native header, waits for the body to mount (at once when the mount is synchronous, otherwise polling for about 2 s), clones the message, and then clicks the header again on every block whose body is mounted, also when cloning throws. A block that was expanded is never toggled. When the body never mounts it still resolves with a clone and leaves the block as it was. Without content/retry-until.js loaded first it fails with a load-order error.
 *
 * DOM: real captured blocks from test/helpers/think-block-fixtures.js; the native toggle is modelled by installNativeThinkToggle (synchronous mount) or installDelayedNativeThinkToggle (mount after a delay). Runs under jsdom because the think selectors use multi-level :has(), which happy-dom mis-evaluates. Fake timers drive every wait, so no assertion depends on the module's poll interval or retry count.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../content/ds-selectors.js';
import '../../content/retry-until.js';
import think from '../../content/harvest.think.js';
import { loadThinkMessage, thinkParts, thinkBodyNodes, installNativeThinkToggle, installDelayedNativeThinkToggle } from '../helpers/think-block-fixtures.js';

const MODULE_FILE = path.resolve(__dirname, '../../content/harvest.think.js');
const { _cloneMessageWithThinkingExpanded } = think;
const Selectors = globalThis.DSstudio.Selectors;

/** A body mount delay far below the ~2 s mount wait of the requirement. */
const SHORT_MOUNT_DELAY_MS = 300;
/** Time within which a clone must settle once a SHORT_MOUNT_DELAY_MS body has mounted: still well below the ~2 s give-up. */
const SETTLE_WITHIN_MS = 1000;

/** Detached copies of the think body nodes the captured expanded block shows. */
function expandedBodyNodes() {
    return thinkBodyNodes(thinkParts(loadThinkMessage('open')).block);
}

/** A collapsed captured block (header, spacer, footer) as `parts`, plus the body nodes its toggle mounts and their markup. */
function collapsedBlock() {
    const parts = thinkParts(loadThinkMessage('closed'));
    const body = expandedBodyNodes();
    return { ...parts, body, bodyHtml: body.map((n) => n.outerHTML), headerHtml: parts.header.outerHTML };
}

function attach(msg) {
    document.body.appendChild(msg);
    return msg;
}

/** Starts the clone and records when it settles, so a hang shows up as "not settled" instead of a test timeout. */
function track(promise) {
    const state = { settled: false, value: undefined, error: undefined };
    state.done = promise.then((v) => { state.value = v; }, (e) => { state.error = e; }).finally(() => { state.settled = true; });
    return state;
}

function expectCollapsedAsCaptured({ block, header, spacer, footer, headerHtml }, label) {
    expect(block.querySelector('.ds-think-content'), label + ': the live block shows a think body').toBeNull();
    expect(Array.from(block.children), label + ': the live block does not hold exactly header, spacer and footer').toEqual([header, spacer, footer]);
    expect(header.outerHTML, label + ': the header markup changed').toBe(headerHtml);
}

beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('fixture self-check', () => {
    it('the delayed toggle mounts the body only after its delay and collapses at once', async () => {
        const b = collapsedBlock();
        installDelayedNativeThinkToggle(b.block, SHORT_MOUNT_DELAY_MS, b.body);
        b.header.click();
        expect(thinkBodyNodes(b.block)).toEqual([]);
        await vi.advanceTimersByTimeAsync(SHORT_MOUNT_DELAY_MS);
        expect(thinkBodyNodes(b.block)).toEqual(b.body);
        b.header.click();
        expectCollapsedAsCaptured(b, 'after a second click');
    });
});

describe('_cloneMessageWithThinkingExpanded', () => {
    it('waits for a body that mounts after a delay, clones it, and collapses the live block again', async () => {
        const b = collapsedBlock();
        attach(b.msg);
        installDelayedNativeThinkToggle(b.block, SHORT_MOUNT_DELAY_MS, b.body);

        const run = track(_cloneMessageWithThinkingExpanded(b.msg));
        await vi.advanceTimersByTimeAsync(SETTLE_WITHIN_MS);

        expect(run.settled, 'the clone did not settle within ' + SETTLE_WITHIN_MS + ' ms of a body that mounted after ' + SHORT_MOUNT_DELAY_MS + ' ms').toBe(true);
        expect(run.error).toBeUndefined();
        const clone = run.value;
        expect(clone).not.toBe(b.msg);
        expect(clone.isConnected).toBe(false);
        expect(thinkBodyNodes(thinkParts(clone).block).map((n) => n.outerHTML), 'the clone lacks the think body that mounted after the delay').toEqual(b.bodyHtml);
        expectCollapsedAsCaptured(b, 'after the clone');
    });

    it('resolves with a body-less clone when the body never mounts, and leaves the block as it was', async () => {
        const b = collapsedBlock();
        attach(b.msg);
        const clicks = vi.fn();
        b.header.addEventListener('click', clicks);
        const markupBefore = b.msg.outerHTML;

        const run = track(_cloneMessageWithThinkingExpanded(b.msg));
        await vi.runAllTimersAsync();

        expect(run.settled, 'the clone never settled for a body that never mounts').toBe(true);
        expect(run.error, 'the clone rejected for a body that never mounts').toBeUndefined();
        expect(run.value).not.toBe(b.msg);
        expect(run.value.querySelector('.ds-think-content')).toBeNull();
        expect(run.value.outerHTML).toBe(markupBefore);
        expectCollapsedAsCaptured(b, 'after giving up');
        expect(clicks, 'the header was not clicked to expand the block, or was clicked again although its body never mounted').toHaveBeenCalledTimes(1);
    });

    it('propagates a clone failure and still collapses every block it expanded', async () => {
        const first = collapsedBlock();
        const second = collapsedBlock();
        first.block.after(second.block);
        attach(first.msg);
        installDelayedNativeThinkToggle(first.block, SHORT_MOUNT_DELAY_MS, first.body);
        installDelayedNativeThinkToggle(second.block, SHORT_MOUNT_DELAY_MS, second.body);
        const failure = new Error('clone failed');
        let isBodyMountedAtClone = null;
        vi.spyOn(first.msg, 'cloneNode').mockImplementationOnce(() => {
            isBodyMountedAtClone = thinkBodyNodes(first.block).length > 0 && thinkBodyNodes(second.block).length > 0;
            throw failure;
        });

        const run = track(_cloneMessageWithThinkingExpanded(first.msg));
        await vi.runAllTimersAsync();

        expect(run.settled).toBe(true);
        expect(run.error, 'the clone failure was swallowed or replaced').toBe(failure);
        expect(isBodyMountedAtClone, 'harness: both bodies were mounted when the clone threw').toBe(true);
        expectCollapsedAsCaptured(first, 'first block after the failure');
        expectCollapsedAsCaptured(second, 'second block after the failure');
    });

    it('toggles only the collapsed block of a message that also holds an expanded one', async () => {
        const collapsed = collapsedBlock();
        const expandedMsg = thinkParts(loadThinkMessage('open'));
        const msg = collapsed.msg;
        collapsed.block.after(expandedMsg.block);
        attach(msg);
        const expandedBody = thinkBodyNodes(expandedMsg.block);
        const expandedBodyHtml = expandedBody.map((n) => n.outerHTML);
        const collapsedClicks = installNativeThinkToggle(collapsed.block, collapsed.body);
        const expandedClicks = installNativeThinkToggle(expandedMsg.block);

        const run = track(_cloneMessageWithThinkingExpanded(msg));
        await vi.runAllTimersAsync();

        expect(run.error).toBeUndefined();
        const [cloneCollapsed, cloneExpanded] = Array.from(run.value.children).slice(0, 2);
        expect(thinkBodyNodes(cloneCollapsed).map((n) => n.outerHTML), 'the clone lacks the body of the collapsed block').toEqual(collapsed.bodyHtml);
        expect(thinkBodyNodes(cloneExpanded).map((n) => n.outerHTML), 'the clone lacks the body of the expanded block').toEqual(expandedBodyHtml);
        expectCollapsedAsCaptured(collapsed, 'collapsed block after the clone');
        expect(thinkBodyNodes(expandedMsg.block), 'the expanded block does not show the same body nodes after the clone').toEqual(expandedBody);
        expect(expandedClicks, 'the already expanded block was toggled').not.toHaveBeenCalled();
        expect(collapsedClicks, 'the collapsed block was not expanded once and restored once').toHaveBeenCalledTimes(2);
    });
});

describe('_cloneMessageWithThinkingExpanded with several blocks or a changed block shape', () => {
    /** Markup of the think body nodes of the `index`-th block of a clone. */
    function cloneBodyHtml(clone, index) {
        return thinkBodyNodes(clone.children[index]).map((n) => n.outerHTML);
    }

    /** Two collapsed captured blocks inside the first block's message, in DOM order. */
    function twoCollapsedBlocks() {
        const first = collapsedBlock();
        const second = collapsedBlock();
        first.block.after(second.block);
        attach(first.msg);
        return { first, second, msg: first.msg };
    }

    it('does not treat a think block without a header in the header position as collapsed: resolves with a plain clone and leaves the block untouched', async () => {
        const b = collapsedBlock();
        b.block.prepend(document.createElement('span'));
        attach(b.msg);
        expect(Array.from(b.msg.querySelectorAll(Selectors.THINK_BLOCK_SELECTOR)), 'harness: the block is still recognised as a think block').toEqual([b.block]);
        const markupBefore = b.msg.outerHTML;

        const run = track(_cloneMessageWithThinkingExpanded(b.msg));
        await vi.runAllTimersAsync();

        expect(run.settled).toBe(true);
        expect(run.error, 'a think block with no header was handled as a collapsed block').toBeUndefined();
        expect(run.value).not.toBe(b.msg);
        expect(run.value.outerHTML, 'the clone differs from the message as shown').toBe(markupBefore);
        expect(b.msg.outerHTML, 'the live message changed').toBe(markupBefore);
    });

    it('waits for every collapsed block when one body mounts at once and the other only after a delay', async () => {
        const { first, second, msg } = twoCollapsedBlocks();
        installNativeThinkToggle(first.block, first.body);
        installDelayedNativeThinkToggle(second.block, SHORT_MOUNT_DELAY_MS, second.body);

        const run = track(_cloneMessageWithThinkingExpanded(msg));
        await vi.advanceTimersByTimeAsync(SETTLE_WITHIN_MS);

        expect(run.settled, 'the clone did not settle within ' + SETTLE_WITHIN_MS + ' ms').toBe(true);
        expect(run.error).toBeUndefined();
        expect(cloneBodyHtml(run.value, 0), 'the clone lacks the body that mounted at once').toEqual(first.bodyHtml);
        expect(cloneBodyHtml(run.value, 1), 'the clone was taken before the delayed body mounted').toEqual(second.bodyHtml);
        expectCollapsedAsCaptured(first, 'first block after the clone');
        expectCollapsedAsCaptured(second, 'second block after the clone');
    });

    it('waits for the slower of two bodies that both mount after a delay', async () => {
        const LATER_MOUNT_DELAY_MS = 3 * SHORT_MOUNT_DELAY_MS;
        const { first, second, msg } = twoCollapsedBlocks();
        installDelayedNativeThinkToggle(first.block, SHORT_MOUNT_DELAY_MS, first.body);
        installDelayedNativeThinkToggle(second.block, LATER_MOUNT_DELAY_MS, second.body);

        const run = track(_cloneMessageWithThinkingExpanded(msg));
        await vi.advanceTimersByTimeAsync(SETTLE_WITHIN_MS);

        expect(run.settled, 'the clone did not settle within ' + SETTLE_WITHIN_MS + ' ms of bodies mounting after ' + SHORT_MOUNT_DELAY_MS + ' and ' + LATER_MOUNT_DELAY_MS + ' ms').toBe(true);
        expect(run.error).toBeUndefined();
        expect(cloneBodyHtml(run.value, 0)).toEqual(first.bodyHtml);
        expect(cloneBodyHtml(run.value, 1), 'the clone was taken as soon as the faster body mounted').toEqual(second.bodyHtml);
        expectCollapsedAsCaptured(first, 'first block after the clone');
        expectCollapsedAsCaptured(second, 'second block after the clone');
    });

    it('still resolves and collapses the other blocks when a block lost its header while expanded', async () => {
        const { first, second, msg } = twoCollapsedBlocks();
        installNativeThinkToggle(first.block, first.body);
        installNativeThinkToggle(second.block, second.body);
        // A host re-render drops the first block's header right after it expanded, so nothing is left to click on that block.
        first.header.addEventListener('click', () => first.header.remove(), { once: true });

        const run = track(_cloneMessageWithThinkingExpanded(msg));
        await vi.runAllTimersAsync();

        expect(first.header.isConnected, 'harness: the first header is gone').toBe(false);
        expect(first.body.every((n) => n.parentNode === first.block), 'harness: the first body mounted').toBe(true);
        expect(run.settled).toBe(true);
        expect(run.error, 'the restore failed on the block that lost its header').toBeUndefined();
        expect(Array.from(run.value.children[0].children).map((n) => n.outerHTML), 'the clone lacks the first block body').toEqual(expect.arrayContaining(first.bodyHtml));
        expect(cloneBodyHtml(run.value, 1)).toEqual(second.bodyHtml);
        expectCollapsedAsCaptured(second, 'second block after the clone');
    });
});

describe('load order', () => {
    /** Evaluates the module source the way the browser runs a classic script: no require or module, and a global holding only what earlier scripts set. */
    function loadAsClassicScript(globals) {
        const root = { DSstudio: globalThis.DSstudio, ...globals };
        const source = fs.readFileSync(MODULE_FILE, 'utf8');
        new Function('globalThis', 'require', 'module', source)(root, undefined, undefined);
        return root.__DS_Harvest_think;
    }

    it('rejects with an error naming content/retry-until.js when it was not loaded first, without touching the block', async () => {
        const b = collapsedBlock();
        attach(b.msg);
        const clicks = installNativeThinkToggle(b.block, b.body);
        const bundle = loadAsClassicScript({});

        const error = await bundle._cloneMessageWithThinkingExpanded(b.msg).then(() => null, (e) => e);

        expect(error, 'the clone did not reject without retry-until loaded').toBeInstanceOf(Error);
        expect(error.message).toContain('retry-until.js');
        expect(error.message).toContain('manifest.json');
        expect(clicks).not.toHaveBeenCalled();
        expectCollapsedAsCaptured(b, 'after the load-order error');
    });

    it('harness: the same classic-script load with retry-until loaded first clones the message', async () => {
        const b = collapsedBlock();
        attach(b.msg);
        installNativeThinkToggle(b.block, b.body);
        const bundle = loadAsClassicScript({ DSSRetryUntil: globalThis.DSSRetryUntil });

        const clone = await bundle._cloneMessageWithThinkingExpanded(b.msg);

        expect(thinkBodyNodes(thinkParts(clone).block).map((n) => n.outerHTML)).toEqual(b.bodyHtml);
        expectCollapsedAsCaptured(b, 'after the clone');
    });
});
