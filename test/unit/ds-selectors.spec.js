// @vitest-environment jsdom
/**
 * content/ds-selectors.js — export contract tests.
 * Invariants only: no literal-value pins (tautological) and no string-composition pins (structural selectors are composed freely).
 * jsdom, not happy-dom, because happy-dom mis-parses relative :has() arguments (testing-pitfalls: DOM Fixture Completeness).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const S = require('../../content/ds-selectors.js');

/** Names removed when hashed-class selectors became structural; a consumer still reading one would get undefined. */
const REMOVED_EXPORTS = [
    'ASSISTANT_MESSAGE_SELECTOR',
    'RETRY_BUTTON_FALLBACK_SELECTOR',
    'NEW_CHAT_HEADER_MODIFIER_CLASS',
    'SIDEBAR_NATIVE_COLLAPSED_CLASS',
    'EXPAND_BUTTON_CONTAINER_CLASS',
    'EXPAND_BUTTON_ICON_CLASS',
    'THINK_HEADER_TOGGLE_CLASS',
    'EDIT_MESSAGE_BUTTON_CLASS',
];

const selectorEntries = Object.entries(S).filter(([key]) => /_(SELECTOR|FALLBACK)$/.test(key));
const classEntries = Object.entries(S).filter(([key]) => /_CLASS$/.test(key));

/**
 * Bracket balance outside quoted strings. The parser auto-closes a bracket left open at end of input, so an
 * unclosed :has( never throws; once another selector is appended to it, the appended part silently moves inside.
 */
function hasBalancedBrackets(selector) {
    const stack = [];
    let quote = null;
    for (const ch of selector) {
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(' || ch === '[') stack.push(ch);
        else if (ch === ')' && stack.pop() !== '(') return false;
        else if (ch === ']' && stack.pop() !== '[') return false;
    }
    return stack.length === 0 && quote === null;
}

describe('DSSelectors — export shape', () => {
    it('exports exactly 95 keys (guards accidental export removal)', () => {
        expect(Object.keys(S)).toHaveLength(95);
    });
    it('does not export the rejected websearch hash classes (ARCHITECTURE.md rejected signals)', () => {
        expect(S).not.toHaveProperty('WEBSEARCH_TOGGLE_CLASS');
        expect(S).not.toHaveProperty('WEBSEARCH_LABEL_CLASS');
    });
    it.each(REMOVED_EXPORTS)('does not export %s (removed by the structural rewrite)', (name) => {
        expect(S).not.toHaveProperty(name);
    });
    it('every value is a string except EDIT_SEND_BUTTON_VARIANT_CLASSES', () => {
        for (const [key, value] of Object.entries(S)) {
            if (key === 'EDIT_SEND_BUTTON_VARIANT_CLASSES') {
                expect(Array.isArray(value), key).toBe(true);
            } else {
                expect(typeof value, key).toBe('string');
            }
        }
    });
    it('no exported value is empty or blank', () => {
        for (const [key, value] of Object.entries(S)) {
            const parts = Array.isArray(value) ? value : [value];
            expect(parts.length, key).toBeGreaterThan(0);
            for (const part of parts) expect(part.trim(), key).not.toBe('');
        }
    });
});

describe('DSSelectors — selector syntax', () => {
    beforeAll(() => {
        expect(selectorEntries.length).toBeGreaterThan(0);
        expect(classEntries.length).toBeGreaterThan(0);
    });
    it.each(selectorEntries)('%s parses as a CSS selector', (key, selector) => {
        expect(() => document.querySelector(selector), selector).not.toThrow();
    });
    it.each(selectorEntries)('%s closes every bracket it opens', (key, selector) => {
        expect(hasBalancedBrackets(selector), selector).toBe(true);
    });
    it.each(classEntries)('%s holds only bare class tokens', (key, value) => {
        for (const token of value.split(/\s+/)) {
            expect(() => document.querySelector('.' + token), token).not.toThrow();
        }
    });
});

/**
 * While a message edit window is open the page holds two textareas: the edit box textarea[name="user query"] first in document order, then the main input textarea[name="search"].
 * Composer paths (send interception, quote-reply) read INPUT_TEXTAREA_SELECTOR and must reach the main input only; edit-window paths read ANY_TEXTAREA_SELECTOR and must still reach the edit box.
 * Expected elements are located by tag and name attribute, never through the selectors under test.
 */
describe('DSSelectors — composer vs edit-window textareas on real markup', () => {
    const SNAPSHOTS = path.resolve(__dirname, '../fixtures/ds-snapshots');
    const EDIT_PANE = path.join(SNAPSHOTS, 'edit-window-chat-pane.html');
    const IDLE_PANE = path.join(SNAPSHOTS, 'conv2-finished-chat-pane.html');

    it('ANY_TEXTAREA_SELECTOR is exported and matches every textarea on the edit-window pane, edit box included', () => {
        expect(S).toHaveProperty('ANY_TEXTAREA_SELECTOR');
        document.body.innerHTML = fs.readFileSync(EDIT_PANE, 'utf8');
        const all = Array.from(document.getElementsByTagName('textarea'));
        expect(all.map((t) => t.getAttribute('name')), 'fixture holds the edit box first, then the main input').toEqual(['user query', 'search']);
        expect(Array.from(document.querySelectorAll(S.ANY_TEXTAREA_SELECTOR))).toEqual(all);
    });

    it.each([
        ['edit-window pane (edit box precedes the main input)', EDIT_PANE],
        ['idle conversation pane', IDLE_PANE],
    ])('INPUT_TEXTAREA_SELECTOR matches exactly the main input on the %s', (_label, file) => {
        document.body.innerHTML = fs.readFileSync(file, 'utf8');
        const matches = Array.from(document.querySelectorAll(S.INPUT_TEXTAREA_SELECTOR));
        expect(matches.map((t) => t.getAttribute('name')), 'composer selector must match only the main input').toEqual(['search']);
    });
});

describe('DSSelectors — floating button bar on real markup', () => {
    const FIXTURE = path.resolve(__dirname, '../fixtures/ds-snapshots/conv2-finished-message-list.html');

    it('FLOATING_BUTTON_BAR_DIV_SELECTOR resolves to one div, the parent of the native go-bottom button', () => {
        document.body.innerHTML = fs.readFileSync(FIXTURE, 'utf8');
        const matches = document.querySelectorAll(S.FLOATING_BUTTON_BAR_DIV_SELECTOR);
        const nativeButton = document.querySelector('.' + S.GO_TOP_NATIVE_BUTTON_CLASS);
        expect(nativeButton, 'fixture holds the native go-bottom button').not.toBeNull();
        expect(matches).toHaveLength(1);
        expect(matches[0].tagName).toBe('DIV');
        expect(matches[0]).toBe(nativeButton.parentElement);
    });
});
