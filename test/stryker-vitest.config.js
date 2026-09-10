import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

// Stryker runs from project root; re-anchor vitest root to test/
export default mergeConfig(base, defineConfig({ test: { root: 'test' } }));
