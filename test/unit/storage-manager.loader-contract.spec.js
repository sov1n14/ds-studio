import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// This spec asserts a consistency contract between:
//   - utils/storage-manager.js (the entry file that mixes bundle globals in via
//     Object.assign(StorageManager, root.__DS_StorageManager_<name> || {}, ...))
//   - utils/storage-manager.<name>.js (the sibling files that each assign one
//     root.__DS_StorageManager_<name> global)
//   - the five loaders that must load every bundle file BEFORE the entry file:
//     manifest.json, popup/popup.html, popup/editor/editor.html,
//     background/service-worker.js, test/setup/vitest.setup.js
//
// Everything below is discovered from the files themselves (regex/JSON parsing
// of real text) — nothing is a hardcoded list of bundle names or paths, so the
// contract keeps holding as bundles are added, renamed, or merged.

const ROOT = path.resolve(__dirname, '../../');
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

// ---------------------------------------------------------------------------
// R1: names mixed in by utils/storage-manager.js's Object.assign call
// ---------------------------------------------------------------------------
function discoverMixedInNames() {
    const src = read('utils/storage-manager.js');
    const assignMatch = src.match(/Object\.assign\(\s*StorageManager,([\s\S]*?)\);/);
    if (!assignMatch) {
        throw new Error('Could not locate Object.assign(StorageManager, ...) block in utils/storage-manager.js');
    }
    const body = assignMatch[1];
    const names = new Set();
    const re = /__DS_StorageManager_(\w+)/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        names.add(m[1]);
    }
    return names;
}

// ---------------------------------------------------------------------------
// R2: map of bundle global name -> file path (relative to repo root), found by
// scanning every utils/storage-manager.*.js file (excluding the entry itself)
// for the __DS_StorageManager_<name> global it assigns.
// ---------------------------------------------------------------------------
function discoverBundleFiles() {
    const utilsDir = path.join(ROOT, 'utils');
    const files = fs.readdirSync(utilsDir)
        .filter((f) => /^storage-manager\..+\.js$/.test(f));

    const nameToFile = new Map();
    for (const file of files) {
        const relPath = `utils/${file}`;
        const src = fs.readFileSync(path.join(utilsDir, file), 'utf8');
        const assignMatch = src.match(/root\.__DS_StorageManager_(\w+)\s*=/);
        if (!assignMatch) continue; // not a bundle file (no global assignment found)
        nameToFile.set(assignMatch[1], relPath);
    }
    return nameToFile;
}

// ---------------------------------------------------------------------------
// R5 helpers: extract an ordered list of storage-manager related file
// references from each loader, normalized to "utils/storage-manager.X.js".
// ---------------------------------------------------------------------------
function normalizeStorageManagerRef(rawPath) {
    const m = rawPath.match(/(storage-manager\.[\w.-]+\.js|storage-manager\.js)$/);
    return m ? `utils/${m[1]}` : null;
}

function extractOrderedRefs(strings) {
    const ordered = [];
    for (const s of strings) {
        const norm = normalizeStorageManagerRef(s);
        if (norm) ordered.push(norm);
    }
    return ordered;
}

function loadManifestOrder() {
    const manifest = JSON.parse(read('manifest.json'));
    const jsList = manifest.content_scripts[0].js;
    return extractOrderedRefs(jsList);
}

function loadHtmlScriptOrder(relHtmlPath) {
    const html = read(relHtmlPath);
    const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
    return extractOrderedRefs(srcs);
}

function loadServiceWorkerOrder() {
    const src = read('background/service-worker.js');
    const importScriptsMatch = src.match(/importScripts\(([\s\S]*?)\);/);
    if (!importScriptsMatch) {
        throw new Error('Could not locate importScripts(...) call in background/service-worker.js');
    }
    const args = [...importScriptsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
    return extractOrderedRefs(args);
}

function loadVitestSetupOrder() {
    const src = read('test/setup/vitest.setup.js');
    const imports = [...src.matchAll(/import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    return extractOrderedRefs(imports);
}

const LOADERS = [
    { name: 'manifest.json', getOrder: loadManifestOrder },
    { name: 'popup/popup.html', getOrder: () => loadHtmlScriptOrder('popup/popup.html') },
    { name: 'popup/editor/editor.html', getOrder: () => loadHtmlScriptOrder('popup/editor/editor.html') },
    { name: 'background/service-worker.js', getOrder: loadServiceWorkerOrder },
    { name: 'test/setup/vitest.setup.js', getOrder: loadVitestSetupOrder },
];

const ENTRY_FILE = 'utils/storage-manager.js';

describe('storage-manager loader contract', () => {
    const mixedInNames = discoverMixedInNames();
    const bundleFilesByName = discoverBundleFiles();

    test('every mixed-in global name is produced by exactly one existing bundle file (R3)', () => {
        const orphans = [...mixedInNames].filter((name) => !bundleFilesByName.has(name));
        expect(orphans, `Names mixed in by ${ENTRY_FILE} but produced by no bundle file (resolves to {} silently): ${orphans.join(', ')}`).toEqual([]);
    });

    test('every bundle file has its global mixed in by the entry file (R4)', () => {
        const deadFiles = [...bundleFilesByName.entries()]
            .filter(([name]) => !mixedInNames.has(name))
            .map(([name, file]) => `${file} (__DS_StorageManager_${name})`);
        expect(deadFiles, `Bundle files whose global nobody mixes in (dead weight): ${deadFiles.join(', ')}`).toEqual([]);
    });

    const bundleFiles = [...bundleFilesByName.values()].sort();

    for (const loader of LOADERS) {
        test(`${loader.name} loads every bundle file before the entry file (R5)`, () => {
            const order = loader.getOrder();
            const entryIndex = order.indexOf(ENTRY_FILE);
            // Some loaders (e.g. vitest.setup.js) intentionally preload only the
            // bundle files and never reference the entry file themselves — the
            // entry is imported by individual spec files instead. For those,
            // "before the entry" is vacuous, so only presence is asserted.
            const requiresOrderCheck = entryIndex !== -1;

            const missing = [];
            const misordered = [];
            for (const bundleFile of bundleFiles) {
                const idx = order.indexOf(bundleFile);
                if (idx === -1) {
                    missing.push(bundleFile);
                } else if (requiresOrderCheck && idx > entryIndex) {
                    misordered.push(bundleFile);
                }
            }

            expect(missing, `${loader.name} is missing bundle file(s): ${missing.join(', ')}`).toEqual([]);
            expect(misordered, `${loader.name} loads bundle file(s) AFTER ${ENTRY_FILE}: ${misordered.join(', ')}`).toEqual([]);
        });
    }
});
