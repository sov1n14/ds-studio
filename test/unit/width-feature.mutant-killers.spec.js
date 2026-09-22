/**
 * content/width-feature.js - Mutant-killer tests.
 * Targeted tests to kill Stryker mutants that survived the main spec.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';

const MASTER_KEY = 'isEnabled';
const ENABLED_KEY = 'isTestWidthEnabled';
const PERCENT_KEY = 'testWidth';
const EXTRA_KEY = 'otherWidth';
const EXTRA_ENABLED_KEY = 'isOtherWidthEnabled';
const STYLE_ID = 'ds-test-width-style';
const UNRELATED_KEY = 'isHideThinkingEnabled';

/** Debounce inside setupMutationObserver is 200ms; wait past it. */
const OBSERVER_SETTLE_MS = 260;

/**
 * Fresh chrome.runtime.onMessage stub (same shape as the shared mock) plus a
 * listener count, so "the listener is gone after destroy" is checkable.
 */
function createOnMessageStub() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        callListeners: (...args) => [...listeners].forEach((fn) => fn(...args)),
        listenerCount: () => listeners.size,
    };
}

let onMessage;
let sendMessage;
let create;

/** Queue the values every GET_SETTINGS round trip resolves with. */
function respondWith(values) {
    sendMessage.mockImplementation((_message, callback) => {
        const response = { ok: true, values };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

/** Let the pending sendMessage promise chains settle. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Storage-change payload shape: { key: { oldValue, newValue } }. */
function change(key, newValue, oldValue) {
    return { [key]: { oldValue, newValue } };
}

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
function broadcast(changes, area = 'local') {
    onMessage.callListeners(
        { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes },
        { id: 'test-extension-id' },
        () => {},
    );
}

const styleTag = () => document.getElementById(STYLE_ID);
const styleText = () => styleTag()?.textContent;

/** Minimal valid config; CSS carries the percent so DOM assertions are exact. */
function makeFeature(overrides = {}) {
    return create({
        STYLE_ID,
        ENABLED_KEY,
        PERCENT_KEY,
        WATCH_KEYS: [EXTRA_KEY, EXTRA_ENABLED_KEY],
        getCSS(percent) {
            return `.ds-test { max-width: ${percent}vw; }`;
        },
        ...overrides,
    });
}

let started = [];

/** Build, start and settle a feature; tracked so afterEach tears it down. */
async function trackedStart(overrides) {
    const feature = makeFeature(overrides);
    await feature.start();
    await flush();
    started.push(feature);
    return feature;
}

beforeEach(async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;
    respondWith({ [MASTER_KEY]: true, [ENABLED_KEY]: true, [PERCENT_KEY]: 55 });

    // Fresh feature-toggle instance per test: its shared onMessage listener and
    // its registry are module state, and must attach to this test's stub.
    vi.resetModules();
    await import('../../content/feature-toggle.js');
    await import('../../content/width-feature.js');
    create = globalThis.DSSWidthFeature.create;
    started = [];
});

afterEach(() => {
    started.forEach((feature) => feature.destroy());
    vi.restoreAllMocks();
});

// -- removeStyles: mutant empties else-branch of applyWidth
describe('applyWidth while disabled removes existing style tag', () => {
    it('removes a leftover style tag when enabled is false', async () => {
        const feature = await trackedStart();
        expect(styleTag()).not.toBeNull();
        feature.enabled = false;
        // applyWidth while disabled must remove the existing style tag
        feature.applyWidth(50);
        expect(styleTag()).toBeNull();
    });
});

describe('setupMutationObserver disconnects previous observer', () => {
    it('disconnects existing observer before creating new one', async () => {
        const feature = await trackedStart();
        const firstObserver = feature.mutationObserver;
        const disconnectSpy = vi.spyOn(firstObserver, 'disconnect');
        feature.setupMutationObserver();
        expect(disconnectSpy).toHaveBeenCalled();
        expect(feature.mutationObserver).not.toBe(firstObserver);
    });
});

describe('MutationObserver debounce resets timer on rapid mutations', () => {
    it('debounces rapid mutations into a single re-injection', async () => {
        const feature = await trackedStart();
        let callCount = 0;
        const originalGetCSS = feature.getCSS;
        feature.getCSS = function (p) { callCount++; return originalGetCSS.call(this, p); };
        callCount = 0;
        document.body.appendChild(document.createElement('div'));
        document.body.appendChild(document.createElement('span'));
        document.body.appendChild(document.createElement('p'));
        await new Promise((resolve) => setTimeout(resolve, OBSERVER_SETTLE_MS));
        expect(callCount).toBe(1);
    });
});

describe('MutationObserver callback does not inject when disabled', () => {
    it('observer callback skips injection after feature.enabled set to false', async () => {
        const feature = await trackedStart();
        expect(styleTag()).not.toBeNull();
        feature.enabled = false;
        feature.removeStyles();
        document.body.appendChild(document.createElement('div'));
        await new Promise((resolve) => setTimeout(resolve, OBSERVER_SETTLE_MS));
        expect(styleTag()).toBeNull();
    });
});

describe('enable() percent fallback', () => {
    it('uses stored percent when called with no argument', () => {
        const feature = makeFeature();
        feature.percent = 60;
        feature.enable();
        expect(styleText()).toBe('.ds-test { max-width: 60vw; }');
        started.push(feature);
    });

    it('uses provided percent when called with a truthy value', () => {
        const feature = makeFeature();
        feature.percent = 60;
        feature.enable(80);
        expect(styleText()).toBe('.ds-test { max-width: 80vw; }');
        started.push(feature);
    });
});

describe('disable() sets enabled to false', () => {
    it('feature.enabled is false after disable()', async () => {
        const feature = await trackedStart();
        expect(feature.enabled).toBe(true);
        feature.disable();
        expect(feature.enabled).toBe(false);
    });
});

describe('disable() clears pending applyTimer', () => {
    it('applyTimer is null after disable even with pending timer', async () => {
        const feature = await trackedStart();
        document.body.appendChild(document.createElement('div'));
        // Wait a tick for the MutationObserver callback to fire and set applyTimer
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(feature.applyTimer).not.toBeNull();
        feature.disable();
        expect(feature.applyTimer).toBeNull();
    });
});

describe('disable() disconnects and nulls the mutationObserver', () => {
    it('mutationObserver is null after disable()', async () => {
        const feature = await trackedStart();
        expect(feature.mutationObserver).not.toBeNull();
        feature.disable();
        expect(feature.mutationObserver).toBeNull();
    });
});

describe('destroy() cleans up _unregisterToggle', () => {
    it('_unregisterToggle is null after destroy', async () => {
        const feature = await trackedStart();
        expect(feature._unregisterToggle).not.toBeNull();
        feature.destroy();
        expect(feature._unregisterToggle).toBeNull();
    });
});

describe('destroy() removes message listener', () => {
    it('_messageListener is null and count drops after destroy', async () => {
        const feature = await trackedStart();
        expect(feature._messageListener).not.toBeNull();
        const countBefore = onMessage.listenerCount();
        feature.destroy();
        expect(feature._messageListener).toBeNull();
        expect(onMessage.listenerCount()).toBe(countBefore - 1);
    });
});

describe('_handleSettingsChanged rejects malformed messages', () => {
    it('ignores a null message without crashing', async () => {
        await trackedStart();
        onMessage.callListeners(null, {}, () => {});
        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
    });

    it('ignores a message without type field', async () => {
        await trackedStart();
        onMessage.callListeners({ area: 'local', changes: change(PERCENT_KEY, 99, 55) }, {}, () => {});
        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
    });
});

describe('_handleSettingsChanged tolerates null change entries', () => {
    it('does not crash when a change entry is null', async () => {
        await trackedStart();
        onMessage.callListeners(
            { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area: 'local', changes: { [PERCENT_KEY]: null } },
            {},
            () => {},
        );
        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
    });
});

describe('_handleSettingsChanged does not applyWidth when disabled', () => {
    it('style tag stays absent when percent changes while disabled', async () => {
        respondWith({ [MASTER_KEY]: true, [ENABLED_KEY]: false, [PERCENT_KEY]: 55 });
        const feature = await trackedStart();
        expect(styleTag()).toBeNull();
        broadcast(change(PERCENT_KEY, 40, 55));
        expect(styleTag()).toBeNull();
        expect(feature.percent).toBe(40);
    });
});

describe('start() handles bad GET_SETTINGS responses', () => {
    it('does not inject when response.ok is false', async () => {
        sendMessage.mockResolvedValue({ ok: false, error: 'fail' });
        const feature = makeFeature();
        await feature.start();
        await flush();
        expect(styleTag()).toBeNull();
        started.push(feature);
    });

    it('does not throw when response is null', async () => {
        sendMessage.mockResolvedValue(null);
        const feature = makeFeature();
        await feature.start();
        await flush();
        expect(styleTag()).toBeNull();
        started.push(feature);
    });
});

describe('create() validates each config field independently', () => {
    it('throws when config is null', () => {
        expect(() => create(null)).toThrow();
    });

    it('throws when config is a string', () => {
        expect(() => create('not-an-object')).toThrow();
    });

    it('throws when STYLE_ID is empty string', () => {
        expect(() => create({ STYLE_ID: '', ENABLED_KEY, PERCENT_KEY, getCSS: () => '' })).toThrow(/STYLE_ID/);
    });

    it('throws when ENABLED_KEY is empty string', () => {
        expect(() => create({ STYLE_ID, ENABLED_KEY: '', PERCENT_KEY, getCSS: () => '' })).toThrow(/ENABLED_KEY/);
    });

    it('throws when PERCENT_KEY is empty string', () => {
        expect(() => create({ STYLE_ID, ENABLED_KEY, PERCENT_KEY: '', getCSS: () => '' })).toThrow(/PERCENT_KEY/);
    });

    it('throws when STYLE_ID is a number', () => {
        expect(() => create({ STYLE_ID: 42, ENABLED_KEY, PERCENT_KEY, getCSS: () => '' })).toThrow(/STYLE_ID/);
    });

    it('throws when ENABLED_KEY is a number', () => {
        expect(() => create({ STYLE_ID, ENABLED_KEY: 42, PERCENT_KEY, getCSS: () => '' })).toThrow(/ENABLED_KEY/);
    });

    it('throws when PERCENT_KEY is a number', () => {
        expect(() => create({ STYLE_ID, ENABLED_KEY, PERCENT_KEY: 42, getCSS: () => '' })).toThrow(/PERCENT_KEY/);
    });
});

describe('clampPercent', () => {
    it('clamps below MIN to MIN', () => {
        const feature = makeFeature({ MIN: 30, MAX: 100 });
        expect(feature.clampPercent(10)).toBe(30);
    });

    it('clamps above MAX to MAX', () => {
        const feature = makeFeature({ MIN: 30, MAX: 100 });
        expect(feature.clampPercent(150)).toBe(100);
    });

    it('passes through a mid-range value', () => {
        const feature = makeFeature({ MIN: 30, MAX: 100 });
        expect(feature.clampPercent(50)).toBe(50);
    });
});

describe('getWatchedKeys', () => {
    it('includes PERCENT_KEY and all WATCH_KEYS', () => {
        const feature = makeFeature({ WATCH_KEYS: ['a', 'b'] });
        expect(feature.getWatchedKeys()).toEqual([PERCENT_KEY, 'a', 'b']);
    });

    it('returns only PERCENT_KEY when no WATCH_KEYS', () => {
        const feature = create({ STYLE_ID, ENABLED_KEY, PERCENT_KEY, getCSS: () => '' });
        expect(feature.getWatchedKeys()).toEqual([PERCENT_KEY]);
    });
});

describe('shared defaults', () => {
    it('defaults MIN to 30 and MAX to 100', () => {
        const feature = makeFeature();
        expect(feature.MIN).toBe(30);
        expect(feature.MAX).toBe(100);
    });

    it('defaults WATCH_KEYS to empty array', () => {
        const feature = create({ STYLE_ID, ENABLED_KEY, PERCENT_KEY, getCSS: () => '' });
        expect(feature.WATCH_KEYS).toEqual([]);
    });

    it('defaults enabled to false and percent to 70', () => {
        const feature = makeFeature();
        expect(feature.enabled).toBe(false);
        expect(feature.percent).toBe(70);
    });
});

describe('_applyValues only updates percent for numeric values', () => {
    it('does not update percent when value is a string', async () => {
        await trackedStart();
        broadcast({ [PERCENT_KEY]: { oldValue: 55, newValue: 'not-a-number' } });
        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
    });
});

describe('module.exports', () => {
    it('DSSWidthFeature.create is available on globalThis', () => {
        expect(typeof globalThis.DSSWidthFeature.create).toBe('function');
    });
});
