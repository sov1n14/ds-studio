/**
 * System-time de-duplication for content/prompt-injector.controller.js (per the agreed behaviour: "Do not repeatedly inject the current time").
 *
 * Scenario: the show-system-time option is on and the textarea already starts with a `Current Time:` line that the user typed or pasted (not an already-wrapped injection). The leading line and the blank or whitespace-only lines after it are stripped and replaced with one fresh timestamp line, so the sent text carries exactly ONE `Current Time:` line. A timestamp-only input is left unsent and unchanged unless an attachment or image makes it sendable without text; then the old line is replaced by one fresh line (per the agreed behaviour). Every assertion reads the textarea value the page would send.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../content/ds-selectors.js';
import '../../content/prompt-injector.send-button.js';
import '../../content/prompt-injector.controller.js';

const { createPromptInjector } = globalThis.__DS_PromptInjector;

// One injector per file: createPromptInjector() registers document listeners that cannot be removed, so its ctx reads from a mutable state object reset before every test.
const STUB_TIME = '2026/11/08 09:00:00 (UTC+08:00)';
const OLD_TIME_LINE = 'Current Time: 2026/01/01 00:00:00 (UTC+08:00)';

const state = {};

function resetState(over) {
    Object.assign(state, {
        isEnabled: true,
        promptPrefix: '',
        globalDefaultPrompt: '',
        isGlobalPromptEnabled: false,
        isShowSystemTime: false,
        isInjecting: false,
    }, over || {});
}

const { injectPrefix } = createPromptInjector({
    getIsEnabled:             () => state.isEnabled,
    getPromptPrefix:          () => state.promptPrefix,
    getGlobalDefaultPrompt:   () => state.globalDefaultPrompt,
    getIsGlobalPromptEnabled: () => state.isGlobalPromptEnabled,
    getIsShowSystemTime:      () => state.isShowSystemTime,
    getIsInjecting:           () => state.isInjecting,
    setIsInjecting:           (v) => { state.isInjecting = v; },
    markChatCreationAttempt:  () => {},
    formatSystemTime:         () => STUB_TIME,
});

function makeTextarea(value) {
    const ta = document.createElement('textarea');
    ta.value = value;
    return ta;
}

function countTimeLines(value) {
    return (value.match(/Current Time:/g) || []).length;
}

// The text sent with system time on and no preset or global prompt: one fresh time line, a blank line, then the user text wrapped as-is.
function expectedSent(userText) {
    return `Current Time: ${STUB_TIME}\n\n<user-input>\n${userText}\n</user-input>`;
}

beforeEach(() => { resetState(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('system time: input that already starts with "Current Time:"', () => {
    it('sends exactly one Current Time line, keeping the global prompt, preset prefix and user text', () => {
        resetState({
            isShowSystemTime: true,
            isGlobalPromptEnabled: true,
            globalDefaultPrompt: 'GLOBAL',
            promptPrefix: 'PRESET',
        });
        const ta = makeTextarea(`${OLD_TIME_LINE}\n\nhello`);

        expect(injectPrefix(ta)).toBe(true);

        expect(countTimeLines(ta.value), `sent text must hold exactly one "Current Time:" line, got:\n${ta.value}`).toBe(1);
        expect(ta.value.startsWith('Current Time: '), 'the time line must open the sent text').toBe(true);
        expect(ta.value).toContain('<system-reminder>\nGLOBAL\n\nPRESET\n</system-reminder>');
        expect(ta.value).toMatch(/<user-input>\n[\s\S]*hello\n<\/user-input>$/);
    });

    it('sends exactly one Current Time line when there is no preset prefix and no global prompt', () => {
        resetState({ isShowSystemTime: true });
        const ta = makeTextarea(`${OLD_TIME_LINE}\n\nhello`);

        expect(injectPrefix(ta)).toBe(true);

        expect(countTimeLines(ta.value), `sent text must hold exactly one "Current Time:" line, got:\n${ta.value}`).toBe(1);
        expect(ta.value.startsWith('Current Time: '), 'the time line must open the sent text').toBe(true);
        expect(ta.value).not.toContain('<system-reminder>');
        expect(ta.value).toMatch(/<user-input>\n[\s\S]*hello\n<\/user-input>$/);
    });
});

describe('system time: exact sent text after the leading Current Time line is replaced', () => {
    it.each([
        ['directly followed by text, with no blank line', `${OLD_TIME_LINE}\nhello`, 'hello'],
        ['followed by one empty line', `${OLD_TIME_LINE}\n\nhello`, 'hello'],
        ['followed by several empty lines', `${OLD_TIME_LINE}\n\n\n\nhello`, 'hello'],
        ['followed by whitespace-only lines of several spaces and tabs', `${OLD_TIME_LINE}\n  \t \n\t\t\nhello`, 'hello'],
        ['followed by a multi-line user text', `${OLD_TIME_LINE}\n\nfirst\nsecond\nthird`, 'first\nsecond\nthird'],
        ['followed by a user text line that starts with spaces', `${OLD_TIME_LINE}\n\n  indented`, '  indented'],
    ])('time line %s: sends one fresh time line and the remaining user text with nothing added', (_label, input, userText) => {
        resetState({ isShowSystemTime: true });
        const ta = makeTextarea(input);

        expect(injectPrefix(ta)).toBe(true);

        expect(ta.value).toBe(expectedSent(userText));
    });

    it('leaves a Current Time line that is not at the start of the text inside the user text', () => {
        resetState({ isShowSystemTime: true });
        const userText = `hello\n${OLD_TIME_LINE}\nworld`;
        const ta = makeTextarea(userText);

        expect(injectPrefix(ta)).toBe(true);

        expect(ta.value).toBe(expectedSent(userText));
    });

    it.each([
        ['with no trailing newline', OLD_TIME_LINE],
        ['followed by empty lines', `${OLD_TIME_LINE}\n\n`],
    ])('leaves a timestamp-only input %s unsent and unchanged', (_label, input) => {
        resetState({ isShowSystemTime: true });
        const ta = makeTextarea(input);

        expect(injectPrefix(ta)).toBe(false);

        expect(ta.value).toBe(input);
    });

    // The second argument marks the message as sendable without text (an attachment or image is present).
    it.each([
        ['with no trailing newline', OLD_TIME_LINE],
        ['followed by empty lines', `${OLD_TIME_LINE}

`],
    ])('replaces the old line of a timestamp-only input %s with one fresh line when an attachment makes it sendable', (_label, input) => {
        resetState({ isShowSystemTime: true });
        const ta = makeTextarea(input);

        expect(injectPrefix(ta, true)).toBe(true);

        expect(ta.value, `the old timestamp must be replaced, not kept or stacked, got:
${ta.value}`).toBe(`Current Time: ${STUB_TIME}

`);
    });
});

describe('system time: guards', () => {
    it('adds exactly one fresh Current Time line to plain text without the prefix', () => {
        resetState({ isShowSystemTime: true, isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('hello');

        expect(injectPrefix(ta)).toBe(true);

        expect(countTimeLines(ta.value)).toBe(1);
        expect(ta.value.startsWith(`Current Time: ${STUB_TIME}\n\n`)).toBe(true);
        expect(ta.value).toContain('<user-input>\nhello\n</user-input>');
    });

    it('keeps exactly one Current Time line when an already-wrapped value is re-injected', () => {
        resetState({ isShowSystemTime: true, isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('hello');
        expect(injectPrefix(ta)).toBe(true);

        expect(injectPrefix(ta)).toBe(true);

        expect(countTimeLines(ta.value)).toBe(1);
        expect(ta.value.match(/<user-input>/g)).toHaveLength(1);
        expect(ta.value).toContain('<user-input>\nhello\n</user-input>');
    });

    it('adds no Current Time line when the system-time option is off', () => {
        resetState({ isShowSystemTime: false, isGlobalPromptEnabled: true, globalDefaultPrompt: 'GLOBAL' });
        const ta = makeTextarea('hello');

        expect(injectPrefix(ta)).toBe(true);

        expect(countTimeLines(ta.value)).toBe(0);
        expect(ta.value).toContain('<user-input>\nhello\n</user-input>');
    });
});
