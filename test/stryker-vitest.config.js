import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

// Stryker runs from project root; re-anchor vitest root to test/
export default mergeConfig(base, defineConfig({
    test: {
        root: 'test',
        // Text-parse contract specs (including the popup toggle specs that regex-parse popup source) read source files as text; Stryker's instrumented copies break their regexes, and mutant switching keeps the text identical across mutants, so they can never kill a mutant. The e2e-* specs import helpers under test/e2e, which stryker.config.json ignorePatterns leaves out of the sandbox, so they cannot resolve there and test E2E helpers, not extension code.
        exclude: ['unit/content-script-global-collisions.spec.js', 'unit/storage-manager.loader-contract.spec.js', 'unit/editor-html.spec.js', 'unit/popup-prevent-auto-scroll-toggle.spec.js', 'unit/popup-websearch-toggle.spec.js', 'unit/editor.preset-target-source.spec.js', 'unit/popup.open-editor-window-source.spec.js', 'unit/storage-manager.sync-now.call-site-source.spec.js', 'unit/url-constants.spec.js', 'unit/e2e-har-purpose.spec.js', 'unit/e2e-har-recording.spec.js', 'unit/e2e-offline-manifest.spec.js', 'unit/e2e-pow-worker-stub.spec.js', 'unit/e2e-replay-misses.spec.js', 'unit/e2e-request-guard.spec.js'],
    },
}));
