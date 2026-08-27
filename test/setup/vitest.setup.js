import { vi, beforeEach } from 'vitest';
import InMemoryStorageMock from '../fixtures/chrome-storage-mock.js';

// ── Globals preload (i18n) ──────────────────────────────────────────────────
// dsI18n is referenced by many modules at load time. Load it first so the
// IIFE runs and populates window.dsI18n before any dependent module evaluates.
import '../../utils/i18n.locales.js';
import '../../utils/i18n.js';
// init() is explicit since autoInit was removed. Placement is load-bearing: it MUST run
// while globalThis.chrome is still undefined, so init() skips the storage read and
// registers NO storage listener -- moving it below the chrome mock would inflate
// getStorageOnChangedListenerCount() for background specs.
await globalThis.dsI18n.init();

// __DS_Logger is referenced by background/pending-store.js and
// other modules via globalThis.__DS_Logger?.warn(...). Preload it here (a
// small, dependency-free util with no chrome.* usage at load time) so specs
// exercise the REAL warn() implementation instead of silently falling through
// to each caller's own console.warn fallback branch -- that fallback would
// mask arg-forwarding bugs inside warn() itself. Smaller blast radius than
// stubbing __DS_Logger per-spec since this file has no other side effects.
import '../../utils/logger.js';

// globalThis.DSS_SETTINGS_MSG is read at call time by content/feature-toggle.js
// (message type strings for GET_SETTINGS / SETTINGS_CHANGED). Preload it so any
// spec that loads a toggle-gated content module gets the real constants instead
// of a TypeError inside the toggle's initial settings read.
import '../../utils/settings-message-constants.js';

// ── Bundle / collaborator preloads ──────────────────────────────────────────
// These files set globalThis.__DS_*_* keys. They MUST execute before any spec
// imports an entry file (storage-manager.js, go-top.js, etc.) so that the
// entry's Object.assign finds the bundles already populated.
// utils/temporary-chat-constants.js mounts every DSS_TEMP_CHAT_* constant onto
// globalThis via Object.assign as a load side effect. It MUST load before any
// preloaded module that resolves one of those constants -- content/temporary-chat-enabled-flag.js
// reads DSS_TEMP_CHAT_STORAGE_KEY at load time (its module-level ENABLED_KEY), and the
// temporary-chat-delete.* parts read DSS_* constants at call time. Placed at the top of
// the preload block so it precedes all of them.
import '../../utils/temporary-chat-constants.js';
import '../../utils/storage-manager.keys.js';
import '../../utils/storage-manager.chunk-lock.js';
import '../../utils/storage-manager.rw.js';
import '../../utils/storage-manager.sync.js';
import '../../utils/storage-manager.presets.js';
import '../../utils/storage-manager.chatmap.js';
import '../../utils/storage-manager.local.js';
import '../../utils/storage-manager.init.js';
import '../../utils/storage-manager.setters.js';
import '../../utils/storage-manager.settings-read.js';
import '../../content/censor-reply-restore.markdown.js';
import '../../content/censor-reply-restore.dom.js';
import '../../content/censor-reply-restore.thinkblock.js';
import '../../content/censor-reply-restore.storage.js';
import '../../content/go-top.locate.js';
import '../../content/go-top.render.js';
import '../../content/go-top.scroll.js';
// temporary-chat-enabled-flag.js publishes globalThis.TemporaryChatEnabledFlag, the
// shared enabled-flag cache that content/temporary-chat-toggle.js and the
// temporary-chat-delete entry both resolve at load time (they throw a load-order
// error when it is absent). Preloaded here rather than per-spec because static
// imports are hoisted: a spec cannot reliably order it ahead of its own
// module-under-test import.
import '../../content/temporary-chat-enabled-flag.js';
// temporary-chat-delete.* parts: each sets its own __DSS_TempChatDelete_* global as
// a load side effect and MUST execute before the entry file (content/temporary-chat-delete.js),
// which _requirePart()s all three. Same contract as the storage-manager.* parts above.
import '../../content/temporary-chat-delete.tracking.js';
import '../../content/temporary-chat-delete.coordinator.js';
import '../../content/temporary-chat-delete.handlers.js';
// harvest.policy.js is the pure decision-logic module for content/harvest.js's
// scroll-harvest loop. It must load before harvest.js (loaded directly by
// harvest.spec.js via import, not preloaded here) so window.DSstudio.HarvestPolicy
// is populated before any consumer resolves it.
import '../../content/harvest.policy.js';
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
        // Test helper: how many listeners are currently registered. Lets a spec
        // await a module's load-time bootstrap by polling for the listener that
        // the bootstrap registers as its last step, instead of guessing a tick budget.
        listenerCount: () => listeners.size,
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

// Opt-in test helper: removes every currently-registered chrome.storage.onChanged
// listener. NOT called from the global beforeEach above (that would strip the
// module-load-time listener other specs may depend on) -- a spec that re-invokes
// a content module start() repeatedly (registering a new listener each time)
// must import this and call it from its OWN beforeEach to keep exactly one
// listener live per test.
export function resetStorageOnChangedListeners() {
    [...onChangedListeners].forEach((listener) => storageOnChanged.removeListener(listener));
}

// Registered-listener count for chrome.storage.onChanged, for a spec that needs to
// know whether the module under test has installed its storage listener
// (background/settings-routes.js and friends). Content scripts receive setting
// changes as a chrome.runtime.onMessage broadcast instead -- for those, poll
// chrome.runtime.onMessage.listenerCount().
export function getStorageOnChangedListenerCount() {
    return onChangedListeners.length;
}

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
