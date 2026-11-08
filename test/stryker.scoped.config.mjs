import { readFileSync } from 'node:fs';

// Stryker 10 沒有 extends，沿用完整設定的 JSON 再覆寫範圍相關欄位。
const base = JSON.parse(readFileSync('test/stryker.config.json', 'utf8'));
const mutate = (process.env.STRYKER_MUTATE ?? '').split(',').filter(Boolean);
if (mutate.length === 0) throw new Error('STRYKER_MUTATE is empty');

export default {
  ...base,
  mutate,
  vitest: { ...base.vitest, configFile: 'test/stryker-vitest.scoped.config.js' },
  incrementalFile: 'test/stryker-incremental.scoped.json',
  reporters: ['clear-text', 'html', 'json'],
  htmlReporter: { fileName: 'test/reports/mutation.scoped.html' },
  jsonReporter: { fileName: 'test/reports/mutation.scoped.json' },
  thresholds: { high: 80, low: 60, break: null },
};
