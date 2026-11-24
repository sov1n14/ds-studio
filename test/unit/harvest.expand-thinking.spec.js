// @vitest-environment jsdom
/**
 * content/harvest.js — harvestAllMessages({ expandThinking }) and its load-order guards.
 *
 * Requirement: harvestAllMessages() captures every message as shown and never expands a collapsed think block unless the caller passes expandThinking: true (the export with "include thinking" on). With expandThinking on, each message is expanded and cloned once, also when the harvest re-scans messages it already captured. Without content/harvest.policy.js loaded first the harvest fails with a load-order error; without content/harvest.think.js it fails with a load-order error only when expandThinking is on.
 *
 * DOM: a real finished conversation from test/helpers/think-block-fixtures.js (mountThinkConversation) that fits the viewport, with DeepSeek's header toggle modelled by installNativeThinkToggle. Runs under jsdom because the think selectors use multi-level :has(), which happy-dom mis-evaluates. Fake timers drive every wait.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../content/ds-selectors.js';
import '../../content/retry-until.js';
import '../../content/harvest.toast.js';
import '../../content/harvest.dom.js';
import '../../content/harvest.think.js';
import '../../content/harvest.policy.js';
import harvestModule from '../../content/harvest.js';
import { loadThinkMessage, thinkParts, thinkBodyNodes, mountThinkConversation, watchThinkBodyMounts } from '../helpers/think-block-fixtures.js';

const MODULE_FILE = path.resolve(__dirname, '../../content/harvest.js');
const { harvestAllMessages } = harvestModule;

/** Runs a harvest to completion under fake timers; a rejection is held until the timers ran, so it surfaces as this call's rejection instead of an unhandled one. */
async function runHarvest(harvest, ...args) {
    vi.useFakeTimers();
    try {
        const outcome = harvest(...args).then((value) => ({ value }), (error) => ({ error, isRejected: true }));
        await vi.runAllTimersAsync();
        const { value, error, isRejected } = await outcome;
        if (isRejected) throw error;
        return value;
    } finally {
        vi.useRealTimers();
    }
}

/** True when the node shows a think body. */
function showsThinking(node) {
    return node.querySelector('.ds-think-content') !== null;
}

function expectCollapsed({ block, header, spacer, footer }, label) {
    expect(showsThinking(block), label + ': the live block shows a think body').toBe(false);
    expect(Array.from(block.children), label + ': the live block does not hold exactly header, spacer and footer').toEqual([header, spacer, footer]);
}

/** Number of think-step nodes one expansion of the captured block mounts. */
function thinkStepNodesPerExpansion() {
    return thinkBodyNodes(thinkParts(loadThinkMessage('open')).block).filter((n) => n.matches('.ds-think-content') || n.querySelector('.ds-think-content')).length;
}

beforeEach(() => {
    document.body.innerHTML = '';
    window.DSstudio = window.DSstudio || {};
    delete window.DSstudio.GoToTop;
    delete window.DSstudio.PreventAutoScroll;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('harvestAllMessages expandThinking option', () => {
    it('without options captures a collapsed think block as shown and never expands it', async () => {
        const conv = mountThinkConversation('collapsed');
        const watcher = watchThinkBodyMounts(conv.block);

        const result = await runHarvest(harvestAllMessages);
        const mounted = watcher.stop();

        expect(result.isComplete, 'harness: the harvest completed').toBe(true);
        expect(result.items).toHaveLength(2);
        expect(showsThinking(result.items[1]), 'the default harvest captured the collapsed block expanded').toBe(false);
        expect(mounted, 'the default harvest mounted the think body of a collapsed block').toEqual([]);
        expectCollapsed(conv, 'after the default harvest');
    });

    it('harness: with expandThinking on, the same collapsed block is captured with its thinking and collapsed again', async () => {
        const conv = mountThinkConversation('collapsed');

        const result = await runHarvest(harvestAllMessages, { expandThinking: true });

        expect(result.items).toHaveLength(2);
        expect(showsThinking(result.items[1])).toBe(true);
        expectCollapsed(conv, 'after the expanding harvest');
    });

    it('expands a captured message only once although the harvest re-scans the visible messages until the bottom is confirmed', async () => {
        const perExpansion = thinkStepNodesPerExpansion();
        expect(perExpansion, 'fixture: one expansion mounts think steps').toBeGreaterThan(0);
        const conv = mountThinkConversation('collapsed');
        const watcher = watchThinkBodyMounts(conv.block);

        const result = await runHarvest(harvestAllMessages, { expandThinking: true });
        const mounted = watcher.stop();

        expect(result.isComplete, 'harness: the harvest completed').toBe(true);
        expect(result.items, 'a message was captured twice').toHaveLength(2);
        expect(mounted.length, 'the think body was mounted more than once: an already captured message was expanded again').toBe(perExpansion);
        expectCollapsed(conv, 'after the expanding harvest');
    });
});

describe('harvestAllMessages load order', () => {
    /** Evaluates harvest.js the way the browser runs a classic script: no require or module, and one global object (window and globalThis alike) holding only what earlier scripts set. Returns that copy of harvestAllMessages. */
    function loadAsClassicScript(globals) {
        const root = {
            innerHeight: window.innerHeight,
            __DS_Harvest_toast: globalThis.__DS_Harvest_toast,
            __DS_Harvest_dom: globalThis.__DS_Harvest_dom,
            ...globals,
        };
        const source = fs.readFileSync(MODULE_FILE, 'utf8');
        new Function('globalThis', 'window', 'require', 'module', source)(root, root, undefined, undefined);
        return root.DSstudio.Harvest.harvestAllMessages;
    }

    function policyLoaded() {
        return { DSstudio: { HarvestPolicy: globalThis.DSstudio.HarvestPolicy } };
    }

    function thinkLoaded() {
        return { __DS_Harvest_think: globalThis.__DS_Harvest_think };
    }

    /** Settles `promise` to its rejection reason, or null when it resolves. */
    function rejectionOf(promise) {
        return promise.then(() => null, (error) => error);
    }

    it('rejects with an error naming content/harvest.policy.js when it was not loaded first', async () => {
        const harvest = loadAsClassicScript(thinkLoaded());

        const error = await rejectionOf(harvest());

        expect(error, 'the harvest did not reject without the policy module').toBeInstanceOf(Error);
        expect(error.message).toContain('harvest.policy.js');
        expect(error.message).toContain('manifest.json');
    });

    it('harness: the same classic-script load with every module loaded first resolves', async () => {
        const harvest = loadAsClassicScript({ ...policyLoaded(), ...thinkLoaded() });

        await expect(harvest({ expandThinking: true })).resolves.toMatchObject({ reason: 'no_container' });
    });

    it('with expandThinking on, rejects with an error naming content/harvest.think.js when it was not loaded first', async () => {
        const conv = mountThinkConversation('collapsed');
        const harvest = loadAsClassicScript(policyLoaded());

        const error = await rejectionOf(runHarvest(harvest, { expandThinking: true }));

        expect(error, 'the harvest did not reject without the think module').toBeInstanceOf(Error);
        expect(error.message).toContain('harvest.think.js');
        expect(error.message).toContain('manifest.json');
        expectCollapsed(conv, 'after the load-order error');
    });

    it('with expandThinking off, harvests normally without the think module', async () => {
        const conv = mountThinkConversation('collapsed');
        const harvest = loadAsClassicScript(policyLoaded());

        const result = await runHarvest(harvest);

        expect(result.isComplete).toBe(true);
        expect(result.items).toHaveLength(2);
        expect(showsThinking(result.items[1])).toBe(false);
        expectCollapsed(conv, 'after the harvest');
    });
});
