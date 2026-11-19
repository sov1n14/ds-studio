/**
 * Human-like pacing for the capture sweep (tools/capture.mjs, tools/scenario-helpers.mjs), the same rhythm as the E2E suite.
 * Reuses the pacing logic of test/e2e/helpers/pacing.js: a random pause before every Page and Locator action, and key-by-key typing.
 * DSS_E2E_PACE: unset → full pacing; "off" → no pacing; a positive number scales every wait (for example 0.5).
 */

import { LOCATOR_ACTIONS, PAGE_ACTIONS, createPacer, installActionPacing, pacingConfig, typeIntoLocator } from '../test/e2e/helpers/pacing.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds the pacing for one process; `env`, `rng` and `delay` are injectable so tests run without real waits. */
export function createCapturePacing({ env = process.env, rng = Math.random, delay = sleep } = {}) {
  const pacer = createPacer({ config: pacingConfig(env), rng, delay });

  return {
    /** Makes every Page and Locator action of this Playwright client pause first; the classes are shared, so one install covers every page and context. */
    async installPacing(context) {
      // A persistent context starts with a blank page; a page created here stays open, as that blank page would.
      const page = context.pages()[0] ?? await context.newPage();
      installActionPacing(Object.getPrototypeOf(page), PAGE_ACTIONS, pacer);
      installActionPacing(Object.getPrototypeOf(page.locator('html')), LOCATOR_ACTIONS, pacer);
    },

    /** Enters `text` into `locator` key by key, replacing its content; the plan is `typeIntoLocator` of test/e2e/helpers/pacing.js. */
    typeText: (locator, text) => typeIntoLocator(pacer, locator, text),
  };
}

export const { installPacing, typeText } = createCapturePacing();
