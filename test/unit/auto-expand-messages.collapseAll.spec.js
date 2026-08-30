/**
 * content/auto-expand-messages.js — _collapseAll() and disable() behavior.
 *
 * DOM-adapter layer tests: the module manipulates DeepSeek expand-button
 * containers via class-based selectors and click events.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';

const CONTAINER_CLASS = '_08f18f6';
const ICON_CLASS = 'd630ec62';
const OWN_KEY = 'dsAutoExpandMessages';

// ─────────────────────────────────────────────────────────────────────────────
//  DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

function createContainer({ isCollapsed = false, hasAutoExpanded = false } = {}) {
    const container = document.createElement('div');
    container.classList.add(CONTAINER_CLASS);
    container.click = vi.fn();

    const icon = document.createElement('span');
    icon.classList.add(ICON_CLASS);
    if (isCollapsed) {
        icon.style.transform = 'rotate(180deg)';
    }
    container.appendChild(icon);

    if (hasAutoExpanded) {
        container.dataset.dssAutoExpanded = '1';
    }

    document.body.appendChild(container);
    return container;
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

function cleanup() {
    if (AutoExpandMessages) {
        AutoExpandMessages._stopObserver();
        AutoExpandMessages.enabled = false;
    }
    document.body.innerHTML = '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('AutoExpandMessages._collapseAll()', () => {
    beforeEach(async () => {
        document.body.innerHTML = '';
        onMessage = createOnMessageStub();
        sendMessage = vi.fn();
        chrome.runtime.onMessage = onMessage;
        chrome.runtime.sendMessage = sendMessage;
        await loadModule();
    });

    afterEach(cleanup);

    it('clicks only expanded containers, not collapsed ones', () => {
        const expanded1 = createContainer({ isCollapsed: false });
        const expanded2 = createContainer({ isCollapsed: false });
        const collapsed = createContainer({ isCollapsed: true });

        AutoExpandMessages._collapseAll();

        expect(expanded1.click).toHaveBeenCalledTimes(1);
        expect(expanded2.click).toHaveBeenCalledTimes(1);
        expect(collapsed.click).not.toHaveBeenCalled();
    });

    it('removes data-dssAutoExpanded from ALL containers regardless of state', () => {
        const expanded = createContainer({ isCollapsed: false, hasAutoExpanded: true });
        const collapsed = createContainer({ isCollapsed: true, hasAutoExpanded: true });
        const noAttr = createContainer({ isCollapsed: false, hasAutoExpanded: false });

        AutoExpandMessages._collapseAll();

        expect(expanded.dataset.dssAutoExpanded).toBeUndefined();
        expect(collapsed.dataset.dssAutoExpanded).toBeUndefined();
        expect(noAttr.dataset.dssAutoExpanded).toBeUndefined();
    });
});

describe('AutoExpandMessages.disable()', () => {
    beforeEach(async () => {
        document.body.innerHTML = '';
        onMessage = createOnMessageStub();
        sendMessage = vi.fn();
        chrome.runtime.onMessage = onMessage;
        chrome.runtime.sendMessage = sendMessage;
        await loadModule({ isEnabled: true, [OWN_KEY]: true });
    });

    afterEach(cleanup);

    it('collapses expanded containers, stops observer, and sets enabled to false', () => {
        AutoExpandMessages.enable();

        const expanded = createContainer({ isCollapsed: false, hasAutoExpanded: true });
        const collapsed = createContainer({ isCollapsed: true, hasAutoExpanded: true });

        expect(AutoExpandMessages._observer).not.toBeNull();

        AutoExpandMessages.disable();

        expect(expanded.click).toHaveBeenCalledTimes(1);
        expect(collapsed.click).not.toHaveBeenCalled();
        expect(expanded.dataset.dssAutoExpanded).toBeUndefined();
        expect(collapsed.dataset.dssAutoExpanded).toBeUndefined();
        expect(AutoExpandMessages._observer).toBeNull();
        expect(AutoExpandMessages.enabled).toBe(false);
    });
});
