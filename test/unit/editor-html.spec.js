/**
 * Load-order contract for popup/editor/editor.html (classic scripts, so order is the dependency graph). Expected order: logger and debounce first; every utils/storage-manager.* part, then the storage-manager.js entry that mixes them in; message constants and tab control; the i18n locales then i18n.js; the shared popup helpers; the editor parts; editor.js last. The storage-manager part sequence must also be identical to the one declared by manifest.json, popup/popup.html and background/service-worker.js, so the editor never assembles the bundle differently from the other contexts. (storage-manager.loader-contract.spec.js only checks presence and part-before-entry; this spec pins the full editor order.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const htmlSrcs = (rel) => [...read(rel).matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const scriptSrcs = htmlSrcs('popup/editor/editor.html');

/** Ordered storage-manager file names (parts and entry) from any list of loader paths. */
const storageManagerSequence = (paths) => paths.map((p) => p.match(/(storage-manager(?:\.[\w-]+)*\.js)$/)?.[1]).filter(Boolean);

const SM_PARTS = [
    'keys', 'rw', 'sync', 'sync.retry', 'restore', 'tombstone', 'preset-merge', 'preset-recency', 'presets',
    'chatmap.diff', 'chatmap.ops', 'chatmap', 'chatmap.client', 'local', 'init', 'setters', 'settings-read',
].map((p) => `storage-manager.${p}.js`);

const EXPECTED = [
    '../../utils/logger.js',
    '../../utils/debounce.js',
    ...SM_PARTS.map((f) => `../../utils/${f}`),
    '../../utils/storage-manager.js',
    '../../utils/message-constants.js',
    '../../utils/tab-control.js',
    '../../utils/i18n.locales.zhTW.js',
    '../../utils/i18n.locales.en.js',
    '../../utils/i18n.locales.js',
    '../../utils/i18n.js',
    '../popup.i18n-apply.js',
    '../popup.preset-domain.js',
    'editor.parse.js',
    'editor.render.js',
    'editor.storage.js',
    'editor.js',
];

describe('editor.html script load order', () => {
    it('declares exactly the expected scripts in the expected order', () => {
        expect(scriptSrcs).toEqual(EXPECTED);
    });

    it('every storage-manager part on disk loads before the storage-manager.js entry', () => {
        const onDisk = fs.readdirSync(path.join(ROOT, 'utils')).filter((f) => /^storage-manager\..+\.js$/.test(f)).sort();
        expect([...SM_PARTS].sort(), 'SM_PARTS must list every utils/storage-manager.*.js file').toEqual(onDisk);
        const entryIdx = scriptSrcs.indexOf('../../utils/storage-manager.js');
        expect(entryIdx).toBeGreaterThan(0);
        for (const part of onDisk) {
            const idx = scriptSrcs.indexOf(`../../utils/${part}`);
            expect(idx, `${part} must load before storage-manager.js`).toBeGreaterThanOrEqual(0);
            expect(idx, `${part} must load before storage-manager.js`).toBeLessThan(entryIdx);
        }
    });

    it.each([
        ['manifest.json', () => JSON.parse(read('manifest.json')).content_scripts[0].js],
        ['popup/popup.html', () => htmlSrcs('popup/popup.html')],
        ['background/service-worker.js', () => [...read('background/service-worker.js').match(/importScripts\(([\s\S]*?)\);/)[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])],
    ])('assembles the storage-manager bundle in the same order as %s', (_name, loaderPaths) => {
        const editorSeq = storageManagerSequence(scriptSrcs);
        expect(editorSeq).toEqual([...SM_PARTS, 'storage-manager.js']);
        expect(storageManagerSequence(loaderPaths())).toEqual(editorSeq);
    });
});
