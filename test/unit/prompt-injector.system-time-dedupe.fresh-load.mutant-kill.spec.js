/**
 * System-time de-duplication of content/prompt-injector.controller.js with the controller evaluated INSIDE each test.
 *
 * Requirement (docs/FEATURES.md "System Time", docs/spec/04-features.md): with show-system-time on, a leading `Current Time:` line of the user text and the blank or whitespace-only lines after it are replaced by one fresh timestamp line; a `Current Time:` line elsewhere in the text is user text and stays; a timestamp-only input is left unsent and unchanged unless an attachment makes it sendable, and then the old line is replaced by one fresh line.
 *
 * Why a fresh-load spec: the pattern that recognises the leading line is built once, when the controller file is evaluated. test/stryker.config.json sets "ignoreStatic": true, under which Stryker runs a mutant of a load-time value only against tests that evaluate the file inside the test. test/unit/prompt-injector.system-time-dedupe.spec.js imports the controller at file load, so its identical assertions never run against those mutants. Here every test drops the controller from the require cache, requires it again and builds its own injector; afterEach removes the document listeners that injector registered.
 *
 * Every assertion reads the exact textarea value the page would send, and the injectPrefix return value (true: send, false: leave unsent).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../content/ds-selectors.js';
import '../../content/prompt-injector.send-button.js';

const CONTROLLER_PATH = require.resolve('../../content/prompt-injector.controller.js');
const STUB_TIME = '2026/11/09 10:00:00 (UTC+08:00)';
const OLD_TIME_LINE = 'Current Time: 2026/01/01 00:00:00 (UTC+08:00)';

let addListenerSpy;

/** Evaluate prompt-injector.controller.js from scratch and return injectPrefix of a new injector with system time on and no prompt prefix. */
function loadFreshInjectPrefix() {
    delete require.cache[CONTROLLER_PATH];
    const { createPromptInjector } = require('../../content/prompt-injector.controller.js');
    let isInjecting = false;
    const { injectPrefix } = createPromptInjector({
        getIsEnabled:             () => true,
        getPromptPrefix:          () => '',
        getGlobalDefaultPrompt:   () => '',
        getIsGlobalPromptEnabled: () => false,
        getIsShowSystemTime:      () => true,
        getIsInjecting:           () => isInjecting,
        setIsInjecting:           (v) => { isInjecting = v; },
        markChatCreationAttempt:  () => {},
        formatSystemTime:         () => STUB_TIME,
    });
    return injectPrefix;
}

function makeTextarea(value) {
    const ta = document.createElement('textarea');
    ta.value = value;
    return ta;
}

// The text sent with system time on and no preset or global prompt: one fresh time line, a blank line, then the user text wrapped as-is.
function expectedSent(userText) {
    return `Current Time: ${STUB_TIME}\n\n<user-input>\n${userText}\n</user-input>`;
}

beforeEach(() => {
    addListenerSpy = vi.spyOn(document, 'addEventListener');
});

afterEach(() => {
    addListenerSpy.mock.calls.forEach(([type, fn, opts]) => document.removeEventListener(type, fn, opts));
    addListenerSpy.mockRestore();
    document.body.innerHTML = '';
});

describe('system time, fresh controller load: the leading Current Time line is replaced', () => {
    it.each([
        ['directly followed by text, with no blank line', `${OLD_TIME_LINE}\nhello`, 'hello'],
        ['followed by one empty line', `${OLD_TIME_LINE}\n\nhello`, 'hello'],
        ['followed by several empty lines', `${OLD_TIME_LINE}\n\n\n\nhello`, 'hello'],
        ['followed by whitespace-only lines of several spaces and tabs', `${OLD_TIME_LINE}\n  \t \n\t\t\nhello`, 'hello'],
        ['followed by a whitespace-only line of one space', `${OLD_TIME_LINE}\n \nhello`, 'hello'],
        ['followed by a multi-line user text', `${OLD_TIME_LINE}\n\nfirst\nsecond\nthird`, 'first\nsecond\nthird'],
    ])('time line %s: sends one fresh time line and the remaining user text with nothing added', (_label, input, userText) => {
        const injectPrefix = loadFreshInjectPrefix();
        const ta = makeTextarea(input);

        expect(injectPrefix(ta), 'injectPrefix return value').toBe(true);

        expect(ta.value, 'sent text').toBe(expectedSent(userText));
    });

    it('leaves a Current Time line that is not at the start of the text inside the user text', () => {
        const injectPrefix = loadFreshInjectPrefix();
        const userText = `hello\n${OLD_TIME_LINE}\nworld`;
        const ta = makeTextarea(userText);

        expect(injectPrefix(ta), 'injectPrefix return value').toBe(true);

        expect(ta.value, 'sent text').toBe(expectedSent(userText));
    });
});

describe('system time, fresh controller load: timestamp-only input', () => {
    it.each([
        ['with no trailing newline', OLD_TIME_LINE],
        ['followed by empty lines', `${OLD_TIME_LINE}\n\n`],
    ])('leaves a timestamp-only input %s unsent and unchanged', (_label, input) => {
        const injectPrefix = loadFreshInjectPrefix();
        const ta = makeTextarea(input);

        expect(injectPrefix(ta), 'injectPrefix return value').toBe(false);

        expect(ta.value, 'textarea value').toBe(input);
    });

    // The second argument marks the message as sendable without text (an attachment or image is present).
    it.each([
        ['with no trailing newline', OLD_TIME_LINE],
        ['followed by empty lines', `${OLD_TIME_LINE}\n\n`],
    ])('replaces the old line of a timestamp-only input %s with one fresh line when an attachment makes it sendable', (_label, input) => {
        const injectPrefix = loadFreshInjectPrefix();
        const ta = makeTextarea(input);

        expect(injectPrefix(ta, true), 'injectPrefix return value').toBe(true);

        expect(ta.value, 'sent text').toBe(`Current Time: ${STUB_TIME}\n\n`);
    });
});
