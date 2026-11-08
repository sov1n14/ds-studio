import { vi } from 'vitest';
import GoToTop from '../../content/go-top.js';
import { createFullWrapperWithNativeButton } from './go-top-fixtures.js';

/**
 * Harness for "a press on DeepSeek's native go-bottom button while Go Top is running": the real GoToTop module (enabled, its clone injected into the captured live floating bar) and a replay of the host page's go-bottom click handler share one happy-dom document.
 *
 * Trust boundaries modelled here (and only here): the browser's scroll engine on the message-list scroller (scrollTop / scrollTo / scrollBy clamp to [0, scrollHeight - clientHeight]), the browser's isTrusted flag (reused from prevent-auto-scroll-harness.js), and DeepSeek's own click handler on the native control. The two GoToTop DOM locators (_findScrollContainer, _getAnchor) are pinned to the fixture's scroller, as go-top.enable.spec.js and go-top.scroll-engine.spec.js do, because happy-dom has no layout to resolve overflow or anchor geometry.
 */

/** A long conversation: 50 viewports tall, so the bottom sits at 49000. */
export const LIST_CLIENT_HEIGHT = 1000;
export const LIST_SCROLL_HEIGHT = 50000;
export const BOTTOM = LIST_SCROLL_HEIGHT - LIST_CLIENT_HEIGHT;

/** Host go-bottom handler replay (see testing-pitfalls interceptors-need-user-path): one scrollTo, then 5 re-measure scrollTo calls within 25 ms. */
const HOST_REMEASURE_COUNT = 5;
const HOST_REMEASURE_GAP_MS = 5;
export const HOST_SCROLL_SETTLE_MS = HOST_REMEASURE_COUNT * HOST_REMEASURE_GAP_MS + 5;

/**
 * Gives the scroller a real, independently tracked scroll position. Every write (JS scrollTop setter, scrollTo, scrollBy) lands through one clamped write and is appended to `history`, so a test can see each position the user would have seen, not only the final one.
 */
function makeScrollable(list, initialScrollTop) {
    const maxTop = () => Math.max(0, LIST_SCROLL_HEIGHT - LIST_CLIENT_HEIGHT);
    let top = initialScrollTop;
    const history = [];
    const write = (value) => {
        const n = Number(value);
        top = Math.min(Math.max(0, Number.isFinite(n) ? n : 0), maxTop());
        history.push(top);
    };
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => LIST_SCROLL_HEIGHT });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => LIST_CLIENT_HEIGHT });
    Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => top, set: write });
    list.scrollTo = function scrollTo(optionsOrX, y) {
        const t = optionsOrX !== null && typeof optionsOrX === 'object' ? optionsOrX.top : y;
        if (t !== undefined) write(t);
    };
    list.scroll = list.scrollTo;
    list.scrollBy = function scrollBy(optionsOrX, y) {
        const dy = optionsOrX !== null && typeof optionsOrX === 'object' ? optionsOrX.top : y;
        if (dy !== undefined) write(top + Number(dy));
    };
    return history;
}

/** Anchor (first message) whose rect follows the scroller's live position, so "at top" holds only when the list really is at the top. */
function makeTrackingAnchor(list) {
    const anchor = document.createElement('div');
    anchor.getBoundingClientRect = () => ({ top: -list.scrollTop, bottom: -list.scrollTop + 50, height: 50 });
    return anchor;
}

/** DeepSeek's go-bottom onClick bound on the native control: jumps to the bottom, then re-measures as the virtual list settles. */
function installHostGoBottomHandler(nativeControl, list) {
    nativeControl.addEventListener('click', () => {
        list.scrollTo({ top: list.scrollHeight });
        for (let i = 1; i <= HOST_REMEASURE_COUNT; i++) {
            setTimeout(() => list.scrollTo({ top: list.scrollHeight }), i * HOST_REMEASURE_GAP_MS);
        }
    });
}

/**
 * Mounts the captured live message list (native go-bottom button rendered, conversation scrolled to the bottom), installs MutationObserver delivery, enables the real GoToTop so its clone is injected, and installs the host go-bottom handler. Call with fake timers already active; call restoreMutationDelivery() in afterEach.
 * Option `cloneInsideNativeWrapper`: moves the injected clone into the native positioning wrapper (._0706cde), a host layout where the clone sits under the same wrapper as the native control, so only the clone's own .dsw-gotop class tells the two presses apart.
 * Returns handles found by real nesting plus `goTopCalls()`, the promises every scrollToTopAndWait call returned (a pass-through spy, so the real engine runs).
 */
export function mountGoTopConversation({ cloneInsideNativeWrapper = false } = {}) {
    installMutationDelivery();
    const { nativeBtn } = createFullWrapperWithNativeButton();
    const list = document.body.firstElementChild;
    const history = makeScrollable(list, BOTTOM);

    vi.spyOn(GoToTop, '_findScrollContainer').mockImplementation(function findFixtureScroller() {
        this._scrollContainer = list;
        return list;
    });
    vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(makeTrackingAnchor(list));

    GoToTop._masterEnabled = true;
    GoToTop.enable();
    const clone = GoToTop._button;
    if (!clone || !document.body.contains(clone)) {
        throw new Error('go-top-native-press-harness: GoToTop.enable() did not inject its button into the fixture');
    }

    if (cloneInsideNativeWrapper) nativeBtn.appendChild(clone);

    const nativeControl = nativeBtn.firstElementChild;
    const nativeIcon = nativeControl.querySelector('svg') || nativeControl;
    const cloneIcon = clone.querySelector('svg') || clone;
    installHostGoBottomHandler(nativeControl, list);

    const goTopSpy = vi.spyOn(GoToTop, 'scrollToTopAndWait');
    const goTopCalls = () => goTopSpy.mock.results.map((r) => r.value);

    return { list, history, nativeWrapper: nativeBtn, nativeControl, nativeIcon, clone, cloneIcon, goTopCalls };
}

/**
 * Collects Node 'unhandledRejection' reasons from now on; works under fake timers. collect() switches to real timers (dropping any pending fake timer) and waits two real macrotask turns, because Node reports an unhandled rejection only after the microtask queue drains. Call dispose() in afterEach so a failed test never leaks the listener.
 */
export function watchUnhandledRejections() {
    const reasons = [];
    const onRejection = (reason) => reasons.push(reason);
    process.on('unhandledRejection', onRejection);
    const dispose = () => process.off('unhandledRejection', onRejection);
    async function collect() {
        vi.useRealTimers();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        dispose();
        return reasons;
    }
    return { collect, dispose };
}

/** Records how a promise settles, without caring whether the outcome arrives as a resolve or a reject. */
export function trackSettle(promise) {
    const state = { settled: false, value: undefined };
    if (!promise || typeof promise.then !== 'function') return state;
    promise.then(
        (v) => { state.settled = true; state.value = v; },
        (e) => { state.settled = true; state.value = e; },
    );
    return state;
}

/**
 * Browser MutationObserver delivery. Under fake timers happy-dom delivered only 1 to 2 callback batches for 12 appends 50 ms apart, so a "busy" DOM looked quiet to the code under test. This subclass keeps the real observer and also records each observe() registration, so startContainerMutations() can deliver one childList record per append at the next microtask, as Chrome does, to every observer whose target contains the mutated node.
 */
const RealMutationObserver = globalThis.MutationObserver;
const registrations = new Set();

class DeliveringMutationObserver extends RealMutationObserver {
    constructor(callback) {
        super(callback);
        this._dssCallback = callback;
    }
    observe(target, options = {}) {
        registrations.add({ observer: this, target, options });
        super.observe(target, options);
    }
    disconnect() {
        for (const r of [...registrations]) if (r.observer === this) registrations.delete(r);
        super.disconnect();
    }
}

/** Installs the delivering MutationObserver; call before GoToTop creates any observer. */
export function installMutationDelivery() {
    registrations.clear();
    globalThis.MutationObserver = DeliveringMutationObserver;
    window.MutationObserver = DeliveringMutationObserver;
}

/** Restores the real MutationObserver and drops every recorded registration. */
export function restoreMutationDelivery() {
    registrations.clear();
    globalThis.MutationObserver = RealMutationObserver;
    window.MutationObserver = RealMutationObserver;
}

function deliverChildListRecord(parent, added) {
    const record = { type: "childList", target: parent, addedNodes: [added], removedNodes: [] };
    for (const r of [...registrations]) {
        const covers = r.target === parent || (r.options.subtree && r.target.contains(parent));
        if (covers && r.options.childList) queueMicrotask(() => r.observer._dssCallback([record], r.observer));
    }
}

/** Busy conversation DOM (streaming, lazy mounting): appends a node to the scroller every `intervalMs` and delivers its childList record. Returns a stop function. */
export function startContainerMutations(list, intervalMs = 50) {
    const id = setInterval(() => {
        const node = document.createElement("div");
        list.appendChild(node);
        deliverChildListRecord(list, node);
    }, intervalMs);
    return () => clearInterval(id);
}

export { dispatchWithTrust, userClick, scriptedClickSequence } from './prevent-auto-scroll-harness.js';
