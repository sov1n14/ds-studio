/**
 * test/scripts/stryker-scoped.mjs `--files` option — mutate an explicit list of production files whole, independent of git diff (killing the surviving mutants in utils/storage-manager.keys.js and popup/popup.toggles.js needs both files mutated whole even though neither changed).
 *
 * Requirement (observed through `--plan`, which prints the plan and exits without running Stryker):
 *   - `--files a.js,b.js --plan` exits 0; the `Mutate (N)` block lists exactly the given files (repo-relative POSIX paths), N = number of files, each with whole-file scope (a bare path, or `<path>:1-<end>` with end >= the line count of the file); no `--base` is needed and a file unchanged since HEAD still appears; nothing from git diff is added.
 *   - Spec selection follows the same rules as the diff mode: a listed file loaded by the vitest setup file selects every spec that the Stryker vitest config runs; any other file selects the specs that reach it.
 *   - A listed path that does not exist -> non-zero exit, output names that path, no plan printed.
 *   - `--files` combined with `--base` or `--full` (either order) -> non-zero exit, output names both options, no plan printed.
 * The gate rule (every mutant in a listed file is in scope) is not observable under `--plan`; it needs a Stryker run.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import strykerVitestConfig from '../stryker-vitest.config.js';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'test', 'scripts', 'stryker-scoped.mjs');
const KEYS = 'utils/storage-manager.keys.js';
const TOGGLES = 'popup/popup.toggles.js';

function runScoped(args) {
    const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    console.info(`[stryker-scoped ${args.join(' ')}] exit=${run.status}\n${output}`);
    return { status: run.status, stdout: run.stdout ?? '', output };
}

/** 讀出 `--plan` 輸出中 `<Title> (N):` 之後的 N 行。 */
function planBlock(stdout, title) {
    const lines = stdout.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => line.startsWith(`${title} (`));
    if (headerIndex === -1) return null;
    const count = Number(/\((\d+)\)/.exec(lines[headerIndex])[1]);
    return { count, entries: lines.slice(headerIndex + 1, headerIndex + 1 + count) };
}

const lineCount = (repoPath) => fs.readFileSync(path.join(ROOT, repoPath), 'utf8').split(/\r?\n/).length;

/** Mutate 行是否涵蓋整個檔案：裸路徑，或 `<path>:1-<end>` 且 end 不小於檔案行數。 */
function coversWholeFile(entry, repoPath) {
    if (entry === repoPath) return true;
    const range = /^(.+):(\d+)-(\d+)$/.exec(entry);
    return Boolean(range) && range[1] === repoPath && Number(range[2]) === 1 && Number(range[3]) >= lineCount(repoPath);
}

function allStrykerSpecs() {
    const excluded = new Set((strykerVitestConfig.test.exclude ?? []).map((entry) => `test/${entry}`));
    return fs.readdirSync(path.join(ROOT, 'test', 'unit'), { recursive: true })
        .map((entry) => `test/unit/${entry.split(path.sep).join('/')}`)
        .filter((entry) => entry.endsWith('.spec.js') && !excluded.has(entry))
        .sort();
}

describe('stryker-scoped --files: plan', () => {
    it('mutates exactly the listed files, each whole, and exits 0 under --plan', () => {
        const { status, stdout } = runScoped(['--files', `${KEYS},${TOGGLES}`, '--plan']);
        expect(status, 'exit code of --files ... --plan').toBe(0);
        const mutate = planBlock(stdout, 'Mutate');
        expect(mutate, 'a "Mutate (N):" block is printed').not.toBeNull();
        expect(mutate.count, 'Mutate count = number of listed files').toBe(2);
        const keysEntry = mutate.entries.find((entry) => entry.startsWith(KEYS));
        const togglesEntry = mutate.entries.find((entry) => entry.startsWith(TOGGLES));
        expect(keysEntry && coversWholeFile(keysEntry, KEYS), `whole-file scope for ${KEYS}, got ${keysEntry}`).toBe(true);
        expect(togglesEntry && coversWholeFile(togglesEntry, TOGGLES), `whole-file scope for ${TOGGLES}, got ${togglesEntry}`).toBe(true);
    });

    it('includes a listed file that is unchanged since HEAD, with no --base given', () => {
        const diff = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', TOGGLES], { cwd: ROOT });
        expect(diff.status, `precondition: ${TOGGLES} has no uncommitted change`).toBe(0);
        const { status, stdout } = runScoped(['--files', TOGGLES, '--plan']);
        expect(status).toBe(0);
        expect(stdout, 'diff mode would report nothing to mutate').not.toMatch(/Nothing to mutate/);
        const mutate = planBlock(stdout, 'Mutate');
        expect(mutate?.count).toBe(1);
        expect(coversWholeFile(mutate.entries[0], TOGGLES), `whole-file scope, got ${mutate.entries[0]}`).toBe(true);
    });

    it('selects every Stryker spec when a listed file is loaded by the vitest setup file', () => {
        const { status, stdout } = runScoped(['--files', KEYS, '--plan']);
        expect(status).toBe(0);
        const specs = planBlock(stdout, 'Specs');
        expect(specs, 'a "Specs (N):" block is printed').not.toBeNull();
        expect([...specs.entries].sort()).toEqual(allStrykerSpecs());
    });

    it('selects only the specs that reach a listed file that is not setup-loaded', () => {
        const { status, stdout } = runScoped(['--files', TOGGLES, '--plan']);
        expect(status).toBe(0);
        const specs = planBlock(stdout, 'Specs');
        expect(specs, 'a "Specs (N):" block is printed').not.toBeNull();
        expect(specs.entries).toContain('test/unit/popup-auto-click-toggles.spec.js');
        expect(specs.entries).toContain('test/unit/popup-auto-copy-toggles.spec.js');
        expect(specs.entries, 'specs excluded by stryker-vitest.config.js stay out').not.toContain('test/unit/popup-websearch-toggle.spec.js');
        expect(specs.count, 'not every spec').toBeLessThan(allStrykerSpecs().length);
    });
});

describe('stryker-scoped --files: rejected input', () => {
    const expectRejected = ({ status, output }) => {
        expect(status, 'non-zero exit').not.toBe(0);
        expect(output, 'no plan printed').not.toMatch(/^Mutate \(/m);
        expect(output, '--files is a known option').not.toMatch(/Unknown argument/);
    };

    it('rejects a listed path that does not exist and names it', () => {
        const result = runScoped(['--files', 'utils/no-such-file.js', '--plan']);
        expectRejected(result);
        expect(result.output).toContain('utils/no-such-file.js');
    });

    it('rejects the whole list when one of several paths does not exist, naming the missing one', () => {
        const result = runScoped(['--files', `${KEYS},popup/no-such-file.js`, '--plan']);
        expectRejected(result);
        expect(result.output).toContain('popup/no-such-file.js');
    });

    it.each([
        ['--files then --base', ['--files', KEYS, '--base', 'HEAD', '--plan'], '--base'],
        ['--base then --files', ['--base', 'HEAD', '--files', KEYS, '--plan'], '--base'],
        ['--files then --full', ['--files', KEYS, '--full', '--plan'], '--full'],
        ['--full then --files', ['--full', '--files', KEYS, '--plan'], '--full'],
    ])('rejects %s and names both options', (_label, args, other) => {
        const result = runScoped(args);
        expectRejected(result);
        expect(result.output).toContain('--files');
        expect(result.output).toContain(other);
    });
});
