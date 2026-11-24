import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
// The storage-manager side-effect import MUST stay above the go-top import.
// content/go-top.js has no imports of its own: it reads the bare global
// `StorageManager`, and its module tail calls `GoToTop.init()`, which
// dereferences `StorageManager.KEYS.IS_ENABLED` synchronously during module
// evaluation (inside a `new Promise` executor, before the first `await`).
// That global is installed by utils/storage-manager.js. Importing go-top.js
// before this line produces `ReferenceError: StorageManager is not defined`
// at collection time.
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';

// ─── Shared fixture helpers ───────────────────────────────────────────────

/**
 * Live DeepSeek message-list root (`.ds-virtual-list.ds-scroll-area`) captured from the
 * conv2-finished snapshot: scroll gutters, the virtual list with one user and one assistant
 * message (text replaced by placeholders), a spacer, and the centred content column. The column
 * holds the floating button bar, whose children are the native go-bottom button followed by the
 * composer card that wraps `textarea[name="search"]` three levels down.
 */
const MESSAGE_LIST_FIXTURE = path.resolve(__dirname, '../fixtures/ds-snapshots/conv2-finished-message-list.html');

/** Parses the captured message-list root into a detached element. */
function parseMessageList() {
    const host = document.createElement('div');
    host.innerHTML = fs.readFileSync(MESSAGE_LIST_FIXTURE, 'utf8');
    return host.firstElementChild;
}

/** The floating-bar child that holds `textarea[name="search"]` (the composer card), found by real nesting. */
function findComposer(injectParent) {
    return Array.from(injectParent.children).find((child) => child.querySelector('textarea[name="search"]')) || null;
}

/**
 * Mounts the captured message-list root into document.body and returns handles located by the
 * real nesting (textarea → composer chain → floating bar → content column), never by the
 * selectors under test.
 */
function mountMessageList() {
    const listRoot = parseMessageList();
    document.body.appendChild(listRoot);
    const textarea = listRoot.querySelector('textarea[name="search"]');
    const composer = textarea.parentElement.parentElement.parentElement;
    const injectParent = composer.parentElement;
    const outerWrapper = injectParent.parentElement;
    const nativeBtn = injectParent.firstElementChild;
    return { listRoot, outerWrapper, injectParent, composer, nativeBtn };
}

/**
 * Live page state with the conversation scrolled to the bottom: the native go-bottom button is
 * not rendered, so the floating bar holds only the composer card (as captured in the
 * conv-reopened and stream-* snapshots). Built from the conv2-finished capture by removing the
 * native button only.
 * Returns { outerWrapper, injectParent }.
 */
export function createWrapperWithoutNativeButton() {
    const { outerWrapper, injectParent, nativeBtn } = mountMessageList();
    nativeBtn.remove();
    return { outerWrapper, injectParent };
}

/**
 * Detached copy of the live native go-bottom button, verbatim from the conv2-finished capture. It
 * keeps both real DOM levels: the positioning wrapper carrying GO_TOP_NATIVE_BUTTON_CLASS
 * (`_0706cde`), whose only child is the `div[role="button"].ds-button--floating.ds-button--circle`
 * control with its background, border and icon layers.
 */
export function createNativeButton() {
    const textarea = parseMessageList().querySelector('textarea[name="search"]');
    const injectParent = textarea.parentElement.parentElement.parentElement.parentElement;
    const nativeBtn = injectParent.firstElementChild;
    nativeBtn.remove();
    return nativeBtn;
}

/**
 * Live page transition where the conversation scrolls up and React mounts the native go-bottom
 * button: inserts a createNativeButton() copy into the floating bar directly before the composer
 * card, where the capture places it. Returns the inserted native button.
 */
export function insertNativeButton(injectParent) {
    const nativeBtn = createNativeButton();
    injectParent.insertBefore(nativeBtn, findComposer(injectParent));
    return nativeBtn;
}

/**
 * Live page state with the conversation scrolled up: the captured floating bar holds the native
 * go-bottom button (first child) followed by the composer card, verbatim from conv2-finished.
 * Returns { outerWrapper, injectParent, nativeBtn }.
 */
export function createFullWrapperWithNativeButton() {
    const { outerWrapper, injectParent, nativeBtn } = mountMessageList();
    return { outerWrapper, injectParent, nativeBtn };
}

/**
 * Resets GoToTop module state and the DOM between tests. Mirrors the
 * original inline `beforeEach` body from go-top.spec.js — order matters:
 * `disable()` must run FIRST (it calls `_stopWrapperObserver()`, which
 * disconnects a live MutationObserver; nulling `_wrapperObserver` before
 * calling `disable()` would orphan a still-connected observer that then
 * fires into the next test's DOM), and `vi.restoreAllMocks()` must run
 * LAST (several describe blocks install spies in their own nested
 * `beforeEach`, which runs after this one; restoring earlier would wipe
 * their setup).
 */
export function resetGoToTopState() {
    GoToTop.disable();
    // disable() only tears down when the feature was enabled; a DOM-readiness
    // poll armed by a direct _tryConnectDom() call in a test would otherwise
    // survive into the next test and inject a button into its DOM.
    GoToTop._stopConnectRetry();
    GoToTop.enabled = false;
    GoToTop._masterEnabled = false;
    GoToTop._isLocked = false;
    GoToTop._hasSeenDom = false;
    GoToTop._button = null;
    GoToTop._injectionMode = null;
    GoToTop._scrollContainer = null;
    GoToTop._scrollPromise = null;
    GoToTop._scrollReject = null;
    GoToTop._observer = null;
    if (GoToTop._wrapperObserver) GoToTop._wrapperObserver.disconnect();
    GoToTop._wrapperObserver = null;
    // Clear, not just drop, the debounce timer: disable() is a no-op when the test never enabled the feature, and an armed timer would fire into the next test or after teardown.
    clearTimeout(GoToTop._wrapperObserverTimer);
    GoToTop._wrapperObserverTimer = null;
    GoToTop._scrollListener = null;
    GoToTop._popstateHandler = null;
    clearTimeout(GoToTop._observerTimer);
    GoToTop._observerTimer = null;
    GoToTop._lastPath = '';
    clearTimeout(GoToTop._routeChangeTimer);
    GoToTop._routeChangeTimer = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
}
