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
    it('ICON_BUTTON_ANY_SELECTOR equals ICON_BUTTON_ROLE_SELECTOR (simplified after dead .ds-icon-button removal)', () => {
        expect(S.ICON_BUTTON_ANY_SELECTOR).toBe(S.ICON_BUTTON_ROLE_SELECTOR);
    });
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
    it('exports exactly 87 keys', () => {
        expect(Object.keys(S)).toHaveLength(87);
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
