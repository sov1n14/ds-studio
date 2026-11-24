/**
 * content/react-click-bridge.shared.main.js — the MAIN-world copy of content/react-click-bridge.shared.js.
 *
 * Contract: the two files are byte-identical. No path may appear in content_scripts entries of two worlds (rule: chrome-extension-coding-guidelines SKILL.md section 1, Runtime model), so the "world": "MAIN" entry lists this copy instead of the isolated entry's path (manifest wiring: test/unit/react-click-bridge.shared.spec.js). Any drift between the copies gives the two worlds different bridge definitions.
 * This spec compares two files as data; it asserts no text of either file. It reads source files, so test/stryker-vitest.config.js excludes it: Stryker instruments each copy differently, and mutant switching keeps the text identical across mutants.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const ORIGINAL = 'content/react-click-bridge.shared.js';
const MAIN_COPY = 'content/react-click-bridge.shared.main.js';

describe('MAIN-world copy of the shared bridge definitions', () => {
    it(`the reader loads the existing ${ORIGINAL}`, () => {
        expect(fs.readFileSync(path.join(REPO_ROOT, ORIGINAL)).length, `${ORIGINAL} byte length`).toBeGreaterThan(0);
    });

    it(`${MAIN_COPY} exists`, () => {
        expect(fs.existsSync(path.join(REPO_ROOT, MAIN_COPY)), `${MAIN_COPY} does not exist`).toBe(true);
    });

    it(`${MAIN_COPY} is byte-identical to ${ORIGINAL}`, () => {
        const copyPath = path.join(REPO_ROOT, MAIN_COPY);
        const original = fs.readFileSync(path.join(REPO_ROOT, ORIGINAL));
        const copy = fs.existsSync(copyPath) ? fs.readFileSync(copyPath) : null;

        expect(copy, `${MAIN_COPY} does not exist`).not.toBeNull();
        expect(copy.equals(original), `${MAIN_COPY} differs from ${ORIGINAL} (${copy.length} vs ${original.length} bytes)`).toBe(true);
    });
});
