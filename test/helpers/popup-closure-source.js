/**
 * 從 popup/popup.js 原始碼取出 DOMContentLoaded 閉包內的宣告，供 harness 與 spec 執行真實程式碼。
 *
 * Stryker 會以 Babel 重新排版受測檔（縮排改為兩格），並在檔案最外層加入 stryNS_*、stryCov_*、stryMutAct_* 輔助函式，插樁後的程式碼會呼叫它們，所以本模組完全不依賴縮排或排版：宣告的範圍取「從起點起最短、且能由 JS 引擎單獨編譯」的原始碼；一個宣告是否位於閉包最外層，以「閉包本體開頭到該宣告前的原始碼能否編譯為 async 函式本體」判斷，位於巢狀函式或區塊內時前段會有未閉合的大括號而無法編譯。字串、註解與樣板字串中的大括號都由引擎的語法判斷排除。
 *
 * 找不到宣告或其結尾時直接拋錯，不會默默回傳空結果。
 */

const POPUP_REL = 'popup/popup.js';
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** 原始碼能否編譯為指定建構子（Function 或 AsyncFunction）的函式本體；非語法錯誤照常拋出。 */
function isCompilable(code, FunctionConstructor) {
    try {
        new FunctionConstructor(code);
        return true;
    } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        return false;
    }
}

/** 從 startIndex 起，回傳以 terminator 結尾且可單獨編譯的最短原始碼，即從該處開始的完整宣告或敘述。 */
export function sliceCompilable(source, startIndex, terminator, label) {
    for (let end = source.indexOf(terminator, startIndex); end !== -1; end = source.indexOf(terminator, end + 1)) {
        const candidate = source.slice(startIndex, end + terminator.length);
        if (isCompilable(candidate, Function)) return candidate;
    }
    throw new Error(`Could not find the end of ${label} in ${POPUP_REL}`);
}

/** 名為 name 的函式宣告（含 async 前綴）的完整原始碼；取第一個出現的宣告。 */
export function findFunctionDeclaration(source, name) {
    const start = source.search(new RegExp(String.raw`(?:\basync\s+)?\bfunction\s+${name}\s*\(`));
    if (start === -1) throw new Error(`Could not locate function ${name}() in ${POPUP_REL}`);
    return sliceCompilable(source, start, '}', `function ${name}()`);
}

/** 檔案最外層（第 0 欄）的函式宣告原始碼；未插樁的 popup.js 沒有這類宣告，Stryker 插樁後則包含其 stryNS_*、stryCov_*、stryMutAct_* 輔助函式。執行取出的程式碼前先放入同一範圍，與瀏覽器中閉包看得到的最外層宣告一致。 */
export function topLevelFunctionDeclarations(source) {
    return [...source.matchAll(/^function\s+([\w$]+)\s*\(/gm)].map((m) => sliceCompilable(source, m.index, '}', `function ${m[1]}()`));
}

/** DOMContentLoaded 回呼本體的起點（左大括號之後）。 */
function closureBodyStart(source) {
    const match = /document\.addEventListener\(\s*(['"])DOMContentLoaded\1\s*,\s*async\s*\(\s*\)\s*=>\s*\{/.exec(source);
    if (!match) throw new Error(`Could not locate the DOMContentLoaded closure in ${POPUP_REL}`);
    return match.index + match[0].length;
}

/**
 * 閉包最外層的 DOM 參照宣告（`const x = document.getElementById(...)` 與 `const x = Array.from(document.querySelectorAll(...))`）：名稱 -> { lookup, resolve }。
 * resolve 以 popup.js 自己的初始化運算式對當下的 document 求值，因此插樁後包在 stryMutAct_* 條件式中的選擇器字串也照常解析。
 * @returns {Map<string, { lookup: string, resolve: () => Element | Element[] | null }>}
 */
export function readClosureDomRefs(source) {
    const bodyStart = closureBodyStart(source);
    const helpers = topLevelFunctionDeclarations(source).join('\n');
    const refs = new Map();
    for (const m of source.matchAll(/\bconst\s+([\w$]+)\s*=\s*(?:document\.getElementById|Array\.from\(\s*document\.querySelectorAll)\s*\(/g)) {
        if (m.index < bodyStart) continue;
        // 前段無法編譯代表此宣告位於巢狀函式或區塊內，不是閉包層級的 DOM 參照
        if (!isCompilable(source.slice(bodyStart, m.index), AsyncFunction)) continue;
        const name = m[1];
        const declaration = sliceCompilable(source, m.index, ';', `const ${name}`);
        const evaluate = new Function('document', `${helpers}\n${declaration}\nreturn ${name};`);
        refs.set(name, { lookup: declaration, resolve: () => evaluate(document) });
    }
    return refs;
}
