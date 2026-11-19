/**
 * tools/scenario-helpers.mjs submitPrompt — the capture sweep types a prompt the way the E2E suite does (decision: pacing wired into tools/capture.mjs).
 *
 * Requirement (user ruling, 「送出文字改成逐字輸入（原本是一次 fill）」; expected values come from that text and from DSS_E2E_PACE, not from the implementation):
 *   - Pacing on: the prompt reaches the composer as separate key presses in order, a line break as Shift+Enter, and Enter presses once, after the whole text is in.
 *   - A prompt over 200 characters is pasted in one step, as in the E2E suite.
 *   - DSS_E2E_PACE=off: one fill, then Enter.
 * DSS_E2E_PACE=0.0001 keeps typing mode on while every wait rounds to 0 ms, so the spec runs in real time without a fake clock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A composer whose value follows the keys it receives; `sent` holds the value at each Enter. */
function createComposer() {
    const composer = {
        value: '',
        fills: [],
        keys: [],
        sent: [],
        async fill(text) { composer.fills.push(text); composer.value = text; },
        async selectText() { composer.value = ''; },
        async pressSequentially(key) { composer.keys.push(key); composer.value += key; },
        async press(key) {
            composer.keys.push(key);
            if (key === 'Enter') composer.sent.push(composer.value);
            else if (key === 'Shift+Enter') composer.value += '\n';
        },
        first: () => composer,
    };
    return composer;
}

async function submitWithPace(pace, text) {
    vi.resetModules();
    vi.stubEnv('DSS_E2E_PACE', pace);
    const { submitPrompt } = await import('../../tools/scenario-helpers.mjs');
    const composer = createComposer();
    await submitPrompt({ locator: () => composer }, text);
    return composer;
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('submitPrompt typing', () => {
    it('types the prompt one key at a time in order, then presses Enter once with the full text in the composer', async () => {
        const composer = await submitWithPace('0.0001', 'Say hello');
        expect(composer.keys).toEqual([...'Say hello', 'Enter']);
        expect(composer.sent).toEqual(['Say hello']);
        expect(composer.fills).toEqual([]);
    });

    it('types a line break as Shift+Enter and sends only once, at the end', async () => {
        const composer = await submitWithPace('0.0001', 'line one\nline two');
        expect(composer.keys.filter((key) => key === 'Enter')).toHaveLength(1);
        expect(composer.keys.at(-1)).toBe('Enter');
        expect(composer.keys).toContain('Shift+Enter');
        expect(composer.sent).toEqual(['line one\nline two']);
    });

    it('pastes a prompt over 200 characters in one fill', async () => {
        const longText = 'x'.repeat(201);
        const composer = await submitWithPace('0.0001', longText);
        expect(composer.fills).toEqual([longText]);
        expect(composer.keys).toEqual(['Enter']);
        expect(composer.sent).toEqual([longText]);
    });

    it('fills in one step and presses Enter when DSS_E2E_PACE is off', async () => {
        const composer = await submitWithPace('off', 'Say hello');
        expect(composer.fills).toEqual(['Say hello']);
        expect(composer.keys).toEqual(['Enter']);
        expect(composer.sent).toEqual(['Say hello']);
    });
});
