/**
 * test/scripts/mutation-scope.mjs — pure helpers behind scoped Stryker runs (mutate only changed lines, run only specs that reach the file, gate on in-scope mutants).
 *
 * Requirement:
 *   - parseChangedRanges(diffText): raw `git diff -U0` text (LF or CRLF) -> { '<repo-relative path>': [[start, end], ...] } of NEW-side ranges, sorted, overlapping or adjacent ranges merged. Only `+++ b/<path>` under popup/, background/, content/, utils/, offscreen/ and ending in `.js`. `@@ -a,b +c,d @@` -> [c, c+d-1]; `+c` -> [c, c]; d = 0 -> no range; a file with only deletions or `+++ /dev/null` is omitted. Empty input -> {}.
 *   - toMutateArgs(ranges): ['<path>:<start>-<end>', ...], one per range, files in sorted path order.
 *   - findSpecsReaching(target, specPaths, readFile): sorted subset of specPaths whose transitive relative import graph reaches target. Specifiers: import ... from, export ... from, bare import, import(), require(), either quote. Relative = ./ or ../, resolved against the importer's directory; no extension also tries .js, .mjs. Non-relative ignored, cycles terminate, missing files (readFile -> null) ignored.
 *   - evaluateGate(report, ranges): Stryker mutation-testing-report JSON. In scope = file is a key of ranges (report keys may use backslashes) and location.start.line inside one of its ranges, inclusive. Returns { pass, inScope, ignored, notKilled }; inScope counts every in-scope mutant, Ignored included; ignored = in-scope mutants with status 'Ignored' (they already carry a recorded reason: ignoreStatic or a disable comment); notKilled = in-scope mutants whose status is neither 'Killed' nor 'Ignored'; both lists hold { file, line, id, mutatorName, status }, sorted by file then line; pass = notKilled empty AND inScope > 0.
 *   - dropExcluded(ranges, baseMutate): baseMutate = the mutate array of test/stryker.config.json. Returns { ranges, dropped }: a new ranges object without the files named by '!'-prefixed exact-path entries (non-'!' entries do not restrict), and dropped = the removed paths, sorted. The input ranges object is not mutated.
 */
import { describe, it, expect } from 'vitest';
import { parseChangedRanges, toMutateArgs, findSpecsReaching, evaluateGate, dropExcluded } from '../scripts/mutation-scope.mjs';

const lf = (lines) => lines.join('\n') + '\n';
const crlf = (lines) => lines.join('\r\n') + '\r\n';

const fileHeader = (path) => [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
];

describe('parseChangedRanges', () => {
    it('returns {} for empty input', () => {
        expect(parseChangedRanges('')).toEqual({});
    });

    it('maps "+c,d" to [c, c+d-1], "+c" to [c, c] and "+c,1" to [c, c] for one file', () => {
        const diff = lf([
            ...fileHeader('content/a.js'),
            '@@ -10,2 +10,3 @@ function x() {',
            '-old1', '-old2', '+new1', '+new2', '+new3',
            '@@ -30 +31 @@',
            '-x', '+y',
            '@@ -40,1 +41,1 @@',
            '-p', '+q',
        ]);
        expect(parseChangedRanges(diff)).toEqual({ 'content/a.js': [[10, 12], [31, 31], [41, 41]] });
    });

    it('produces the same result for CRLF input, with no carriage return left in path keys', () => {
        const lines = [
            ...fileHeader('utils/b.js'),
            '@@ -5,0 +6,2 @@',
            '+a', '+b',
        ];
        const result = parseChangedRanges(crlf(lines));
        expect(result).toEqual({ 'utils/b.js': [[6, 7]] });
        expect(Object.keys(result)).toEqual(['utils/b.js']);
    });

    it('yields no range for a pure-deletion hunk (d = 0) and keeps the other hunks of the file', () => {
        const diff = lf([
            ...fileHeader('background/sw.js'),
            '@@ -5,2 +4,0 @@',
            '-gone1', '-gone2',
            '@@ -20,1 +18,2 @@',
            '-o', '+n1', '+n2',
        ]);
        expect(parseChangedRanges(diff)).toEqual({ 'background/sw.js': [[18, 19]] });
    });

    it('omits a file whose only hunks are deletions', () => {
        const diff = lf([
            ...fileHeader('popup/popup.js'),
            '@@ -5,2 +4,0 @@',
            '-gone1', '-gone2',
            '@@ -30 +27,0 @@',
            '-gone3',
        ]);
        expect(parseChangedRanges(diff)).toEqual({});
    });

    it('omits a deleted file (+++ /dev/null) and keeps a new file (--- /dev/null)', () => {
        const diff = lf([
            'diff --git a/utils/gone.js b/utils/gone.js',
            'deleted file mode 100644',
            'index abcdef0..0000000',
            '--- a/utils/gone.js',
            '+++ /dev/null',
            '@@ -1,3 +0,0 @@',
            '-a', '-b', '-c',
            'diff --git a/offscreen/new.js b/offscreen/new.js',
            'new file mode 100644',
            'index 0000000..abcdef0',
            '--- /dev/null',
            '+++ b/offscreen/new.js',
            '@@ -0,0 +1,4 @@',
            '+1', '+2', '+3', '+4',
        ]);
        expect(parseChangedRanges(diff)).toEqual({ 'offscreen/new.js': [[1, 4]] });
    });

    it('takes the path from the "+++ b/" line of a renamed file', () => {
        const diff = lf([
            'diff --git a/utils/old.js b/utils/new.js',
            'similarity index 90%',
            'rename from utils/old.js',
            'rename to utils/new.js',
            'index 1111111..2222222 100644',
            '--- a/utils/old.js',
            '+++ b/utils/new.js',
            '@@ -4 +4 @@',
            '-x', '+y',
        ]);
        expect(parseChangedRanges(diff)).toEqual({ 'utils/new.js': [[4, 4]] });
    });

    it('keeps only .js files under popup/, background/, content/, utils/, offscreen/ across a multi-file diff', () => {
        const hunk = ['@@ -1 +1 @@', '-a', '+b'];
        const diff = lf([
            ...fileHeader('popup/p.js'), ...hunk,
            ...fileHeader('test/unit/x.spec.js'), ...hunk,
            ...fileHeader('background/b.js'), ...hunk,
            ...fileHeader('docs/a.md'), ...hunk,
            ...fileHeader('content/sub/c.js'), ...hunk,
            ...fileHeader('manifest.json'), ...hunk,
            ...fileHeader('utils/u.js'), ...hunk,
            ...fileHeader('popup/style.css'), ...hunk,
            ...fileHeader('offscreen/o.js'), ...hunk,
            ...fileHeader('contents/not-a-source-dir.js'), ...hunk,
            ...fileHeader('test/content/nested.js'), ...hunk,
        ]);
        expect(parseChangedRanges(diff)).toEqual({
            'popup/p.js': [[1, 1]],
            'background/b.js': [[1, 1]],
            'content/sub/c.js': [[1, 1]],
            'utils/u.js': [[1, 1]],
            'offscreen/o.js': [[1, 1]],
        });
    });

    it('does not attribute hunks of an excluded file to the preceding included file', () => {
        const diff = lf([
            ...fileHeader('content/a.js'),
            '@@ -1 +1 @@', '-a', '+b',
            ...fileHeader('docs/a.md'),
            '@@ -50,0 +50,2 @@', '+x', '+y',
            ...fileHeader('test/unit/a.spec.js'),
            '@@ -70,0 +70,1 @@', '+z',
        ]);
        expect(parseChangedRanges(diff)).toEqual({ 'content/a.js': [[1, 1]] });
    });

    it('sorts out-of-order ranges, merges overlapping and adjacent ones, and keeps a one-line gap separate', () => {
        const diff = lf([
            ...fileHeader('content/m.js'),
            '@@ -40,0 +40,2 @@', '+a', '+b',
            '@@ -12,0 +12,2 @@', '+c', '+d',
            '@@ -10,0 +10,5 @@', '+e',
            '@@ -3,0 +3,2 @@', '+f', '+g',
            '@@ -5,0 +5 @@', '+h',
            '@@ -15,0 +15,1 @@', '+i',
            '@@ -43,0 +43,1 @@', '+j',
        ]);
        // [40,41]; [12,13] inside [10,14]; [3,4]+[5,5] adjacent; [15,15] adjacent to [10,14]; [43,43] one line after [40,41]
        expect(parseChangedRanges(diff)).toEqual({ 'content/m.js': [[3, 5], [10, 15], [40, 41], [43, 43]] });
    });
});

describe('toMutateArgs', () => {
    it('emits one "<path>:<start>-<end>" per range', () => {
        expect(toMutateArgs({ 'content/a.js': [[3, 3], [10, 12]] })).toEqual(['content/a.js:3-3', 'content/a.js:10-12']);
    });

    it('orders files by sorted path regardless of key insertion order', () => {
        const ranges = {
            'utils/z.js': [[1, 2]],
            'content/a.js': [[5, 5]],
            'background/m.js': [[7, 9], [20, 20]],
        };
        expect(toMutateArgs(ranges)).toEqual([
            'background/m.js:7-9',
            'background/m.js:20-20',
            'content/a.js:5-5',
            'utils/z.js:1-2',
        ]);
    });

    it('returns [] for no ranges', () => {
        expect(toMutateArgs({})).toEqual([]);
    });
});

describe('findSpecsReaching', () => {
    const TARGET = 'content/x.js';
    const reader = (files) => (path) => (Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null);
    const base = { 'content/x.js': 'export const x = 1;\n', 'content/y.js': 'export const y = 2;\n' };

    it('finds a spec that imports the target directly via ../../content/x.js', () => {
        const files = { ...base, 'test/unit/direct.spec.js': "import { describe } from 'vitest';\nimport { x } from '../../content/x.js';\n" };
        expect(findSpecsReaching(TARGET, ['test/unit/direct.spec.js'], reader(files))).toEqual(['test/unit/direct.spec.js']);
    });

    it('finds a spec that reaches the target through a helper under test/helpers/ re-exporting it (export ... from, double quotes)', () => {
        const files = {
            ...base,
            'test/unit/via-helper.spec.js': "import { h } from '../helpers/h.js';\n",
            'test/helpers/h.js': 'export { x as h } from "../../content/x.js";\n',
        };
        expect(findSpecsReaching(TARGET, ['test/unit/via-helper.spec.js'], reader(files))).toEqual(['test/unit/via-helper.spec.js']);
    });

    it('finds a spec that reaches the target through a dynamic import()', () => {
        const files = { ...base, 'test/unit/dynamic.spec.js': "it('x', async () => { const m = await import('../../content/x.js'); });\n" };
        expect(findSpecsReaching(TARGET, ['test/unit/dynamic.spec.js'], reader(files))).toEqual(['test/unit/dynamic.spec.js']);
    });

    it('finds a spec that reaches the target through a bare side-effect import', () => {
        const files = { ...base, 'test/unit/bare.spec.js': "import '../../content/x.js';\n" };
        expect(findSpecsReaching(TARGET, ['test/unit/bare.spec.js'], reader(files))).toEqual(['test/unit/bare.spec.js']);
    });

    it('finds a spec that reaches the target through require() of a ./ sibling helper', () => {
        const files = {
            ...base,
            'test/unit/req.spec.js': 'const s = require("./shared.js");\n',
            'test/unit/shared.js': "module.exports = require('../../content/x.js');\n",
        };
        expect(findSpecsReaching(TARGET, ['test/unit/req.spec.js'], reader(files))).toEqual(['test/unit/req.spec.js']);
    });

    it('resolves an extensionless specifier to .js', () => {
        const files = { ...base, 'test/unit/noext.spec.js': "import { x } from '../../content/x';\n" };
        expect(findSpecsReaching(TARGET, ['test/unit/noext.spec.js'], reader(files))).toEqual(['test/unit/noext.spec.js']);
    });

    it('resolves an extensionless specifier to .mjs when no .js exists', () => {
        const files = {
            'test/scripts/tool.mjs': 'export const t = 1;\n',
            'test/unit/mjs.spec.js': "import { t } from '../scripts/tool';\n",
        };
        expect(findSpecsReaching('test/scripts/tool.mjs', ['test/unit/mjs.spec.js'], reader(files))).toEqual(['test/unit/mjs.spec.js']);
    });

    it('excludes a spec that imports other modules, a non-relative path spelled like the target, and a similarly named file', () => {
        const files = {
            ...base,
            'content/ax.js': 'export const ax = 0;\n',
            'test/unit/none.spec.js': [
                "import fs from 'node:fs';",
                "import { describe } from 'vitest';",
                "import 'content/x.js';",
                "import { y } from '../../content/y.js';",
                "import { ax } from '../../content/ax.js';",
            ].join('\n') + '\n',
        };
        expect(findSpecsReaching(TARGET, ['test/unit/none.spec.js'], reader(files))).toEqual([]);
    });

    it('terminates on an import cycle that never reaches the target', () => {
        const files = {
            ...base,
            'test/unit/cycle.spec.js': "import '../helpers/c1.js';\n",
            'test/helpers/c1.js': "import './c2';\nexport const c1 = 1;\n",
            'test/helpers/c2.js': "import { c1 } from './c1.js';\nexport const c2 = 2;\n",
        };
        expect(findSpecsReaching(TARGET, ['test/unit/cycle.spec.js'], reader(files))).toEqual([]);
    });

    it('reaches the target from inside an import cycle', () => {
        const files = {
            ...base,
            'test/unit/cycle-hit.spec.js': "import '../helpers/c3.js';\n",
            'test/helpers/c3.js': "import './c4.js';\n",
            'test/helpers/c4.js': "import './c3.js';\nimport { x } from '../../content/x.js';\n",
        };
        expect(findSpecsReaching(TARGET, ['test/unit/cycle-hit.spec.js'], reader(files))).toEqual(['test/unit/cycle-hit.spec.js']);
    });

    it('ignores missing imported files and missing spec files', () => {
        const files = {
            ...base,
            'test/unit/partial.spec.js': "import '../helpers/missing.js';\nimport { x } from '../../content/x.js';\n",
            'test/unit/only-missing.spec.js': "import '../helpers/missing.js';\n",
        };
        const specs = ['test/unit/partial.spec.js', 'test/unit/only-missing.spec.js', 'test/unit/absent.spec.js'];
        expect(findSpecsReaching(TARGET, specs, reader(files))).toEqual(['test/unit/partial.spec.js']);
    });

    it('returns the reaching specs sorted, whatever the input order', () => {
        const files = {
            ...base,
            'test/unit/b.spec.js': "import '../../content/x.js';\n",
            'test/unit/a.spec.js': "import '../../content/x.js';\n",
            'test/unit/c.spec.js': "import '../../content/y.js';\n",
            'test/unit/0.spec.js': "import '../../content/x.js';\n",
        };
        const specs = ['test/unit/b.spec.js', 'test/unit/c.spec.js', 'test/unit/a.spec.js', 'test/unit/0.spec.js'];
        expect(findSpecsReaching(TARGET, specs, reader(files))).toEqual(['test/unit/0.spec.js', 'test/unit/a.spec.js', 'test/unit/b.spec.js']);
    });
});

describe('evaluateGate', () => {
    let nextId = 0;
    const m = (line, status, mutatorName = 'ConditionalExpression') => ({
        id: String(++nextId),
        mutatorName,
        status,
        location: { start: { line, column: 1 }, end: { line, column: 9 } },
    });
    const report = (files) => ({
        schemaVersion: '2',
        thresholds: { high: 80, low: 60 },
        files: Object.fromEntries(Object.entries(files).map(([k, mutants]) => [k, { language: 'javascript', source: '', mutants }])),
    });
    const RANGES = { 'content/a.js': [[10, 12], [20, 20]] };

    it('passes when every in-scope mutant is Killed, counting both inclusive range ends', () => {
        const r = report({ 'content/a.js': [m(10, 'Killed'), m(12, 'Killed'), m(20, 'Killed'), m(11, 'Killed')] });
        expect(evaluateGate(r, RANGES)).toEqual({ pass: true, inScope: 4, ignored: [], notKilled: [] });
    });

    it.each(['Survived', 'NoCoverage', 'Timeout'])('fails on one in-scope %s mutant and lists it', (status) => {
        const bad = m(11, status, 'EqualityOperator');
        const r = report({ 'content/a.js': [m(10, 'Killed'), bad, m(20, 'Killed')] });
        expect(evaluateGate(r, RANGES)).toEqual({
            pass: false,
            inScope: 3,
            ignored: [],
            notKilled: [{ file: 'content/a.js', line: 11, id: bad.id, mutatorName: 'EqualityOperator', status }],
        });
    });

    it('ignores Survived mutants just outside each range and in files not in ranges', () => {
        const r = report({
            'content/a.js': [m(9, 'Survived'), m(13, 'Survived'), m(19, 'Survived'), m(21, 'Survived'), m(10, 'Killed')],
            'content/b.js': [m(10, 'Survived')],
        });
        expect(evaluateGate(r, RANGES)).toEqual({ pass: true, inScope: 1, ignored: [], notKilled: [] });
    });

    it('fails with inScope 0 when the ranged file is absent from the report', () => {
        const r = report({ 'content/b.js': [m(10, 'Killed')] });
        expect(evaluateGate(r, RANGES)).toEqual({ pass: false, inScope: 0, ignored: [], notKilled: [] });
    });

    it('fails with inScope 0 when the file is present but no mutant lies in a range', () => {
        const r = report({ 'content/a.js': [m(1, 'Killed'), m(15, 'Killed')] });
        expect(evaluateGate(r, RANGES)).toEqual({ pass: false, inScope: 0, ignored: [], notKilled: [] });
    });

    it('passes when one ranged file is absent but the other has only Killed in-scope mutants', () => {
        const ranges = { ...RANGES, 'utils/u.js': [[1, 5]] };
        const r = report({ 'content/a.js': [m(10, 'Killed')] });
        expect(evaluateGate(r, ranges)).toEqual({ pass: true, inScope: 1, ignored: [], notKilled: [] });
    });

    it('matches a Windows backslash report key to the POSIX range key', () => {
        const bad = m(20, 'Survived', 'BlockStatement');
        const r = report({ 'content\\a.js': [m(10, 'Killed'), bad, m(30, 'Survived')] });
        expect(Object.keys(r.files)[0]).toHaveLength('content/a.js'.length);
        expect(evaluateGate(r, RANGES)).toEqual({
            pass: false,
            inScope: 2,
            ignored: [],
            notKilled: [{ file: 'content/a.js', line: 20, id: bad.id, mutatorName: 'BlockStatement', status: 'Survived' }],
        });
    });

    it('sorts notKilled by file, then numerically by line', () => {
        const ranges = { 'content/a.js': [[1, 100]], 'background/b.js': [[1, 100]] };
        const a50 = m(50, 'Survived');
        const a9 = m(9, 'NoCoverage');
        const b30 = m(30, 'Timeout');
        const r = report({ 'content/a.js': [a50, m(40, 'Killed'), a9], 'background/b.js': [b30] });
        const result = evaluateGate(r, ranges);
        expect(result.pass).toBe(false);
        expect(result.inScope).toBe(4);
        expect(result.ignored).toEqual([]);
        expect(result.notKilled.map((x) => [x.file, x.line, x.id])).toEqual([
            ['background/b.js', 30, b30.id],
            ['content/a.js', 9, a9.id],
            ['content/a.js', 50, a50.id],
        ]);
    });

    it('passes with an in-scope Ignored mutant next to Killed ones, counting it in inScope and listing it in ignored', () => {
        const ign = m(11, 'Ignored', 'StringLiteral');
        const r = report({ 'content/a.js': [m(10, 'Killed'), ign, m(20, 'Killed')] });
        expect(evaluateGate(r, RANGES)).toEqual({
            pass: true,
            inScope: 3,
            ignored: [{ file: 'content/a.js', line: 11, id: ign.id, mutatorName: 'StringLiteral', status: 'Ignored' }],
            notKilled: [],
        });
    });

    it('passes when the only in-scope mutants are Ignored, since each already carries a recorded reason', () => {
        const i10 = m(10, 'Ignored', 'ArrayDeclaration');
        const i20 = m(20, 'Ignored', 'ObjectLiteral');
        const r = report({ 'content/a.js': [i10, i20] });
        expect(evaluateGate(r, RANGES)).toEqual({
            pass: true,
            inScope: 2,
            ignored: [
                { file: 'content/a.js', line: 10, id: i10.id, mutatorName: 'ArrayDeclaration', status: 'Ignored' },
                { file: 'content/a.js', line: 20, id: i20.id, mutatorName: 'ObjectLiteral', status: 'Ignored' },
            ],
            notKilled: [],
        });
    });

    it('fails on Ignored plus Survived, listing only the Survived mutant in notKilled', () => {
        const ign = m(10, 'Ignored', 'StringLiteral');
        const bad = m(12, 'Survived', 'EqualityOperator');
        const r = report({ 'content/a.js': [ign, bad] });
        expect(evaluateGate(r, RANGES)).toEqual({
            pass: false,
            inScope: 2,
            ignored: [{ file: 'content/a.js', line: 10, id: ign.id, mutatorName: 'StringLiteral', status: 'Ignored' }],
            notKilled: [{ file: 'content/a.js', line: 12, id: bad.id, mutatorName: 'EqualityOperator', status: 'Survived' }],
        });
    });

    it.each(['CompileError', 'RuntimeError'])('still fails on an in-scope %s mutant next to an Ignored one', (status) => {
        const ign = m(10, 'Ignored');
        const bad = m(20, status, 'BlockStatement');
        const r = report({ 'content/a.js': [ign, m(11, 'Killed'), bad] });
        expect(evaluateGate(r, RANGES)).toEqual({
            pass: false,
            inScope: 3,
            ignored: [{ file: 'content/a.js', line: 10, id: ign.id, mutatorName: 'ConditionalExpression', status: 'Ignored' }],
            notKilled: [{ file: 'content/a.js', line: 20, id: bad.id, mutatorName: 'BlockStatement', status }],
        });
    });

    it('leaves Ignored mutants outside the ranges or in unranged files out of both inScope and ignored', () => {
        const r = report({
            'content/a.js': [m(9, 'Ignored'), m(13, 'Ignored'), m(21, 'Ignored'), m(10, 'Killed')],
            'content/b.js': [m(10, 'Ignored')],
        });
        expect(evaluateGate(r, RANGES)).toEqual({ pass: true, inScope: 1, ignored: [], notKilled: [] });
    });

    it('sorts ignored by file, then numerically by line, with POSIX file names from backslash report keys', () => {
        const ranges = { 'content/a.js': [[1, 100]], 'background/b.js': [[1, 100]] };
        const a50 = m(50, 'Ignored');
        const a9 = m(9, 'Ignored');
        const b30 = m(30, 'Ignored');
        const r = report({ 'content\\a.js': [a50, m(40, 'Killed'), a9], 'background\\b.js': [b30] });
        const result = evaluateGate(r, ranges);
        expect(result.pass).toBe(true);
        expect(result.inScope).toBe(4);
        expect(result.notKilled).toEqual([]);
        expect(result.ignored.map((x) => [x.file, x.line, x.id])).toEqual([
            ['background/b.js', 30, b30.id],
            ['content/a.js', 9, a9.id],
            ['content/a.js', 50, a50.id],
        ]);
    });
});

describe('dropExcluded', () => {
    // The mutate array of test/stryker.config.json.
    const BASE_MUTATE = [
        'utils/**/*.js',
        'content/**/*.js',
        '!content/sse-parser.js',
        '!content/censor-xhr-hook.js',
        '!content/prevent-auto-scroll.js',
        '!content/temporary-chat-history-hook.js',
    ];

    it('drops one excluded file and keeps the others', () => {
        const ranges = { 'content/a.js': [[3, 3]], 'content/sse-parser.js': [[1, 2]], 'utils/u.js': [[5, 9]] };
        expect(dropExcluded(ranges, BASE_MUTATE)).toEqual({
            ranges: { 'content/a.js': [[3, 3]], 'utils/u.js': [[5, 9]] },
            dropped: ['content/sse-parser.js'],
        });
    });

    it('drops every excluded file present and lists them sorted, whatever the key order', () => {
        const ranges = {
            'content/temporary-chat-history-hook.js': [[1, 1]],
            'utils/u.js': [[2, 2]],
            'content/censor-xhr-hook.js': [[3, 4]],
            'content/prevent-auto-scroll.js': [[7, 7]],
        };
        expect(dropExcluded(ranges, BASE_MUTATE)).toEqual({
            ranges: { 'utils/u.js': [[2, 2]] },
            dropped: ['content/censor-xhr-hook.js', 'content/prevent-auto-scroll.js', 'content/temporary-chat-history-hook.js'],
        });
    });

    it('returns the ranges unchanged with dropped [] when baseMutate has no negated entries', () => {
        const ranges = { 'content/sse-parser.js': [[1, 2]], 'utils/u.js': [[5, 9]] };
        expect(dropExcluded(ranges, ['utils/**/*.js', 'content/**/*.js'])).toEqual({
            ranges: { 'content/sse-parser.js': [[1, 2]], 'utils/u.js': [[5, 9]] },
            dropped: [],
        });
    });

    it('returns the ranges unchanged with dropped [] when no excluded path is in ranges', () => {
        const ranges = { 'content/a.js': [[3, 3]], 'utils/u.js': [[5, 9]] };
        expect(dropExcluded(ranges, BASE_MUTATE)).toEqual({
            ranges: { 'content/a.js': [[3, 3]], 'utils/u.js': [[5, 9]] },
            dropped: [],
        });
    });

    it('does not restrict by positive entries: files outside the positive globs and a file named exactly by one are kept', () => {
        const ranges = { 'background/sw.js': [[1, 1]], 'popup/p.js': [[2, 2]], 'content/a.js': [[3, 3]] };
        expect(dropExcluded(ranges, ['content/a.js', 'utils/**/*.js', '!content/sse-parser.js'])).toEqual({
            ranges: { 'background/sw.js': [[1, 1]], 'popup/p.js': [[2, 2]], 'content/a.js': [[3, 3]] },
            dropped: [],
        });
    });

    it('matches negated entries by exact path only, keeping a file whose path merely ends with or contains the excluded path', () => {
        const ranges = {
            'utils/content/sse-parser.js': [[1, 1]],
            'content/sse-parser.js.bak.js': [[2, 2]],
            'content/old-sse-parser.js': [[3, 3]],
            'content/sse-parser.js': [[4, 4]],
        };
        expect(dropExcluded(ranges, BASE_MUTATE)).toEqual({
            ranges: {
                'utils/content/sse-parser.js': [[1, 1]],
                'content/sse-parser.js.bak.js': [[2, 2]],
                'content/old-sse-parser.js': [[3, 3]],
            },
            dropped: ['content/sse-parser.js'],
        });
    });

    it('returns a new ranges object and leaves the input untouched', () => {
        const ranges = { 'content/a.js': [[3, 3]], 'content/sse-parser.js': [[1, 2]] };
        const snapshot = structuredClone(ranges);
        const result = dropExcluded(ranges, BASE_MUTATE);
        expect(result.ranges).not.toBe(ranges);
        expect(ranges).toEqual(snapshot);
        const unchanged = dropExcluded(ranges, ['utils/**/*.js']);
        expect(unchanged.ranges).not.toBe(ranges);
        expect(unchanged.ranges).toEqual(snapshot);
        expect(ranges).toEqual(snapshot);
    });
});
