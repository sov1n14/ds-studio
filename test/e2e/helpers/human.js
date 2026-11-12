// Playwright wiring of the human-like pacing in pacing.js (D-105): one pacer per worker, a pause before every Page and Locator action, and character-by-character typing.
// DSS_E2E_PACE: unset → full pacing (the two full-suite runs); "off" → no pacing, for debugging one spec locally; a positive number scales every wait (for example 0.5).

import { test } from '@playwright/test';
import { createPacer, installActionPacing, pacingConfig, planTyping, withPacingAllowance } from './pacing.js';

// Actions that pause before they run. Mouse, Keyboard and Touchscreen primitives, evaluate, route, expect and CDP stay unpaced: a drag would pause between its moves.
const PAGE_ACTIONS = ['click', 'dblclick', 'tap', 'fill', 'press', 'type', 'hover', 'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'goto', 'reload', 'goBack', 'goForward'];
const LOCATOR_ACTIONS = ['click', 'dblclick', 'tap', 'fill', 'press', 'pressSequentially', 'type', 'hover', 'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'dragTo'];

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

/** Makes every Page and Locator action of this Playwright client pause first; the classes are shared, so one install covers every page of the worker. */
export async function installHumanPacing(context) {
    // A persistent context starts with a blank page; a page created here stays open, as that blank page would.
    const page = context.pages()[0] ?? await context.newPage();
    installActionPacing(Object.getPrototypeOf(page), PAGE_ACTIONS, pacer);
    installActionPacing(Object.getPrototypeOf(page.locator('html')), LOCATOR_ACTIONS, pacer);
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

async function typeSteps(steps, pressKey) {
    for (const { key, delayMs, thinkMs } of steps) {
        await pacer.wait(thinkMs);
        await pacer.wait(delayMs);
        await pressKey(key);
    }
}

/**
 * Enters `text` into `locator` as a person types it: one pause, then one key at a time with random gaps and think pauses, a line break as Shift+Enter (Enter would send).
 * Like `fill`, the text replaces the current value (selected first, so the first key overwrites it and the field is never empty in between); with `{ isAppending: true }` it is typed at the caret instead.
 * Text over 200 characters, empty text, a range input, or pacing off: one paced `fill`, like a paste.
 */
export async function humanType(locator, text, { isAppending = false } = {}) {
    const inputType = await locator.evaluate((element) => (element instanceof HTMLInputElement ? element.type : ''));
    const plan = planTyping(text, { config: pacer.config, rng: pacer.rng, inputType });
    if (plan.mode === 'fill') {
        await locator.fill(isAppending ? (await locator.inputValue()) + text : text);
        return;
    }
    await pacer.pause('betweenActions');
    await pacer.runUnpaced(async () => {
        if (!isAppending) await locator.selectText();
        await typeSteps(plan.steps, (key) => (key === 'Shift+Enter' ? locator.press(key) : locator.pressSequentially(key)));
    });
}

/** Types `text` (no line breaks: the pacing-off branch presses Enter for one) wherever the keyboard focus is, as a person types it, with the same keys and waits as `humanType`; with pacing off, one `keyboard.type` call. */
export async function humanTypeAtFocus(keyboard, text) {
    const plan = planTyping(text, { config: pacer.config, rng: pacer.rng });
    if (plan.mode === 'fill') {
        await keyboard.type(text);
        return;
    }
    await pacer.pause('betweenActions');
    await typeSteps(plan.steps, (key) => (key === 'Shift+Enter' ? keyboard.press(key) : keyboard.type(key)));
}
