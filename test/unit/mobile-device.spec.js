/**
 * content/mobile-device.js — shared mobile-device detection contract.
 *
 * Mobile means form factor, read from the user agent, not reported touch points: a desktop UA that reports touch points is a desktop and keeps Enter-to-send prefix injection. Touchscreen laptops, pen devices, and touch-injecting software all report them; the bug-report machine is a Windows desktop with no touch hardware (desktop Edge UA) that reports maxTouchPoints 10, most likely via an Android emulator's touch-injection service. Touch points count only for iPadOS in desktop mode, which reports a Mac UA with platform 'MacIntel' and maxTouchPoints > 1 (a real Mac reports 0).
 *
 * Contract:
 *   - UA contains Android / iPhone / iPad / Mobi (case-insensitive) → true, any maxTouchPoints
 *   - Mac UA + platform 'MacIntel' + maxTouchPoints > 1 → true (iPadOS desktop mode)
 *   - any other desktop UA → false, whatever maxTouchPoints is
 *   - viewport size is not an input
 *
 * Published as `globalThis.DSSMobileDevice.isMobileDevice()` from a classic script whose only load-time effect is the global assignment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../content/mobile-device.js';

/** Replace the whole navigator so the listed fields are the only inputs. */
function stubNavigator(maxTouchPoints, userAgent, platform = '') {
    vi.stubGlobal('navigator', { maxTouchPoints, userAgent, platform });
}

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36';
// Exact UA from the bug-report runtime log: a Windows desktop with no touch hardware that reports maxTouchPoints 10.
const WINDOWS_TOUCH_EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';
// Safari UA reported by both a real Mac and iPadOS in desktop mode.
const MAC_SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

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

describe('isMobileDevice() — reported touch points alone do not make a desktop mobile', () => {
    it('is false for the Windows desktop from the bug report that reports touch points (Edge UA, maxTouchPoints 10)', () => {
        stubNavigator(10, WINDOWS_TOUCH_EDGE_UA, 'Win32');
        expect(isMobileDevice(), 'a Windows desktop that reports touch points is a desktop form factor').toBe(false);
    });

    it('is false for a desktop user agent with maxTouchPoints 2', () => {
        stubNavigator(2, DESKTOP_UA, 'Win32');
        expect(isMobileDevice()).toBe(false);
    });

    it('is false for a desktop user agent with maxTouchPoints 1', () => {
        stubNavigator(1, DESKTOP_UA, 'Win32');
        expect(isMobileDevice()).toBe(false);
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

describe('isMobileDevice() — iPadOS desktop mode (Mac UA + MacIntel + touch)', () => {
    it('is true for a Mac Safari UA on platform MacIntel with maxTouchPoints 5 (iPad requesting the desktop site)', () => {
        stubNavigator(5, MAC_SAFARI_UA, 'MacIntel');
        expect(isMobileDevice(), 'iPadOS desktop mode is identified by touch on a MacIntel platform').toBe(true);
    });

    it('is false for the same Mac Safari UA on platform MacIntel with maxTouchPoints 0 (a real Mac)', () => {
        stubNavigator(0, MAC_SAFARI_UA, 'MacIntel');
        expect(isMobileDevice()).toBe(false);
    });

    it('is false for the same Mac Safari UA on platform MacIntel with maxTouchPoints 1 (the iPadOS cutoff is more than one touch point)', () => {
        stubNavigator(1, MAC_SAFARI_UA, 'MacIntel');
        expect(isMobileDevice(), 'a single touch point on a MacIntel platform is not treated as an iPad').toBe(false);
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

        it(`is true for a ${label} user agent with touch points`, () => {
            stubNavigator(5, userAgent);
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

    it('is false for a narrow viewport on a Windows desktop that reports touch points', () => {
        stubNavigator(10, WINDOWS_TOUCH_EDGE_UA, 'Win32');
        vi.stubGlobal('innerWidth', 375);
        vi.stubGlobal('innerHeight', 667);
        expect(isMobileDevice()).toBe(false);
    });

    it('returns a strict boolean, not merely a truthy value', () => {
        stubNavigator(5, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
        expect(isMobileDevice()).toBe(true);
    });
});

// The top-of-file import runs at collection time, which Stryker (ignoreStatic) counts as static coverage, and the global it publishes survives any later re-import. This test therefore deletes the global and evaluates the script inside the test body, so an empty module body is observable.
describe('content/mobile-device.js — a fresh load publishes a working detector', () => {
    it('publishes globalThis.DSSMobileDevice.isMobileDevice, which classifies an Android phone as mobile and the bug-report Windows desktop as desktop', async () => {
        delete globalThis.DSSMobileDevice;
        expect(globalThis.DSSMobileDevice, 'precondition: no detector is published before the fresh load').toBeUndefined();
        vi.resetModules();
        await import('../../content/mobile-device.js');

        const detect = globalThis.DSSMobileDevice?.isMobileDevice;
        expect(detect, 'loading the script must publish isMobileDevice on globalThis.DSSMobileDevice').toBeTypeOf('function');
        stubNavigator(5, 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36', 'Linux armv81');
        expect(detect(), 'an Android phone is a mobile device').toBe(true);
        stubNavigator(10, WINDOWS_TOUCH_EDGE_UA, 'Win32');
        expect(detect(), 'the bug-report Windows desktop that reports touch points is not a mobile device').toBe(false);
    });
});
