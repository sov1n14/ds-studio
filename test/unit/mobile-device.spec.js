/**
 * content/mobile-device.js — shared mobile-device detection contract.
 *
 * Contract source (the three duplicate implementations this helper replaces —
 * verified identical in expression, only the function name differs):
 *   - content/mobile-homepage-cleanup.js:27-30      `_isMobileDevice()`
 *   - content/mobile-sidebar-swipe.js:48-51         `_isMobileDevice()`
 *   - content/prompt-injector.controller.js:119-121 `isMobileDevice()`
 *
 * All three evaluate exactly:
 *   navigator.maxTouchPoints > 0 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
 *
 * So the contract is: touch-capable OR a mobile user-agent token. Viewport size
 * is NOT an input to the existing behavior and MUST NOT become one here.
 *
 * Requirement: publish `globalThis.DSSMobileDevice.isMobileDevice()` with that
 * behavior, as a classic script whose only load-time effect is the global
 * assignment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../content/mobile-device.js';

/** Replace the whole navigator so the two inputs are the only inputs. */
function stubNavigator(maxTouchPoints, userAgent) {
    vi.stubGlobal('navigator', { maxTouchPoints, userAgent });
}

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36';

let isMobileDevice;

beforeEach(() => {
    isMobileDevice = globalThis.DSSMobileDevice.isMobileDevice;
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('content/mobile-device.js — module surface', () => {
    it('publishes isMobileDevice on globalThis.DSSMobileDevice', () => {
        expect(globalThis.DSSMobileDevice).toBeTypeOf('object');
        expect(globalThis.DSSMobileDevice.isMobileDevice).toBeTypeOf('function');
    });
});

describe('isMobileDevice() — touch capability branch', () => {
    it('is true for a touch-capable device even with a desktop user agent', () => {
        stubNavigator(2, DESKTOP_UA);
        expect(isMobileDevice()).toBe(true);
    });

    it('is false when maxTouchPoints is 0 and the user agent is desktop', () => {
        stubNavigator(0, DESKTOP_UA);
        expect(isMobileDevice()).toBe(false);
    });

    it('is false when maxTouchPoints is absent and the user agent is desktop', () => {
        stubNavigator(undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36');
        expect(isMobileDevice()).toBe(false);
    });
});

describe('isMobileDevice() — user agent branch', () => {
    const mobileAgents = {
        'Mobi token': 'Mozilla/5.0 (Linux; U) AppleWebKit/537.36 Mobi Safari/537.36',
        Android: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120.0.0.0 Mobile Safari/537.36',
        iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/604.1',
        iPad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Safari/604.1',
    };

    for (const [label, userAgent] of Object.entries(mobileAgents)) {
        it(`is true for a ${label} user agent with no touch points (DevTools emulation)`, () => {
            stubNavigator(0, userAgent);
            expect(isMobileDevice()).toBe(true);
        });
    }

    it('matches the user agent case-insensitively', () => {
        stubNavigator(0, 'SOMETHING/1.0 ANDROID 13');
        expect(isMobileDevice()).toBe(true);
    });

    it('inherits the loose "Mobi" substring match of the three source copies', () => {
        // "Automobiles" contains "Mobi", so the existing regex matches it. This
        // documents the inherited behavior; the helper must not tighten it.
        stubNavigator(0, 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36 Automobiles');
        expect(isMobileDevice()).toBe(true);
    });
});

describe('isMobileDevice() — viewport is deliberately not an input', () => {
    it('is false for a narrow viewport with no touch support and no mobile UA', () => {
        stubNavigator(0, DESKTOP_UA);
        vi.stubGlobal('innerWidth', 375);
        vi.stubGlobal('innerHeight', 667);
        expect(isMobileDevice()).toBe(false);
    });

    it('returns a strict boolean, not merely a truthy value', () => {
        stubNavigator(5, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
        expect(isMobileDevice()).toBe(true);
    });
});
