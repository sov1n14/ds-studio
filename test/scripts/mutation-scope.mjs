/**
 * 限定範圍突變測試的純函式：由 git diff 取出改動行範圍、挑出會碰到目標檔的 spec、剔除基底設定排除的檔案、判定範圍內突變體是否全數 Killed。
 *
 * Usage: import { parseChangedRanges, toMutateArgs, findSpecsReaching, evaluateGate, dropExcluded } from './mutation-scope.mjs';
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

/** 回傳經由相對 import 圖（遞移）碰到 target 的 spec，已排序。 */
export function findSpecsReaching(target, specPaths, readFile) {
    const importsOf = new Map();
    const relativeImports = (file) => {
        if (!importsOf.has(file)) {
            const text = readFile(file) ?? '';
            const resolved = [...text.matchAll(SPECIFIER)]
                .map((match) => match[2])
                .filter((specifier) => specifier.startsWith('./') || specifier.startsWith('../'))
                .map((specifier) => resolveExisting(file, specifier, readFile))
                .filter(Boolean);
            importsOf.set(file, resolved);
        }
        return importsOf.get(file);
    };
    const isReaching = (spec) => {
        const visited = new Set([spec]);
        const pending = [spec];
        while (pending.length > 0) {
            for (const dep of relativeImports(pending.pop())) {
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
