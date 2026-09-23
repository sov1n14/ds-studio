import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

// Stryker runs from project root; re-anchor vitest root to test/
export default mergeConfig(base, defineConfig({
    test: {
        root: 'test',
        // Text-parse contract specs read source files as text; Stryker's instrumented copies break their regexes, and mutant switching keeps the text identical across mutants, so they can never kill a mutant.
        exclude: ['unit/content-script-global-collisions.spec.js', 'unit/storage-manager.loader-contract.spec.js', 'unit/editor-html.spec.js'],
    },
}));
