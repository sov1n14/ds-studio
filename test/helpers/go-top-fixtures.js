import { vi } from 'vitest';
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
 * Creates the live-site DOM structure:
 *   ._871cbca > .aaff8b8f > (optional nativeBtn)
 * Returns { outerWrapper, injectParent }.
 */
export function createWrapperWithoutNativeButton() {
    const outerWrapper = document.createElement('div');
    outerWrapper.className = '_871cbca';
    const injectParent = document.createElement('div');
    injectParent.className = 'aaff8b8f';
    const inputArea = document.createElement('div');
    injectParent.appendChild(inputArea);
    outerWrapper.appendChild(injectParent);
    document.body.appendChild(outerWrapper);
    return { outerWrapper, injectParent };
}

/**
 * Creates a native go-bottom button matching the live-site fixture
 * (go-bottom.html ground truth).
 */
export function createNativeButton() {
    const nativeBtn = document.createElement('div');
    nativeBtn.setAttribute('role', 'button');
    nativeBtn.className =
        'ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ' +
        'ds-button--m ds-button--icon-relative-m ds-button--floating _0706cde';
    nativeBtn.setAttribute('tabindex', '0');
    nativeBtn.setAttribute('style',
        '--dsl-button-color: var(--dsw-alias-button-floating-fill); ' +
        '--dsl-button-height: 34px; ' +
        '--dsl-button-hover-color: var(--dsw-alias-button-floating-hover); ' +
        '--dsl-button-icon-size: 14px;');

    const bg = document.createElement('div');
    bg.className = 'ds-button__background';
    const border = document.createElement('div');
    border.className = 'ds-button__border';
    const icon = document.createElement('div');
    icon.className = 'ds-button__icon ds-button__icon--last-child';
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" ' +
        'xmlns="http://www.w3.org/2000/svg"><path d="M11.8486 5.5" fill="currentColor"></path></svg>';
    nativeBtn.appendChild(bg);
    nativeBtn.appendChild(border);
    nativeBtn.appendChild(icon);
    return nativeBtn;
}

/**
 * Creates the full live-site context:
 *   ._871cbca > .aaff8b8f > nativeBtn
 */
export function createFullWrapperWithNativeButton() {
    const { outerWrapper, injectParent } = createWrapperWithoutNativeButton();
    const nativeBtn = createNativeButton();
    injectParent.appendChild(nativeBtn);
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
    GoToTop._wrapperObserver = null;
    GoToTop._wrapperObserverTimer = null;
    GoToTop._scrollListener = null;
    GoToTop._popstateHandler = null;
    GoToTop._observerTimer = null;
    GoToTop._lastPath = '';
    clearTimeout(GoToTop._routeChangeTimer);
    GoToTop._routeChangeTimer = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
}
