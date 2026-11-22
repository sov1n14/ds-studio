import { defineConfig } from '@playwright/test';
import { LANE_ENV, OFFLINE_LANE } from './e2e/helpers/pacing.js';

// The offline lane: tests tagged @offline run in a disposable bundled Chromium with the extension loaded and no network (fixtures.js, helpers/offline-lane.js).
// Every worker owns its browser and profile, so workers run in parallel. Pacing is off unless DSS_E2E_PACE is set (pacing.js).
process.env[LANE_ENV] = OFFLINE_LANE;

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.e2e.js',
    grep: /@offline/,
    workers: 2,
    fullyParallel: false,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    reporter: [['list'], ['./e2e/helpers/offline-guard-reporter.js']],
});
