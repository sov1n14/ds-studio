import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

/**
 * Load a classic (non-module) extension script into a fresh vm context.
 *
 * The extension ships classic scripts that publish their API by assigning to a
 * global, so a spec cannot `import` them; it has to run the source in a sandbox
 * and read the global back off it.
 *
 * @param {string} relPath  Path relative to the repo root, e.g. 'content/sse-parser.js'.
 * @param {object} [sandbox] Pre-seeded globals the script needs (XMLHttpRequest,
 *                           window, dependency globals...). Mutated in place and returned.
 * @returns {object} The sandbox, now carrying whatever globals the script defined.
 */
export function loadClassicScript(relPath, sandbox = {}) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const src = fs.readFileSync(path.join(root, relPath), 'utf-8');
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox;
}
