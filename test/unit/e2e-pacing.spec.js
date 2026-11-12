/**
 * test/e2e/helpers/pacing.js — human-like pacing for the E2E suite (decision D-105, ruled 2026-11-12).
 *
 * Requirement (user ruling plus lead design; every expected value below comes from that text, not from the implementation):
 *   - DSS_E2E_PACE: unset or blank → pacing on at scale 1; "off" in any letter case → pacing off; a positive number → that scale; anything else → an error naming the variable and the allowed values.
 *   - Random waits, each multiplied by the scale: between tests 5–20 s, between actions 0.3–1.5 s, per typed key 60–220 ms, a think pause of 300–700 ms every 5–12 keys. Pacing off → no wait at all.
 *   - Typing plan: one key per character, a line break typed as Shift+Enter (Enter would send in the composer); text longer than 200 characters, empty text and a range input are filled in one step.
 *   - The between-tests pause is skipped for the first test of a worker; every wait first extends the running test's time budget by the same amount.
 *   - Action pacing pauses once before each listed Playwright action, also when an action delegates to another listed action (pressSequentially calls type), and never inside an unpaced scope.
 *   - A retry budget (expect.toPass) around paced actions and typing gets 60 s × scale more while pacing is on (one worst-case paced attempt of a 63-character prompt with its clicks is about 33 s), and stays unchanged while pacing is off.
 */
import { describe, it, expect } from 'vitest';
import { createPacer, drawDelay, installActionPacing, pacingConfig, planTyping, randomBetween, randomIntBetween, withPacingAllowance } from '../e2e/helpers/pacing.js';

/** Deterministic PRNG (mulberry32) so every draw sequence is reproducible. */
function seededRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ON = Object.freeze({ isEnabled: true, scale: 1 });
const OFF = Object.freeze({ isEnabled: false, scale: 0 });

// Ranges in milliseconds, transcribed from the requirement text.
const RANGES_MS = {
    betweenTests: [5_000, 20_000],
    betweenActions: [300, 1_500],
    key: [60, 220],
    think: [300, 700],
};

/** A pacer whose delay resolves at once and records every wait, plus the budget extensions in call order. */
function recordingPacer(config, rng = seededRng(7)) {
    const events = [];
    const pacer = createPacer({
        config,
        rng,
        delay: async (ms) => { events.push({ type: 'delay', ms }); },
        extendBudget: (ms) => { events.push({ type: 'extend', ms }); },
    });
    const waits = () => events.filter((event) => event.type === 'delay' && event.ms > 0).map((event) => event.ms);
    return { pacer, events, waits };
}

describe('pacingConfig(env) reads DSS_E2E_PACE', () => {
    it('leaves pacing on at scale 1 when the variable is unset or blank', () => {
        expect(pacingConfig({})).toEqual({ isEnabled: true, scale: 1 });
        expect(pacingConfig({ DSS_E2E_PACE: '' })).toEqual({ isEnabled: true, scale: 1 });
        expect(pacingConfig({ DSS_E2E_PACE: '   ' })).toEqual({ isEnabled: true, scale: 1 });
    });

    it('turns pacing off for "off" in any letter case', () => {
        for (const value of ['off', 'OFF', 'Off', ' off ']) {
            expect(pacingConfig({ DSS_E2E_PACE: value }).isEnabled, `DSS_E2E_PACE=${JSON.stringify(value)}`).toBe(false);
        }
    });

    it('uses a positive number as the scale', () => {
        expect(pacingConfig({ DSS_E2E_PACE: '0.5' })).toEqual({ isEnabled: true, scale: 0.5 });
        expect(pacingConfig({ DSS_E2E_PACE: '2' })).toEqual({ isEnabled: true, scale: 2 });
        expect(pacingConfig({ DSS_E2E_PACE: '1' })).toEqual({ isEnabled: true, scale: 1 });
    });

    it('rejects any other value with an error naming the variable and the allowed values', () => {
        for (const value of ['fast', '0', '-1', 'NaN', 'Infinity', 'on', '1x']) {
            expect(() => pacingConfig({ DSS_E2E_PACE: value }), `DSS_E2E_PACE=${JSON.stringify(value)}`).toThrow(/DSS_E2E_PACE/);
            expect(() => pacingConfig({ DSS_E2E_PACE: value }), `DSS_E2E_PACE=${JSON.stringify(value)}`).toThrow(/off/);
            expect(() => pacingConfig({ DSS_E2E_PACE: value }), `DSS_E2E_PACE=${JSON.stringify(value)}`).toThrow(/positive number/);
        }
    });
});

describe('random helpers', () => {
    it('randomBetween maps the rng onto [min, max]', () => {
        expect(randomBetween(300, 1_500, () => 0)).toBe(300);
        expect(randomBetween(300, 1_500, () => 0.5)).toBe(900);
        const nearTop = randomBetween(300, 1_500, () => 0.999_999);
        expect(nearTop).toBeGreaterThan(1_499);
        expect(nearTop).toBeLessThanOrEqual(1_500);
    });

    it('randomIntBetween draws every integer of [min, max] inclusive and nothing outside', () => {
        expect(randomIntBetween(5, 12, () => 0)).toBe(5);
        expect(randomIntBetween(5, 12, () => 0.999_999)).toBe(12);
        const rng = seededRng(11);
        const seen = new Set();
        for (let i = 0; i < 2_000; i += 1) seen.add(randomIntBetween(5, 12, rng));
        expect([...seen].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    });
});

describe('drawDelay(kind, config, rng)', () => {
    for (const scale of [1, 0.5, 2]) {
        for (const [kind, [min, max]] of Object.entries(RANGES_MS)) {
            it(`keeps every ${kind} delay inside ${min}–${max} ms × ${scale} and spreads over the whole range`, () => {
                const rng = seededRng(42);
                const draws = Array.from({ length: 3_000 }, () => drawDelay(kind, { isEnabled: true, scale }, rng));
                const low = min * scale;
                const high = max * scale;
                const margin = (high - low) * 0.05;
                expect(Math.min(...draws), `smallest ${kind} draw`).toBeGreaterThanOrEqual(low);
                expect(Math.max(...draws), `largest ${kind} draw`).toBeLessThanOrEqual(high);
                expect(Math.min(...draws), `${kind} draws reach the bottom of the range`).toBeLessThan(low + margin);
                expect(Math.max(...draws), `${kind} draws reach the top of the range`).toBeGreaterThan(high - margin);
            });
        }
    }

    it('draws zero for every kind when pacing is off', () => {
        const rng = seededRng(3);
        for (const kind of Object.keys(RANGES_MS)) {
            for (let i = 0; i < 50; i += 1) expect(drawDelay(kind, OFF, rng), kind).toBe(0);
        }
    });
});

describe('planTyping(text, { config, rng, inputType })', () => {
    const keysOf = (plan) => plan.steps.map((step) => step.key);
    const typedText = (plan) => keysOf(plan).map((key) => (key === 'Shift+Enter' ? '\n' : key)).join('');

    it('types one key per character and a line break as Shift+Enter, never a bare Enter', () => {
        const plan = planTyping('ab\ncd', { config: ON, rng: seededRng(1) });
        expect(plan.mode).toBe('type');
        expect(keysOf(plan)).toEqual(['a', 'b', 'Shift+Enter', 'c', 'd']);
        expect(keysOf(plan)).not.toContain('Enter');
    });

    it('types text of exactly 200 characters key by key and fills 201 characters in one step', () => {
        const exact = 'x'.repeat(199) + '\n';
        const typed = planTyping(exact, { config: ON, rng: seededRng(2) });
        expect(typed.mode).toBe('type');
        expect(typed.steps).toHaveLength(200);
        expect(typedText(typed)).toBe(exact);
        expect(planTyping('x'.repeat(201), { config: ON, rng: seededRng(2) })).toEqual({ mode: 'fill' });
    });

    it('counts characters, not UTF-16 units: 200 astral-plane characters are typed, each as one key', () => {
        const astral = String.fromCodePoint(0x1f600);
        const plan = planTyping(astral.repeat(200), { config: ON, rng: seededRng(4) });
        expect(plan.mode).toBe('type');
        expect(plan.steps).toHaveLength(200);
        expect(new Set(keysOf(plan))).toEqual(new Set([astral]));
    });

    it('fills empty text, a range input and any text while pacing is off in one step', () => {
        expect(planTyping('', { config: ON, rng: seededRng(5) })).toEqual({ mode: 'fill' });
        expect(planTyping('55', { config: ON, rng: seededRng(5), inputType: 'range' })).toEqual({ mode: 'fill' });
        expect(planTyping('hello', { config: OFF, rng: seededRng(5) })).toEqual({ mode: 'fill' });
    });

    it('types into a text input or a textarea (no input type) key by key', () => {
        expect(planTyping('hi', { config: ON, rng: seededRng(6), inputType: 'text' }).mode).toBe('type');
        expect(planTyping('hi', { config: ON, rng: seededRng(6), inputType: 'search' }).mode).toBe('type');
        expect(planTyping('hi', { config: ON, rng: seededRng(6) }).mode).toBe('type');
    });

    it('waits 60–220 ms × scale before each key and 300–700 ms × scale at each think pause', () => {
        for (const scale of [1, 0.5]) {
            const plan = planTyping('y'.repeat(200), { config: { isEnabled: true, scale }, rng: seededRng(8) });
            for (const step of plan.steps) {
                expect(step.delayMs).toBeGreaterThanOrEqual(60 * scale);
                expect(step.delayMs).toBeLessThanOrEqual(220 * scale);
                if (step.thinkMs > 0) {
                    expect(step.thinkMs).toBeGreaterThanOrEqual(300 * scale);
                    expect(step.thinkMs).toBeLessThanOrEqual(700 * scale);
                } else {
                    expect(step.thinkMs).toBe(0);
                }
            }
        }
    });

    it('puts a think pause after every 5–12 keys: never before the first key, never after the last, and every gap in 5–12', () => {
        const gaps = new Set();
        for (let seed = 1; seed <= 200; seed += 1) {
            const plan = planTyping('z'.repeat(150), { config: ON, rng: seededRng(seed) });
            const pauseAt = plan.steps.map((step, index) => (step.thinkMs > 0 ? index : -1)).filter((index) => index >= 0);
            expect(pauseAt.length, `seed ${seed}: 150 keys hold at least 12 think pauses`).toBeGreaterThanOrEqual(12);
            expect(pauseAt[0], `seed ${seed}: keys typed before the first think pause`).toBeGreaterThanOrEqual(5);
            expect(pauseAt[0], `seed ${seed}: keys typed before the first think pause`).toBeLessThanOrEqual(12);
            for (let i = 1; i < pauseAt.length; i += 1) {
                const gap = pauseAt[i] - pauseAt[i - 1];
                gaps.add(gap);
                expect(gap, `seed ${seed}: keys between think pauses`).toBeGreaterThanOrEqual(5);
                expect(gap, `seed ${seed}: keys between think pauses`).toBeLessThanOrEqual(12);
            }
            const trailing = plan.steps.length - pauseAt[pauseAt.length - 1];
            expect(trailing, `seed ${seed}: keys typed after the last think pause`).toBeGreaterThanOrEqual(1);
            expect(trailing, `seed ${seed}: keys typed after the last think pause`).toBeLessThanOrEqual(12);
        }
        expect(Math.min(...gaps), 'gaps reach 5 keys').toBe(5);
        expect(Math.max(...gaps), 'gaps reach 12 keys').toBe(12);
    });

    it('types a short text of 4 keys with no think pause', () => {
        const plan = planTyping('abcd', { config: ON, rng: seededRng(9) });
        expect(plan.steps.every((step) => step.thinkMs === 0)).toBe(true);
    });
});

describe('createPacer: waits and the time budget', () => {
    it('extends the budget by the same amount before each wait starts', async () => {
        const { pacer, events } = recordingPacer(ON);
        const waited = await pacer.pause('betweenActions');
        expect(waited).toBeGreaterThanOrEqual(300);
        expect(waited).toBeLessThanOrEqual(1_500);
        expect(events).toEqual([{ type: 'extend', ms: waited }, { type: 'delay', ms: waited }]);
    });

    it('skips the between-tests pause for the first test of a worker and pauses 5–20 s before each later test', async () => {
        const { pacer, waits } = recordingPacer(ON);
        expect(await pacer.betweenTests(), 'the first test starts at once').toBe(0);
        expect(waits()).toEqual([]);
        await pacer.betweenTests();
        await pacer.betweenTests();
        expect(waits()).toHaveLength(2);
        for (const ms of waits()) {
            expect(ms).toBeGreaterThanOrEqual(5_000);
            expect(ms).toBeLessThanOrEqual(20_000);
        }
    });

    it('scales the between-tests pause', async () => {
        const { pacer, waits } = recordingPacer({ isEnabled: true, scale: 0.5 });
        await pacer.betweenTests();
        for (let i = 0; i < 30; i += 1) await pacer.betweenTests();
        expect(waits()).toHaveLength(30);
        expect(Math.min(...waits())).toBeGreaterThanOrEqual(2_500);
        expect(Math.max(...waits())).toBeLessThanOrEqual(10_000);
    });

    it('never waits or extends the budget while pacing is off', async () => {
        const { pacer, events } = recordingPacer(OFF);
        await pacer.betweenTests();
        await pacer.betweenTests();
        await pacer.pause('betweenActions');
        await pacer.pause('think');
        await pacer.wait(0);
        expect(events.filter((event) => event.ms > 0)).toEqual([]);
    });
});

describe('installActionPacing(prototype, methodNames, pacer)', () => {
    /** A stand-in for Playwright's Locator: pressSequentially delegates to type, as Playwright's does. */
    function fakeLocatorClass(log) {
        return class FakeLocator {
            constructor(name) { this.name = name; }
            async click(options) { log.push(`click:${this.name}:${JSON.stringify(options ?? null)}`); return 'clicked'; }
            async type(text) { log.push(`type:${text}`); }
            async pressSequentially(text) { return this.type(text); }
            async fill() { throw new Error('fill failed'); }
            async evaluate() { log.push('evaluate'); return 'evaluated'; }
        };
    }

    function setup(config = ON) {
        const log = [];
        const FakeLocator = fakeLocatorClass(log);
        const pacer = createPacer({
            config,
            rng: seededRng(13),
            delay: async (ms) => { if (ms > 0) log.push(`wait:${ms}`); },
            extendBudget: () => {},
        });
        installActionPacing(FakeLocator.prototype, ['click', 'type', 'pressSequentially', 'fill', 'missingMethod'], pacer);
        const waits = () => log.filter((entry) => entry.startsWith('wait:')).map((entry) => Number(entry.slice(5)));
        return { log, FakeLocator, pacer, waits };
    }

    it('pauses 0.3–1.5 s before a listed action, then runs it with its own this, arguments and result', async () => {
        const { log, FakeLocator, waits } = setup();
        const result = await new FakeLocator('send').click({ force: true });
        expect(result).toBe('clicked');
        expect(log).toHaveLength(2);
        expect(log[0]).toMatch(/^wait:/);
        expect(log[1]).toBe('click:send:{"force":true}');
        expect(waits()[0]).toBeGreaterThanOrEqual(300);
        expect(waits()[0]).toBeLessThanOrEqual(1_500);
    });

    it('pauses once for an action that delegates to another listed action', async () => {
        const { log, FakeLocator, waits } = setup();
        await new FakeLocator('composer').pressSequentially('hi');
        expect(waits()).toHaveLength(1);
        expect(log[log.length - 1]).toBe('type:hi');
    });

    it('pauses for each of two concurrent actions', async () => {
        const { FakeLocator, waits } = setup();
        await Promise.all([new FakeLocator('a').click(), new FakeLocator('b').click()]);
        expect(waits()).toHaveLength(2);
    });

    it('leaves unlisted methods unpaced and ignores listed names the prototype lacks', async () => {
        const { FakeLocator, waits } = setup();
        expect(await new FakeLocator('x').evaluate()).toBe('evaluated');
        expect(waits()).toEqual([]);
        expect(FakeLocator.prototype.missingMethod).toBeUndefined();
    });

    it('runs actions inside runUnpaced without any pause, and pauses again after the scope ends', async () => {
        const { FakeLocator, pacer, waits } = setup();
        const value = await pacer.runUnpaced(async () => {
            await new FakeLocator('name').click();
            await new FakeLocator('name').pressSequentially('abc');
            return 'done';
        });
        expect(value).toBe('done');
        expect(waits()).toEqual([]);
        await new FakeLocator('name').click();
        expect(waits()).toHaveLength(1);
    });

    it('installing twice still pauses once per action', async () => {
        const { FakeLocator, pacer, waits } = setup();
        installActionPacing(FakeLocator.prototype, ['click'], pacer);
        await new FakeLocator('twice').click();
        expect(waits()).toHaveLength(1);
    });

    it('passes a rejected action through unchanged', async () => {
        const { FakeLocator } = setup();
        await expect(new FakeLocator('f').fill('x')).rejects.toThrow('fill failed');
    });

    it('never pauses while pacing is off', async () => {
        const { FakeLocator, waits } = setup(OFF);
        await new FakeLocator('off').click();
        await new FakeLocator('off').pressSequentially('abc');
        expect(waits()).toEqual([]);
    });
});

describe('withPacingAllowance(ms, config)', () => {
    it('adds 60 s × scale to a retry budget while pacing is on', () => {
        expect(withPacingAllowance(15_000, ON)).toBe(75_000);
        expect(withPacingAllowance(30_000, { isEnabled: true, scale: 0.5 })).toBe(60_000);
        expect(withPacingAllowance(30_000, { isEnabled: true, scale: 2 })).toBe(150_000);
    });

    it('leaves the budget unchanged while pacing is off', () => {
        expect(withPacingAllowance(15_000, OFF)).toBe(15_000);
    });
});
