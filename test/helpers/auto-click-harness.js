/**
 * Shared harness for the auto-click loop (content/auto-retry.js) specs.
 *
 * The loop owns no storage access: feature-toggle.js asks background for the initial values (DSS_GET_SETTINGS) and reacts to DSS_SETTINGS_CHANGED broadcasts. Only chrome.runtime is stubbed; feature-toggle.js, auto-click.delay.js, auto-retry.js and ds-selectors.js are the real modules. feature-toggle keeps its registry and onMessage listener in module scope, so every load uses vi.resetModules + dynamic import bound to the current test's chrome stubs.
 *
 * Success criterion is activation, not a click event. On the live page (observed via DevTools) the retry/continue buttons act only through React's onClick, whose handler requires e.nativeEvent.isTrusted === true && e.nativeEvent instanceof Event; untrusted .click() / synthetic mouse events are ignored. guardButton() models that guard; content/react-click-bridge.main.js (MAIN world in production, same document here) is what lets the loop pass it.
 *
 * Callers MUST enable fake timers before loadAutoClick(): the loop schedules its first round while the initial GET_SETTINGS settles.
 */
import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import '../../utils/message-constants.js';
import '../../content/ds-selectors.js';

export const MASTER_KEY = 'isEnabled';
export const RETRY_KEY = 'isAutoRetryEnabled';
export const CONTINUE_KEY = 'isAutoContinueEnabled';

/** Math.random values and the delay nextDelayMs() derives from them: floor(r * 31) * 100. */
export const R_300 = 0.1;   // floor(3.1)  = 3  -> 300 ms
export const R_1500 = 0.5;  // floor(15.5) = 15 -> 1500 ms
export const R_2500 = 0.81; // floor(25.11) = 25 -> 2500 ms
export const R_2700 = 0.9;  // floor(27.9) = 27 -> 2700 ms

export const selectors = () => window.DSstudio.Selectors;

// ─────────────────────────────────────────────────────────────────────────────
//  DOM fixtures — real DeepSeek markup (retry: existing spec; continue: to-do/samples/continue-generate.html). data-fixture attributes only identify elements for the test; no selector reads them.
// ─────────────────────────────────────────────────────────────────────────────

export const RETRY_MARKUP =
    '<div data-fixture="retry" role="button" class="ds-button ds-button--warning ds-button--filled ds-button--circle ds-button--xs ds-button--icon-relative-m a3b9bd76 _76a2310" tabindex="0"></div>';

export const CONTINUE_MARKUP =
    '<div class="_8e85838"><div data-fixture="continue" role="button" class="ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--capsule ds-button--s ds-button--icon-relative-m ds-button--min-width _6eef0b0" tabindex="0"><div class="ds-button__background"></div><div class="ds-button__border"></div><span class="ds-button__content">继续生成</span></div></div>';

/** Matches only RETRY_BUTTON_FALLBACK_SELECTOR (hashed classes), not the semantic primary. */
export const RETRY_FALLBACK_ONLY_MARKUP =
    '<div data-fixture="retry-fallback" role="button" class="a3b9bd76 _76a2310" tabindex="0"></div>';

/** Matches only CONTINUE_BUTTON_FALLBACK_SELECTOR: hashed class, not a child of ._8e85838. */
export const CONTINUE_FALLBACK_ONLY_MARKUP =
    '<div data-fixture="continue-fallback" role="button" class="ds-button ds-button--outlined _6eef0b0" tabindex="0"><span class="ds-button__content">继续生成</span></div>';

/** Carry the continue button's text but match none of the button selectors. */
export const DECOY_MARKUP =
    '<div data-fixture="decoy-div" role="button" class="ds-button ds-button--outlined" tabindex="0"><span class="ds-button__content">繼續生成</span></div>' +
    '<button data-fixture="decoy-button" type="button">Continue</button>' +
    '<span data-fixture="decoy-span">继续生成</span>';

export function mount(...parts) {
    document.body.innerHTML = parts.join('');
}

function fixture(name) {
    const el = document.querySelector(`[data-fixture="${name}"]`);
    if (!el) throw new Error(`fixture element "${name}" is not mounted`);
    return el;
}

/** Spy on native click events reaching the fixture element `name`. Success signal only for elements with no React props (bridge fallback); otherwise use it for "never touched" assertions. */
export function clickSpy(name) {
    const spy = vi.fn();
    fixture(name).addEventListener('click', spy);
    return spy;
}

let reactKeySeq = 0;

/**
 * Give fixture element `name` the live page's React expandos and guarded onClick. Returns a spy called once per activation — i.e. only when onClick receives an event whose nativeEvent is a trusted Event, as the live handler requires.
 * A native click is delegated to onClick with the native event as nativeEvent, the way React's root listener does; untrusted clicks are therefore observably ignored. Suffixes avoid Math.random, which the specs stub for the round delay.
 */
export function guardButton(name) {
    const el = fixture(name);
    const activated = vi.fn();
    reactKeySeq += 1;
    const props = {
        role: 'button',
        tabIndex: 0,
        className: el.className,
        onClick(e) {
            const nativeEvent = e?.nativeEvent;
            if (nativeEvent?.isTrusted === true && nativeEvent instanceof Event) activated(e);
        },
    };
    el[`__reactFiber$g${reactKeySeq}`] = { stateNode: el };
    el[`__reactProps$g${reactKeySeq}`] = props;
    el.addEventListener('click', (nativeEvent) => props.onClick({ nativeEvent, target: el, currentTarget: el }));
    return activated;
}

/** Stub Math.random: each value once in order, the last one for every later call. */
export function stubRandom(...values) {
    const spy = vi.spyOn(Math, 'random');
    values.slice(0, -1).forEach((v) => spy.mockReturnValueOnce(v));
    spy.mockReturnValue(values[values.length - 1]);
    return spy;
}

// ─────────────────────────────────────────────────────────────────────────────
//  chrome.runtime trust boundary
// ─────────────────────────────────────────────────────────────────────────────

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

export function installChromeRuntime() {
    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;
    return { onMessage, sendMessage };
}

/** Every GET_SETTINGS round trip answers { ok: true, values } (copied, as the real boundary does). */
export function respondWith(values) {
    sendMessage.mockImplementation((_message, callback) => {
        const response = { ok: true, values: structuredClone(values) };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

/** Union of the keys requested by every GET_SETTINGS call so far. */
export function requestedKeys() {
    return [...new Set(sendMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.type === globalThis.DSS_SETTINGS_MSG.GET_SETTINGS)
        .flatMap((message) => message.keys || []))];
}

/** Drain promise chains without advancing (fake) timers. */
export async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
export function broadcast(changes, area = 'local') {
    onMessage.callListeners(
        { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes: structuredClone(changes) },
        { id: 'test-extension-id' },
        () => {},
    );
}

/** { key: { oldValue, newValue } } for each [key, newValue, oldValue] triple. */
export function changes(...triples) {
    return Object.fromEntries(triples.map(([key, newValue, oldValue]) => [key, { oldValue, newValue }]));
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN-world click bridge
// ─────────────────────────────────────────────────────────────────────────────

export const BRIDGE_PATH = 'content/react-click-bridge.main.js';
const bridgeLoaders = import.meta.glob('../../content/react-click-bridge.main.js');
let isBridgeLoaded = false;

export function isBridgePresent() {
    return fs.existsSync(path.resolve(__dirname, '../..', BRIDGE_PATH));
}

/**
 * Load the bridge once per spec file. It listens on `document`, which outlives vi.resetModules, so re-importing it per test would stack listeners. While the file does not exist (red phase) this is a no-op and activation assertions fail on their own; a file that exists but is not loadable throws.
 */
export async function loadBridge() {
    if (isBridgeLoaded || !isBridgePresent()) return;
    const load = Object.values(bridgeLoaders)[0];
    if (!load) throw new Error(`${BRIDGE_PATH} exists but import.meta.glob did not pick it up — fix the glob in auto-click-harness.js`);
    await load();
    isBridgeLoaded = true;
}

/** Load fresh modules in manifest order; `values` answers the initial GET_SETTINGS when given. */
export async function loadAutoClick(values) {
    if (values) respondWith(values);
    await loadBridge();
    vi.resetModules();
    await import('../../content/feature-toggle.js');
    await import('../../content/auto-click.delay.js');
    await import('../../content/auto-retry.js');
    await settle();
}
