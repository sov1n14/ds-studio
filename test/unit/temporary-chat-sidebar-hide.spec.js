import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Load order matters: constants and shared selectors must resolve their globals
// before the module under test evaluates. Static imports are hoisted in source
// order, so these three lines fix the sequence.
import '../../utils/temporary-chat-constants.js';
import '../../content/ds-selectors.js';
import '../../content/temporary-chat-sidebar-hide.js';

// --- Sidebar DOM fixtures (inlined; sole consumer) ---
// Markup shape transcribed from the captured snapshot to-do/samples/side-chat.html,
// NOT derived from content/ds-selectors.js: a fixture built from the selector it
// exercises would prove nothing.
const CHAT_PATH_PREFIX = '/a/chat/s/';
const ABSOLUTE_ORIGIN = 'https://chat.deepseek.com';

function makeChatAnchor(uuid, { absolute = false } = {}) {
    const a = document.createElement('a');
    a.className = '_546d736 b64fb9ae';
    a.setAttribute('tabindex', '0');
    const base = absolute ? ABSOLUTE_ORIGIN : '';
    a.setAttribute('href', `${base}${CHAT_PATH_PREFIX}${uuid}`);

    const ring = document.createElement('div');
    ring.className = 'ds-focus-ring';

    const title = document.createElement('div');
    title.className = 'c08e6e93';
    title.textContent = 'chat title';

    const actions = document.createElement('div');
    actions.className = '_254829d';
    const actionBtn = document.createElement('div');
    actionBtn.setAttribute('role', 'button');
    actionBtn.className = 'ds-button _2090548';
    actionBtn.setAttribute('tabindex', '0');
    actions.appendChild(actionBtn);

    a.appendChild(ring);
    a.appendChild(title);
    a.appendChild(actions);
    return a;
}

function makeDateGroup({ uuids = [], label = '今天', groupClass = '_3098d02', absolute = false } = {}) {
    const group = document.createElement('div');
    group.className = groupClass;

    const dateLabel = document.createElement('div');
    dateLabel.className = 'f3d18f6a';
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

function mountSidebar(...groups) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dc04ec1d';
    const inner = document.createElement('div');
    inner.className = 'b8812f16 a2f3d50e';
    wrapper.appendChild(inner);
    groups.forEach((g) => inner.appendChild(g));
    document.body.appendChild(wrapper);
    return { wrapper, inner };
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
    // rAF coalescing: run the scheduled application synchronously so a single
    // flush() after a mutation is enough to observe the result deterministically.
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

describe('TemporaryChatSidebarHide - fallback when the group container class changes', () => {
    it('7: queued anchors are still hidden individually when no date-group container matches', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'], groupClass: 'renamed-group-xyz' });
        mountSidebar(group);

        stubPendingUuids(['u1']);
        await Hide.init();

        expect(isHidden(byUuid.get('u1'))).toBe(true);
        expect(isHidden(byUuid.get('u2'))).toBe(false);
        expect(isHidden(group)).toBe(false);
    });
});

describe('TemporaryChatSidebarHide - MutationObserver re-apply', () => {
    it('8: a fully-queued group appended after init() is hidden once the observer fires', async () => {
        const { group: existing } = makeDateGroup({ uuids: ['keep'] });
        const { inner } = mountSidebar(existing);

        stubPendingUuids(['new1', 'new2']);
        await Hide.init();
        expect(isHidden(existing)).toBe(false);

        const { group: added } = makeDateGroup({ uuids: ['new1', 'new2'], label: '昨天' });
        inner.appendChild(added);
        await flush();

        expect(isHidden(added)).toBe(true);
    });
});

describe('TemporaryChatSidebarHide - stop()', () => {
    it('9: after stop(), neither a push nor a DOM insertion changes the hiding state', async () => {
        const { group } = makeDateGroup({ uuids: ['u1'] });
        const { inner } = mountSidebar(group);

        stubPendingUuids([]);
        await Hide.init();
        expect(allHidden()).toEqual([]);

        Hide.stop();

        pushPendingUuids(['u1']);
        expect(isHidden(group)).toBe(false);

        const { group: added } = makeDateGroup({ uuids: ['u1'] });
        inner.appendChild(added);
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
        const { inner } = mountSidebar(group);

        stubPendingUuids(['u1', 'u2']);
        await Hide.init();

        pushPendingUuids(['u1']);

        const { group: added } = makeDateGroup({ uuids: ['u3'] });
        inner.appendChild(added);
        await flush();

        Hide.stop();

        [...localSpies, ...syncSpies].forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });
});

describe('TemporaryChatSidebarHide - href-based uuid extraction', () => {
    it('11: an anchor with an ABSOLUTE href for a queued uuid is still hidden', async () => {
        const anchor = makeChatAnchor('abs-uuid', { absolute: true });
        const container = document.createElement('div');
        container.className = 'renamed-group-abs';
        container.appendChild(anchor);
        const { inner } = mountSidebar();
        inner.appendChild(container);

        stubPendingUuids(['abs-uuid']);
        await Hide.init();

        expect(isHidden(anchor)).toBe(true);
    });
});
