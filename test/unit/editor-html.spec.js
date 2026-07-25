/**
 * Structural test for popup/editor/editor.html — verifies correct script tag order.
 *
 * This test reads the actual HTML file and asserts that all required script
 * dependencies are loaded in the correct sequence, particularly that i18n.js
 * is included between messaging.js and editor.js (Bug 3 fix).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '../../popup/editor/editor.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

// Extract src attributes from all <script> tags in document order
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);

describe('editor.html script tag structure', () => {
    it('has exactly 11 script tags', () => {
        expect(scriptSrcs).toHaveLength(11);
    });

    it.each([
        ['logger.js first', 0, '../../utils/logger.js'],
        ['storage-manager.chunk-lock.js second', 1, '../../utils/storage-manager.chunk-lock.js'],
        ['storage-manager.sync.js third', 2, '../../utils/storage-manager.sync.js'],
        ['storage-manager.presets.js fourth', 3, '../../utils/storage-manager.presets.js'],
        ['storage-manager.chatmap.js fifth', 4, '../../utils/storage-manager.chatmap.js'],
        ['storage-manager.local.js sixth', 5, '../../utils/storage-manager.local.js'],
        ['storage-manager.init.js seventh', 6, '../../utils/storage-manager.init.js'],
        ['storage-manager.js eighth', 7, '../../utils/storage-manager.js'],
        ['messaging.js ninth', 8, '../../utils/messaging.js'],
        ['i18n.js tenth (between messaging.js and editor.js)', 9, '../../utils/i18n.js'],
        ['editor.js last (eleventh)', 10, 'editor.js'],
    ])('loads %s', (_label, index, expected) => {
        expect(scriptSrcs[index]).toBe(expected);
    });

    it('ensures logger.js loads before the storage-manager bundle', () => {
        const loggerIdx = scriptSrcs.indexOf('../../utils/logger.js');
        const smFirstIdx = scriptSrcs.indexOf('../../utils/storage-manager.chunk-lock.js');
        expect(loggerIdx).toBeGreaterThanOrEqual(0);
        expect(loggerIdx).toBeLessThan(smFirstIdx);
    });

    it('ensures i18n.js appears after messaging.js and before editor.js (positional invariant)', () => {
        const msgIdx = scriptSrcs.indexOf('../../utils/messaging.js');
        const i18nIdx = scriptSrcs.indexOf('../../utils/i18n.js');
        const edIdx = scriptSrcs.indexOf('editor.js');
        expect(i18nIdx).toBeGreaterThan(msgIdx);
        expect(i18nIdx).toBeLessThan(edIdx);
    });
});
