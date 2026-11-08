/**
 * 限定範圍突變測試的純函式：由 git diff 取出改動行範圍、挑出會碰到目標檔的 spec（含 setup 檔載入的目標）、剔除基底設定排除的檔案、判定範圍內突變體是否全數 Killed。
 *
 * Usage: import { parseChangedRanges, toMutateArgs, findSpecsReaching, selectSpecs, evaluateGate, dropExcluded } from './mutation-scope.mjs';
 */
import { posix } from 'node:path';

const SOURCE_FILE = /^(?:popup|background|content|utils|offscreen)\/.+\.js$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** 排序後合併重疊或相鄰（end + 1 >= start）的區間。 */
function mergeRanges(ranges) {
    const merged = [];
    for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }
    return merged;
}

/** `git diff -U0` 文字 -> { 路徑: [[起, 迄], ...] }（新版行號，已排序合併）。 */
export function parseChangedRanges(diffText) {
    const found = {};
    let isInHeader = false;
    let currentPath = null;
    for (const line of diffText.split(/\r?\n/)) {
        if (line.startsWith('diff --git ')) {
            isInHeader = true;
            currentPath = null;
            continue;
        }
        if (isInHeader && line.startsWith('+++ ')) {
            const path = line.startsWith('+++ b/') ? line.slice('+++ b/'.length) : null;
            currentPath = path && SOURCE_FILE.test(path) ? path : null;
            continue;
        }
        const hunk = HUNK_HEADER.exec(line);
        if (!hunk) continue;
        isInHeader = false;
        if (!currentPath) continue;
        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        if (count === 0) continue;
        (found[currentPath] ??= []).push([start, start + count - 1]);
    }
    return Object.fromEntries(Object.entries(found).map(([path, ranges]) => [path, mergeRanges(ranges)]));
}

/** 範圍 -> Stryker `--mutate` 參數 `<path>:<start>-<end>`，檔案依路徑排序；假設各檔範圍已排序。 */
export function toMutateArgs(ranges) {
    return Object.keys(ranges).sort().flatMap((path) => ranges[path].map(([start, end]) => `${path}:${start}-${end}`));
}

// import/export ... from、裸 import、import()、require()，單雙引號皆可
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

function resolveExisting(importer, specifier, readFile) {
    const base = posix.join(posix.dirname(importer), specifier);
    return [base, `${base}.js`, `${base}.mjs`].find((candidate) => readFile(candidate) !== null) ?? null;
}

/** 取出程式碼中的字串字面值內容（單、雙、反引號），略過行註解與區塊註解；字串內的 `//` 不算註解。 */
function stringLiterals(text) {
    const literals = [];
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        const pair = text.slice(index, index + 2);
        if (pair === '//') {
            const lineEnd = text.indexOf('\n', index);
            index = lineEnd === -1 ? text.length : lineEnd;
        } else if (pair === '/*') {
            const blockEnd = text.indexOf('*/', index + 2);
            index = blockEnd === -1 ? text.length : blockEnd + 2;
        } else if (char === "'" || char === '"' || char === '`') {
            let end = index + 1;
            // 單雙引號字串不跨行；反引號可跨行
            while (end < text.length && text[end] !== char && (char === '`' || text[end] !== '\n')) end += text[end] === '\\' ? 2 : 1;
            literals.push(text.slice(index + 1, end));
            index = end + 1;
        } else {
            index++;
        }
    }
    return literals;
}

/** 字面值以 target 結尾，且 target 前一字元是開頭引號或 `/`（排除 xcontent/x.js、x.json 這類近似）。 */
function endsWithPath(literal, target) {
    if (!literal.endsWith(target)) return false;
    const before = literal[literal.length - target.length - 1];
    return before === undefined || before === '/';
}

/**
 * 回傳 spec 清單中會碰到 target 的 spec，已排序。兩種碰到方式：
 * 一是經由相對 import 圖（遞移）到達 target；
 * 二是圖中 test/ 底下的檔案（spec、helper、fixture）有字面值寫出 target 的 repo 相對路徑（以文字載入正式檔的測試）。
 * 經 import 圖到達的正式檔只追蹤 import 邊，不掃字面值。
 */
export function findSpecsReaching(target, specPaths, readFile) {
    const infoOf = new Map();
    const inspect = (file) => {
        if (!infoOf.has(file)) {
            const text = readFile(file) ?? '';
            const imports = [...text.matchAll(SPECIFIER)]
                .map((match) => match[2])
                .filter((specifier) => specifier.startsWith('./') || specifier.startsWith('../'))
                .map((specifier) => resolveExisting(file, specifier, readFile))
                .filter(Boolean);
            const isLiteralHolder = file.startsWith('test/') && stringLiterals(text).some((literal) => endsWithPath(literal, target));
            infoOf.set(file, { imports, isLiteralHolder });
        }
        return infoOf.get(file);
    };
    const isReaching = (spec) => {
        const visited = new Set([spec]);
        const pending = [spec];
        while (pending.length > 0) {
            const { imports, isLiteralHolder } = inspect(pending.pop());
            if (isLiteralHolder) return true;
            for (const dep of imports) {
                if (dep === target) return true;
                if (!visited.has(dep)) {
                    visited.add(dep);
                    pending.push(dep);
                }
            }
        }
        return false;
    };
    return specPaths.filter((spec) => readFile(spec) !== null && isReaching(spec)).sort();
}

/** target 是否被 setup 檔載入（setup 檔在每個 spec 之前執行，載入規則與 findSpecsReaching 相同）。 */
function isSetupLoaded(target, setupPaths, readFile) {
    return findSpecsReaching(target, setupPaths, readFile).length > 0;
}

/**
 * 依各 target 挑出要跑的 spec，已排序且無重複。
 * target 被 setupPaths 載入時，每個 spec 都會碰到它，故選取 specPaths 全部（含讀不到的）；否則只選 findSpecsReaching 的結果。
 */
export function selectSpecs(targets, specPaths, setupPaths, readFile) {
    const selected = new Set();
    for (const target of targets) {
        const specs = isSetupLoaded(target, setupPaths, readFile) ? specPaths : findSpecsReaching(target, specPaths, readFile);
        specs.forEach((spec) => selected.add(spec));
    }
    return [...selected].sort();
}

/** 剔除 baseMutate（stryker.config.json 的 mutate）以 `!` 精確路徑排除的檔案；正向 glob 不限縮範圍。 */
export function dropExcluded(ranges, baseMutate) {
    const excluded = new Set(baseMutate.filter((entry) => entry.startsWith('!')).map((entry) => entry.slice(1)));
    const kept = Object.entries(ranges).filter(([path]) => !excluded.has(path));
    return {
        ranges: Object.fromEntries(kept),
        dropped: Object.keys(ranges).filter((path) => excluded.has(path)).sort(),
    };
}

const byFileThenLine = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);

/**
 * 以 Stryker JSON 報告判定：範圍內突變體除 Ignored 外須全數 Killed，且至少有一個範圍內突變體。
 * Ignored（ignoreStatic 或 disable 註解）已有記錄的理由，列在 ignored 供參考，不擋關卡。
 */
export function evaluateGate(report, ranges) {
    let inScope = 0;
    const ignored = [];
    const notKilled = [];
    for (const [rawFile, entry] of Object.entries(report.files)) {
        const file = rawFile.replaceAll('\\', '/');
        const fileRanges = ranges[file];
        if (!fileRanges) continue;
        for (const mutant of entry.mutants) {
            const { line } = mutant.location.start;
            if (!fileRanges.some(([start, end]) => line >= start && line <= end)) continue;
            inScope++;
            if (mutant.status === 'Killed') continue;
            const item = { file, line, id: mutant.id, mutatorName: mutant.mutatorName, status: mutant.status };
            (mutant.status === 'Ignored' ? ignored : notKilled).push(item);
        }
    }
    ignored.sort(byFileThenLine);
    notKilled.sort(byFileThenLine);
    return { pass: notKilled.length === 0 && inScope > 0, inScope, ignored, notKilled };
}
