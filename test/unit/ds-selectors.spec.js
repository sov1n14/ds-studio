/**
 * content/ds-selectors.js — value contract tests.
 * Composite derivation and export shape only; literal-value pins removed (tautological).
 */
import { describe, it, expect, beforeAll } from 'vitest';

let S;

beforeAll(() => {
    S = require('../../content/ds-selectors.js');
});

describe('DSSelectors — composite values', () => {
    it('THINK_BLOCK_SELECTOR is dot-prefixed THINK_BLOCK_CLASS', () => {
        expect(S.THINK_BLOCK_SELECTOR).toBe('.' + S.THINK_BLOCK_CLASS);
    });
    it('THINK_SEPARATOR_SELECTOR is dot-prefixed THINK_SEPARATOR_CLASS', () => {
        expect(S.THINK_SEPARATOR_SELECTOR).toBe('.' + S.THINK_SEPARATOR_CLASS);
    });
    it('FLOATING_BUTTON_BAR_DIV_SELECTOR is div + FLOATING_BUTTON_BAR_SELECTOR', () => {
        expect(S.FLOATING_BUTTON_BAR_DIV_SELECTOR).toBe('div' + S.FLOATING_BUTTON_BAR_SELECTOR);
    });
    it('THINK_HEADER_TOGGLE_CLASS is the first word of THINK_HEADER_CLASS', () => {
        expect(S.THINK_HEADER_TOGGLE_CLASS).toBe(S.THINK_HEADER_CLASS.split(' ')[0]);
    });
});

describe('DSSelectors — export shape', () => {
    it('exports exactly 91 keys', () => {
        expect(Object.keys(S)).toHaveLength(91);
    });
    it('every value is a string except EDIT_SEND_BUTTON_VARIANT_CLASSES', () => {
        for (const [key, value] of Object.entries(S)) {
            if (key === 'EDIT_SEND_BUTTON_VARIANT_CLASSES') {
                expect(Array.isArray(value)).toBe(true);
            } else {
                expect(typeof value).toBe('string');
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Mutant-killing: IIFE body → {} (line 13) and EDIT_SEND_BUTTON_VARIANT_CLASSES → [] (line 280)
// ---------------------------------------------------------------------------

describe('DSSelectors — IIFE body produces non-empty exports (kills BlockStatement → {} mutant on line 13)', () => {
    it('exports a non-empty object with expected selector properties', () => {
        expect(Object.keys(S).length).toBeGreaterThan(0);
        expect(S).toHaveProperty('SEND_BUTTON_ROLE_SELECTOR');
        expect(S).toHaveProperty('SIDEBAR_WRAPPER_SELECTOR');
        expect(S).toHaveProperty('MESSAGE_SELECTOR');
        expect(S).toHaveProperty('INPUT_TEXTAREA_SELECTOR');
    });
});

describe('DSSelectors — EDIT_SEND_BUTTON_VARIANT_CLASSES content (kills [] mutant on line 280)', () => {
    it('contains exactly 2 entries: ds-button--primary and ds-button--filled', () => {
        const classes = S.EDIT_SEND_BUTTON_VARIANT_CLASSES;
        expect(classes).toHaveLength(2);
        expect(classes).toContain('ds-button--primary');
        expect(classes).toContain('ds-button--filled');
    });
});
