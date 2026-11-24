/**
 * Source-text contract for the StorageManager.syncNow() call sites: reads popup/popup.js and content/content-script.js as text and regex-matches the calls.
 * Listed on the exclude list of test/stryker-vitest.config.js, because Stryker's instrumented copies of these files break source-text matching.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

describe('syncNow() call-site wiring', () => {
    it('popup.js invokes StorageManager.syncNow() during its refresh/init flow', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const popupCode = readFileSync(resolve(__dirname, '../../popup/popup.js'), 'utf-8');

        expect(popupCode).toMatch(/StorageManager\.syncNow\s*\(\s*\)/);
    });

    it('content-script.js initSettings() invokes StorageManager.syncNow()', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const contentCode = readFileSync(resolve(__dirname, '../../content/content-script.js'), 'utf-8');

        const initSettingsMatch = contentCode.match(/async function initSettings\(\)\s*\{[\s\S]*?\n\}/);
        expect(initSettingsMatch).not.toBeNull();
        expect(initSettingsMatch[0]).toMatch(/StorageManager\.syncNow\s*\(\s*\)/);
    });
});
