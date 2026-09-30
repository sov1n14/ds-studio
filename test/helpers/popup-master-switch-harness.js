/**
 * Runs the real applyMasterSwitchUI from popup/popup.js against the real popup/popup.html DOM.
 *
 * applyMasterSwitchUI lives inside popup.js's DOMContentLoaded closure and reads closure-level DOM refs. The harness extracts its source, finds which of those refs it names by intersecting its identifiers with the closure's own `const x = document.getElementById(...)` / `Array.from(document.querySelectorAll(...))` declarations, resolves each ref with the same lookup popup.js uses, and passes them in as parameters. A new control added to subControls is picked up without editing any spec.
 *
 * Fails loudly instead of stubbing: a ref whose element is missing from the mounted DOM throws, and any identifier the function names that is neither a declared DOM ref nor a local stays unbound, so calling the function throws ReferenceError.
 */
import { readProjectFile } from './popup-script-loader.js';

/** popup.html parsed into a detached document. Link/script tags are stripped first so happy-dom does not fetch popup assets over HTTP. */
export function parsePopupHtml() {
    const html = readProjectFile('popup/popup.html').replace(/<link\b[^>]*>/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '');
    return new DOMParser().parseFromString(html, 'text/html');
}

/** Replaces document.body with the real popup.html body. */
export function mountPopupHtml() {
    document.body.innerHTML = parsePopupHtml().body.innerHTML;
}

/** Closure-level (4-space indent) DOM-ref declarations in popup.js: name -> resolver against `document`. */
function readClosureDomRefs(popupSource) {
    const refs = new Map();
    for (const [, name, , id] of popupSource.matchAll(/^ {4}const\s+(\w+)\s*=\s*document\.getElementById\(\s*(['"])(.+?)\2\s*\)/gm)) {
        refs.set(name, { lookup: `#${id}`, resolve: () => document.getElementById(id) });
    }
    for (const [, name, , selector] of popupSource.matchAll(/^ {4}const\s+(\w+)\s*=\s*Array\.from\(\s*document\.querySelectorAll\(\s*(['"])(.+?)\2\s*\)\s*\)/gm)) {
        refs.set(name, { lookup: selector, resolve: () => Array.from(document.querySelectorAll(selector)) });
    }
    return refs;
}

/**
 * Builds the real applyMasterSwitchUI bound to elements in the current document (call mountPopupHtml() first).
 * @returns {{ applyMasterSwitchUI: (isEnabled: boolean) => void, refs: Record<string, Element | Element[]> }} refs holds every bound DOM ref by its popup.js name.
 */
export function buildApplyMasterSwitchUI() {
    const popupSource = readProjectFile('popup/popup.js');
    const match = popupSource.match(/function applyMasterSwitchUI\(isEnabled\)\s*\{[\s\S]*?\n {4}\}/);
    if (!match) throw new Error('Could not locate applyMasterSwitchUI(isEnabled) in popup/popup.js');
    const fnSource = match[0];

    const declared = readClosureDomRefs(popupSource);
    const names = [...new Set(fnSource.match(/[A-Za-z_$][\w$]*/g))].filter((name) => declared.has(name));
    if (names.length === 0) throw new Error('applyMasterSwitchUI references no closure DOM refs; the popup.js declaration parser is out of date');

    const refs = {};
    for (const name of names) {
        const { lookup, resolve } = declared.get(name);
        const value = resolve();
        if (!value || (Array.isArray(value) && value.length === 0)) {
            throw new Error(`applyMasterSwitchUI references ${name}, but ${lookup} matches nothing in the mounted DOM (mount popup.html first, or popup.html lost the element)`);
        }
        refs[name] = value;
    }

    const factory = new Function(...names, `${fnSource}\nreturn applyMasterSwitchUI;`);
    return { applyMasterSwitchUI: factory(...names.map((name) => refs[name])), refs };
}
