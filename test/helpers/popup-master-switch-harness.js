/**
 * Runs the real applyMasterSwitchUI from popup/popup.js against the real popup/popup.html DOM.
 *
 * applyMasterSwitchUI lives inside popup.js's DOMContentLoaded closure and reads closure-level DOM refs. The harness extracts its source, finds which of those refs it names by intersecting its identifiers with the closure's own `const x = document.getElementById(...)` / `Array.from(document.querySelectorAll(...))` declarations, resolves each ref with the same lookup popup.js uses, and passes them in as parameters. A new control added to subControls is picked up without editing any spec.
 *
 * 取出原始碼與判斷閉包層級宣告都交由 popup-closure-source.js，不依賴縮排，因此在 Stryker 以 Babel 重新排版並插樁的 popup.js 上同樣執行真實程式碼；檔案最外層的 stryMutAct_* 等輔助函式與 applyMasterSwitchUI 放在同一範圍。
 *
 * Fails loudly instead of stubbing: a ref whose element is missing from the mounted DOM throws, and any identifier the function names that is neither a declared DOM ref nor a local stays unbound, so calling the function throws ReferenceError.
 */
import { readProjectFile } from './popup-script-loader.js';
import { findFunctionDeclaration, readClosureDomRefs, topLevelFunctionDeclarations } from './popup-closure-source.js';

/** popup.html parsed into a detached document. Link/script tags are stripped first so happy-dom does not fetch popup assets over HTTP. */
export function parsePopupHtml() {
    const html = readProjectFile('popup/popup.html').replace(/<link\b[^>]*>/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '');
    return new DOMParser().parseFromString(html, 'text/html');
}

/** Replaces document.body with the real popup.html body. */
export function mountPopupHtml() {
    document.body.innerHTML = parsePopupHtml().body.innerHTML;
}

/**
 * Builds the real applyMasterSwitchUI bound to elements in the current document (call mountPopupHtml() first).
 * @returns {{ applyMasterSwitchUI: (isEnabled: boolean) => void, refs: Record<string, Element | Element[]> }} refs holds every bound DOM ref by its popup.js name.
 */
export function buildApplyMasterSwitchUI() {
    const popupSource = readProjectFile('popup/popup.js');
    const fnSource = findFunctionDeclaration(popupSource, 'applyMasterSwitchUI');

    const declared = readClosureDomRefs(popupSource);
    const names = [...new Set(fnSource.match(/[A-Za-z_$][\w$]*/g))].filter((name) => declared.has(name));
    if (names.length === 0) throw new Error('applyMasterSwitchUI references no closure DOM refs; the popup.js declaration parser is out of date');

    const refs = {};
    for (const name of names) {
        const { lookup, resolve } = declared.get(name);
        const value = resolve();
        if (!value || (Array.isArray(value) && value.length === 0)) {
            throw new Error(`applyMasterSwitchUI references ${name}, but its popup.js lookup "${lookup}" matches nothing in the mounted DOM (mount popup.html first, or popup.html lost the element)`);
        }
        refs[name] = value;
    }

    const factory = new Function(...names, `${topLevelFunctionDeclarations(popupSource).join('\n')}\n${fnSource}\nreturn applyMasterSwitchUI;`);
    return { applyMasterSwitchUI: factory(...names.map((name) => refs[name])), refs };
}
