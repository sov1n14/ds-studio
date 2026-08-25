/**
 * Behavior tests for content/prompt-injector.controller.js, exercised through the
 * factory boundary (createPromptInjector(ctx)) instead of through content-script.js.
 *
 * Two contracts are pinned here:
 *   1. The pure output of buildInjectionPrefix / injectPrefix for the requirement
 *      matrix (global prompt gating, preset prefix, timestamp, wrapping,
 *      re-injection idempotence, refusal cases).
 *   2. The ctx callbacks that ARE the contract with the host script:
 *      setIsInjecting (re-entrancy guard) and markChatCreationAttempt (fired once
 *      per intercepted send). These are asserted because the host has no other way
 *      to observe them, not as a stand-in for behavior.
 *
 * Everything else is asserted on observable state only: the textarea value, the
 * events dispatched on it, event.defaultPrevented, and the return value.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../content/ds-selectors.js';
import '../../content/prompt-injector.send-button.js';
import '../../content/prompt-injector.controller.js';
import {
    makeMobileSendButton,
    makeEditSendButtonInContainer,
    mountInDocument,
    dispatchClick,
} from '../helpers/send-button-fixtures.js';

const { createPromptInjector } = globalThis.__DS_PromptInjector;

// ---------------------------------------------------------------------------
// Harness
//
// createPromptInjector() registers capture-phase listeners on `document` that
// cannot be unregistered, so exactly ONE injector is created for the whole file
// and its ctx reads from a mutable `state` object reset before every test.
// ---------------------------------------------------------------------------

const STUB_TIME = 'STUB-TIME';

const state = {};

function resetState(over) {
    Object.assign(state, {
        isEnabled: true,
        promptPrefix: '',
        globalDefaultPrompt: '',
        isGlobalPromptEnabled: false,
        showSystemTime: false,
        isInjecting: false,
        setIsInjectingCalls: [],
        markCalls: 0,
        formatSystemTimeCalls: 0,
    }, over || {});
}

const injector = createPromptInjector({
    getIsEnabled:             () => state.isEnabled,
    getPromptPrefix:          () => state.promptPrefix,
    getGlobalDefaultPrompt:   () => state.globalDefaultPrompt,
    getIsGlobalPromptEnabled: () => state.isGlobalPromptEnabled,
    getShowSystemTime:        () => state.showSystemTime,
    getIsInjecting:           () => state.isInjecting,
    setIsInjecting:           (v) => { state.isInjecting = v; state.setIsInjectingCalls.push(v); },
    markChatCreationAttempt:  () => { state.markCalls += 1; },
    formatSystemTime:         () => { state.formatSystemTimeCalls += 1; return STUB_TIME; },
});

const { buildInjectionPrefix, injectPrefix } = injector;

function makeTextarea(value = '') {
    const ta = document.createElement('textarea');
    ta.value = value;
    return ta;
}

/** Record the types of events dispatched on `el`; returns the recording array. */
function recordEvents(el, types) {
    const seen = [];
    types.forEach(t => el.addEventListener(t, (e) => seen.push({ type: e.type, value: el.value })));
    return seen;
}

let cleanup = null;

beforeEach(() => { resetState(); });
afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// buildInjectionPrefix
// ---------------------------------------------------------------------------

describe('buildInjectionPrefix', () => {
    it('returns an empty string when there is no global prompt and no preset prefix', () => {
        resetState({ isGlobalPromptEnabled: true });
        expect(buildInjectionPrefix()).toBe('');
    });

    it('wraps the global prompt alone when the global prompt is enabled', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        expect(buildInjectionPrefix()).toBe('<system-reminder>\nGLOBAL\n</system-reminder>');
    });

    it('omits the global prompt entirely when the global prompt is disabled', () => {
        resetState({ isGlobalPromptEnabled: false, globalDefaultPrompt: 'GLOBAL' });
        expect(buildInjectionPrefix()).toBe('');
    });

    it('wraps the preset prefix alone when the global prompt is disabled', () => {
        resetState({ isGlobalPromptEnabled: false, globalDefaultPrompt: 'GLOBAL', promptPrefix: 'PRESET' });
        expect(buildInjectionPrefix()).toBe('<system-reminder>\nPRESET\n</system-reminder>');
    });

    it('joins global prompt and preset prefix with a blank line inside a single wrapper', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL', promptPrefix: 'PRESET' });
        const result = buildInjectionPrefix();
        expect(result).toBe('<system-reminder>\nGLOBAL\n\nPRESET\n</system-reminder>');
        expect(result.match(/<system-reminder>/g)).toHaveLength(1);
    });

    it('wraps the preset prefix alone when the global prompt is enabled but empty', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: '', promptPrefix: 'PRESET' });
        expect(buildInjectionPrefix()).toBe('<system-reminder>\nPRESET\n</system-reminder>');
    });
});

// ---------------------------------------------------------------------------
// injectPrefix — refusal cases
// ---------------------------------------------------------------------------

describe('injectPrefix refusals', () => {
    it('returns false and leaves the textarea untouched when the extension is disabled', () => {
        resetState({ isEnabled: false, isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('hello');
        const seen = recordEvents(ta, ['input', 'change']);

        expect(injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('hello');
        expect(seen).toEqual([]);
    });

    it('returns false and leaves the textarea untouched when it is empty and nothing else is sendable', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('');

        expect(injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('');
    });

    it('returns false for a whitespace-only textarea when nothing else is sendable', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('   \n\t ');

        expect(injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('   \n\t ');
    });

    it('does not bypass the disabled extension even when the send button is sendable without text', () => {
        resetState({ isEnabled: false, isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('');

        expect(injectPrefix(ta, true)).toBe(false);
        expect(ta.value).toBe('');
    });
});

// ---------------------------------------------------------------------------
// injectPrefix — successful injection
// ---------------------------------------------------------------------------

describe('injectPrefix success', () => {
    it('wraps the typed text in <user-input> after the prefix and fires input then change', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('hello');
        const seen = recordEvents(ta, ['input', 'change']);

        expect(injectPrefix(ta)).toBe(true);
        expect(ta.value).toBe(
            '<system-reminder>\nGLOBAL\n</system-reminder>\n\n<user-input>\nhello\n</user-input>'
        );
        expect(seen.map(e => e.type)).toEqual(['input', 'change']);
        expect(seen[0].value).toBe(ta.value);
    });

    it('prepends the formatted timestamp when the system-time option is on', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL', showSystemTime: true });
        const ta = makeTextarea('hello');

        expect(injectPrefix(ta)).toBe(true);
        expect(ta.value).toBe(
            'Current Time: STUB-TIME\n\n<system-reminder>\nGLOBAL\n</system-reminder>' +
            '\n\n<user-input>\nhello\n</user-input>'
        );
        expect(state.formatSystemTimeCalls).toBe(1);
    });

    it('still wraps the text when there is no prefix at all', () => {
        resetState({ isGlobalPromptEnabled: true });
        const ta = makeTextarea('hello');

        expect(injectPrefix(ta)).toBe(true);
        expect(ta.value).toBe('<user-input>\nhello\n</user-input>');
    });

    it('injects prefix-only content, with no <user-input> wrapper, for an empty sendable textarea', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL', showSystemTime: true });
        const ta = makeTextarea('');

        expect(injectPrefix(ta, true)).toBe(true);
        expect(ta.value).toBe('Current Time: STUB-TIME\n\n<system-reminder>\nGLOBAL\n</system-reminder>');
        expect(ta.value).not.toContain('<user-input>');
    });
});

// ---------------------------------------------------------------------------
// injectPrefix — re-injection idempotence
// ---------------------------------------------------------------------------

describe('injectPrefix re-injection', () => {
    it('unwraps an already-injected value before re-wrapping, so nothing nests', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('hello');

        expect(injectPrefix(ta)).toBe(true);
        const once = ta.value;
        expect(injectPrefix(ta)).toBe(true);

        expect(ta.value).toBe(once);
        expect(ta.value.match(/<user-input>/g)).toHaveLength(1);
        expect(ta.value.match(/<system-reminder>/g)).toHaveLength(1);
    });

    it('re-wraps with the CURRENT prefix, dropping the stale one', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'OLD' });
        const ta = makeTextarea('hello');
        expect(injectPrefix(ta)).toBe(true);

        state.globalDefaultPrompt = 'NEW';
        expect(injectPrefix(ta)).toBe(true);

        expect(ta.value).toBe(
            '<system-reminder>\nNEW\n</system-reminder>\n\n<user-input>\nhello\n</user-input>'
        );
        expect(ta.value).not.toContain('OLD');
    });

    it('keeps the user text intact when the prefix is turned off between injections', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('hello');
        expect(injectPrefix(ta)).toBe(true);

        state.isGlobalPromptEnabled = false;
        expect(injectPrefix(ta)).toBe(true);

        expect(ta.value).toBe('<user-input>\nhello\n</user-input>');
    });
});

// ---------------------------------------------------------------------------
// Event interception (click / Enter)
//
// requestAnimationFrame is stubbed into a manual queue: happy-dom clamps
// setTimeout(0) to ~15ms and its MutationObserver is unreliable under fake
// timers, so a hand-flushed rAF queue is the only deterministic way to observe
// the suppress-then-redispatch cycle.
// ---------------------------------------------------------------------------

describe('send interception via click', () => {
    let rafQueue;
    let originalRaf;

    beforeEach(() => {
        rafQueue = [];
        originalRaf = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
    });

    function flushRaf() {
        const queued = rafQueue.splice(0, rafQueue.length);
        queued.forEach(cb => cb(0));
    }

    /** input area: <div><textarea/><div class="bf38813a"><send button/></div></div> */
    function mountComposer(value, opts) {
        opts = opts || {};
        const { button, svg } = makeMobileSendButton();
        if (opts.disabled) button.classList.add('ds-button--disabled');

        const row = document.createElement('div');
        row.className = 'bf38813a';
        row.appendChild(button);

        const inputArea = document.createElement('div');
        const textarea = makeTextarea(value);
        inputArea.appendChild(textarea);
        inputArea.appendChild(row);

        cleanup = mountInDocument(inputArea);
        return { inputArea, textarea, button, svg };
    }

    it('suppresses the original click, injects, and re-dispatches exactly one send', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const { textarea, svg } = mountComposer('hello');

        const ev = dispatchClick(svg);

        expect(ev.defaultPrevented).toBe(true);
        expect(textarea.value).toBe(
            '<system-reminder>\nGLOBAL\n</system-reminder>\n\n<user-input>\nhello\n</user-input>'
        );
        expect(rafQueue.length).toBeGreaterThan(0);

        const injected = textarea.value;
        flushRaf();
        expect(textarea.value).toBe(injected);
        expect(textarea.value.match(/<user-input>/g)).toHaveLength(1);
    });

    it('marks the chat-creation attempt exactly once for one send', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const { svg } = mountComposer('hello');

        dispatchClick(svg);
        flushRaf();

        expect(state.markCalls).toBe(1);
    });

    it('leaves the injecting flag false once the cycle completes', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const { svg } = mountComposer('hello');

        dispatchClick(svg);
        flushRaf();

        expect(state.setIsInjectingCalls).toContain(true);
        expect(state.isInjecting).toBe(false);
    });

    it('does nothing while an injection is already in flight', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL', isInjecting: true });
        const { textarea, svg } = mountComposer('hello');

        const ev = dispatchClick(svg);

        expect(textarea.value).toBe('hello');
        expect(ev.defaultPrevented).toBe(false);
        expect(state.markCalls).toBe(0);
    });

    it('does nothing when the send button is disabled and the textarea is empty', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const { textarea, svg } = mountComposer('', { disabled: true });

        const ev = dispatchClick(svg);

        expect(textarea.value).toBe('');
        expect(ev.defaultPrevented).toBe(false);
    });

    it('injects for an enabled send button with an empty textarea (attachment-only send)', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const { textarea, svg } = mountComposer('');

        const ev = dispatchClick(svg);

        expect(ev.defaultPrevented).toBe(true);
        expect(textarea.value).toBe('<system-reminder>\nGLOBAL\n</system-reminder>');
        expect(textarea.value).not.toContain('<user-input>');
    });

    it('injects into the edit-window textarea when the edit Send button is clicked', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const { container, span, textarea } = makeEditSendButtonInContainer('edit message');
        cleanup = mountInDocument(container);

        const ev = dispatchClick(span);

        expect(ev.defaultPrevented).toBe(true);
        expect(textarea.value).toBe(
            '<system-reminder>\nGLOBAL\n</system-reminder>\n\n<user-input>\nedit message\n</user-input>'
        );
    });
});

describe('send interception via Enter', () => {
    let rafQueue;
    let originalRaf;

    beforeEach(() => {
        rafQueue = [];
        originalRaf = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
    });

    function dispatchEnter(target, over) {
        const ev = new KeyboardEvent('keydown', Object.assign({
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
        }, over || {}));
        target.dispatchEvent(ev);
        return ev;
    }

    function mountComposer(value) {
        const { button } = makeMobileSendButton();
        const row = document.createElement('div');
        row.className = 'bf38813a';
        row.appendChild(button);

        const inputArea = document.createElement('div');
        const textarea = makeTextarea(value);
        inputArea.appendChild(textarea);
        inputArea.appendChild(row);

        cleanup = mountInDocument(inputArea);
        textarea.focus();
        return { textarea, button };
    }

    it('injects and swallows the keydown for a plain Enter', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const { textarea } = mountComposer('hello');

        const ev = dispatchEnter(textarea);

        expect(ev.defaultPrevented).toBe(true);
        expect(textarea.value).toBe(
            '<system-reminder>\nGLOBAL\n</system-reminder>\n\n<user-input>\nhello\n</user-input>'
        );
        expect(state.markCalls).toBe(1);
    });

    it('ignores Shift+Enter so the newline behavior is preserved', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const { textarea } = mountComposer('hello');

        const ev = dispatchEnter(textarea, { shiftKey: true });

        expect(ev.defaultPrevented).toBe(false);
        expect(textarea.value).toBe('hello');
        expect(state.markCalls).toBe(0);
    });

    it('ignores Enter while an injection is already in flight', () => {
        resetState({ isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL', isInjecting: true });
        const { textarea } = mountComposer('hello');

        const ev = dispatchEnter(textarea);

        expect(ev.defaultPrevented).toBe(false);
        expect(textarea.value).toBe('hello');
    });
});
