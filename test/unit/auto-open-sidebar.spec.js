/**
 * content/auto-open-sidebar.js — DOM-adapter tests (implementation first, tests after).
 *
 * Requirement:
 *   - Gate: master "isEnabled" ON && own key "isAutoOpenSidebarEnabled" true; initial values from DSS_GET_SETTINGS, live changes from DSS_SETTINGS_CHANGED (area 'local').
 *   - While on: the element matching Selectors.SIDEBAR_OPEN_BUTTON_SELECTOR (the collapsed rail's "open sidebar" button) is activated exactly once per collapsed episode. An episode starts when the sidebar wrapper (Selectors.SIDEBAR_WRAPPER_SELECTOR) gains the native-collapsed class (live: 'a02af2e6') and ends when it loses it. Within one episode the button is never re-activated; the next episode re-activates it even when DeepSeek reuses the same rail node and only flips the wrapper className.
 *   - Loop breaker: if, after an activation, the wrapper leaves and re-enters the collapsed class within 1500 ms with no window 'resize' in between, activation stops until the next 'resize'.
 *   - Activation goes through the MAIN-world bridge (dss:react-click), so success is asserted as the guarded React onClick accepting the event (guardButton), never as "an event was dispatched".
 *   - An error inside a scan is reported with console.error('[DSS] auto-open-sidebar: ...') and does not stop later scans.
 *
 * Fixtures are verbatim captures from the live page (test/fixtures/sidebar-buttons/, copied from to-do/samples/). The collapsed rail holds three iconLabelPrimary/m buttons (open sidebar, search, new chat); only the first must match. The expanded-sidebar button (iconLabelTertiary, same svg path) and the minimized button (xl, different path) occupy the same slot in other UI states and must never match.
 * Live wrapper facts (DevTools): the wrapper is 'dc04ec1d a02af2e6' when natively collapsed and 'dc04ec1d' when expanded; React rewrites the whole className on each native toggle, and at narrow widths the rail and its button node stay mounted across collapse, open, collapse.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    MASTER_KEY, selectors, guardButton, installChromeRuntime, respondWith, broadcast, changes, settle, loadBridge,
} from '../helpers/auto-click-harness.js';

const OWN_KEY = 'isAutoOpenSidebarEnabled';
const ON = { [MASTER_KEY]: true, [OWN_KEY]: true };

const readFixture = (name) => fs.readFileSync(path.resolve(__dirname, '../fixtures/sidebar-buttons', name), 'utf8');
const RAIL = readFixture('full-collapesed-component.html');   // buttons: [open-sidebar, search, new-chat]
const COLLAPSED = readFixture('collapsed-side-button.html');  // buttons: [open-sidebar]
const EXTENDED = readFixture('extended-side-button.html');    // buttons: [close-sidebar (Tertiary)]
const MINIMIZED = readFixture('minimized-side-button.html');  // buttons: [minimized menu (xl)]

/** Live wrapper className per native state (React rewrites the whole attribute on each toggle). The harness import loads ds-selectors.js first. */
const WRAPPER_EXPANDED = selectors().SIDEBAR_WRAPPER_SELECTOR.replace(/^div./, '');
const WRAPPER_COLLAPSED = WRAPPER_EXPANDED + ' ' + selectors().SIDEBAR_NATIVE_COLLAPSED_CLASS;

/** happy-dom delivers MutationObserver records on its own window timer, which vi.useFakeTimers() does not control; flush() waits on this real timer so it works under fake timers too. */
const realSetTimeout = globalThis.setTimeout;

let fixtureSeq = 0;

/** Append `html` to `parent` (default body); tag each role=button with a unique data-fixture and guard it. Returns the activation spies in DOM order. */
function append(html, parent = document.body) {
    const host = document.createElement('div');
    host.innerHTML = html;
    const names = [...host.querySelectorAll('[role="button"]')].map((el) => {
        fixtureSeq += 1;
        const name = 'sb' + fixtureSeq;
        el.setAttribute('data-fixture', name);
        return name;
    });
    parent.append(...host.childNodes);
    return names.map((name) => guardButton(name));
}

/** Mount the sidebar wrapper with the given live className under `parent` (default body). */
function mountWrapper(className, parent = document.body) {
    const wrapper = document.createElement('div');
    wrapper.className = className;
    parent.append(wrapper);
    return wrapper;
}

const calls = (spies) => spies.map((spy) => spy.mock.calls.length);

const resize = () => window.dispatchEvent(new Event('resize'));

/** Let MutationObserver callbacks and promise chains run (real wall-clock turn, fake timers untouched). */
async function flush() {
    await settle();
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    await settle();
}

/** Start a new collapsed episode the way DeepSeek does after an expand: drop the old rail button, window resize (keeps the loop breaker out of play), collapse with a fresh rail node. Returns the fresh node's spies. */
async function nextEpisodeWithFreshNode(wrapper, html) {
    wrapper.className = WRAPPER_EXPANDED;
    wrapper.querySelectorAll('[data-fixture]').forEach((el) => el.remove());
    await flush();
    resize();
    wrapper.className = WRAPPER_COLLAPSED;
    const spies = append(html, wrapper);
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

// Every case below mounts the buttons inside the sidebar wrapper: activation is scoped to a collapsed episode of that wrapper, so a bare button outside it no longer models a live state.
describe('enabled', () => {
    it('activates the open-sidebar button already present at enable time, and no other button', async () => {
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const spies = append(RAIL + EXTENDED + MINIMIZED, wrapper);

        await load(ON);

        expect(calls(spies), '[open, search, new-chat, extended, minimized]').toEqual([1, 0, 0, 0, 0]);
    });

    it('activates the open-sidebar button when the wrapper collapses after enable', async () => {
        const wrapper = mountWrapper(WRAPPER_EXPANDED);
        await load(ON);

        wrapper.className = WRAPPER_COLLAPSED;
        const spies = append(RAIL, wrapper);
        await flush();

        expect(calls(spies), '[open, search, new-chat]').toEqual([1, 0, 0]);
    });

    it('activates the open-sidebar button inserted inside an existing descendant (not a direct body child)', async () => {
        const host = document.createElement('div');
        host.id = 'host';
        document.body.append(host);
        const wrapper = mountWrapper(WRAPPER_EXPANDED, host);
        await load(ON);

        wrapper.className = WRAPPER_COLLAPSED;
        const spies = append(RAIL, wrapper);
        await flush();

        expect(calls(spies), '[open, search, new-chat] nested under #host').toEqual([1, 0, 0]);
    });

    it('does not re-activate the same node within one episode; activates a fresh node in the next episode', async () => {
        const wrapper = mountWrapper(WRAPPER_EXPANDED);
        await load(ON);
        wrapper.className = WRAPPER_COLLAPSED;
        const [first] = append(COLLAPSED, wrapper);
        await flush();
        expect(first, 'first appearance').toHaveBeenCalledTimes(1);

        append('<div class="unrelated">x</div>');
        await flush();
        expect(first, 'after an unrelated mutation (wrapper class unchanged, same episode)').toHaveBeenCalledTimes(1);

        const [second] = await nextEpisodeWithFreshNode(wrapper, COLLAPSED);
        expect([first.mock.calls.length, second.mock.calls.length], '[old node, fresh node]').toEqual([1, 1]);
    });

    // Live fact (DevTools): at the narrow layout (<= ~768px) DeepSeek's header hamburger (MINIMIZED fixture, outside the sidebar wrapper) is visible while the collapsed rail button is visible too, so the rail button's own visibility cannot tell the layouts apart; on desktop the hamburger stays mounted but hidden. Clicking the rail at the narrow layout opens the sidebar as a drawer.
    it('skips the open-sidebar button while the header hamburger is visible, without consuming the episode; activates it once the hamburger is hidden', async () => {
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const spies = append(RAIL, wrapper);
        const [hamburgerActivated] = append(MINIMIZED);
        const hamburger = document.body.lastElementChild;
        expect(hamburger.querySelector('path').getAttribute('d').startsWith('M17.2027'), 'precondition: hamburger node is the MINIMIZED fixture outside the wrapper').toBe(true);
        const hamburgerEvents = [];
        hamburger.addEventListener('dss:react-click', () => hamburgerEvents.push('dss:react-click'));
        hamburger.addEventListener('click', () => hamburgerEvents.push('click'));
        Object.defineProperty(hamburger, 'checkVisibility', { value: () => true, configurable: true });

        await load(ON);
        expect(calls(spies), '[open, search, new-chat] while the header hamburger is visible (narrow layout)').toEqual([0, 0, 0]);
        expect(hamburgerActivated, 'hamburger React activations').toHaveBeenCalledTimes(0);
        expect(hamburgerEvents, 'events dispatched on the hamburger').toEqual([]);

        Object.defineProperty(hamburger, 'checkVisibility', { value: () => false, configurable: true });
        wrapper.append(document.createElement('div'));
        await flush();
        expect(calls(spies), '[open, search, new-chat] after the hamburger became hidden (same episode, childList rescan)').toEqual([1, 0, 0]);
        expect(hamburgerActivated, 'hamburger React activations after it became hidden').toHaveBeenCalledTimes(0);
        expect(hamburgerEvents, 'events dispatched on the hamburger after it became hidden').toEqual([]);
    });

    // happy-dom 16.8.1 has no Element.prototype.checkVisibility; a hamburger without the method must not block (only typeof checkVisibility === 'function' && checkVisibility() blocks).
    it('activates the open-sidebar button when the header hamburger is mounted but has no checkVisibility method', async () => {
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const spies = append(RAIL, wrapper);
        const [hamburgerActivated] = append(MINIMIZED);
        expect(typeof document.body.lastElementChild.checkVisibility, 'precondition: environment lacks checkVisibility').toBe('undefined');

        await load(ON);

        expect(calls(spies), '[open, search, new-chat] with an unstubbed hamburger').toEqual([1, 0, 0]);
        expect(hamburgerActivated, 'hamburger React activations').toHaveBeenCalledTimes(0);
    });
});

describe('disabled', () => {
    it.each([
        ['own key off', { [MASTER_KEY]: true, [OWN_KEY]: false }],
        ['master off', { [MASTER_KEY]: false, [OWN_KEY]: true }],
    ])('%s: neither a present button nor one in a later episode is activated', async (_label, values) => {
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const before = append(COLLAPSED, wrapper);
        await load(values);

        const after = await nextEpisodeWithFreshNode(wrapper, RAIL);

        expect(calls([...before, ...after])).toEqual([0, 0, 0, 0]);
    });
});

describe('live toggle', () => {
    it('own key off stops activation; on again activates the unactivated button already present', async () => {
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const [first] = append(COLLAPSED, wrapper);
        await load(ON);
        expect(first, 'precondition').toHaveBeenCalledTimes(1);

        broadcast(changes([OWN_KEY, false, true]));
        await flush();
        const [second] = await nextEpisodeWithFreshNode(wrapper, COLLAPSED);
        expect(second, 'collapsed episode while off').toHaveBeenCalledTimes(0);

        broadcast(changes([OWN_KEY, true, false]));
        await flush();
        expect([first.mock.calls.length, second.mock.calls.length], '[earlier node, node present at on] after on').toEqual([1, 1]);
    });
});

describe('observer error resilience', () => {
    it('reports a throwing scan with the [DSS] prefix and keeps scanning afterwards', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const wrapper = mountWrapper(WRAPPER_EXPANDED);
        await load(ON);

        const qsa = vi.spyOn(document, 'querySelectorAll').mockImplementationOnce(() => {
            throw new Error('scan failure');
        });
        append('<div class="unrelated">x</div>');
        await flush();
        qsa.mockRestore();

        const firstArgs = errorSpy.mock.calls.map((args) => String(args[0]));
        expect(firstArgs.some((first) => first.startsWith('[DSS] auto-open-sidebar:')), 'console.error first args: ' + firstArgs.join(' | ')).toBe(true);

        wrapper.className = WRAPPER_COLLAPSED;
        const [open] = append(COLLAPSED, wrapper);
        await flush();
        expect(open, 'button of the episode after the failed scan').toHaveBeenCalledTimes(1);
    });
});

// Live bug: at narrow widths DeepSeek re-collapses the sidebar right after the auto click, reusing the same rail and button node and only rewriting the wrapper className. A per-node "already clicked" flag and a childList-only observer left the sidebar collapsed for good.
describe('collapsed episodes on a reused rail node', () => {
    it('re-activates the same node when the wrapper re-collapses after a resize, with no node added or removed', async () => {
        vi.useFakeTimers();
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const [open] = append(RAIL, wrapper);
        await load(ON);
        expect(open, 'first episode').toHaveBeenCalledTimes(1);

        wrapper.className = WRAPPER_EXPANDED;
        await flush();
        vi.advanceTimersByTime(3000);
        resize();
        wrapper.className = WRAPPER_COLLAPSED;
        await flush();

        expect(open, 'second episode on the reused node (class-only change)').toHaveBeenCalledTimes(2);
    });

    it('same episode: an unrelated mutation inside the still-collapsed wrapper 3000 ms after the click does not re-activate the button', async () => {
        vi.useFakeTimers();
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const [open] = append(RAIL, wrapper);
        await load(ON);
        expect(open, 'first episode').toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(3000);
        wrapper.append(document.createElement('div'));
        await flush();

        expect(open, 'unrelated childList mutation past the 1500 ms window, wrapper class unchanged (same episode)').toHaveBeenCalledTimes(1);
    });

    it('loop breaker holds for the rest of the episode: an unrelated mutation 3000 ms later is not clicked; a resize re-arms it', async () => {
        vi.useFakeTimers();
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const [open] = append(RAIL, wrapper);
        await load(ON);
        expect(open, 'first episode').toHaveBeenCalledTimes(1);

        wrapper.className = WRAPPER_EXPANDED;
        await flush();
        vi.advanceTimersByTime(200);
        wrapper.className = WRAPPER_COLLAPSED;
        await flush();
        expect(open, 'page re-collapsed 200 ms after the click, no resize: loop breaker holds').toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(3000);
        wrapper.append(document.createElement('div'));
        await flush();
        expect(open, 'same suppressed episode, unrelated mutation 3000 ms later, no resize: still suppressed').toHaveBeenCalledTimes(1);

        resize();
        wrapper.className = WRAPPER_EXPANDED;
        await flush();
        vi.advanceTimersByTime(2000);
        wrapper.className = WRAPPER_COLLAPSED;
        await flush();
        expect(open, 'episode after a resize re-armed the breaker').toHaveBeenCalledTimes(2);
    });

    it('a re-collapse 2000 ms after the last click with no resize is outside the 1500 ms window and is clicked', async () => {
        vi.useFakeTimers();
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const [open] = append(RAIL, wrapper);
        await load(ON);
        expect(open, 'episode A').toHaveBeenCalledTimes(1);

        wrapper.className = WRAPPER_EXPANDED;
        await flush();
        resize();
        vi.advanceTimersByTime(2000);
        wrapper.className = WRAPPER_COLLAPSED;
        await flush();
        expect(open, 'episode B after a resize').toHaveBeenCalledTimes(2);

        wrapper.className = WRAPPER_EXPANDED;
        await flush();
        vi.advanceTimersByTime(2000);
        wrapper.className = WRAPPER_COLLAPSED;
        await flush();
        expect(open, 'episode C 2000 ms after the last click, no resize: window elapsed, not suppressed').toHaveBeenCalledTimes(3);
    });
    it('a re-collapse exactly 1500 ms after the last click with no resize is clicked: the loop-breaker window is strictly under 1500 ms', async () => {
        vi.useFakeTimers();
        const wrapper = mountWrapper(WRAPPER_COLLAPSED);
        const [open] = append(RAIL, wrapper);
        await load(ON);
        expect(open, 'episode A').toHaveBeenCalledTimes(1);

        wrapper.className = WRAPPER_EXPANDED;
        await flush();
        vi.advanceTimersByTime(1500);
        wrapper.className = WRAPPER_COLLAPSED;
        await flush();
        expect(open, 'episode B exactly 1500 ms after the click, no resize: window elapsed, not suppressed').toHaveBeenCalledTimes(2);
    });
});

// Lifecycle contract (docs/architecture/content-interaction.md): enable() resets the episode state, registers the resize listener, scans once and starts the observer; disable() disconnects the observer, removes the resize listener and resets the episode state. The module is exposed as window.DSstudio.AutoOpenSidebar.
describe('lifecycle and guard edges', () => {
    const api = () => window.DSstudio.AutoOpenSidebar;

    it('a collapsed wrapper with no open-sidebar button is a no-op without error; a button rendered later in the same episode is clicked once', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const wrapper = mountWrapper(WRAPPER_EXPANDED);
        await load(ON);

        wrapper.className = WRAPPER_COLLAPSED;
        await flush();
        expect(errorSpy.mock.calls.map((args) => String(args[0])), 'console.error first args after a buttonless collapse').toEqual([]);

        const [open] = append(COLLAPSED, wrapper);
        await flush();
        expect(open, 'button rendered later in the same episode').toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls.map((args) => String(args[0])), 'console.error first args after the button rendered').toEqual([]);
    });

    it('isEnabled is true while the gate is open and false after it closes', async () => {
        mountWrapper(WRAPPER_EXPANDED);
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
