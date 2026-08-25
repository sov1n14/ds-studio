/**
 * Structural test for popup/editor/editor.html — verifies correct script tag order. This test reads the actual HTML file and asserts that all required script dependencies are loaded in the correct sequence, particularly that i18n.js is included between messaging.js and editor.js (Bug 3 fix).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '../../popup/editor/editor.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);

describe('editor.html script tag structure', () => {
    it('has exactly 17 script tags', () => {
        expect(scriptSrcs).toHaveLength(17);
    });

    it.each([
        ['logger.js first', 0, '../../utils/logger.js'],
        ['debounce.js second (immediately after logger.js)', 1, '../../utils/debounce.js'],
        ['storage-manager.chunk-lock.js third', 2, '../../utils/storage-manager.chunk-lock.js'],
        ['storage-manager.sync.js fourth', 3, '../../utils/storage-manager.sync.js'],
        ['storage-manager.presets.js fifth', 4, '../../utils/storage-manager.presets.js'],
        ['storage-manager.chatmap.js sixth', 5, '../../utils/storage-manager.chatmap.js'],
        ['storage-manager.local.js seventh', 6, '../../utils/storage-manager.local.js'],
        ['storage-manager.init.js eighth', 7, '../../utils/storage-manager.init.js'],
        ['storage-manager.setters.js ninth', 8, '../../utils/storage-manager.setters.js'],
        ['storage-manager.settings-read.js tenth (immediately before storage-manager.js)', 9, '../../utils/storage-manager.settings-read.js'],
        ['storage-manager.js eleventh', 10, '../../utils/storage-manager.js'],
        ['tab-control.js twelfth', 11, '../../utils/tab-control.js'],
        ['i18n.locales.js thirteenth (immediately before i18n.js)', 12, '../../utils/i18n.locales.js'],
        ['i18n.js fourteenth (between i18n.locales.js and editor.js)', 13, '../../utils/i18n.js'],
        ['popup.i18n-apply.js fifteenth (after i18n.js)', 14, '../popup.i18n-apply.js'],
        ['popup.preset-domain.js sixteenth (before editor.js)', 15, '../popup.preset-domain.js'],
        ['editor.js last (seventeenth)', 16, 'editor.js'],
    ])('loads %s', (_label, index, expected) => {
        expect(scriptSrcs[index]).toBe(expected);
    });

    it('ensures logger.js loads before the storage-manager bundle', () => {
        const loggerIdx = scriptSrcs.indexOf('../../utils/logger.js');
        const smFirstIdx = scriptSrcs.indexOf('../../utils/storage-manager.chunk-lock.js');
        expect(loggerIdx).toBeGreaterThanOrEqual(0);
        expect(loggerIdx).toBeLessThan(smFirstIdx);
    });

    it('ensures i18n.js appears after tab-control.js and before editor.js (positional invariant)', () => {
        const tabCtrlIdx = scriptSrcs.indexOf('../../utils/tab-control.js');
        const i18nIdx = scriptSrcs.indexOf('../../utils/i18n.js');
        const edIdx = scriptSrcs.indexOf('editor.js');
        expect(tabCtrlIdx).toBeGreaterThanOrEqual(0);
        expect(i18nIdx).toBeGreaterThan(tabCtrlIdx);
        expect(i18nIdx).toBeLessThan(edIdx);
    });
});
