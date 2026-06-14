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
    it('has exactly 8 script tags', () => {
        expect(scriptSrcs).toHaveLength(8);
    });

    it('loads storage-manager.chunking.js first', () => {
        expect(scriptSrcs[0]).toBe('../../utils/storage-manager.chunking.js');
    });

    it('loads storage-manager.lock.js second', () => {
        expect(scriptSrcs[1]).toBe('../../utils/storage-manager.lock.js');
    });

    it('loads storage-manager.sync.js third', () => {
        expect(scriptSrcs[2]).toBe('../../utils/storage-manager.sync.js');
    });

    it('loads storage-manager.presets.js fourth', () => {
        expect(scriptSrcs[3]).toBe('../../utils/storage-manager.presets.js');
    });

    it('loads storage-manager.js fifth', () => {
        expect(scriptSrcs[4]).toBe('../../utils/storage-manager.js');
    });

    it('loads messaging.js sixth', () => {
        expect(scriptSrcs[5]).toBe('../../utils/messaging.js');
    });

    it('loads i18n.js seventh (between messaging.js and editor.js)', () => {
        expect(scriptSrcs[6]).toBe('../../utils/i18n.js');
    });

    it('loads editor.js last (eighth)', () => {
        expect(scriptSrcs[7]).toBe('editor.js');
    });

    it('ensures i18n.js appears after messaging.js and before editor.js (positional invariant)', () => {
        const msgIdx = scriptSrcs.indexOf('../../utils/messaging.js');
        const i18nIdx = scriptSrcs.indexOf('../../utils/i18n.js');
        const edIdx = scriptSrcs.indexOf('editor.js');
        expect(i18nIdx).toBeGreaterThan(msgIdx);
        expect(i18nIdx).toBeLessThan(edIdx);
    });
});
