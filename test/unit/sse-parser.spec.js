import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

/**
 * Unit tests for content/sse-parser.js — migrated from the orphaned
 * test/unit/sse-parser.test.js (never collected: it used a .test.js
 * extension while test/vitest.config.js only includes unit/**\/*.spec.js,
 * and its own `node` runner crashed under the ESM "type": "module" package).
 *
 * Only the branches with NO existing collected coverage are ported here:
 *   - SseParser.joinPath (5 direct cases)
 *   - Bare top-level array CONTENT_FILTER detection (no "o":"BATCH" wrapper,
 *     no top-level "p")
 *   - Absolute sub-path inside a BATCH envelope
 *
 * TEMPLATE_RESPONSE filtering, APPEND/short-format content accumulation, and
 * relative-path-in-BATCH censored detection are already covered with real
 * assertions in censor-xhr-hook-edit-message.spec.js (groups B3, B5, B7) and
 * censor-reply-restore.spec.js (the `_parseSseEvent()` describe blocks) —
 * not duplicated here.
 *
 * The fixture-based describe blocks from the original file (first/second/
 * third/fourth-API-resopnse) depended on test/samples/debugging/*.yaml,
 * which does not exist in this repo, and are not portable.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadSseParser() {
    const src = fs.readFileSync(path.join(ROOT, 'content', 'sse-parser.js'), 'utf-8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox.SseParser;
}

describe('SseParser', () => {
    let SseParser;

    beforeEach(() => {
        SseParser = loadSseParser();
    });

    describe('joinPath edge cases', () => {
        it('top-level call with full path (parentP=undefined) passes through', () => {
            expect(SseParser.joinPath(undefined, 'response/status')).toBe('response/status');
        });

        it('bare-array recursion with empty parent prepends /', () => {
            expect(SseParser.joinPath('', 'status')).toBe('/status');
        });

        it('BATCH recursion with parent path joins parent+child', () => {
            expect(SseParser.joinPath('response', 'status')).toBe('response/status');
        });

        it('absolute child path is returned as-is, overriding the parent', () => {
            expect(SseParser.joinPath('response', '/absolute/path')).toBe('/absolute/path');
        });

        it('null parent is treated as undefined (top-level)', () => {
            expect(SseParser.joinPath(null, 'response/status')).toBe('response/status');
        });
    });

    describe('CONTENT_FILTER detection — branches with no BATCH-relative-path coverage elsewhere', () => {
        it('bare top-level array (no "o":"BATCH", no top-level "p") detects CONTENT_FILTER', () => {
            const state = SseParser.createState();
            state.started = true;
            SseParser.parseLine(state, 'data: {"v":[{"p":"status","v":"CONTENT_FILTER"},{"p":"quasi_status","v":"CONTENT_FILTER"}]}');
            expect(state.censored).toBe(true);
        });

        it('absolute sub-path inside a BATCH envelope still sets censored', () => {
            const state = SseParser.createState();
            state.started = true;
            SseParser.parseLine(state, 'data: {"p":"response","o":"BATCH","v":[{"p":"/response/status","v":"CONTENT_FILTER"}]}');
            expect(state.censored).toBe(true);
        });
    });
});
