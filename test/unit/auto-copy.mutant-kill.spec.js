// @vitest-environment jsdom
/**
 * content/auto-copy.js and content/reply-completion.js — targeted tests for behaviors test/unit/auto-copy.scenario.spec.js leaves unpinned (surviving Stryker mutants).
 *
 * Requirements asserted:
 *   A. Reply copy and code copy are independent: a new toolbar without a reply copy button (no direct div[role="button"] child) still gets its code blocks copied, and nothing is reported as an error.
 *   B. A new toolbar that is no longer inside a virtual-list item when its turn comes (copying an earlier reply of the same batch made the host page re-render it out of its item) has no code blocks to copy: nothing is activated for it and nothing is reported as an error.
 *   C. With reply and code copy on, a code block copy whose activation attempt throws is reported through console.error('[DSS] auto-copy:處理新工具列失敗:', error) and does not cost the reply its copy: the reply copy is still activated and is the last activation (the clipboard must end holding the full reply); the feature keeps working, so the next new reply is still copied, code blocks first and the reply last.
 *   D. Loading content/auto-copy.js starts it (manifest entry point): with its dependencies on the globals and no Node module system, a new reply after load is copied without anyone calling start().
 *   E. Exports: in a CommonJS environment module.exports is the AutoCopy object; in a window environment window.DSstudio.AutoCopy is that object and existing window.DSstudio members survive; loading works where only one of the two exists.
 *   F. A missing dependency makes loading fail with an Error naming the missing file, never a TypeError, also when globalThis.DSstudio or globalThis.__DS_StorageManager_keys does not exist at all.
 *   G. Node fallback: a dependency absent from the globals (DSstudio.Selectors, DSSFeatureToggle) is taken from require() when a module system exists.
 *   H. content/reply-completion.js loads with or without DSstudio and require, and takes its selectors from DSstudio.Selectors when present, from require('./ds-selectors.js') otherwise.
 *
 * "Copied" = the guarded React onClick accepted the event (test/helpers/auto-copy-harness.js); D to G evaluate the module source with chosen globalThis / window / module / require bindings (new Function parameters shadow the free variables), so each environment is observable without touching the suite-wide globals.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { broadcast, changes, requestedKeys } from '../helpers/auto-click-harness.js';
import {
    MASTER_KEY, REPLY_KEY, CODE_KEY, installChromeRuntime, activations, resetActivations, guard,
    addCodeBlock, mountPage, awaitingItem, flush, completeNewReply, loadAutoCopy, loadAutoCopyDependencies,
} from '../helpers/auto-copy-harness.js';
import { loadVisibleItems, loadAssistantItem, mountAndObserve } from '../helpers/reply-completion-fixtures.js';

const AUTO_COPY_FILE = path.resolve(__dirname, '../../content/auto-copy.js');
const REPLY_COMPLETION_FILE = path.resolve(__dirname, '../../content/reply-completion.js');
const ERROR_PREFIX = '[DSS] auto-copy:處理新工具列失敗:';
const MISSING = {
    featureToggle: 'content/auto-copy.js 需要 content/feature-toggle.js 先行載入',
    replyCompletion: 'content/auto-copy.js 需要 content/reply-completion.js 先行載入',
    keys: 'content/auto-copy.js 需要 utils/storage-manager.keys.js 先行載入',
};

const settings = ({ master = true, reply = false, code = false } = {}) => ({ [MASTER_KEY]: master, [REPLY_KEY]: reply, [CODE_KEY]: code });
const ALL_OFF = settings();
const CODE_ONLY = settings({ code: true });
const BOTH = settings({ reply: true, code: true });

/** Run a classic script with the given free-variable bindings (parameter names shadow the globals of the same name). */
function evaluate(file, bindings) {
    const names = Object.keys(bindings);
    new Function(...names, fs.readFileSync(file, 'utf8'))(...names.map((name) => bindings[name]));
}

/** A globalThis stand-in holding the real, freshly loaded dependencies of content/auto-copy.js (call after loadAutoCopyDependencies). */
function dependencyGlobals() {
    return {
        DSstudio: { Selectors: globalThis.DSstudio.Selectors, ReplyCompletion: globalThis.DSstudio.ReplyCompletion },
        DSSFeatureToggle: globalThis.DSSFeatureToggle,
        __DS_StorageManager_keys: globalThis.__DS_StorageManager_keys,
    };
}

/** Load content/auto-copy.js; by default browser-like (a window object, module and require unbound). A binding passed explicitly as undefined stays undefined. */
function evaluateAutoCopy({ globals = dependencyGlobals(), ...bindings } = {}) {
    evaluate(AUTO_COPY_FILE, { globalThis: globals, window: {}, module: undefined, require: undefined, ...bindings });
}

/** Wrap a guarded button's React onClick so that `effect` runs right after each accepted activation (a host-page re-render triggered by the click). */
function onActivation(button, effect) {
    const props = button[Object.keys(button).find((k) => k.startsWith('__reactProps$'))];
    const original = props.onClick;
    props.onClick = (e) => { original(e); effect(); };
}

/** Replace each direct div[role="button"] of `toolbar` with a span[role="button"] holding the same attributes and content, guarded as `${name}:span#i`: the toolbar keeps its shape but has no reply copy button. */
function retagToolbarButtons(toolbar, name) {
    [...toolbar.children].filter((el) => el.matches('div[role="button"]')).forEach((div, i) => {
        const span = document.createElement('span');
        [...div.attributes].forEach((attr) => span.setAttribute(attr.name, attr.value));
        span.append(...div.childNodes);
        div.replaceWith(guard(span, `${name}:span#${i}`));
    });
}

beforeEach(() => {
    document.body.innerHTML = '';
    resetActivations();
    installChromeRuntime();
});

afterEach(async () => {
    // Close every gate so this test's observers cannot act on the next test's page.
    broadcast(changes([MASTER_KEY, false, true]));
    await flush();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

// ── A to C: processing a new toolbar ──

describe('processing a new toolbar', () => {
    it('A. reply and code copy on, the new toolbar has no reply copy button: its code block is still copied and no error is logged', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { list } = mountPage();
        await loadAutoCopy(BOTH);
        const fresh = awaitingItem(4, 'new');
        retagToolbarButtons(fresh.toolbar, 'new');
        addCodeBlock(fresh.item, 'new', 0);

        await completeNewReply(list, fresh);

        expect(activations()).toEqual(['new:code#0']);
        expect(errors).not.toHaveBeenCalled();
    });

    it('B. code copy on, two replies complete in one batch and copying the first re-renders the second toolbar out of its item: the second gets nothing and no error is logged', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { list } = mountPage();
        await loadAutoCopy(CODE_ONLY);
        const first = awaitingItem(4, 'first');
        const second = awaitingItem(6, 'second');
        const { copy } = addCodeBlock(first.item, 'first', 0);
        addCodeBlock(second.item, 'second', 0);
        onActivation(copy, () => second.row.remove());
        list.append(first.item, second.item);
        await flush();

        second.item.appendChild(second.row);
        first.item.appendChild(first.row);
        await flush();

        expect(activations()).toEqual(['first:code#0']);
        expect(second.row.isConnected, 'precondition: the first copy detached the second toolbar row').toBe(false);
        expect(errors).not.toHaveBeenCalled();
    });

    it('C. reply and code copy on, the last code block copy throws: the error is logged with the auto-copy prefix, the reply copy is still activated last, and the next new reply is still copied', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { list } = mountPage();
        await loadAutoCopy(BOTH);
        const first = awaitingItem(4, 'first');
        addCodeBlock(first.item, 'first', 0);
        const { copy } = addCodeBlock(first.item, 'first', 1);
        const failure = new Error('dispatch failed');
        copy.dispatchEvent = () => { throw failure; };

        await completeNewReply(list, first);
        expect(activations(), 'code block #0 copied, #1 failed, then the reply copy still ran last').toEqual(['first:code#0', 'first:reply']);
        expect(errors).toHaveBeenCalledTimes(1);
        expect(errors).toHaveBeenCalledWith(ERROR_PREFIX, failure);

        const control = awaitingItem(6, 'control');
        addCodeBlock(control.item, 'control', 0);
        await completeNewReply(list, control);
        expect(activations(), 'the feature keeps working after the failure').toEqual(['first:code#0', 'first:reply', 'control:code#0', 'control:reply']);
    });
});

// ── D. auto-start ──

describe('loading content/auto-copy.js', () => {
    it('D. starts the module: with no module system and the toggles on, a new reply after load is copied without calling start()', async () => {
        const { list } = mountPage();
        await loadAutoCopyDependencies(BOTH);
        evaluateAutoCopy();
        await flush();
        const fresh = awaitingItem(4, 'new');
        addCodeBlock(fresh.item, 'new', 0);

        await completeNewReply(list, fresh);

        expect(activations()).toEqual(['new:code#0', 'new:reply']);
    });
});

// ── E. exports ──

describe('exports', () => {
    beforeEach(async () => {
        mountPage();
        await loadAutoCopyDependencies(ALL_OFF);
    });

    it('E1. CommonJS without window: module.exports is the AutoCopy object (has start) and loading does not touch window', () => {
        const module = { exports: {} };

        evaluateAutoCopy({ window: undefined, module, require: createRequire(AUTO_COPY_FILE) });

        expect(module.exports.start).toBeTypeOf('function');
    });

    it('E2. window with an existing DSstudio: DSstudio.AutoCopy is the exported object and the existing members survive', () => {
        const module = { exports: {} };
        const existing = { marker: true };
        const window = { DSstudio: { Existing: existing } };

        evaluateAutoCopy({ window, module });

        expect(window.DSstudio.AutoCopy).toBe(module.exports);
        expect(window.DSstudio.AutoCopy.start).toBeTypeOf('function');
        expect(window.DSstudio.Existing).toBe(existing);
    });

    it('E3. window without DSstudio and no module system: DSstudio is created holding AutoCopy', () => {
        const window = {};

        evaluateAutoCopy({ window });

        expect(window.DSstudio.AutoCopy.start).toBeTypeOf('function');
    });
});

// ── F. missing dependencies ──

describe('a missing dependency fails loading with an Error naming it', () => {
    beforeEach(async () => {
        mountPage();
        await loadAutoCopyDependencies(ALL_OFF);
    });

    it.each([
        ['DSSFeatureToggle absent, no require', (g) => { delete g.DSSFeatureToggle; }, MISSING.featureToggle],
        ['DSstudio.ReplyCompletion absent', (g) => { delete g.DSstudio.ReplyCompletion; }, MISSING.replyCompletion],
        ['globalThis.DSstudio absent entirely, no require', (g) => { delete g.DSstudio; }, MISSING.replyCompletion],
        ['__DS_StorageManager_keys absent', (g) => { delete g.__DS_StorageManager_keys; }, MISSING.keys],
    ])('F. %s', (_name, remove, message) => {
        const globals = dependencyGlobals();
        remove(globals);

        let error = null;
        try {
            evaluateAutoCopy({ globals });
        } catch (e) {
            error = e;
        }

        expect(error, 'loading must fail').toBeInstanceOf(Error);
        expect(error, `not a TypeError: ${error?.message}`).not.toBeInstanceOf(TypeError);
        expect(error.message).toBe(message);
    });
});

// ── G. Node require fallback ──

describe('a dependency absent from the globals is taken from require()', () => {
    const require = createRequire(AUTO_COPY_FILE);
    let saved;

    beforeEach(() => {
        saved = { featureToggle: globalThis.DSSFeatureToggle, selectors: window.DSstudio?.Selectors };
    });

    afterEach(() => {
        // The natively required modules publish themselves on the real globals; restore the fresh copies and drop the require cache.
        globalThis.DSSFeatureToggle = saved.featureToggle;
        if (saved.selectors) window.DSstudio.Selectors = saved.selectors;
        delete require.cache[require.resolve('./feature-toggle.js')];
        delete require.cache[require.resolve('./ds-selectors.js')];
    });

    it('G1. DSSFeatureToggle absent: feature-toggle.js is required, the toggles register and a new reply is copied', async () => {
        const { list } = mountPage();
        await loadAutoCopyDependencies(BOTH);
        const globals = dependencyGlobals();
        delete globals.DSSFeatureToggle;
        delete require.cache[require.resolve('./feature-toggle.js')];

        evaluateAutoCopy({ globals, require });
        await flush();
        expect(requestedKeys(), 'both own keys requested through GET_SETTINGS').toEqual(expect.arrayContaining([REPLY_KEY, CODE_KEY]));
        const fresh = awaitingItem(4, 'new');
        addCodeBlock(fresh.item, 'new', 0);
        await completeNewReply(list, fresh);

        expect(activations()).toEqual(['new:code#0', 'new:reply']);
    });

    it('G2. DSstudio.Selectors absent: ds-selectors.js is required and both copy buttons are found', async () => {
        const { list } = mountPage();
        await loadAutoCopyDependencies(BOTH);
        const globals = dependencyGlobals();
        delete globals.DSstudio.Selectors;

        evaluateAutoCopy({ globals, require });
        await flush();
        const fresh = awaitingItem(4, 'new');
        addCodeBlock(fresh.item, 'new', 0);
        await completeNewReply(list, fresh);

        expect(activations()).toEqual(['new:code#0', 'new:reply']);
    });
});

// ── H. content/reply-completion.js load fallbacks ──

/** Records of a reply completing (item mounted in one batch, its toolbar row appended in the next), plus that toolbar. */
function completionBatch() {
    const { list } = loadVisibleItems();
    const parts = loadAssistantItem(4);
    parts.row.remove();
    const session = mountAndObserve(list);
    list.appendChild(parts.item);
    session.flush();
    parts.item.appendChild(parts.row);
    const records = session.flush();
    session.disconnect();
    return { records, toolbar: parts.toolbar };
}

function loadReplyCompletion(root, require) {
    evaluate(REPLY_COMPLETION_FILE, { globalThis: root, module: undefined, require });
    const api = root.DSstudio?.ReplyCompletion;
    expect(api?.newToolbarsFromRecords, 'ReplyCompletion published on the given global').toBeTypeOf('function');
    return api;
}

describe('content/reply-completion.js load fallbacks', () => {
    const require = createRequire(REPLY_COMPLETION_FILE);
    let savedSelectors;

    beforeEach(async () => {
        vi.resetModules();
        await import('../../content/ds-selectors.js');
        savedSelectors = window.DSstudio.Selectors;
    });

    afterEach(() => {
        window.DSstudio.Selectors = savedSelectors;
        delete require.cache[require.resolve('./ds-selectors.js')];
    });

    it('H1. no DSstudio and no require: loads without throwing and publishes ReplyCompletion', () => {
        const root = {};

        loadReplyCompletion(root, undefined);

        expect(root.DSstudio.ReplyCompletion.isStoppedReply).toBeTypeOf('function');
    });

    it('H2. DSstudio.Selectors present, no require: the published selectors are used (a completing reply\'s toolbar is found)', () => {
        const root = { DSstudio: { Selectors: savedSelectors } };
        const api = loadReplyCompletion(root, undefined);
        const { records, toolbar } = completionBatch();

        const found = api.newToolbarsFromRecords(records);

        expect(found).toHaveLength(1);
        expect(found[0]).toBe(toolbar);
    });

    it('H3. no DSstudio, require available: ds-selectors.js is required (a completing reply\'s toolbar is found)', () => {
        const root = {};
        delete require.cache[require.resolve('./ds-selectors.js')];
        const api = loadReplyCompletion(root, require);
        const { records, toolbar } = completionBatch();

        const found = api.newToolbarsFromRecords(records);

        expect(found).toHaveLength(1);
        expect(found[0]).toBe(toolbar);
    });
});
