/**
 * utils/permission-request-errors.js - classifies a chrome.permissions.request rejection.
 *
 * Requirement: Chromium rejects chrome.permissions.request with `Error: Could not find an active window.` when no native window exists to host the permission prompt (Kiwi Browser on Android). The module is a classic script that publishes globalThis.DSSPermissionRequestErrors with isWindowUnavailableError(err), which answers true only for an error whose message is exactly that text and false for anything else, including a missing or non-Error value, without throwing.
 *
 * Assertions read only the boolean the classifier returns. The expected text is the literal Chromium message, so a wrong message in the module fails here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// node:path, not new URL(): happy-dom's global URL does not resolve a relative path against a file: base.
const MODULE_PATH = resolve(import.meta.dirname, '../../utils/permission-request-errors.js');
// import.meta.glob resolves outside test/ and yields {} for a missing file instead of failing the transform.
const MODULE_LOADERS = import.meta.glob('../../utils/permission-request-errors.js');
const CHROMIUM_WINDOW_UNAVAILABLE = 'Could not find an active window.';

/** Evaluates the module afresh and returns its published global; a missing file and a missing global are distinct errors. */
async function loadApi() {
    if (!existsSync(MODULE_PATH)) throw new Error(`utils/permission-request-errors.js does not exist (${MODULE_PATH})`);
    const [loader] = Object.values(MODULE_LOADERS);
    if (!loader) throw new Error('utils/permission-request-errors.js exists but import.meta.glob did not match it; fix the loader path in this spec');
    vi.resetModules();
    await loader();
    const api = globalThis.DSSPermissionRequestErrors;
    if (!api) throw new Error('utils/permission-request-errors.js loaded but did not publish globalThis.DSSPermissionRequestErrors');
    return api;
}

describe('DSSPermissionRequestErrors', () => {
    beforeEach(() => { delete globalThis.DSSPermissionRequestErrors; });
    afterEach(() => { delete globalThis.DSSPermissionRequestErrors; });

    it("isWindowUnavailableError returns true for new Error('Could not find an active window.')", async () => {
        const api = await loadApi();

        expect(api.isWindowUnavailableError(new Error(CHROMIUM_WINDOW_UNAVAILABLE))).toBe(true);
    });

    it.each([
        ['another permissions error', 'Only permissions specified in the manifest may be requested.'],
        ['a user-gesture error', 'This function must be called during a user gesture'],
        ['the window text with a trailing space', CHROMIUM_WINDOW_UNAVAILABLE + ' '],
        ['the window text without its final period', 'Could not find an active window'],
        ['the window text in different case', CHROMIUM_WINDOW_UNAVAILABLE.toUpperCase()],
        ['the window text as a prefix of a longer message', CHROMIUM_WINDOW_UNAVAILABLE + ' Retry later.'],
        ['an empty message', ''],
    ])('isWindowUnavailableError returns false for an Error with %s', async (_label, message) => {
        const api = await loadApi();

        expect(api.isWindowUnavailableError(new Error(message)), JSON.stringify(message)).toBe(false);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['the bare window text as a string (no message property)', CHROMIUM_WINDOW_UNAVAILABLE],
        ['an object without a message', {}],
    ])('isWindowUnavailableError returns false without throwing for %s', async (_label, value) => {
        const api = await loadApi();

        let result;
        expect(() => { result = api.isWindowUnavailableError(value); }).not.toThrow();
        expect(result).toBe(false);
    });
});
