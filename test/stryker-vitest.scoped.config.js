import base from './stryker-vitest.config.js';

// Stryker 10 沒有 extends，vitest 的 mergeConfig 又會串接 include，所以用展開取代 include。
const specs = (process.env.STRYKER_SPECS ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
if (specs.length === 0) throw new Error('STRYKER_SPECS is empty');

export default { ...base, test: { ...base.test, include: specs } };
