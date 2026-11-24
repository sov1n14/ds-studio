#!/usr/bin/env node
/**
 * 限定範圍突變測試：只突變 git diff 改動的行，只跑會碰到改動檔的 spec（改動檔被 vitest setup 載入時跑全部 spec），並要求範圍內突變體全數 Killed。
 * --base 指定比較基準（預設 HEAD，即未提交的改動）；--full 突變整個改動檔（收分支前搭配 --base origin/main）；--plan 只印計算結果不跑 Stryker。
 * --files 改為突變逗號分隔清單中的整個檔案（repo 相對路徑），不看 git diff，不可與 --base、--full 並用。
 *
 * Usage: node test/scripts/stryker-scoped.mjs [--base <ref> [--full] | --files <a.js,b.js>] [--plan]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dropExcluded, evaluateGate, findSpecsReaching, parseChangedRanges, selectSpecs, toMutateArgs } from './mutation-scope.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIRS = ['popup', 'background', 'content', 'utils', 'offscreen'];
const BASE_CONFIG_PATH = join(ROOT, 'test', 'stryker.config.json');
const REPORT_PATH = join(ROOT, 'test', 'reports', 'mutation.scoped.json');

/** 逗號分隔的路徑清單 -> 去重的 repo 相對 POSIX 路徑。 */
function parseFileList(value) {
    const files = (value ?? '').split(',').map((path) => path.trim().replaceAll('\\', '/')).filter(Boolean);
    if (files.length === 0) throw new Error('--files needs a comma-separated list of repo-relative paths');
    return [...new Set(files)];
}

function parseArgs(argv) {
    const options = { base: 'HEAD', isBaseGiven: false, isFull: false, isPlan: false, files: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base') {
            options.base = argv[++i];
            options.isBaseGiven = true;
        } else if (argv[i] === '--full') options.isFull = true;
        else if (argv[i] === '--files') options.files = parseFileList(argv[++i]);
        else if (argv[i] === '--plan') options.isPlan = true;
        else throw new Error(`Unknown argument: ${argv[i]}`);
    }
    if (!options.base) throw new Error('--base needs a ref');
    // --files 本身就是整檔且不看 diff，與 --base、--full 並用時語意矛盾
    if (options.files && options.isBaseGiven) throw new Error('--files cannot be combined with --base');
    if (options.files && options.isFull) throw new Error('--files cannot be combined with --full');
    return options;
}

function readTextOrNull(repoPath) {
    try {
        return readFileSync(join(ROOT, repoPath), 'utf8');
    } catch {
        return null;
    }
}

/** 每個檔案的範圍都涵蓋整個檔案（--full 與 --files 共用）。 */
function wholeFileRanges(files) {
    return Object.fromEntries(files.map((file) => [file, [[1, Number.MAX_SAFE_INTEGER]]]));
}

/** 依選項取得要突變的範圍：--files 為清單中的整個檔案，否則為 git diff 相對 base 的改動行。 */
function collectRanges({ base, files }) {
    if (!files) {
        return parseChangedRanges(execFileSync('git', ['diff', '-U0', base, '--', ...SOURCE_DIRS], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    }
    const missing = files.filter((file) => readTextOrNull(file) === null);
    if (missing.length > 0) throw new Error(`--files lists paths that do not exist or are not readable files: ${missing.join(', ')}`);
    return wholeFileRanges(files);
}

/** 讀 Stryker 實際使用的 vitest 設定，回傳會跑的 spec 與每個 spec 前都會載入的 setup 檔（皆為 repo 相對 POSIX 路徑）。 */
async function loadVitestScope() {
    const { default: config } = await import(pathToFileURL(join(ROOT, 'test', 'stryker-vitest.config.js')).href);
    // exclude 與 setupFiles 以 test/ 為根，例如 unit/x.spec.js、./setup/vitest.setup.js
    const excluded = new Set((config.test.exclude ?? []).map((path) => `test/${path}`));
    const specs = readdirSync(join(ROOT, 'test', 'unit'), { recursive: true })
        .map((path) => `test/unit/${path.replaceAll('\\', '/')}`)
        .filter((path) => path.endsWith('.spec.js') && !excluded.has(path));
    const setupPaths = (config.test.setupFiles ?? []).map((path) => posix.join('test', path));
    return { specs, setupPaths };
}

function printGate(result) {
    console.log(`In-scope mutants: ${result.inScope}`);
    if (result.ignored.length > 0) {
        console.log(`Ignored in-scope mutants (informational, do not fail the gate): ${result.ignored.length}`);
        console.table(result.ignored.map((m) => ({ location: `${m.file}:${m.line}`, id: m.id, mutator: m.mutatorName })));
    }
    if (result.notKilled.length > 0) {
        console.table(result.notKilled.map((m) => ({ location: `${m.file}:${m.line}`, id: m.id, mutator: m.mutatorName, status: m.status })));
    }
    console.log(result.pass ? 'Gate PASS: every in-scope mutant is Killed.' : 'Gate FAIL: see not-Killed mutants above (or no mutant was in scope).');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const isWholeFile = options.isFull || options.files !== null;
    // 範圍會取代 Stryker 的 mutate，基底設定以 ! 排除的檔案要在這裡先剔除
    const baseMutate = JSON.parse(readFileSync(BASE_CONFIG_PATH, 'utf8')).mutate;
    const { ranges, dropped } = dropExcluded(collectRanges(options), baseMutate);
    if (dropped.length > 0) console.log(`Excluded by test/stryker.config.json: ${dropped.join(', ')}`);
    const files = Object.keys(ranges).sort();
    if (files.length === 0) {
        console.log(options.files
            ? 'Nothing to mutate: every listed file is excluded by test/stryker.config.json.'
            : `Nothing to mutate: no mutable production .js changes between ${options.base} and the working tree.`);
        return 0;
    }

    const { specs, setupPaths } = await loadVitestScope();
    const setupLoaded = files.filter((file) => findSpecsReaching(file, setupPaths, readTextOrNull).length > 0);
    if (setupLoaded.length > 0) console.log(`Setup-loaded (all specs selected): ${setupLoaded.join(', ')}`);
    const reaching = selectSpecs(files, specs, setupPaths, readTextOrNull);
    const mutateArgs = isWholeFile ? files : toMutateArgs(ranges);
    if (reaching.length === 0) {
        console.log(`No spec reaches the changed files: ${files.join(', ')}`);
        return 1;
    }
    console.log(`Mutate (${mutateArgs.length}):\n${mutateArgs.join('\n')}`);
    console.log(`Specs (${reaching.length}):\n${reaching.join('\n')}`);
    if (options.isPlan) return 0;

    const startedAt = Date.now();
    const run = spawnSync('npx', ['--prefix', 'test', 'stryker', 'run', 'test/stryker.scoped.config.mjs'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: {
            ...process.env,
            STRYKER_MUTATE: mutateArgs.join(','),
            STRYKER_SPECS: reaching.map((spec) => `./${spec.slice('test/'.length)}`).join('\n'),
        },
    });
    if (run.status !== 0) {
        console.error(`Stryker exited with status ${run.status}`);
        return 1;
    }
    // 報告比啟動時間舊代表這次沒產出新報告，不能拿舊結果過關
    if (!existsSync(REPORT_PATH) || statSync(REPORT_PATH).mtimeMs < startedAt) {
        console.error(`Stryker wrote no fresh report at ${REPORT_PATH}`);
        return 1;
    }
    const result = evaluateGate(JSON.parse(readFileSync(REPORT_PATH, 'utf8')), isWholeFile ? wholeFileRanges(files) : ranges);
    printGate(result);
    return result.pass ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
});
