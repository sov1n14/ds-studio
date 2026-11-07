import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Load order matters: constants and shared selectors must resolve their globals before the module under test evaluates. Static imports are hoisted in source order, so these lines fix the sequence.
import '../../utils/temporary-chat-constants.js';
import '../../content/ds-selectors.js';
import '../../content/temporary-chat-sidebar-hide.js';

// --- Sidebar DOM fixtures (inlined; also inlined in temporary-chat-sidebar-hide.mutant-kill.spec.js) ---
// Markup comes from test/fixtures/ds-snapshots/sidebar-expanded.html, the expanded sidebar wrapper captured from the live page (conv2-finished) with chat titles and session ids replaced by placeholders. Test rows and date groups are clones of the captured row anchor and date-group container with only href, title text and label text changed, so no element is shaped from a selector constant. The captured groups stay mounted (their placeholder ids are never queued) so every case runs among the real sibling groups.
const SIDEBAR_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/sidebar-expanded.html'), 'utf8');
const CHAT_PATH_PREFIX = '/a/chat/s/';
const ABSOLUTE_ORIGIN = 'https://chat.deepseek.com';

function parseSidebar() {
    const host = document.createElement('div');
    host.innerHTML = SIDEBAR_HTML;
    return host.firstElementChild;
}

const TEMPLATE_ANCHOR = parseSidebar().querySelector('a[href]');
const TEMPLATE_GROUP = TEMPLATE_ANCHOR.parentElement;

function makeChatAnchor(uuid, { absolute = false } = {}) {
    const a = TEMPLATE_ANCHOR.cloneNode(true);
    const base = absolute ? ABSOLUTE_ORIGIN : '';
    a.setAttribute('href', `${base}${CHAT_PATH_PREFIX}${uuid}`);
    a.querySelector('.ds-focus-ring').nextElementSibling.textContent = 'chat title';
    return a;
}

function makeDateGroup({ uuids = [], label = '今天', absolute = false } = {}) {
    const group = TEMPLATE_GROUP.cloneNode(false);
    const dateLabel = TEMPLATE_GROUP.firstElementChild.cloneNode(true);
    dateLabel.textContent = label;
    group.appendChild(dateLabel);

    const byUuid = new Map();
    const anchors = uuids.map((uuid) => {
        const a = makeChatAnchor(uuid, { absolute });
        group.appendChild(a);
        byUuid.set(uuid, a);
        return a;
    });

    return { group, dateLabel, anchors, byUuid };
}

/** Mount the captured sidebar as the first element of body and append `groups` to its chat list (the container of the captured date groups). */
function mountSidebar(...groups) {
    document.body.innerHTML = SIDEBAR_HTML;
    const wrapper = document.body.firstElementChild;
    const list = wrapper.querySelector('a[href]').parentElement.parentElement;
    groups.forEach((g) => list.appendChild(g));
    return { wrapper, list };
}

/** Minimal mutation that reaches the fallback: every date-group container in the sidebar (captured and test-built) becomes a <section> with the same attributes and children, modelling a rebuild where no div directly holds the chat rows. Returns the replacement of `group`. */
function retagDateGroups(wrapper, group) {
    let replacement = null;
    const containers = new Set([...wrapper.querySelectorAll('a[href]')].map((a) => a.parentElement));
    containers.forEach((div) => {
        const section = document.createElement('section');
        [...div.attributes].forEach(({ name, value }) => section.setAttribute(name, value));
        section.append(...div.childNodes);
        div.replaceWith(section);
        if (div === group) replacement = section;
    });
    return replacement;
}

// Derived from the CONTRACT, not from reading the module source.
const HIDDEN_CLASS = 'ds-temp-chat-hidden';
const PUSH_TYPE = 'DSS_PENDING_UUIDS_CHANGED';

const Hide = globalThis.TemporaryChatSidebarHide;

function stubPendingUuids(uuids) {
    chrome.runtime.sendMessage.mockResolvedValue({ ok: true, uuids });
}

function pushPendingUuids(uuids) {
    chrome.runtime.onMessage.callListeners({ type: PUSH_TYPE, uuids }, {}, () => {});
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function isHidden(el) {
    return el.classList.contains(HIDDEN_CLASS);
}

function allHidden() {
    return Array.from(document.querySelectorAll('.' + HIDDEN_CLASS));
}

beforeEach(() => {
    // rAF coalescing: run the scheduled application synchronously so a single flush() after a mutation is enough to observe the result deterministically.
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    chrome.runtime.sendMessage.mockReset();
    stubPendingUuids([]);
});

afterEach(() => {
    Hide.stop();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('TemporaryChatSidebarHide - group collapse', () => {
    it('1: a 2-anchor group with BOTH anchors queued hides the CONTAINER, nothing else', async () => {
        const { group, dateLabel, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);

        stubPendingUuids(['u1', 'u2']);
        await Hide.init();

        expect(isHidden(group)).toBe(true);
        expect(allHidden()).toEqual([group]);
        expect(isHidden(dateLabel)).toBe(false);
        expect(isHidden(byUuid.get('u1'))).toBe(false);
        expect(isHidden(byUuid.get('u2'))).toBe(false);
    });

    it('2: a 2-anchor group with ONE queued hides only that anchor; container and label stay visible', async () => {
        const { group, dateLabel, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);

        stubPendingUuids(['u1']);
        await Hide.init();

        expect(isHidden(group)).toBe(false);
        expect(isHidden(dateLabel)).toBe(false);
        expect(isHidden(byUuid.get('u1'))).toBe(true);
        expect(isHidden(byUuid.get('u2'))).toBe(false);
    });

    it('3: a single-anchor group whose only anchor is queued hides the container', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['only'] });
        mountSidebar(group);

        stubPendingUuids(['only']);
        await Hide.init();

        expect(isHidden(group)).toBe(true);
        expect(isHidden(byUuid.get('only'))).toBe(false);
    });

    it('4: an empty queue leaves nothing hidden anywhere', async () => {
        const { group } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);

        stubPendingUuids([]);
        await Hide.init();

        expect(allHidden()).toEqual([]);
    });
});

describe('TemporaryChatSidebarHide - idempotent re-apply on queue change', () => {
    it('5: a fully-hidden group becomes visible again when its uuids leave the queue', async () => {
        const { group } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);

        stubPendingUuids(['u1', 'u2']);
        await Hide.init();
        expect(isHidden(group)).toBe(true);

        pushPendingUuids([]);
        expect(isHidden(group)).toBe(false);
        expect(allHidden()).toEqual([]);
    });

    it('6: an individually-hidden anchor is unhidden when its uuid leaves the queue', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);

        stubPendingUuids(['u1']);
        await Hide.init();
        expect(isHidden(byUuid.get('u1'))).toBe(true);

        pushPendingUuids([]);
        expect(isHidden(byUuid.get('u1'))).toBe(false);
        expect(allHidden()).toEqual([]);
    });
});

describe('TemporaryChatSidebarHide - fallback when no date-group container matches', () => {
    it('7: queued anchors are still hidden individually when no div directly holds the chat rows', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        const { wrapper } = mountSidebar(group);
        const container = retagDateGroups(wrapper, group);
        expect([...wrapper.querySelectorAll('a[href]')].map((x) => x.parentElement.tagName), 'precondition: no chat row has a div parent').not.toContain('DIV');

        stubPendingUuids(['u1']);
        await Hide.init();

        expect(isHidden(byUuid.get('u1'))).toBe(true);
        expect(isHidden(byUuid.get('u2'))).toBe(false);
        expect(isHidden(container)).toBe(false);
        expect(allHidden()).toEqual([byUuid.get('u1')]);
    });
});

describe('TemporaryChatSidebarHide - MutationObserver re-apply', () => {
    it('8: a fully-queued group appended after init() is hidden once the observer fires', async () => {
        const { group: existing } = makeDateGroup({ uuids: ['keep'] });
        const { list } = mountSidebar(existing);

        stubPendingUuids(['new1', 'new2']);
        await Hide.init();
        expect(isHidden(existing)).toBe(false);

        const { group: added } = makeDateGroup({ uuids: ['new1', 'new2'], label: '昨天' });
        list.appendChild(added);
        await flush();

        expect(isHidden(added)).toBe(true);
    });
});

describe('TemporaryChatSidebarHide - stop()', () => {
    it('9: after stop(), neither a push nor a DOM insertion changes the hiding state', async () => {
        const { group } = makeDateGroup({ uuids: ['u1'] });
        const { list } = mountSidebar(group);

        stubPendingUuids([]);
        await Hide.init();
        expect(allHidden()).toEqual([]);

        Hide.stop();

        pushPendingUuids(['u1']);
        expect(isHidden(group)).toBe(false);

        const { group: added } = makeDateGroup({ uuids: ['u1'] });
        list.appendChild(added);
        await flush();
        expect(isHidden(added)).toBe(false);
        expect(allHidden()).toEqual([]);
    });
});

describe('TemporaryChatSidebarHide - storage boundary', () => {
    it('10: no chrome.storage.local/sync method is invoked across the lifecycle', async () => {
        const localSpies = ['get', 'set', 'remove', 'clear'].map((m) => vi.spyOn(chrome.storage.local, m));
        const syncSpies = ['get', 'set', 'remove', 'clear'].map((m) => vi.spyOn(chrome.storage.sync, m));

        const { group } = makeDateGroup({ uuids: ['u1', 'u2'] });
        const { list } = mountSidebar(group);

        stubPendingUuids(['u1', 'u2']);
        await Hide.init();

        pushPendingUuids(['u1']);

        const { group: added } = makeDateGroup({ uuids: ['u3'] });
        list.appendChild(added);
        await flush();

        Hide.stop();

        [...localSpies, ...syncSpies].forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
});

describe('TemporaryChatSidebarHide - href-based uuid extraction', () => {
    it('11: an anchor with an ABSOLUTE href for a queued uuid is still hidden', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['rel-uuid'] });
        const absolute = makeChatAnchor('abs-uuid', { absolute: true });
        group.appendChild(absolute);
        mountSidebar(group);

        stubPendingUuids(['abs-uuid']);
        await Hide.init();

        expect(isHidden(absolute), 'absolute-href row').toBe(true);
        expect(isHidden(byUuid.get('rel-uuid')), 'unqueued sibling row').toBe(false);
        expect(isHidden(group), 'group with an unqueued row').toBe(false);
    });
});
