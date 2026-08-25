/**
 * content/width-feature.js — DSSWidthFeature.create lifecycle behavior.
 *
 * Post-implementation coverage (DOM-adapter layer): the two consumer specs
 * (chat-width.css.spec.js, input-width.css.spec.js) only exercise getCSS()
 * output. This spec covers the factory's own observable behavior: what ends up
 * in the DOM (the injected style tag and its textContent), what the feature
 * records from settings broadcasts, and what stops happening after disable /
 * destroy.
 *
 * Everything is asserted through DOM state or through the config seams the
 * factory calls back into (onValues / getEffectivePercent) -- never by
 * inspecting internal call sequences.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/settings-message-constants.js';

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

describe('DSSWidthFeature.create — config validation', () => {
    it('throws naming STYLE_ID when it is missing', () => {
        expect(() => create({ ENABLED_KEY, PERCENT_KEY, getCSS: () => '' })).toThrow(/STYLE_ID/);
    });

    it('throws naming PERCENT_KEY when it is missing', () => {
        expect(() => create({ STYLE_ID, ENABLED_KEY, getCSS: () => '' })).toThrow(/PERCENT_KEY/);
    });

    it('throws naming ENABLED_KEY when it is missing', () => {
        expect(() => create({ STYLE_ID, PERCENT_KEY, getCSS: () => '' })).toThrow(/ENABLED_KEY/);
    });

    it('throws naming getCSS when it is not a function', () => {
        expect(() => create({ STYLE_ID, ENABLED_KEY, PERCENT_KEY, getCSS: 'nope' })).toThrow(/getCSS/);
    });

    it('throws when no config object is passed at all', () => {
        expect(() => create()).toThrow();
    });
});

describe('DSSWidthFeature — start()', () => {
    it('requests the percent key plus every watch key from background', async () => {
        await trackedStart();

        const getCalls = sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === globalThis.DSS_SETTINGS_MSG.GET_SETTINGS
                && message.keys?.includes(PERCENT_KEY));
        expect(getCalls).toHaveLength(1);
        expect(getCalls[0].keys).toEqual([PERCENT_KEY, EXTRA_KEY, EXTRA_ENABLED_KEY]);
    });

    it('injects the style tag with the fetched percent when master and own toggles are on', async () => {
        await trackedStart();

        expect(styleTag()).not.toBeNull();
        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
    });

    it('injects nothing when the master toggle is off', async () => {
        respondWith({ [MASTER_KEY]: false, [ENABLED_KEY]: true, [PERCENT_KEY]: 55 });
        await trackedStart();

        expect(styleTag()).toBeNull();
    });

    it('injects nothing when its own toggle is off', async () => {
        respondWith({ [MASTER_KEY]: true, [ENABLED_KEY]: false, [PERCENT_KEY]: 55 });
        await trackedStart();

        expect(styleTag()).toBeNull();
    });

    it('injects the effective percent, not the raw one, when getEffectivePercent narrows it', async () => {
        respondWith({ [MASTER_KEY]: true, [ENABLED_KEY]: true, [PERCENT_KEY]: 70, [EXTRA_KEY]: 40 });
        await trackedStart({
            _cap: 100,
            onValues(values) {
                if (Object.prototype.hasOwnProperty.call(values, EXTRA_KEY)) this._cap = values[EXTRA_KEY];
            },
            getEffectivePercent() {
                return Math.min(this.percent, this._cap);
            },
        });

        expect(styleText()).toBe('.ds-test { max-width: 40vw; }');
    });
});

describe('DSSWidthFeature — percent changes via SETTINGS_CHANGED', () => {
    it('re-injects updated CSS while enabled', async () => {
        await trackedStart();
        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');

        broadcast(change(PERCENT_KEY, 40, 55));

        expect(styleText()).toBe('.ds-test { max-width: 40vw; }');
    });

    it('records the value but injects nothing while disabled, and the next enable uses it', async () => {
        respondWith({ [MASTER_KEY]: true, [ENABLED_KEY]: false, [PERCENT_KEY]: 55 });
        await trackedStart();

        broadcast(change(PERCENT_KEY, 40, 55));
        expect(styleTag()).toBeNull();

        broadcast(change(ENABLED_KEY, true, false));

        expect(styleText()).toBe('.ds-test { max-width: 40vw; }');
    });

    it('re-injects with the new cap when a cross-feature watch key changes', async () => {
        respondWith({ [MASTER_KEY]: true, [ENABLED_KEY]: true, [PERCENT_KEY]: 70, [EXTRA_KEY]: 90 });
        await trackedStart({
            _cap: 100,
            onValues(values) {
                if (Object.prototype.hasOwnProperty.call(values, EXTRA_KEY)) this._cap = values[EXTRA_KEY];
            },
            getEffectivePercent() {
                return Math.min(this.percent, this._cap);
            },
        });
        expect(styleText()).toBe('.ds-test { max-width: 70vw; }');

        broadcast(change(EXTRA_KEY, 45, 90));

        expect(styleText()).toBe('.ds-test { max-width: 45vw; }');
    });

    it('ignores a non-numeric percent value and keeps the injected CSS', async () => {
        await trackedStart();

        broadcast(change(PERCENT_KEY, undefined, 55));

        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
    });
});

describe('DSSWidthFeature — onValues seam', () => {
    it('receives the initial GET values and every later change delta', async () => {
        const seen = [];
        respondWith({
            [MASTER_KEY]: true,
            [ENABLED_KEY]: true,
            [PERCENT_KEY]: 55,
            [EXTRA_KEY]: 80,
            [EXTRA_ENABLED_KEY]: true,
        });
        await trackedStart({ onValues(values) { seen.push(values); } });

        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ [PERCENT_KEY]: 55, [EXTRA_KEY]: 80, [EXTRA_ENABLED_KEY]: true });

        broadcast({ ...change(EXTRA_KEY, 45, 80), ...change(EXTRA_ENABLED_KEY, false, true) });

        expect(seen).toHaveLength(2);
        expect(seen[1]).toEqual({ [EXTRA_KEY]: 45, [EXTRA_ENABLED_KEY]: false });
    });

    it('is not called for a change naming none of the watched keys', async () => {
        const seen = [];
        await trackedStart({ onValues(values) { seen.push(values); } });
        seen.length = 0;

        broadcast(change(UNRELATED_KEY, true, false));

        expect(seen).toEqual([]);
    });
});

describe('DSSWidthFeature — disable and re-enable', () => {
    it('removes the style tag and tears the observer down when the master toggle goes off', async () => {
        const feature = await trackedStart();
        expect(styleTag()).not.toBeNull();

        broadcast(change(MASTER_KEY, false, true));

        expect(styleTag()).toBeNull();
        expect(feature.mutationObserver).toBeNull();
        expect(feature.applyTimer).toBeNull();
    });

    it('leaves the DOM alone after disable, so no timer re-arms an injection', async () => {
        await trackedStart();
        broadcast(change(MASTER_KEY, false, true));

        document.body.appendChild(document.createElement('div'));
        await new Promise((resolve) => setTimeout(resolve, OBSERVER_SETTLE_MS));

        expect(styleTag()).toBeNull();
    });

    it('rebuilds an equivalent style tag and a live observer on re-enable', async () => {
        const feature = await trackedStart();
        const freshText = styleText();

        broadcast(change(MASTER_KEY, false, true));
        broadcast(change(MASTER_KEY, true, false));

        expect(styleText()).toBe(freshText);
        expect(feature.mutationObserver).not.toBeNull();

        // The rebuilt observer must restore a style the page removed.
        styleTag().remove();
        document.body.appendChild(document.createElement('div'));
        await new Promise((resolve) => setTimeout(resolve, OBSERVER_SETTLE_MS));

        expect(styleText()).toBe(freshText);
    });

    it('re-enables with the percent that arrived while it was off', async () => {
        await trackedStart();

        broadcast(change(ENABLED_KEY, false, true));
        broadcast(change(PERCENT_KEY, 33, 55));
        broadcast(change(ENABLED_KEY, true, false));

        expect(styleText()).toBe('.ds-test { max-width: 33vw; }');
    });
});

describe('DSSWidthFeature — messages that must change nothing', () => {
    it('ignores a SETTINGS_CHANGED broadcast for the sync area', async () => {
        const seen = [];
        await trackedStart({ onValues(values) { seen.push(values); } });
        seen.length = 0;

        broadcast(change(PERCENT_KEY, 40, 55), 'sync');
        broadcast(change(MASTER_KEY, false, true), 'sync');

        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
        expect(seen).toEqual([]);
    });

    it('ignores a change naming only unrelated keys', async () => {
        await trackedStart();

        broadcast(change(UNRELATED_KEY, false, true));

        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
    });

    it('ignores a message of an unrelated type carrying watched changes', async () => {
        await trackedStart();

        onMessage.callListeners(
            { type: 'DSS_SOMETHING_ELSE', area: 'local', changes: change(PERCENT_KEY, 40, 55) },
            {},
            () => {},
        );

        expect(styleText()).toBe('.ds-test { max-width: 55vw; }');
    });
});

describe('DSSWidthFeature — destroy()', () => {
    it('removes the style tag and its message listener', async () => {
        const feature = await trackedStart();
        const countBefore = onMessage.listenerCount();

        feature.destroy();

        expect(styleTag()).toBeNull();
        expect(onMessage.listenerCount()).toBe(countBefore - 1);
    });

    it('lets no later broadcast touch the DOM again', async () => {
        const feature = await trackedStart();
        feature.destroy();

        broadcast(change(PERCENT_KEY, 40, 55));
        broadcast(change(ENABLED_KEY, true, false));
        broadcast(change(MASTER_KEY, true, true));

        expect(styleTag()).toBeNull();
    });
});
