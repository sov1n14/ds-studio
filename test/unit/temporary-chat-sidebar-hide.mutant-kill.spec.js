import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Load order matters: constants and shared selectors must resolve their globals
// before the module under test evaluates. Static imports are hoisted in source
// order, so these three lines fix the sequence.
import '../../utils/temporary-chat-constants.js';
import '../../content/ds-selectors.js';
const DSSelectors = require('../../content/ds-selectors.js');
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

function makeDateGroup({ uuids = [], label = '今天', groupClass = DSSelectors.SIDEBAR_DATE_GROUP_SELECTOR.split('.').pop(), absolute = false } = {}) {
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
    wrapper.className = DSSelectors.SIDEBAR_WRAPPER_SELECTOR.split('.').pop();
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


const STYLE_ID = 'ds-temp-chat-sidebar-hide-style';
const GET_TYPE = 'DSS_GET_PENDING_UUIDS';


describe('uuidFromHref edge cases', () => {
    it('empty href returns empty uuid', async () => {
        const a = makeChatAnchor('x-empty');
        a.setAttribute('href', '');
        const { group } = makeDateGroup({ uuids: [] });
        group.appendChild(a);
        mountSidebar(group);
        stubPendingUuids(['']);
        await Hide.init();
        expect(isHidden(a)).toBe(false);
    });
    it('trailing slash href extracts uuid', async () => {
        const a = makeChatAnchor('x-trail');
        a.setAttribute('href', '/a/chat/s/my-uuid/');
        const { group } = makeDateGroup({ uuids: [], groupClass: 'no-match' });
        group.appendChild(a);
        mountSidebar(group);
        stubPendingUuids(['my-uuid']);
        await Hide.init();
        expect(isHidden(a)).toBe(true);
    });
    it('query string stripped before uuid', async () => {
        const a = makeChatAnchor('x-qs');
        a.setAttribute('href', '/a/chat/s/q-uuid?foo=bar');
        const { group } = makeDateGroup({ uuids: [], groupClass: 'no-match' });
        group.appendChild(a);
        mountSidebar(group);
        stubPendingUuids(['q-uuid']);
        await Hide.init();
        expect(isHidden(a)).toBe(true);
    });
    it('anchor with no href not hidden', async () => {
        const a = document.createElement('a');
        a.className = '_546d736 b64fb9ae';
        const { group } = makeDateGroup({ uuids: [], groupClass: 'no-match' });
        group.appendChild(a);
        mountSidebar(group);
        stubPendingUuids(['something']);
        await Hide.init();
        expect(isHidden(a)).toBe(false);
    });
});

describe('setQueued edge cases', () => {
    it('non-array uuids in push clears queue', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);
        stubPendingUuids(['u1']);
        await Hide.init();
        expect(isHidden(byUuid.get('u1'))).toBe(true);
        pushPendingUuids('not-an-array');
        expect(isHidden(byUuid.get('u1'))).toBe(false);
    });
    it('falsy values in uuid array ignored', async () => {
        const { group } = makeDateGroup({ uuids: ['u1'] });
        mountSidebar(group);
        stubPendingUuids([null, undefined, '', 0, false]);
        await Hide.init();
        expect(allHidden()).toEqual([]);
    });
});


describe('style injection and removal', () => {
    it('init injects style with correct id', async () => {
        mountSidebar();
        stubPendingUuids([]);
        await Hide.init();
        const style = document.getElementById(STYLE_ID);
        expect(style).not.toBeNull();
        expect(style.tagName).toBe('STYLE');
    });
    it('style contains hidden class with display:none', async () => {
        mountSidebar();
        stubPendingUuids([]);
        await Hide.init();
        const style = document.getElementById(STYLE_ID);
        expect(style.textContent).toContain(HIDDEN_CLASS);
        expect(style.textContent).toContain('display: none');
    });
    it('style appended to document.head', async () => {
        mountSidebar();
        stubPendingUuids([]);
        await Hide.init();
        expect(document.getElementById(STYLE_ID).parentNode).toBe(document.head);
    });
    it('init twice does not duplicate style', async () => {
        mountSidebar();
        stubPendingUuids([]);
        await Hide.init();
        await Hide.init();
        expect(document.querySelectorAll('#' + STYLE_ID).length).toBe(1);
    });
    it('stop removes the injected style', async () => {
        mountSidebar();
        stubPendingUuids([]);
        await Hide.init();
        expect(document.getElementById(STYLE_ID)).not.toBeNull();
        Hide.stop();
        expect(document.getElementById(STYLE_ID)).toBeNull();
    });
});

describe('apply idempotent re-apply', () => {
    it('switching queue re-hides correctly', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);
        stubPendingUuids(['u1']);
        await Hide.init();
        expect(isHidden(byUuid.get('u1'))).toBe(true);
        pushPendingUuids(['u2']);
        expect(isHidden(byUuid.get('u1'))).toBe(false);
        expect(isHidden(byUuid.get('u2'))).toBe(true);
    });
});


describe('scheduleApply coalescing', () => {
    it('falls back to setTimeout when rAF undefined', async () => {
        vi.stubGlobal('requestAnimationFrame', undefined);
        const { group, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);
        stubPendingUuids([]);
        await Hide.init();
        await flush();
        pushPendingUuids(['u1']);
        await flush();
        expect(isHidden(byUuid.get('u1'))).toBe(true);
    });
});


describe('observeSidebar', () => {
    it('observes body when wrapper absent', async () => {
        const a = makeChatAnchor('u1');
        document.body.appendChild(a);
        stubPendingUuids(['u1']);
        await Hide.init();
        await flush();
        expect(isHidden(a)).toBe(true);
    });
    it('re-init disconnects previous observer', async () => {
        const { group } = makeDateGroup({ uuids: ['u1'] });
        mountSidebar(group);
        stubPendingUuids([]);
        await Hide.init();
        await Hide.init();
        expect(allHidden()).toEqual([]);
    });
});

describe('onMessage filtering', () => {
    it('ignores wrong message type', async () => {
        const { group } = makeDateGroup({ uuids: ['u1'] });
        mountSidebar(group);
        stubPendingUuids([]);
        await Hide.init();
        chrome.runtime.onMessage.callListeners({ type: 'WRONG', uuids: ['u1'] }, {}, () => {});
        await flush();
        expect(allHidden()).toEqual([]);
    });
    it('ignores null/undefined messages', async () => {
        mountSidebar();
        stubPendingUuids([]);
        await Hide.init();
        chrome.runtime.onMessage.callListeners(null, {}, () => {});
        chrome.runtime.onMessage.callListeners(undefined, {}, () => {});
        await flush();
        expect(allHidden()).toEqual([]);
    });
});


describe('requestSnapshot', () => {
    it('sends correct message type', async () => {
        mountSidebar();
        stubPendingUuids([]);
        await Hide.init();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: GET_TYPE });
    });
    it('applies uuids from snapshot', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['s1', 's2'] });
        mountSidebar(group);
        stubPendingUuids(['s1']);
        await Hide.init();
        expect(isHidden(byUuid.get('s1'))).toBe(true);
    });
    it('does not apply when ok is false', async () => {
        const { group } = makeDateGroup({ uuids: ['u1'] });
        mountSidebar(group);
        chrome.runtime.sendMessage.mockResolvedValue({ ok: false, uuids: ['u1'] });
        await Hide.init();
        await flush();
        expect(allHidden()).toEqual([]);
    });
    it('handles rejection gracefully', async () => {
        mountSidebar();
        chrome.runtime.sendMessage.mockRejectedValue(new Error('err'));
        await Hide.init();
        await flush();
        expect(allHidden()).toEqual([]);
    });
});

describe('init listener dedup', () => {
    it('init twice - pushes still work', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);
        stubPendingUuids([]);
        await Hide.init();
        await Hide.init();
        pushPendingUuids(['u1']);
        expect(isHidden(byUuid.get('u1'))).toBe(true);
    });
});


describe('stop thorough cleanup', () => {
    it('observer disconnected after stop', async () => {
        const { group } = makeDateGroup({ uuids: ['u1'] });
        const { inner } = mountSidebar(group);
        stubPendingUuids(['u1', 'n1']);
        await Hide.init();
        Hide.stop();
        const { group: added } = makeDateGroup({ uuids: ['n1'] });
        inner.appendChild(added);
        await flush();
        expect(allHidden()).toEqual([]);
    });
    it('listener removed after stop', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['u1'] });
        mountSidebar(group);
        stubPendingUuids([]);
        await Hide.init();
        Hide.stop();
        pushPendingUuids(['u1']);
        await flush();
        expect(isHidden(byUuid.get('u1'))).toBe(false);
    });
    it('all hidden classes removed on stop', async () => {
        const { group } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);
        stubPendingUuids(['u1']);
        await Hide.init();
        expect(allHidden().length).toBeGreaterThan(0);
        Hide.stop();
        expect(allHidden()).toEqual([]);
    });
    it('queue cleared so re-init starts fresh', async () => {
        const { group, byUuid } = makeDateGroup({ uuids: ['u1', 'u2'] });
        mountSidebar(group);
        stubPendingUuids(['u1']);
        await Hide.init();
        expect(isHidden(byUuid.get('u1'))).toBe(true);
        Hide.stop();
        stubPendingUuids([]);
        await Hide.init();
        expect(isHidden(byUuid.get('u1'))).toBe(false);
    });
});


describe('isEveryAnchorQueued', () => {
    it('empty group is NOT hidden', async () => {
        const { group } = makeDateGroup({ uuids: [] });
        mountSidebar(group);
        stubPendingUuids(['anything']);
        await Hide.init();
        expect(isHidden(group)).toBe(false);
    });
});