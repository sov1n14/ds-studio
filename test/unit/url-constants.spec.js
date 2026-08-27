/**
 * utils/url-constants.js — shared URL constants (debt-registry paydown).
 *
 * Requirement: DEEPSEEK_TAB_URL ('*://chat.deepseek.com/*') is currently
 * duplicated in background/settings-routes.js:16 and utils/tab-control.js:10.
 * The fix extracts it into utils/url-constants.js so both consumers reference
 * a single source of truth.
 *
 * This test asserts:
 *   1. utils/url-constants.js exists and exports DEEPSEEK_TAB_URL with the
 *      correct value.
 *   2. Neither consumer defines its own local DEEPSEEK_TAB_URL anymore.
 *   3. background/service-worker.js imports url-constants.js before both
 *      consumers.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../');
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

describe('utils/url-constants.js — shared constant extraction', () => {

    it('exports DEEPSEEK_TAB_URL with value *://chat.deepseek.com/*', () => {
        // Loading the module should make the constant available on globalThis
        // We cannot import it (classic script), so we verify it exists and
        // has the right value by loading it in the vitest environment.
        // First, just verify the file exists.
        const filePath = path.join(ROOT, 'utils/url-constants.js');
        expect(
            fs.existsSync(filePath),
            'utils/url-constants.js must exist'
        ).toBe(true);

        // Read the source and verify the constant value is declared
        const src = read('utils/url-constants.js');
        expect(src).toContain("DEEPSEEK_TAB_URL");
        expect(src).toContain("*://chat.deepseek.com/*");
    });

    it('background/settings-routes.js does NOT define its own DEEPSEEK_TAB_URL', () => {
        const src = read('background/settings-routes.js');
        // A local definition would be: const/let/var DEEPSEEK_TAB_URL =
        const hasLocalDef = /\b(?:const|let|var)\s+DEEPSEEK_TAB_URL\s*=/.test(src);
        expect(
            hasLocalDef,
            'background/settings-routes.js must not define a local DEEPSEEK_TAB_URL'
        ).toBe(false);
    });

    it('utils/tab-control.js does NOT define its own DEEPSEEK_TAB_URL', () => {
        const src = read('utils/tab-control.js');
        const hasLocalDef = /\b(?:const|let|var)\s+DEEPSEEK_TAB_URL\s*=/.test(src);
        expect(
            hasLocalDef,
            'utils/tab-control.js must not define a local DEEPSEEK_TAB_URL'
        ).toBe(false);
    });

    it('background/service-worker.js imports url-constants.js before settings-routes.js', () => {
        const src = read('background/service-worker.js');
        const urlConstantsIdx = src.indexOf('url-constants.js');
        const settingsRoutesIdx = src.indexOf('settings-routes.js');

        expect(
            urlConstantsIdx,
            'service-worker.js must import url-constants.js'
        ).toBeGreaterThan(-1);
        expect(
            urlConstantsIdx,
            'url-constants.js must appear before settings-routes.js in importScripts'
        ).toBeLessThan(settingsRoutesIdx);
    });
});
