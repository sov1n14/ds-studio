import { defineConfig } from '@playwright/test';

// The persistent Chrome profile admits one browser at a time, so tests run serially.
export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.e2e.js',
    workers: 1,
    fullyParallel: false,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    reporter: 'list',
});
