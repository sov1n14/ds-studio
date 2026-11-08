#!/usr/bin/env node
/**
 * 限定範圍突變測試：只突變 git diff 改動的行，只跑會碰到改動檔的 spec，並要求範圍內突變體全數 Killed。
 * --base 指定比較基準（預設 HEAD，即未提交的改動）；--full 突變整個改動檔（收分支前搭配 --base origin/main）；--plan 只印計算結果不跑 Stryker。
 *
 * Usage: node test/scripts/stryker-scoped.mjs [--base <ref>] [--full] [--plan]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dropExcluded, evaluateGate, findSpecsReaching, parseChangedRanges, toMutateArgs } from './mutation-scope.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIRS = ['popup', 'background', 'content', 'utils', 'offscreen'];
const BASE_CONFIG_PATH = join(ROOT, 'test', 'stryker.config.json');
const REPORT_PATH = join(ROOT, 'test', 'reports', 'mutation.scoped.json');

function parseArgs(argv) {
    const options = { base: 'HEAD', isFull: false, isPlan: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base') options.base = argv[++i];
        else if (argv[i] === '--full') options.isFull = true;
        else if (argv[i] === '--plan') options.isPlan = true;
        else throw new Error(`Unknown argument: ${argv[i]}`);
    }
    if (!options.base) throw new Error('--base needs a ref');
    return options;
}

function readTextOrNull(repoPath) {
    try {
        return readFileSync(join(ROOT, repoPath), 'utf8');
    } catch {
        return null;
    }
}

async function listSpecs() {
    const { default: config } = await import(pathToFileURL(join(ROOT, 'test', 'stryker-vitest.config.js')).href);
    // exclude 以 test/ 為根，例如 unit/x.spec.js
    const excluded = new Set((config.test.exclude ?? []).map((path) => `test/${path}`));
    return readdirSync(join(ROOT, 'test', 'unit'), { recursive: true })
        .map((path) => `test/unit/${path.replaceAll('\\', '/')}`)
        .filter((path) => path.endsWith('.spec.js') && !excluded.has(path));
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
    const { base, isFull, isPlan } = parseArgs(process.argv.slice(2));
    const diff = execFileSync('git', ['diff', '-U0', base, '--', ...SOURCE_DIRS], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // 範圍會取代 Stryker 的 mutate，基底設定以 ! 排除的檔案要在這裡先剔除
    const baseMutate = JSON.parse(readFileSync(BASE_CONFIG_PATH, 'utf8')).mutate;
    const { ranges, dropped } = dropExcluded(parseChangedRanges(diff), baseMutate);
    if (dropped.length > 0) console.log(`Excluded by test/stryker.config.json: ${dropped.join(', ')}`);
    const files = Object.keys(ranges).sort();
    if (files.length === 0) {
        console.log(`Nothing to mutate: no mutable production .js changes between ${base} and the working tree.`);
        return 0;
    }

    const specs = await listSpecs();
    const reaching = [...new Set(files.flatMap((file) => findSpecsReaching(file, specs, readTextOrNull)))].sort();
    const mutateArgs = isFull ? files : toMutateArgs(ranges);
    if (reaching.length === 0) {
        console.log(`No spec reaches the changed files: ${files.join(', ')}`);
        return 1;
    }
    console.log(`Mutate (${mutateArgs.length}):\n${mutateArgs.join('\n')}`);
    console.log(`Specs (${reaching.length}):\n${reaching.join('\n')}`);
    if (isPlan) return 0;

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
    const gateRanges = isFull ? Object.fromEntries(files.map((file) => [file, [[1, Number.MAX_SAFE_INTEGER]]])) : ranges;
    const result = evaluateGate(JSON.parse(readFileSync(REPORT_PATH, 'utf8')), gateRanges);
    printGate(result);
    return result.pass ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
});
