/**
 * Unit tests for content/harvest.policy.js
 */
import { describe, it, expect } from 'vitest';

const { createInitialState, decideNextStep, describeIncompleteReason } = window.DSstudio.HarvestPolicy;

const HARVEST_STALL_TIMEOUT_MS = 20000;

function baseObservation(overrides = {}) {
    return {
        nowMs: 0,
        capturedCount: 0,
        scrollHeight: 1000,
        isAtBottomConfirmed: false,
        isAborted: false,
        isScrollJumpDetected: false,
        ...overrides,
    };
}

function deepFreeze(obj) {
    Object.values(obj).forEach((v) => {
        if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
    });
    return Object.freeze(obj);
}

describe('decideNextStep - individual rules', () => {
    it('rule 1: isAtBottomConfirmed=true stops with reason complete', () => {
        const state = createInitialState(baseObservation());
        const result = decideNextStep(baseObservation({ isAtBottomConfirmed: true }), state);
        expect(result.action).toBe('stop');
        expect(result.reason).toBe('complete');
    });

    it('rule 2: isAborted=true stops with reason cancelled', () => {
        const state = createInitialState(baseObservation());
        const result = decideNextStep(baseObservation({ isAborted: true }), state);
        expect(result.action).toBe('stop');
        expect(result.reason).toBe('cancelled');
    });

    it('rule 3: isScrollJumpDetected=true stops with reason scroll_interrupted', () => {
        const state = createInitialState(baseObservation());
        const result = decideNextStep(baseObservation({ isScrollJumpDetected: true }), state);
        expect(result.action).toBe('stop');
        expect(result.reason).toBe('scroll_interrupted');
    });

    it('rule 4: progress via capturedCount increase continues with reason null', () => {
        const state = createInitialState(baseObservation({ nowMs: 0, capturedCount: 0 }));
        const result = decideNextStep(baseObservation({ nowMs: 100, capturedCount: 1 }), state);
        expect(result.action).toBe('continue');
        expect(result.reason).toBeNull();
    });

    it('rule 5: no progress for >= HARVEST_STALL_TIMEOUT_MS stops with reason stalled', () => {
        const state = createInitialState(baseObservation({ nowMs: 0 }));
        const result = decideNextStep(baseObservation({ nowMs: HARVEST_STALL_TIMEOUT_MS }), state);
        expect(result.action).toBe('stop');
        expect(result.reason).toBe('stalled');
    });

    it('rule 6: no progress but under the stall threshold continues with reason null', () => {
        const state = createInitialState(baseObservation({ nowMs: 0 }));
        const result = decideNextStep(baseObservation({ nowMs: HARVEST_STALL_TIMEOUT_MS - 1 }), state);
        expect(result.action).toBe('continue');
        expect(result.reason).toBeNull();
    });

    it('stall boundary is inclusive: exactly 20000ms stops, 19999ms continues', () => {
        const stateA = createInitialState(baseObservation({ nowMs: 0 }));
        const atThreshold = decideNextStep(baseObservation({ nowMs: 20000 }), stateA);
        expect(atThreshold.action).toBe('stop');
        expect(atThreshold.reason).toBe('stalled');

        const stateB = createInitialState(baseObservation({ nowMs: 0 }));
        const belowThreshold = decideNextStep(baseObservation({ nowMs: 19999 }), stateB);
        expect(belowThreshold.action).toBe('continue');
    });
});

describe('decideNextStep - precedence when multiple conditions hold simultaneously', () => {
    it('bottom-confirmed wins over isAborted AND isScrollJumpDetected both being true', () => {
        const state = createInitialState(baseObservation());
        const result = decideNextStep(
            baseObservation({ isAtBottomConfirmed: true, isAborted: true, isScrollJumpDetected: true }),
            state,
        );
        expect(result.reason).toBe('complete');
    });

    it('abort wins over scroll-jump when bottom is not confirmed', () => {
        const state = createInitialState(baseObservation());
        const result = decideNextStep(
            baseObservation({ isAborted: true, isScrollJumpDetected: true }),
            state,
        );
        expect(result.reason).toBe('cancelled');
    });

    it('scroll-jump wins over a stall condition (both true simultaneously)', () => {
        const state = createInitialState(baseObservation({ nowMs: 0 }));
        const result = decideNextStep(
            baseObservation({ nowMs: HARVEST_STALL_TIMEOUT_MS, isScrollJumpDetected: true }),
            state,
        );
        expect(result.reason).toBe('scroll_interrupted');
    });
});

describe('decideNextStep - progress detection', () => {
    it('progress via capturedCount increase alone (scrollHeight unchanged) counts as progress, and resets the no-progress clock', () => {
        const initial = baseObservation({ nowMs: 0, capturedCount: 5, scrollHeight: 1000 });
        const state = createInitialState(initial);
        const result = decideNextStep(
            baseObservation({ nowMs: 500, capturedCount: 6, scrollHeight: 1000 }),
            state,
        );
        expect(result.action).toBe('continue');

        const followUp = decideNextStep(
            baseObservation({ nowMs: 500 + HARVEST_STALL_TIMEOUT_MS - 1, capturedCount: 6, scrollHeight: 1000 }),
            result.state,
        );
        expect(followUp.action).toBe('continue');
    });

    it('progress via scrollHeight increase alone (capturedCount unchanged) counts as progress', () => {
        const initial = baseObservation({ nowMs: 0, capturedCount: 3, scrollHeight: 1000 });
        const state = createInitialState(initial);
        const result = decideNextStep(
            baseObservation({ nowMs: 500, capturedCount: 3, scrollHeight: 1200 }),
            state,
        );
        expect(result.action).toBe('continue');
        expect(result.reason).toBeNull();
    });

    it('progress via scrollHeight DECREASE alone counts as progress, not a stall', () => {
        const initial = baseObservation({ nowMs: 0, capturedCount: 3, scrollHeight: 1000 });
        const state = createInitialState(initial);
        const result = decideNextStep(
            baseObservation({ nowMs: HARVEST_STALL_TIMEOUT_MS, capturedCount: 3, scrollHeight: 800 }),
            state,
        );
        expect(result.action).toBe('continue');
        expect(result.reason).toBeNull();
    });
});

describe('decideNextStep - stall-clock accumulation (regression guard for the 120s truncation bug)', () => {
    it('continues through a sequence of no-progress calls until the 20000ms threshold is crossed, then stalls', () => {
        const initial = baseObservation({ nowMs: 0, capturedCount: 10, scrollHeight: 1000 });
        let state = createInitialState(initial);

        const noProgressTimes = [1000, 5000, 10000, 15000, 19999];
        for (const t of noProgressTimes) {
            const result = decideNextStep(
                baseObservation({ nowMs: t, capturedCount: 10, scrollHeight: 1000 }),
                state,
            );
            expect(result.action).toBe('continue');
            state = result.state;
        }

        const finalResult = decideNextStep(
            baseObservation({ nowMs: 20000, capturedCount: 10, scrollHeight: 1000 }),
            state,
        );
        expect(finalResult.action).toBe('stop');
        expect(finalResult.reason).toBe('stalled');
    });
});

describe('decideNextStep - stall-clock resets on progress', () => {
    it('19000ms no-progress, then a progress call, then another 19000ms no-progress still continues', () => {
        let state = createInitialState(baseObservation({ nowMs: 0, capturedCount: 1, scrollHeight: 1000 }));

        let result = decideNextStep(
            baseObservation({ nowMs: 19000, capturedCount: 1, scrollHeight: 1000 }),
            state,
        );
        expect(result.action).toBe('continue');
        state = result.state;

        result = decideNextStep(
            baseObservation({ nowMs: 19500, capturedCount: 2, scrollHeight: 1000 }),
            state,
        );
        expect(result.action).toBe('continue');
        state = result.state;

        result = decideNextStep(
            baseObservation({ nowMs: 19500 + 19000, capturedCount: 2, scrollHeight: 1000 }),
            state,
        );
        expect(result.action).toBe('continue');
    });
});

describe('decideNextStep - purity', () => {
    it('does not mutate the observation object', () => {
        const observation = deepFreeze(baseObservation({ nowMs: 500, capturedCount: 2, scrollHeight: 1000 }));
        const state = createInitialState(baseObservation({ nowMs: 0, capturedCount: 0, scrollHeight: 1000 }));
        expect(() => decideNextStep(observation, state)).not.toThrow();
    });

    it('does not mutate the state object', () => {
        const state = deepFreeze(createInitialState(baseObservation({ nowMs: 0, capturedCount: 0, scrollHeight: 1000 })));
        const observation = baseObservation({ nowMs: 500, capturedCount: 2, scrollHeight: 1000 });
        expect(() => decideNextStep(observation, state)).not.toThrow();
    });

    it('leaves both inputs deep-equal to their pre-call snapshot after the call', () => {
        const observation = baseObservation({ nowMs: 500, capturedCount: 2, scrollHeight: 1000 });
        const state = createInitialState(baseObservation({ nowMs: 0, capturedCount: 0, scrollHeight: 1000 }));

        const observationSnapshot = JSON.parse(JSON.stringify(observation));
        const stateSnapshot = JSON.parse(JSON.stringify(state));

        decideNextStep(observation, state);

        expect(observation).toEqual(observationSnapshot);
        expect(state).toEqual(stateSnapshot);
    });
});

describe('decideNextStep - no total-elapsed-time cap (the removed 120s bug, explicitly)', () => {
    it('keeps returning continue past nowMs=600000 as long as progress keeps being made', () => {
        let state = createInitialState(baseObservation({ nowMs: 0, capturedCount: 0, scrollHeight: 1000 }));
        let capturedCount = 0;
        let nowMs = 0;

        while (nowMs <= 650000) {
            nowMs += 500;
            capturedCount += 1;
            const result = decideNextStep(
                baseObservation({ nowMs, capturedCount, scrollHeight: 1000 + capturedCount }),
                state,
            );
            expect(result.action).toBe('continue');
            expect(result.reason).toBeNull();
            state = result.state;
        }
    });
});

describe('describeIncompleteReason', () => {
    it('stalled maps to the exact stall sentence', () => {
        expect(describeIncompleteReason('stalled')).toBe(
            'the conversation stopped loading new messages before the end was reached',
        );
    });

    it('scroll_interrupted maps to the exact scroll-interruption sentence', () => {
        expect(describeIncompleteReason('scroll_interrupted')).toBe(
            'the page was scrolled by something else during the export',
        );
    });

    it('cancelled maps to the exact cancellation sentence', () => {
        expect(describeIncompleteReason('cancelled')).toBe('the export was cancelled');
    });

    it('no_container maps to the exact missing-container sentence', () => {
        expect(describeIncompleteReason('no_container')).toBe(
            'the conversation scroll container could not be found',
        );
    });

    it('no_messages maps to the exact no-messages sentence', () => {
        expect(describeIncompleteReason('no_messages')).toBe('no messages were found in the conversation');
    });

    it('an unrecognized reason still produces a diagnosable fallback containing the raw reason', () => {
        const result = describeIncompleteReason('weird_reason');
        expect(typeof result).toBe('string');
        expect(result.includes('weird_reason')).toBe(true);
    });

    it('null produces a non-empty generic fallback without the literal words null or undefined', () => {
        const result = describeIncompleteReason(null);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result.toLowerCase().includes('null')).toBe(false);
        expect(result.toLowerCase().includes('undefined')).toBe(false);
    });

    it('undefined produces a non-empty generic fallback without the literal words null or undefined', () => {
        const result = describeIncompleteReason(undefined);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result.toLowerCase().includes('null')).toBe(false);
        expect(result.toLowerCase().includes('undefined')).toBe(false);
    });

    it('empty string produces a non-empty generic fallback without the literal words null or undefined', () => {
        const result = describeIncompleteReason('');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result.toLowerCase().includes('null')).toBe(false);
        expect(result.toLowerCase().includes('undefined')).toBe(false);
    });

    it('complete does not throw and returns a non-empty string', () => {
        expect(() => describeIncompleteReason('complete')).not.toThrow();
        const result = describeIncompleteReason('complete');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });
});
