// Human-like pacing for the E2E suite (D-105): random waits between tests, between actions and between typed keys, all scaled by DSS_E2E_PACE.
// Pure logic with every effect injected (rng, delay, budget extension), so test/unit/e2e-pacing.spec.js drives it without a browser; test/e2e/helpers/human.js wires it to Playwright.

import { AsyncLocalStorage } from 'node:async_hooks';

export const PACE_ENV = 'DSS_E2E_PACE';

// Wait ranges in milliseconds at scale 1.
const RANGES_MS = Object.freeze({
    betweenTests: [5_000, 20_000],
    betweenActions: [300, 1_500],
    key: [60, 220],
    think: [300, 700],
});
// A think pause comes after every 5–12 typed keys.
const THINK_EVERY_KEYS = [5, 12];
// Text longer than this many characters is pasted in one step, as a person pastes a long text.
const MAX_TYPED_CHARS = 200;
// Input types whose value typing cannot set; they are filled in one step.
const FILL_ONLY_INPUT_TYPES = new Set(['range', 'color', 'date', 'datetime-local', 'month', 'time', 'week']);

/** Reads DSS_E2E_PACE: unset or blank → scale 1; "off" (any case) → pacing off; a positive number → that scale; anything else throws. */
export function pacingConfig(env) {
    const raw = String(env[PACE_ENV] ?? '').trim();
    if (raw === '') return { isEnabled: true, scale: 1 };
    if (raw.toLowerCase() === 'off') return { isEnabled: false, scale: 0 };
    const scale = /^\d*\.?\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(`${PACE_ENV}=${JSON.stringify(env[PACE_ENV])} is not valid: leave it unset for full human pacing, set it to "off" to disable pacing, or to a positive number to scale every wait (for example 0.5).`);
    }
    return { isEnabled: true, scale };
}

/** A number in [min, max] drawn from `rng` (which returns [0, 1)). */
export function randomBetween(min, max, rng) {
    return min + rng() * (max - min);
}

/** An integer in [min, max], both ends included, drawn from `rng`. */
export function randomIntBetween(min, max, rng) {
    return min + Math.floor(rng() * (max - min + 1));
}

/** A wait of `kind` (betweenTests, betweenActions, key, think) in milliseconds, scaled; 0 while pacing is off. */
export function drawDelay(kind, config, rng) {
    if (!config.isEnabled) return 0;
    const [min, max] = RANGES_MS[kind];
    return Math.round(randomBetween(min, max, rng) * config.scale);
}

/**
 * Plans how to enter `text`: `{ mode: 'fill' }` for one-step entry (pacing off, empty text, more than 200 characters, or a fill-only input type),
 * else `{ mode: 'type', steps }` with one step per character, `{ key, delayMs, thinkMs }`: wait `thinkMs` (0 or a think pause) and `delayMs`, then press `key`.
 * A line break is typed as Shift+Enter, because Enter sends in the DeepSeek composer.
 */
export function planTyping(text, { config, rng, inputType = '' }) {
    const chars = Array.from(text);
    if (!config.isEnabled || chars.length === 0 || chars.length > MAX_TYPED_CHARS || FILL_ONLY_INPUT_TYPES.has(inputType)) {
        return { mode: 'fill' };
    }
    const [minEvery, maxEvery] = THINK_EVERY_KEYS;
    let nextThinkAt = randomIntBetween(minEvery, maxEvery, rng);
    const steps = chars.map((char, index) => {
        let thinkMs = 0;
        if (index === nextThinkAt) {
            thinkMs = drawDelay('think', config, rng);
            nextThinkAt += randomIntBetween(minEvery, maxEvery, rng);
        }
        return { key: char === '\n' ? 'Shift+Enter' : char, delayMs: drawDelay('key', config, rng), thinkMs };
    });
    return { mode: 'type', steps };
}

/**
 * Creates the pacer shared by one worker.
 * `delay(ms)` resolves after `ms`; `extendBudget(ms)` adds `ms` to the running test's time budget and is called before every wait, so pacing never eats into a test's own timeout.
 */
export function createPacer({ config, rng = Math.random, delay, extendBudget = () => {} }) {
    const unpaced = new AsyncLocalStorage();
    let testsStarted = 0;

    async function wait(ms) {
        if (!(ms > 0)) return 0;
        extendBudget(ms);
        await delay(ms);
        return ms;
    }

    return {
        config,
        rng,
        wait,
        /** Waits a random delay of `kind`; resolves the milliseconds waited. */
        pause: (kind) => wait(drawDelay(kind, config, rng)),
        /** The pause before a test; the first test of the worker starts at once. */
        betweenTests() {
            testsStarted += 1;
            return testsStarted === 1 ? Promise.resolve(0) : wait(drawDelay('betweenTests', config, rng));
        },
        /** Runs `fn` with action pacing suspended: actions inside it start without a pause. */
        runUnpaced: (fn) => unpaced.run(true, fn),
        isUnpaced: () => unpaced.getStore() === true,
    };
}

const PACED = Symbol.for('dss.e2e.pacedAction');

/**
 * Wraps each method of `prototype` named in `methodNames` so it pauses one between-actions delay before it runs.
 * An action called from inside a paced action (Playwright's pressSequentially calls type) or inside `pacer.runUnpaced` runs without a pause.
 * Installing again over a wrapped method changes nothing; names the prototype lacks are skipped.
 */
export function installActionPacing(prototype, methodNames, pacer) {
    for (const name of methodNames) {
        const original = prototype[name];
        if (typeof original !== 'function' || original[PACED]) continue;
        const paced = async function pacedAction(...args) {
            if (pacer.isUnpaced()) return original.apply(this, args);
            await pacer.pause('betweenActions');
            return pacer.runUnpaced(() => original.apply(this, args));
        };
        paced[PACED] = true;
        Object.defineProperty(prototype, name, { value: paced, writable: true, configurable: true, enumerable: false });
    }
}

// Extra retry budget per unit of scale: one worst-case paced attempt of a 63-character prompt with its clicks is about 33 s.
const RETRY_ALLOWANCE_MS = 60_000;

/** A retry budget (expect.toPass) around paced actions and typing, raised by 60 s × scale while pacing is on so pacing alone cannot exhaust it. */
export function withPacingAllowance(ms, config) {
    return config.isEnabled ? ms + RETRY_ALLOWANCE_MS * config.scale : ms;
}
