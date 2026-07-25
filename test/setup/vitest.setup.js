import { vi, beforeEach } from 'vitest';
import InMemoryStorageMock from '../fixtures/chrome-storage-mock.js';

// ── Globals preload (i18n) ──────────────────────────────────────────────────
// dsI18n is referenced by many modules at load time. Load it first so the
// IIFE runs and populates window.dsI18n before any dependent module evaluates.
import '../../utils/i18n.js';

// ── Bundle / collaborator preloads ──────────────────────────────────────────
// These files set globalThis.__DS_*_* keys. They MUST execute before any spec
// imports an entry file (storage-manager.js, go-top.js, etc.) so that the
// entry's Object.assign finds the bundles already populated.
import '../../utils/storage-manager.chunk-lock.js';
import '../../utils/storage-manager.sync.js';
import '../../utils/storage-manager.presets.js';
import '../../utils/storage-manager.chatmap.js';
import '../../utils/storage-manager.local.js';
import '../../utils/storage-manager.init.js';
import '../../content/censor-reply-restore.markdown.js';
import '../../content/censor-reply-restore.dom.js';
import '../../content/censor-reply-restore.thinkblock.js';
import '../../content/censor-reply-restore.storage.js';
import '../../content/go-top.locate.js';
import '../../content/go-top.render.js';
import '../../content/go-top.scroll.js';
// Overlay refactor: load the four replacement modules in dependency order so
// that window.__DS_PresetOverlay (and the other globals) are available before
// content-script.js (loaded by individual specs via require) resolves them.
import '../../content/preset-dropdown.position.js';
import '../../content/preset-dropdown.component.js';
import '../../content/preset-overlay.styles.js';
import '../../content/preset-overlay.resolvers.js';
import '../../content/preset-settle.scheduler.js';
import '../../content/preset-overlay.controller.js';
import '../../content/content-script.export.js';

// ResizeObserver stub — happy-dom / jsdom may not implement ResizeObserver.
// The controller feature-detects it (typeof ResizeObserver === 'undefined') and
// skips setup when absent, so this stub simply prevents crashes if the check is
// bypassed or if future code calls it unconditionally.
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
        observe()    {}
        unobserve()  {}
        disconnect() {}
    };
}
// ───────────────────────────────────────────────────────────────────────────

// ── Hand-rolled chrome.* mock ────────────────────────────────────────────────
// Replaces jest-chrome: this suite only touches a small, fixed slice of the
// chrome API (storage, runtime, alarms, tabs, windows), so a full jest-chrome
// + jest 27 peer-dependency stack is unneeded weight for what's effectively a
// handful of vi.fn() calls and three fireable events.

// Mirrors jest-chrome's Event: addListener/removeListener/hasListener plus a
// callListeners() test helper that invokes every registered listener with the
// given args (used by specs to simulate onAlarm/onMessage/onStartup/onInstalled
// firing).
function createMockEvent() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        callListeners: (...args) => listeners.forEach((fn) => fn(...args)),
    };
}

// In-memory storage mocks (real get/set/remove/clear semantics — jest-chrome's
// own storage mocks are plain jest.fn() that never invoke callbacks → hangs).
const storageMock = { local: new InMemoryStorageMock('local'), sync: new InMemoryStorageMock('sync') };
// Fan-in dispatcher: a single addListener(l) call registers the listener on
// BOTH area mocks, so it receives notifications with the correct areaName
// ('local' or 'sync') regardless of which area triggered the change.
const onChangedListeners = [];
const storageOnChanged = {
    addListener: (listener) => {
        onChangedListeners.push(listener);
        storageMock.local.onChanged.addListener(listener);
        storageMock.sync.onChanged.addListener(listener);
    },
    removeListener: (listener) => {
        const idx = onChangedListeners.indexOf(listener);
        if (idx !== -1) onChangedListeners.splice(idx, 1);
        storageMock.local.onChanged.removeListener(listener);
        storageMock.sync.onChanged.removeListener(listener);
    },
    // Test helper (mirrors jest-chrome's Event.callListeners): manually invoke all
    // registered listeners, e.g. to simulate a storage change from another context.
    callListeners: (changes, areaName) => {
        onChangedListeners.forEach((l) => l(changes, areaName));
    },
};

globalThis.chrome = {
    storage: {
        local: storageMock.local,
        sync: storageMock.sync,
        onChanged: storageOnChanged,
        // No `session` area by default — a spec that needs it installs its own
        // stub (see content-script.chat-delete.spec.js's `if (!chrome.storage.session)`).
    },
    runtime: {
        id: 'test-extension-id',
        lastError: undefined,
        getURL: vi.fn(),
        sendMessage: vi.fn(),
        onInstalled: createMockEvent(),
        onStartup: createMockEvent(),
        onMessage: createMockEvent(),
    },
    alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: createMockEvent(),
    },
    tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
    },
    windows: {
        create: vi.fn(),
        update: vi.fn(),
    },
};

beforeEach(() => {
    storageMock.local.clear();
    storageMock.sync.clear();
});
