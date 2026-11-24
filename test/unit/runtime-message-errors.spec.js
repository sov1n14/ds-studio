/**
 * utils/runtime-message-errors.js — the one classifier for the chrome.runtime.sendMessage rejection that means "no context is listening" (the offscreen document or the service worker is not running).
 *
 * Contract: DSSRuntimeMessageErrors.isNoReceiverError(err) is true for Chrome's "Receiving end does not exist" rejection whether it arrives as an Error, as a plain string or as an object carrying a message, matched case-insensitively inside a longer text; every other value (other errors, empty values, non-text values) is false. Loading the file works without a module system and sets module.exports to the same object when one exists.
 */
import { describe, it, expect } from 'vitest';
import '../../utils/runtime-message-errors.js';

const CHROME_TEXT = 'Could not establish connection. Receiving end does not exist.';

describe('DSSRuntimeMessageErrors.isNoReceiverError', () => {
    it.each([
        ['an Error carrying the Chrome text', new Error(CHROME_TEXT)],
        ['a plain string carrying the Chrome text', CHROME_TEXT],
        ['an object whose message carries the Chrome text', { message: CHROME_TEXT }],
        ['the Chrome text in different letter case', new Error('RECEIVING END DOES NOT EXIST')],
        ['the bare phrase', 'Receiving end does not exist'],
    ])('is true for %s', (_name, err) => {
        expect(globalThis.DSSRuntimeMessageErrors.isNoReceiverError(err)).toBe(true);
    });

    it.each([
        ['an unrelated Error', new Error('Extension context invalidated.')],
        ['a partial phrase', new Error('Receiving end')],
        ['undefined', undefined],
        ['null', null],
        ['an empty object', {}],
        ['a number', 404],
        ['an empty string', ''],
    ])('is false for %s', (_name, err) => {
        expect(globalThis.DSSRuntimeMessageErrors.isNoReceiverError(err)).toBe(false);
    });

    it('publishes the same object on module.exports when a module system exists', () => {
        const exported = require('../../utils/runtime-message-errors.js');
        expect(exported.isNoReceiverError(CHROME_TEXT)).toBe(true);
    });
});
