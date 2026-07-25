/**
 * Static regression guard: every file listed in manifest.json's
 * content_scripts[].js (and every file loaded via importScripts() in
 * background/service-worker.js) executes as a classic script sharing ONE
 * global scope in the extension's isolated world / service worker context.
 *
 * If two files in the same group both declare the same identifier at the
 * TRUE top level (not inside an IIFE, function, or block), that is a
 * production hazard:
 *   - const/let/class collision -> SyntaxError, second script dies entirely.
 *   - var/function collision -> silent overwrite.
 *
 * This exact bug shipped once already: content/harvest.js and
 * content/go-top.js both declared top-level `const __DSSelectors`, which
 * killed go-top.js and made the GoTop button disappear. Under vitest every
 * spec file is its own module scope, so a runtime unit test can NEVER
 * reproduce a shared-global-scope collision — hence this file is a STATIC
 * source check, not a behavioral one.
 *
 * ── What this check deliberately does NOT catch (documented, not a gap to silently miss) ──
 *  - Destructuring declarations (`const { a, b } = x;`, `const [a] = x;`) are
 *    skipped entirely (regex requires a plain identifier right after the
 *    keyword). Under-reporting here is intentional: parsing destructuring
 *    patterns correctly needs a real AST, and a wrong guess would be a false
 *    positive, which is worse than a missed edge case.
 *  - Regex literals are not specially tokenized. This is safe in practice
 *    because valid regex character classes/quantifiers always contain
 *    balanced `[]`/`{}`, so naive bracket-depth counting stays correct
 *    through them.
 *  - Nested/tagged template literals (a backtick template containing another
 *    backtick template inside `${...}`) can confuse the naive backtick
 *    matcher. Not present in this codebase today; flagged here rather than
 *    silently mishandled.
 *  - Only the FIRST declarator of a multi-declarator statement is guaranteed;
 *    subsequent comma-separated declarators (`let a, b;`) are also picked up
 *    but only because nested brackets are masked out first (see
 *    maskBracketedRegions) — if that masking is ever wrong for some
 *    statement shape, the extra declarators are what would silently vanish.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Replaces all comment and string/template-literal contents with spaces
 * (preserving newlines), so bracket-depth counting below never mistakes
 * a `{`/`}`/`(`/`)`/`[`/`]` written inside a string or comment for real
 * source structure.
 */
function stripCommentsAndStrings(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') {
            let j = i + 2;
            while (j < n && src[j] !== '\n') j++;
            out += ' '.repeat(j - i);
            i = j;
            continue;
        }
        if (c === '/' && c2 === '*') {
            let j = i + 2;
            while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
            j = Math.min(j + 2, n);
            out += src.slice(i, j).replace(/[^\n]/g, ' ');
            i = j;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') {
            const quote = c;
            let j = i + 1;
            while (j < n) {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === quote) { j++; break; }
                j++;
            }
            out += src.slice(i, j).replace(/[^\n]/g, ' ');
            i = j;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/**
 * Replaces everything inside any bracket nesting depth > 0 (`{}`, `()`, `[]`
 * combined) with spaces, leaving only true top-level source text intact.
 * This is what excludes IIFE bodies, function bodies, object/array literals,
 * and call arguments from being read as top-level declarations.
 */
function maskBracketedRegions(src) {
    let out = '';
    let depth = 0;
    for (const ch of src) {
        if (ch === '{' || ch === '(' || ch === '[') {
            depth++;
            out += ' ';
        } else if (ch === '}' || ch === ')' || ch === ']') {
            depth = Math.max(0, depth - 1);
            out += ' ';
        } else if (depth > 0) {
            out += ch === '\n' ? '\n' : ' ';
        } else {
            out += ch;
        }
    }
    return out;
}

/** Returns the set of identifiers declared at the TRUE top level of `source`. */
function extractTopLevelDeclarations(source) {
    const masked = maskBracketedRegions(stripCommentsAndStrings(source));
    const identifiers = new Set();

    const declRe = /\b(?:const|let|var)\s+([\s\S]*?);/g;
    let m;
    while ((m = declRe.exec(masked))) {
        for (const part of m[1].split(',')) {
            const nameMatch = part.match(/^\s*([A-Za-z_$][\w$]*)/);
            if (nameMatch) identifiers.add(nameMatch[1]);
        }
    }

    const funcRe = /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/g;
    while ((m = funcRe.exec(masked))) identifiers.add(m[1]);

    const classRe = /\bclass\s+([A-Za-z_$][\w$]*)/g;
    while ((m = classRe.exec(masked))) identifiers.add(m[1]);

    return identifiers;
}

/** Maps each identifier to the set of relative file paths that declare it at top level. */
function collectDeclarationsByFile(relativePaths) {
    const byIdentifier = new Map();
    for (const rel of relativePaths) {
        const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        for (const id of extractTopLevelDeclarations(source)) {
            if (!byIdentifier.has(id)) byIdentifier.set(id, new Set());
            byIdentifier.get(id).add(rel);
        }
    }
    return byIdentifier;
}

function findCollisions(byIdentifier) {
    const collisions = [];
    for (const [id, files] of byIdentifier) {
        if (files.size > 1) collisions.push({ id, files: [...files].sort() });
    }
    return collisions.sort((a, b) => a.id.localeCompare(b.id));
}

function formatCollisions(collisions) {
    return collisions
        .map((c) => `  - "${c.id}" declared at top level by: ${c.files.join(', ')}`)
        .join('\n');
}

describe('extractTopLevelDeclarations (extraction correctness)', () => {
    it('does not report an identifier declared inside an IIFE', () => {
        const source = "(function () {\n  const HIDDEN = 1;\n  var alsoHidden = 2;\n})();\n";
        expect([...extractTopLevelDeclarations(source)]).toEqual([]);
    });

    it('reports an identifier declared at the true top level', () => {
        const source = "const VISIBLE = 1;\n";
        expect([...extractTopLevelDeclarations(source)]).toEqual(['VISIBLE']);
    });

    it('does not confuse a same-named identifier used only as a property access', () => {
        // Regression guard for the extractor itself: harvest.js references
        // `__DSSelectors.SCROLL_AREA_CLASS`, which must not register `SCROLL_AREA_CLASS`
        // as a top-level declaration of the consuming file.
        const source = "const x = __DSSelectors.SCROLL_AREA_CLASS;\n";
        expect([...extractTopLevelDeclarations(source)]).toEqual(['x']);
    });
});

describe('content-script global scope collisions (static source check)', () => {
    it('no identifier is declared at top level by more than one manifest content script', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
        const files = manifest.content_scripts.flatMap((entry) => entry.js);

        const collisions = findCollisions(collectDeclarationsByFile(files));

        expect(
            collisions,
            `Top-level identifier collisions across manifest content_scripts (they share one global scope in the isolated world):\n${formatCollisions(collisions)}`
        ).toEqual([]);
    });

    it('no identifier is declared at top level by more than one importScripts file in the service worker', () => {
        const swSource = fs.readFileSync(path.join(REPO_ROOT, 'background/service-worker.js'), 'utf8');
        const importCall = swSource.match(/importScripts\(([\s\S]*?)\)/);
        expect(
            importCall,
            'background/service-worker.js must call importScripts(...) for this check to find its dependency list'
        ).toBeTruthy();

        const files = importCall[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.replace(/^['"`]|['"`]$/g, ''))
            .map((rel) => path.normalize(path.join('background', rel)).replace(/\\/g, '/'));

        const collisions = findCollisions(collectDeclarationsByFile(files));

        expect(
            collisions,
            `Top-level identifier collisions across background/service-worker.js importScripts files (they share one global scope):\n${formatCollisions(collisions)}`
        ).toEqual([]);
    });
});
