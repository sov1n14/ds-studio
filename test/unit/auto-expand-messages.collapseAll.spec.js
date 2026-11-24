/**
 * content/auto-expand-messages.js — _collapseAll(), disable(), and the added-node observer.
 *
 * DOM-adapter layer tests. Fixture: test/fixtures/ds-snapshots/conv2-finished-visible-items-collapsible.html,
 * the visible virtual-list items of a finished conversation captured from the live page (message text
 * replaced by placeholders). The user item (key "-2") is a long message: its .fbb737a4 holds the
 * .ds-collapsible-text and the .ds-collapsible-text-toggle-button, whose second child div wraps the
 * .ds-icon chevron. The capture shows the collapsed state (icon inline `transform: rotate(180deg)`).
 *
 * No live capture of the expanded state exists, so an expanded message is the captured one with only
 * the icon's inline transform removed (minimal mutation). Multiple messages are clones of the captured
 * user/assistant pair. Clicks are observed as dispatched click events at document level, so the
 * assertions also prove no other element (assistant toolbar icon buttons) is clicked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';

const OWN_KEY = 'dsAutoExpandMessages';
const FIXTURE = path.resolve(__dirname, '../fixtures/ds-snapshots/conv2-finished-visible-items-collapsible.html');
const FIXTURE_HTML = fs.readFileSync(FIXTURE, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
//  DOM helpers (real markup)
// ─────────────────────────────────────────────────────────────────────────────

function parseCapturedList() {
    const host = document.createElement('div');
    host.innerHTML = FIXTURE_HTML;
    return host.firstElementChild;
}

/** Clone the captured long user-message item; expanded = captured markup minus the icon's rotate. */
function makeLongUserItem({ collapsed }) {
    const item = parseCapturedList().querySelector('[data-virtual-list-item-key="-2"]');
    const toggle = item.querySelector('.ds-collapsible-text-toggle-button');
    const icon = toggle.querySelector('.ds-icon');
    const container = icon.parentElement;
    if (!collapsed) icon.style.removeProperty('transform');
    return { item, toggle, container, icon };
}

function makeAssistantItem() {
    return parseCapturedList().querySelector('[data-virtual-list-item-key="2"]');
}

/**
 * Mount a conversation with one long user message per entry of `states` (true = collapsed),
 * each followed by the captured assistant reply. Returns the list and the toggle containers.
 */
function mountConversation(states) {
    const list = parseCapturedList();
    list.replaceChildren();
    const containers = states.map((collapsed) => {
        const { item, container } = makeLongUserItem({ collapsed });
        list.appendChild(item);
        list.appendChild(makeAssistantItem());
        return container;
    });
    document.body.appendChild(list);
    return { list, containers };
}

let clickedTargets;
function recordClick(event) {
    clickedTargets.push(event.target);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Messaging harness
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
let AutoExpandMessages;

function respondWith(values) {
    sendMessage.mockImplementation((_message, callback) => {
        const response = { ok: true, values };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadModule(values = { isEnabled: false }) {
    respondWith(values);
    vi.resetModules();
    await import('../../content/ds-selectors.js');
    await import('../../content/feature-toggle.js');
    AutoExpandMessages = (await import('../../content/auto-expand-messages.js')).default;
    await flush();
    return AutoExpandMessages;
}

async function setup(values) {
    document.body.innerHTML = '';
    clickedTargets = [];
    document.addEventListener('click', recordClick, true);
    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;
    await loadModule(values);
}

function cleanup() {
    if (AutoExpandMessages) {
        AutoExpandMessages._stopObserver();
        AutoExpandMessages.enabled = false;
    }
    document.removeEventListener('click', recordClick, true);
    document.body.innerHTML = '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('fixture sanity — captured long user message', () => {
    it('captured toggle icon is collapsed; the expanded variant differs only by its transform', () => {
        const collapsed = makeLongUserItem({ collapsed: true });
        const expanded = makeLongUserItem({ collapsed: false });
        expect(collapsed.icon.style.transform).toBe('rotate(180deg)');
        expect(expanded.icon.style.transform).toBe('');
        expect(collapsed.container.parentElement).toBe(collapsed.toggle);
        expect(expanded.icon.getAttribute('style')).toBe(
            collapsed.icon.getAttribute('style').replace(/\s*transform: rotate\(180deg\);/, ''),
        );
    });
});

describe('AutoExpandMessages._collapseAll()', () => {
    beforeEach(() => setup({ isEnabled: false }));
    afterEach(cleanup);

    it('clicks only expanded containers, not collapsed ones nor any other element', () => {
        const { containers: [expanded1, expanded2, collapsed] } = mountConversation([false, false, true]);

        AutoExpandMessages._collapseAll();

        expect(clickedTargets).toEqual([expanded1, expanded2]);
        expect(clickedTargets).not.toContain(collapsed);
    });

    it('removes data-dssAutoExpanded from ALL containers regardless of state', () => {
        const { containers: [expanded, collapsed, noAttr] } = mountConversation([false, true, false]);
        expanded.dataset.dssAutoExpanded = '1';
        collapsed.dataset.dssAutoExpanded = '1';

        AutoExpandMessages._collapseAll();

        expect(expanded.dataset.dssAutoExpanded).toBeUndefined();
        expect(collapsed.dataset.dssAutoExpanded).toBeUndefined();
        expect(noAttr.dataset.dssAutoExpanded).toBeUndefined();
    });
});

describe('AutoExpandMessages.disable()', () => {
    beforeEach(() => setup({ isEnabled: true, [OWN_KEY]: true }));
    afterEach(cleanup);

    it('collapses expanded containers, clears markers, stops reacting to new messages, and sets enabled to false', async () => {
        AutoExpandMessages.enable();
        const { list, containers: [expanded, collapsed] } = mountConversation([false, true]);
        expanded.dataset.dssAutoExpanded = '1';
        collapsed.dataset.dssAutoExpanded = '1';

        AutoExpandMessages.disable();

        expect(clickedTargets).toEqual([expanded]);
        expect(expanded.dataset.dssAutoExpanded).toBeUndefined();
        expect(collapsed.dataset.dssAutoExpanded).toBeUndefined();
        expect(AutoExpandMessages.enabled).toBe(false);

        const late = makeLongUserItem({ collapsed: true });
        list.appendChild(late.item);
        await flush();

        expect(clickedTargets).toEqual([expanded]);
        expect(late.container.dataset.dssAutoExpanded).toBeUndefined();
    });
});

describe('AutoExpandMessages observer — messages added after enable()', () => {
    beforeEach(() => setup({ isEnabled: true, [OWN_KEY]: true }));
    afterEach(cleanup);

    it('expands a newly added collapsed long message exactly once, even when its icon re-renders later', async () => {
        const { list } = mountConversation([]);
        AutoExpandMessages.enable();

        const added = makeLongUserItem({ collapsed: true });
        list.appendChild(added.item);
        list.appendChild(makeAssistantItem());
        await flush();

        expect(clickedTargets).toEqual([added.container]);
        expect(added.container.dataset.dssAutoExpanded).toBe('1');

        // The icon's svg is re-rendered while the icon still reads collapsed (no React here to flip it).
        added.icon.replaceChildren(added.icon.firstElementChild.cloneNode(true));
        await flush();

        expect(clickedTargets).toEqual([added.container]);
    });

    it('expands a toggle whose icon is inserted after its container', async () => {
        const { list } = mountConversation([]);
        AutoExpandMessages.enable();

        const added = makeLongUserItem({ collapsed: true });
        added.icon.remove();
        list.appendChild(added.item);
        await flush();

        expect(clickedTargets).toEqual([]);
        expect(added.container.dataset.dssAutoExpanded).toBeUndefined();

        added.container.appendChild(added.icon);
        await flush();

        expect(clickedTargets).toEqual([added.container]);
        expect(added.container.dataset.dssAutoExpanded).toBe('1');
    });
});
