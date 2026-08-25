/**
 * Move the happy-dom location to `path` without a navigation.
 * happy-dom allows writing location.pathname only via pushState/replaceState.
 */
export function setPathname(path) {
    window.history.replaceState({}, '', path);
}
