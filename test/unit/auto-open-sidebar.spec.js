/**
 * content/auto-open-sidebar.js — DOM-adapter tests (implementation first, tests after).
 *
 * Requirement:
 *   - Gate: master "isEnabled" ON && own key "isAutoOpenSidebarEnabled" true; initial values from DSS_GET_SETTINGS, live changes from DSS_SETTINGS_CHANGED (area 'local').
 *   - While on: the element matching Selectors.SIDEBAR_OPEN_BUTTON_SELECTOR (the collapsed rail's "open sidebar" button) is activated exactly once per collapsed episode. An episode starts when the sidebar wrapper (Selectors.SIDEBAR_WRAPPER_SELECTOR) becomes natively collapsed, i.e. DeepSeek inserts its collapsed rail as the wrapper's first child (Selectors.SIDEBAR_WRAPPER_COLLAPSED_SELECTOR), and ends when the rail is removed. Within one episode the button is never re-activated; the next episode re-activates it even when the same rail node is inserted again.
 *   - Loop breaker: if, after an activation, the wrapper leaves and re-enters the collapsed state within 1500 ms with no window 'resize' in between, activation stops until the next 'resize'.
 *   - Activation goes through the MAIN-world bridge (dss:react-click), so success is asserted as the guarded React onClick accepting the event (guardButton), never as "an event was dispatched".
 *   - An error inside a scan is reported with console.error('[DSS] auto-open-sidebar: ...') and does not stop later scans.
 *
 * Fixtures are captures from the live page. Sidebar wrappers: test/fixtures/ds-snapshots/sidebar-expanded.html (conv2-finished) and sidebar-collapsed.html (conv-sidebar-collapsed), chat titles, session ids and account text replaced by placeholders. Buttons: test/fixtures/sidebar-buttons/ (copied from to-do/samples/); full-collapesed-component.html is the collapsed rail, identical to the rail inside sidebar-collapsed.html. The rail holds three iconLabelPrimary/m buttons (open sidebar, search, new chat); only the first must match. The expanded sidebar's close button (iconLabelTertiary, same svg path; mounted but hidden inside the collapsed wrapper) and the header hamburger (xl, different path) occupy the same slot in other UI states and must never match.
 * Live wrapper facts (captures): natively collapsed, the wrapper's children are [rail, inner content]; expanded, only [inner content], including the narrow-layout drawer. The specs toggle the native state the same way, by inserting the rail as the wrapper's first child and removing it, never through className.
 * happy-dom 16.8.1 evaluates ':has(> A > B)' as ':has(> A)', so its first match for SIDEBAR_WRAPPER_SELECTOR is the first div that has a div child. Every wrapper is mounted with no such div before it in document order (directly in body, or under a non-div host); in Chrome the selector matches only the wrapper.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    MASTER_KEY, selectors, guardButton, installChromeRuntime, respondWith, broadcast, changes, settle, loadBridge,
} from '../helpers/auto-click-harness.js';

const OWN_KEY = 'isAutoOpenSidebarEnabled';
const ON = { [MASTER_KEY]: true, [OWN_KEY]: true };

const readFixture = (dir, name) => fs.readFileSync(path.resolve(__dirname, '../fixtures', dir, name), 'utf8');
const RAIL = readFixture('sidebar-buttons', 'full-collapesed-component.html');   // buttons: [open-sidebar, search, new-chat]
const COLLAPSED = readFixture('sidebar-buttons', 'collapsed-side-button.html');  // buttons: [open-sidebar]
const EXTENDED = readFixture('sidebar-buttons', 'extended-side-button.html');    // buttons: [close-sidebar (Tertiary)]
const MINIMIZED = readFixture('sidebar-buttons', 'minimized-side-button.html');  // buttons: [header hamburger (xl)]
const EXPANDED_SIDEBAR = readFixture('ds-snapshots', 'sidebar-expanded.html');   // wrapper: [inner content]
const COLLAPSED_SIDEBAR = readFixture('ds-snapshots', 'sidebar-collapsed.html'); // wrapper: [rail, hidden inner content]

/** happy-dom delivers MutationObserver records on its own window timer, which vi.useFakeTimers() does not control; flush() waits on this real timer so it works under fake timers too. */
const realSetTimeout = globalThis.setTimeout;

let fixtureSeq = 0;

function parse(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild;
}

/** Tag each role=button under root with a unique data-fixture (identification only; no selector reads it). Returns the names in DOM order. */
function tag(root) {
    return [...root.querySelectorAll('[role="button"]')].map((el) => {
        fixtureSeq += 1;
        const name = 'sb' + fixtureSeq;
        el.setAttribute('data-fixture', name);
        return name;
    });
}

/** Insert element el under parent (as first child when first is true), then guard its buttons. Returns the activation spies in DOM order. */
function insertGuarded(el, parent, first = false) {
    const names = tag(el);
    if (first) parent.prepend(el);
    else parent.append(el);
    return names.map((name) => guardButton(name));
}

/** Append bare fixture markup to parent (default body) and guard its buttons. Returns the activation spies in DOM order. */
function append(html, parent = document.body) {
    const host = document.createElement('div');
    host.innerHTML = html;
    const names = tag(host);
    parent.append(...host.childNodes);
    return names.map((name) => guardButton(name));
}

/** Mount a captured sidebar wrapper under parent (default body); spies covers every button inside it in DOM order. */
function mountSidebar(html, parent = document.body) {
    const wrapper = parse(html);
    const spies = insertGuarded(wrapper, parent);
    return { wrapper, spies };
}

/** Native collapse with a freshly rendered rail: a new capture becomes the wrapper's first child. Returns the rail node and its spies [open, search, new-chat]. */
function collapseWithFreshRail(wrapper) {
    const rail = parse(RAIL);
    const spies = insertGuarded(rail, wrapper, true);
    return { rail, spies };
}

const calls = (spies) => spies.map((spy) => spy.mock.calls.length);

/** Expected activation counts when only the first button (the rail's open-sidebar button) was activated, once. */
const onlyFirst = (spies) => spies.map((_, i) => (i === 0 ? 1 : 0));

const none = (spies) => spies.map(() => 0);

const resize = () => window.dispatchEvent(new Event('resize'));

/** Let MutationObserver callbacks and promise chains run (real wall-clock turn, fake timers untouched). */
async function flush() {
    await settle();
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    await settle();
}

/** Start a new collapsed episode the way DeepSeek does after an expand: unmount the old rail, window resize (keeps the loop breaker out of play), collapse with a fresh rail node. Returns the fresh rail's spies. */
async function nextEpisodeWithFreshRail(wrapper, oldRail) {
    oldRail.remove();
    await flush();
    resize();
    const { spies } = collapseWithFreshRail(wrapper);
    await flush();
    return spies;
}

async function load(values) {
    respondWith(values);
    await loadBridge();
    vi.resetModules();
    await import('../../content/ds-selectors.js');
    await import('../../content/feature-toggle.js');
    await import('../../content/auto-open-sidebar.js');
    await flush();
}

beforeEach(() => {
    document.body.innerHTML = '';
    installChromeRuntime();
});

afterEach(async () => {
    // Close the gate so this test's observer cannot activate buttons mounted by the next test.
    broadcast(changes([MASTER_KEY, false, true]));
    await flush();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('SIDEBAR_OPEN_BUTTON_SELECTOR discrimination', () => {
    it('matches only the open-sidebar button among the rail, expanded and minimized buttons', () => {
        document.body.innerHTML = RAIL + EXTENDED + MINIMIZED;

        const matches = [...document.querySelectorAll(selectors().SIDEBAR_OPEN_BUTTON_SELECTOR)];

        expect(matches, 'match count').toHaveLength(1);
        const [el] = matches;
        expect(el.querySelector('svg path').getAttribute('d').startsWith('M9.67272'), 'svg path starts with M9.67272').toBe(true);
        expect(el.classList.contains('ds-button--iconLabelPrimary'), 'iconLabelPrimary').toBe(true);
        expect(el.classList.contains('ds-button--m'), 'size m').toBe(true);
        expect(el, 'first button of the collapsed rail').toBe(document.querySelectorAll('[role="button"]')[0]);
    });

    it('fixture self-check: an untrusted .click() does not activate the guarded button', () => {
        const [open] = append(COLLAPSED);

        document.querySelector('[role="button"]').click();

        expect(open).toHaveBeenCalledTimes(0);
    });
});

// Activation is scoped to a collapsed episode of the sidebar wrapper, so every case mounts a captured wrapper; a bare button outside it does not model a live state.
describe('enabled', () => {
    it('activates the open-sidebar button of a sidebar already collapsed at enable time, and no other button', async () => {
        const { wrapper, spies } = mountSidebar(COLLAPSED_SIDEBAR);
        const hamburgerSpies = append(MINIMIZED);
        expect(wrapper.querySelectorAll('[role="button"] path[d^="M9.67272"]'), 'precondition: the rail open button and the hidden expanded-sidebar close button share the icon').toHaveLength(2);

        await load(ON);

        expect(calls(spies), 'buttons of the collapsed wrapper in DOM order: [open, search, new-chat, ...hidden expanded-sidebar buttons]').toEqual(onlyFirst(spies));
        expect(calls(hamburgerSpies), 'header hamburger').toEqual([0]);
    });

    it('activates the open-sidebar button when the wrapper collapses after enable', async () => {
        const { wrapper, spies: contentSpies } = mountSidebar(EXPANDED_SIDEBAR);
        await load(ON);

        const { spies } = collapseWithFreshRail(wrapper);
        await flush();

        expect(calls(spies), '[open, search, new-chat]').toEqual([1, 0, 0]);
        expect(calls(contentSpies), 'buttons of the inner content').toEqual(none(contentSpies));
    });

    // The host is a non-div element: under the happy-dom :has() bug a div host would be the first wrapper-selector match (see the file header).
    it('activates the open-sidebar button inserted inside an existing descendant (not a direct body child)', async () => {
        const host = document.createElement('main');
        host.id = 'host';
        document.body.append(host);
        const { wrapper } = mountSidebar(EXPANDED_SIDEBAR, host);
        await load(ON);

        const { spies } = collapseWithFreshRail(wrapper);
        await flush();

        expect(calls(spies), '[open, search, new-chat] nested under #host').toEqual([1, 0, 0]);
    });

    it('does not re-activate the same node within one episode; activates a fresh node in the next episode', async () => {
        const { wrapper } = mountSidebar(EXPANDED_SIDEBAR);
        await load(ON);
        const { rail, spies: [first] } = collapseWithFreshRail(wrapper);
        await flush();
        expect(first, 'first appearance').toHaveBeenCalledTimes(1);

        append('<div class="unrelated">x</div>');
        await flush();
        expect(first, 'after an unrelated mutation (rail still mounted, same episode)').toHaveBeenCalledTimes(1);

        const [second] = await nextEpisodeWithFreshRail(wrapper, rail);
        expect([first.mock.calls.length, second.mock.calls.length], '[old node, fresh node]').toEqual([1, 1]);
    });

    // Live fact (DevTools): at the narrow layout (<= ~768px) DeepSeek's header hamburger (MINIMIZED fixture, outside the sidebar wrapper) is visible while the collapsed rail button is visible too, so the rail button's own visibility cannot tell the layouts apart; on desktop the hamburger stays mounted but hidden. Clicking the rail at the narrow layout opens the sidebar as a drawer.
    it('skips the open-sidebar button while the header hamburger is visible, without consuming the episode; activates it once the hamburger is hidden', async () => {
        const { spies } = mountSidebar(COLLAPSED_SIDEBAR);
        const [hamburgerActivated] = append(MINIMIZED);
        const hamburger = document.body.lastElementChild;
        expect(hamburger.querySelector('path').getAttribute('d').startsWith('M17.2027'), 'precondition: hamburger node is the MINIMIZED fixture outside the wrapper').toBe(true);
        const hamburgerEvents = [];
        hamburger.addEventListener('dss:react-click', () => hamburgerEvents.push('dss:react-click'));
        hamburger.addEventListener('click', () => hamburgerEvents.push('click'));
        Object.defineProperty(hamburger, 'checkVisibility', { value: () => true, configurable: true });

        await load(ON);
        expect(calls(spies), 'buttons of the collapsed wrapper while the header hamburger is visible (narrow layout)').toEqual(none(spies));
        expect(hamburgerActivated, 'hamburger React activations').toHaveBeenCalledTimes(0);
        expect(hamburgerEvents, 'events dispatched on the hamburger').toEqual([]);

        Object.defineProperty(hamburger, 'checkVisibility', { value: () => false, configurable: true });
        append('<div class="unrelated">x</div>');
        await flush();
        expect(calls(spies), 'buttons of the collapsed wrapper after the hamburger became hidden (same episode, childList rescan)').toEqual(onlyFirst(spies));
        expect(hamburgerActivated, 'hamburger React activations after it became hidden').toHaveBeenCalledTimes(0);
        expect(hamburgerEvents, 'events dispatched on the hamburger after it became hidden').toEqual([]);
    });

    // happy-dom 16.8.1 has no Element.prototype.checkVisibility; a hamburger without the method must not block (only typeof checkVisibility === 'function' && checkVisibility() blocks).
    it('activates the open-sidebar button when the header hamburger is mounted but has no checkVisibility method', async () => {
        const { spies } = mountSidebar(COLLAPSED_SIDEBAR);
        const [hamburgerActivated] = append(MINIMIZED);
        expect(typeof document.body.lastElementChild.checkVisibility, 'precondition: environment lacks checkVisibility').toBe('undefined');

        await load(ON);

        expect(calls(spies), 'buttons of the collapsed wrapper with an unstubbed hamburger').toEqual(onlyFirst(spies));
        expect(hamburgerActivated, 'hamburger React activations').toHaveBeenCalledTimes(0);
    });
});

describe('disabled', () => {
    it.each([
        ['own key off', { [MASTER_KEY]: true, [OWN_KEY]: false }],
        ['master off', { [MASTER_KEY]: false, [OWN_KEY]: true }],
    ])('%s: neither a present button nor one in a later episode is activated', async (_label, values) => {
        const { wrapper, spies: before } = mountSidebar(COLLAPSED_SIDEBAR);
        await load(values);

        const after = await nextEpisodeWithFreshRail(wrapper, wrapper.firstElementChild);

        expect(calls([...before, ...after])).toEqual(none([...before, ...after]));
    });
});

describe('live toggle', () => {
    it('own key off stops activation; on again activates the unactivated button already present', async () => {
        const { wrapper, spies: [first] } = mountSidebar(COLLAPSED_SIDEBAR);
        await load(ON);
        expect(first, 'precondition').toHaveBeenCalledTimes(1);

        broadcast(changes([OWN_KEY, false, true]));
        await flush();
        const [second] = await nextEpisodeWithFreshRail(wrapper, wrapper.firstElementChild);
        expect(second, 'collapsed episode while off').toHaveBeenCalledTimes(0);

        broadcast(changes([OWN_KEY, true, false]));
        await flush();
        expect([first.mock.calls.length, second.mock.calls.length], '[earlier node, node present at on] after on').toEqual([1, 1]);
    });
});

describe('observer error resilience', () => {
    it('reports a throwing scan with the [DSS] prefix and keeps scanning afterwards', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { wrapper } = mountSidebar(EXPANDED_SIDEBAR);
        await load(ON);

        const qsa = vi.spyOn(document, 'querySelectorAll').mockImplementationOnce(() => {
            throw new Error('scan failure');
        });
        append('<div class="unrelated">x</div>');
        await flush();
        qsa.mockRestore();

        const firstArgs = errorSpy.mock.calls.map((args) => String(args[0]));
        expect(firstArgs.some((first) => first.startsWith('[DSS] auto-open-sidebar:')), 'console.error first args: ' + firstArgs.join(' | ')).toBe(true);

        const { spies: [open] } = collapseWithFreshRail(wrapper);
        await flush();
        expect(open, 'button of the episode after the failed scan').toHaveBeenCalledTimes(1);
    });
});

// Live bug: at narrow widths DeepSeek re-collapses the sidebar right after the auto click with the same rail and button node, and a per-node "already clicked" flag left the sidebar collapsed for good. The captures show the rail unmounted whenever the sidebar is expanded, so the reuse is modelled as the same rail node removed and inserted again.
describe('collapsed episodes on a reused rail node', () => {
    it('re-activates the same node when the wrapper re-collapses after a resize', async () => {
        vi.useFakeTimers();
        const { wrapper, spies: [open] } = mountSidebar(COLLAPSED_SIDEBAR);
        const rail = wrapper.firstElementChild;
        await load(ON);
        expect(open, 'first episode').toHaveBeenCalledTimes(1);

        rail.remove();
        await flush();
        vi.advanceTimersByTime(3000);
        resize();
        wrapper.prepend(rail);
        await flush();

        expect(open, 'second episode on the reused rail node').toHaveBeenCalledTimes(2);
    });

    it('same episode: an unrelated mutation inside the still-collapsed wrapper 3000 ms after the click does not re-activate the button', async () => {
        vi.useFakeTimers();
        const { wrapper, spies: [open] } = mountSidebar(COLLAPSED_SIDEBAR);
        await load(ON);
        expect(open, 'first episode').toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(3000);
        wrapper.lastElementChild.append(document.createElement('div'));
        await flush();

        expect(open, 'unrelated childList mutation past the 1500 ms window, rail still mounted (same episode)').toHaveBeenCalledTimes(1);
    });

    it('loop breaker holds for the rest of the episode: an unrelated mutation 3000 ms later is not clicked; a resize re-arms it', async () => {
        vi.useFakeTimers();
        const { wrapper, spies: [open] } = mountSidebar(COLLAPSED_SIDEBAR);
        const rail = wrapper.firstElementChild;
        await load(ON);
        expect(open, 'first episode').toHaveBeenCalledTimes(1);

        rail.remove();
        await flush();
        vi.advanceTimersByTime(200);
        wrapper.prepend(rail);
        await flush();
        expect(open, 'page re-collapsed 200 ms after the click, no resize: loop breaker holds').toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(3000);
        wrapper.lastElementChild.append(document.createElement('div'));
        await flush();
        expect(open, 'same suppressed episode, unrelated mutation 3000 ms later, no resize: still suppressed').toHaveBeenCalledTimes(1);

        resize();
        rail.remove();
        await flush();
        vi.advanceTimersByTime(2000);
        wrapper.prepend(rail);
        await flush();
        expect(open, 'episode after a resize re-armed the breaker').toHaveBeenCalledTimes(2);
    });

    it('a re-collapse 2000 ms after the last click with no resize is outside the 1500 ms window and is clicked', async () => {
        vi.useFakeTimers();
        const { wrapper, spies: [open] } = mountSidebar(COLLAPSED_SIDEBAR);
        const rail = wrapper.firstElementChild;
        await load(ON);
        expect(open, 'episode A').toHaveBeenCalledTimes(1);

        rail.remove();
        await flush();
        resize();
        vi.advanceTimersByTime(2000);
        wrapper.prepend(rail);
        await flush();
        expect(open, 'episode B after a resize').toHaveBeenCalledTimes(2);

        rail.remove();
        await flush();
        vi.advanceTimersByTime(2000);
        wrapper.prepend(rail);
        await flush();
        expect(open, 'episode C 2000 ms after the last click, no resize: window elapsed, not suppressed').toHaveBeenCalledTimes(3);
    });

    it('a re-collapse exactly 1500 ms after the last click with no resize is clicked: the loop-breaker window is strictly under 1500 ms', async () => {
        vi.useFakeTimers();
        const { wrapper, spies: [open] } = mountSidebar(COLLAPSED_SIDEBAR);
        const rail = wrapper.firstElementChild;
        await load(ON);
        expect(open, 'episode A').toHaveBeenCalledTimes(1);

        rail.remove();
        await flush();
        vi.advanceTimersByTime(1500);
        wrapper.prepend(rail);
        await flush();
        expect(open, 'episode B exactly 1500 ms after the click, no resize: window elapsed, not suppressed').toHaveBeenCalledTimes(2);
    });
});

// Lifecycle contract (docs/architecture/content-interaction.md): enable() resets the episode state, registers the resize listener, scans once and starts the observer; disable() disconnects the observer, removes the resize listener and resets the episode state. The module is exposed as window.DSstudio.AutoOpenSidebar.
describe('lifecycle and guard edges', () => {
    const api = () => window.DSstudio.AutoOpenSidebar;

    it('a collapsed wrapper with no open-sidebar button is a no-op without error; a button rendered later in the same episode is clicked once', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { wrapper } = mountSidebar(EXPANDED_SIDEBAR);
        await load(ON);

        // The rail renders before its button column (spacer, open, search, new chat), the column's buttons arrive in a later mutation.
        const rail = parse(RAIL);
        const column = rail.lastElementChild;
        column.remove();
        expect(rail.querySelectorAll('[role="button"]'), 'precondition: rail without its button column').toHaveLength(0);
        wrapper.prepend(rail);
        await flush();
        expect(errorSpy.mock.calls.map((args) => String(args[0])), 'console.error first args after a buttonless collapse').toEqual([]);

        const [open] = insertGuarded(column, rail);
        await flush();
        expect(open, 'button rendered later in the same episode').toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls.map((args) => String(args[0])), 'console.error first args after the button rendered').toEqual([]);
    });

    it('isEnabled is true while the gate is open and false after it closes', async () => {
        mountSidebar(EXPANDED_SIDEBAR);
        await load(ON);
        expect(api().isEnabled, 'after enable').toBe(true);

        broadcast(changes([OWN_KEY, false, true]));
        await flush();
        expect(api().isEnabled, 'after disable').toBe(false);
    });

    it('disable() before any enable does not throw', async () => {
        await load({ [MASTER_KEY]: true, [OWN_KEY]: false });

        expect(() => api().disable()).not.toThrow();
    });
});
