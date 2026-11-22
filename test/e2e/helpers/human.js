// Playwright wiring of the human-like pacing in test/helpers/pacing.js (D-105): one pacer per worker, a pause before every Page, Locator, Keyboard, Mouse and Touchscreen action, and character-by-character typing.
// DSS_E2E_PACE: unset → full pacing (the two full-suite runs); "off" → no pacing, for debugging one spec locally; a positive number scales every wait (for example 0.5).

import { test } from '@playwright/test';
import { LOCATOR_ACTIONS, PAGE_ACTIONS, createPacer, createTyper, installActionPacing, installInputPacing, pacingConfig, withPacingAllowance } from '../../helpers/pacing.js';

/** Adds `ms` to the running test's timeout, so pacing never eats into the test's own budget; outside a running test there is no budget to extend. */
function extendTestBudget(ms) {
    let info;
    try {
        info = test.info();
    } catch {
        return;
    }
    if (info.timeout > 0) info.setTimeout(info.timeout + ms);
}

export const pacer = createPacer({
    config: pacingConfig(process.env),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    extendBudget: extendTestBudget,
});

/** Makes every Page, Locator, Keyboard, Mouse and Touchscreen action of this Playwright client pause first; the classes are shared, so one install covers every page of the worker. */
export async function installHumanPacing(context) {
    // A persistent context starts with a blank page; a page created here stays open, as that blank page would.
    const page = context.pages()[0] ?? await context.newPage();
    installActionPacing(Object.getPrototypeOf(page), PAGE_ACTIONS, pacer);
    installActionPacing(Object.getPrototypeOf(page.locator('html')), LOCATOR_ACTIONS, pacer);
    installInputPacing(page, pacer);
}

/** The pause before a test; the first test of the worker starts at once. */
export function pauseBetweenTests() {
    return pacer.betweenTests();
}

/** One between-actions pause, for a spec that runs its next action unpaced (for example inside an observation window that must start right before it). */
export function humanPause() {
    return pacer.pause('betweenActions');
}

/** Runs `fn` with action pacing suspended, for steps whose timing is under test. */
export function runUnpaced(fn) {
    return pacer.runUnpaced(fn);
}

/** A retry budget (expect.toPass) around paced actions and typing: `ms` plus 60 s × scale while pacing is on. */
export function pacedTimeout(ms) {
    return withPacingAllowance(ms, pacer.config);
}

export const { humanType, humanTypeAtFocus } = createTyper(pacer);
