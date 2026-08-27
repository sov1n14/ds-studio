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
    it('has exactly 28 script tags', () => {
        expect(scriptSrcs).toHaveLength(28);
    });

    it.each([
        ['logger.js first', 0, '../../utils/logger.js'],
        ['debounce.js second', 1, '../../utils/debounce.js'],
        ['storage-manager.keys.js third', 2, '../../utils/storage-manager.keys.js'],
        ['storage-manager.chunk-lock.js fourth', 3, '../../utils/storage-manager.chunk-lock.js'],
        ['storage-manager.rw.js fifth', 4, '../../utils/storage-manager.rw.js'],
        ['storage-manager.sync.js sixth', 5, '../../utils/storage-manager.sync.js'],
        ['storage-manager.tombstone.js seventh', 6, '../../utils/storage-manager.tombstone.js'],
        ['storage-manager.preset-merge.js eighth', 7, '../../utils/storage-manager.preset-merge.js'],
        ['storage-manager.preset-recency.js ninth', 8, '../../utils/storage-manager.preset-recency.js'],
        ['storage-manager.presets.js tenth', 9, '../../utils/storage-manager.presets.js'],
        ['storage-manager.chatmap.diff.js eleventh', 10, '../../utils/storage-manager.chatmap.diff.js'],
        ['storage-manager.chatmap.js twelfth', 11, '../../utils/storage-manager.chatmap.js'],
        ['storage-manager.local.js thirteenth', 12, '../../utils/storage-manager.local.js'],
        ['storage-manager.init.js fourteenth', 13, '../../utils/storage-manager.init.js'],
        ['storage-manager.setters.js fifteenth', 14, '../../utils/storage-manager.setters.js'],
        ['storage-manager.settings-read.js sixteenth', 15, '../../utils/storage-manager.settings-read.js'],
        ['storage-manager.js seventeenth', 16, '../../utils/storage-manager.js'],
        ['tab-control.js eighteenth', 17, '../../utils/tab-control.js'],
        ['i18n.locales.zhTW.js nineteenth', 18, '../../utils/i18n.locales.zhTW.js'],
        ['i18n.locales.en.js twentieth', 19, '../../utils/i18n.locales.en.js'],
        ['i18n.locales.js twenty-first', 20, '../../utils/i18n.locales.js'],
        ['i18n.js twenty-second', 21, '../../utils/i18n.js'],
        ['popup.i18n-apply.js twenty-third', 22, '../popup.i18n-apply.js'],
        ['popup.preset-domain.js twenty-fourth', 23, '../popup.preset-domain.js'],
        ['editor.parse.js twenty-fifth', 24, 'editor.parse.js'],
        ['editor.render.js twenty-sixth', 25, 'editor.render.js'],
        ['editor.storage.js twenty-seventh', 26, 'editor.storage.js'],
        ['editor.js last (twenty-eighth)', 27, 'editor.js'],
    ])('loads %s', (_label, index, expected) => {
        expect(scriptSrcs[index]).toBe(expected);
    });

    it('ensures logger.js loads before the storage-manager bundle', () => {
        const loggerIdx = scriptSrcs.indexOf('../../utils/logger.js');
        const smFirstIdx = scriptSrcs.indexOf('../../utils/storage-manager.keys.js');
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
