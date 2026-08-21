/**
 * Shared loader for the popup's classic scripts.
 *
 * The popup ships plain <script> files that publish their API on a global (window.__DS_PopupLiveSync, window.__DSSCustomSelect, ...). Specs load them by reading the file and eval()-ing it, which mirrors the load order declared in popup.html. This module holds the single copy of that loader.
 *
 * eval() stays here on purpose: it is a direct eval, so the evaluated code's own declarations remain local to the call while its assignments to `window` still reach the shared global — exactly as when each spec inlined the same two lines.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Reads a project file as UTF-8. `relPath` is relative to the repo root, e.g. 'popup/popup.js'. */
export function readProjectFile(relPath) {
    return readFileSync(resolve(PROJECT_ROOT, relPath), 'utf-8');
}

/**
 * Evaluates a classic script in the current realm.
 * @param {string} relPath repo-root-relative path, e.g. 'popup/custom-select.js'
 * @param {string} [prelude] code prepended inside the eval scope
 */
export function evalPopupScript(relPath, prelude = '') {
    eval(prelude + readProjectFile(relPath));
}

/** Loads utils/i18n.js once per realm. It is an IIFE that closes over `chrome`, `document` and `window`, so those are bound in the eval scope before it runs. */
export function loadI18nOnce() {
    if (globalThis.dsI18n) return;
    evalPopupScript('utils/i18n.js', 'var chrome=globalThis.chrome,document=globalThis.document,window=globalThis;');
}
