// DeepSeek DOM selectors shared with the extension, loaded from the single source of truth.
// content/ds-selectors.js is a CommonJS-compatible classic script, so it is loaded through require.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @type {Record<string, string>} */
export const DSSelectors = require('../../../content/ds-selectors.js');
