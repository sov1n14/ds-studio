/**
 * Mobile Sidebar Swipe - Mutant Killer Tests (round 2)
 *
 * Targets survivors from the round-1 Stryker run: touchend-time guards (enabled, mobile device, trigger zone evaluated at release), primary-selector precedence in _findButton, loading the button part without the DSstudio selector registry, and the part-file publication contract (globalThis registration + CommonJS export).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';

const PARTS = [
    { file: 'button', method: '_findButton' },
    { file: 'gesture', method: '_onTouchEnd' },
    { file: 'bind', method: '_bindTouchEvents' },
    { file: 'lifecycle', method: 'start' },
];

let Swipe;

function stubMobileNavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 2, userAgent: 'Chrome Desktop' });
}

function stubDesktopNavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Chrome Desktop' });
}

function setViewport(width, height) {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', height);
}

async function load() {
    vi.resetModules();
    await import('../../content/mobile-device.js');
    await import('../../content/retry-until.js');
    await import('../../content/feature-toggle.js');
    await import('../../content/mobile-sidebar-swipe.button.js');
    await import('../../content/mobile-sidebar-swipe.gesture.js');
    await import('../../content/mobile-sidebar-swipe.bind.js');
    await import('../../content/mobile-sidebar-swipe.lifecycle.js');
    const mod = await import('../../content/mobile-sidebar-swipe.js');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return mod.default ?? mod;
}

function addButton(tag, className, withRole) {
    const el = document.createElement(tag);
    el.className = className;
    if (withRole) el.setAttribute('role', 'button');
    document.body.appendChild(el);
    return el;
}

function createOpenButton() {
    return addButton('div', 'ds-button--capsule ds-button--iconLabelPrimary', true);
}

function createCloseButton() {
    const el = addButton('div', 'ds-button--capsule ds-button--iconLabelTertiary', true);
    el.innerHTML = '<svg><path fill-rule="evenodd"></path></svg>';
    return el;
}

function countClicks(el) {
    const counter = { count: 0 };
    el.addEventListener('click', () => { counter.count += 1; });
    return counter;
}

function swipe(from, to) {
    Swipe._onTouchStart({ touches: [{ clientX: from.x, clientY: from.y }] });
    Swipe._onTouchMove({ touches: [{ clientX: to.x, clientY: to.y }] });
    Swipe._onTouchEnd();
}

beforeEach(async () => {
    document.body.innerHTML = '';
    chrome.runtime.onMessage = { addListener: () => {}, removeListener: () => {}, hasListener: () => false };
    chrome.runtime.sendMessage = vi.fn((_msg, cb) => {
        const response = { ok: true, values: { isEnabled: false } };
        if (typeof cb === 'function') cb(response);
        return Promise.resolve(response);
    });
    stubMobileNavigator();
    Swipe = await load();
    Swipe.enabled = true;
    setViewport(1000, 800);
});

afterEach(() => {
    if (Swipe) {
        Swipe.destroy();
        Swipe._unbindTouchEvents();
        Swipe = null;
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// Viewport 1000x800 with a 10% margin: trigger zone is x in [100, 900], y in [80, 720], inclusive.

describe('touchend re-checks the gating conditions at release time', () => {
    it('does not open the sidebar when the feature is disabled mid-gesture', () => {
        const open = countClicks(createOpenButton());
        Swipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        Swipe._onTouchMove({ touches: [{ clientX: 420, clientY: 400 }] });
        Swipe.enabled = false;
        Swipe._onTouchEnd();
        expect(open.count).toBe(0);
    });

    it('does not open the sidebar when the device stops qualifying as mobile mid-gesture', () => {
        const open = countClicks(createOpenButton());
        Swipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        Swipe._onTouchMove({ touches: [{ clientX: 420, clientY: 400 }] });
        stubDesktopNavigator();
        Swipe._onTouchEnd();
        expect(open.count).toBe(0);
    });
});

describe('touchend trigger-zone boundaries are inclusive', () => {
    it('opens the sidebar for a right swipe starting exactly on the left zone edge (x=100)', () => {
        const open = countClicks(createOpenButton());
        swipe({ x: 100, y: 400 }, { x: 200, y: 400 });
        expect(open.count).toBe(1);
    });

    it('closes the sidebar for a left swipe starting exactly on the right zone edge (x=900)', () => {
        const close = countClicks(createCloseButton());
        swipe({ x: 900, y: 400 }, { x: 800, y: 400 });
        expect(close.count).toBe(1);
    });

    it('opens the sidebar for a right swipe starting exactly on the top zone edge (y=80)', () => {
        const open = countClicks(createOpenButton());
        swipe({ x: 300, y: 80 }, { x: 400, y: 80 });
        expect(open.count).toBe(1);
    });

    it('opens the sidebar for a right swipe starting exactly on the bottom zone edge (y=720)', () => {
        const open = countClicks(createOpenButton());
        swipe({ x: 300, y: 720 }, { x: 400, y: 720 });
        expect(open.count).toBe(1);
    });
});

describe('touchend evaluates the trigger zone against the viewport at release', () => {
    it('ignores the swipe when a widened viewport puts the start point left of the zone', () => {
        const open = countClicks(createOpenButton());
        Swipe._onTouchStart({ touches: [{ clientX: 150, clientY: 400 }] });
        Swipe._onTouchMove({ touches: [{ clientX: 270, clientY: 400 }] });
        setViewport(2000, 800); // zone x becomes [200, 1800]
        Swipe._onTouchEnd();
        expect(open.count).toBe(0);
    });

    it('ignores the swipe when a taller viewport puts the start point above the zone', () => {
        const open = countClicks(createOpenButton());
        Swipe._onTouchStart({ touches: [{ clientX: 300, clientY: 100 }] });
        Swipe._onTouchMove({ touches: [{ clientX: 420, clientY: 100 }] });
        setViewport(1000, 1200); // zone y becomes [120, 1080]
        Swipe._onTouchEnd();
        expect(open.count).toBe(0);
    });
});

describe('_findButton prefers the primary selector over DOM-order fallbacks', () => {
    it('opens via the div[role=button] toggle even when a role-less look-alike precedes it', () => {
        // The look-alike matches the class-only fallback but not the primary div[role="button"] selector.
        const lookAlike = countClicks(addButton('span', 'ds-button--capsule ds-button--iconLabelPrimary', false));
        const toggle = countClicks(createOpenButton());
        swipe({ x: 300, y: 400 }, { x: 420, y: 400 });
        expect(toggle.count).toBe(1);
        expect(lookAlike.count).toBe(0);
    });
});

describe('button part without the DSstudio selector registry', () => {
    it('loads without throwing and finds no button', async () => {
        const saved = window.DSstudio;
        delete window.DSstudio;
        delete globalThis.__DS_MobileSidebarSwipe_button;
        try {
            vi.resetModules();
            await expect(import('../../content/mobile-sidebar-swipe.button.js')).resolves.toBeDefined();
            createOpenButton();
            expect(globalThis.__DS_MobileSidebarSwipe_button._findButton()).toBeNull();
        } finally {
            window.DSstudio = saved;
        }
    });
});

describe('part files publish their bundle for both loaders', () => {
    for (const { file, method } of PARTS) {
        const globalName = '__DS_MobileSidebarSwipe_' + file;

        it(file + ' registers ' + globalName + ' on globalThis (manifest loader)', async () => {
            delete globalThis[globalName];
            vi.resetModules();
            await import('../../content/mobile-sidebar-swipe.' + file + '.js');
            expect(typeof globalThis[globalName]?.[method]).toBe('function');
        });

        it(file + ' exports its bundle via module.exports (Node require loader)', async () => {
            vi.resetModules();
            const mod = await import('../../content/mobile-sidebar-swipe.' + file + '.js');
            expect(typeof (mod.default ?? mod)[method]).toBe('function');
        });
    }
});
