/**
 * content/react-click-bridge.main.js carries a defensive guard against being evaluated twice in the same window: however many times the script runs, one dss:react-click must still produce exactly one onClick call on a guarded button, not one per evaluation.
 *
 * Own spec file: the bridge listens on `document`, which survives vi.resetModules, and both evaluations must happen inside the test body on a window no other test has touched (vitest isolates each spec file). The harness loadBridge() is deliberately not used here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CONTINUE_MARKUP, mount, clickSpy, guardButton } from '../helpers/auto-click-harness.js';

const reactClick = (el) => el.dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true }));
const continueEl = () => document.querySelector('[data-fixture="continue"]');

async function evaluateBridge() {
    vi.resetModules();
    await import('../../content/react-click-bridge.main.js');
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('bridge re-injection', () => {
    it('evaluated twice, the bridge activates a guarded button exactly once per dss:react-click', async () => {
        mount(CONTINUE_MARKUP);
        const clicked = clickSpy('continue');
        reactClick(continueEl());
        expect(clicked, 'precondition: no bridge is installed in this window yet').toHaveBeenCalledTimes(0);

        await evaluateBridge();
        await evaluateBridge();
        mount(CONTINUE_MARKUP);
        const activated = guardButton('continue');

        reactClick(continueEl());

        expect(activated, 'activations after one dss:react-click with the bridge evaluated twice').toHaveBeenCalledTimes(1);
    });
});
