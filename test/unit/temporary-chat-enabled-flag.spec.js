/**
 * content/temporary-chat-enabled-flag.js -- flag cache, read, write and
 * cross-context sync, driven entirely through the settings messaging pipeline.
 *
 * Requirements source: the flag no longer touches chrome.storage. Its contract:
 *   - initial value: DSS_GET_SETTINGS with keys ['dss-temporary-chat-enabled']
 *   - write: DSS_SET_SETTINGS with { 'dss-temporary-chat-enabled': <boolean> }
 *   - cross-context sync: a DSS_SETTINGS_CHANGED broadcast with area 'local'
 *   - coercion: enabled ONLY when the value is boolean true
 *   - default (pre-init, missing key, failed/refused read): false
 *
 * Every assertion observes public behavior: isEnabled() return values, the
 * messages the module sends, and how many times subscribers are invoked with
 * which value.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../utils/settings-message-constants.js';
// Mounts DSS_TEMP_CHAT_* on globalThis before the module under test reads them,
// matching temporary-chat-sidebar-hide.spec.js. The module reads
// globalThis.DSS_TEMP_CHAT_STORAGE_KEY directly (no hardcoded fallback).
import '../../utils/temporary-chat-constants.js';

const ENABLED_KEY = globalThis.DSS_TEMP_CHAT_STORAGE_KEY;
const MSG = () => globalThis.DSS_SETTINGS_MSG;

/** Backing store the fake settings route answers from; re-seeded per test. */
let store;
let onMessage;

/**
 * Fresh chrome.runtime.onMessage stub (same shape as the shared mock).
 * A new stub per test drops the listeners of previously loaded module
 * instances, so each test observes only its own instance's registration.
 */
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

/** Answer GET_SETTINGS / SET_SETTINGS from `store`, the way background does. */
function installSettingsRoute() {
    chrome.runtime.sendMessage = vi.fn(async (message) => {
        if (message?.type === MSG().GET_SETTINGS) {
            const values = {};
            (message.keys || []).forEach((key) => {
                if (key in store) values[key] = store[key];
            });
            return { ok: true, values };
        }
        if (message?.type === MSG().SET_SETTINGS) {
            Object.assign(store, message.values);
            return { ok: true };
        }
        return { ok: true, values: {} };
    });
}

/** Seed the value the settings route reports for the enabled key. */
function seed(value) {
    store[ENABLED_KEY] = value;
}

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
function broadcast(changes, area = 'local') {
    onMessage.callListeners(
        { type: MSG().SETTINGS_CHANGED, area, changes },
        { id: 'test-extension-id' },
        () => {},
    );
}

/**
 * Load a pristine instance of the module under test.
 * Fresh per test because the module owns a process-lifetime cache and a
 * once-only onMessage registration; a shared instance would make these tests
 * order-dependent.
 */
async function loadFlagModule() {
    vi.resetModules();
    const mod = await import('../../content/temporary-chat-enabled-flag.js');
    return mod.default ?? mod;
}

describe('TemporaryChatEnabledFlag', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        store = {};
        onMessage = createOnMessageStub();
        chrome.runtime.onMessage = onMessage;
        installSettingsRoute();
    });

    describe('R1 - isEnabled() before any initialization', () => {
        it('R1.1: returns false (the disabled default)', async () => {
            const Flag = await loadFlagModule();
            expect(Flag.isEnabled()).toBe(false);
        });
    });

    describe('R2 - initFromStorage()', () => {
        it('R2.1: settings report true -> isEnabled() is true', async () => {
            seed(true);
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(true);
        });

        it('R2.2: settings report false -> isEnabled() is false', async () => {
            seed(false);
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.3: missing key -> isEnabled() falls back to the false default', async () => {
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.4: a non-boolean truthy value is NOT enabled (strict boolean coercion)', async () => {
            seed('true');
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.5: a rejected settings read does not throw and leaves the false default', async () => {
            seed(true);
            const Flag = await loadFlagModule();
            chrome.runtime.sendMessage.mockRejectedValue(new Error('port closed'));
            await Flag.initFromStorage();   // must not reject
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.5b: a refused settings read ({ok:false}) does not throw and leaves the false default', async () => {
            seed(true);
            const Flag = await loadFlagModule();
            chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'boom' });
            await Flag.initFromStorage();   // must not reject
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.6: a later initFromStorage reflects a value changed after the first read', async () => {
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(false);
            seed(true);
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(true);
        });
    });

    describe('R3 - write(isEnabled)', () => {
        it('R3.1: the cache update is visible synchronously, before any await', async () => {
            const Flag = await loadFlagModule();
            Flag.write(true);
            expect(Flag.isEnabled()).toBe(true);
        });

        it('R3.2: asks background to persist true under the enabled key', async () => {
            const Flag = await loadFlagModule();
            Flag.write(true);
            await vi.waitFor(() => {
                expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
            });
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
                type: MSG().SET_SETTINGS,
                values: { [ENABLED_KEY]: true },
            });
            expect(store[ENABLED_KEY]).toBe(true);
        });

        it('R3.3: asks background to persist false, overwriting a previously stored true', async () => {
            seed(true);
            const Flag = await loadFlagModule();
            Flag.write(false);
            expect(Flag.isEnabled()).toBe(false);
            await vi.waitFor(() => {
                expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
            });
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
                type: MSG().SET_SETTINGS,
                values: { [ENABLED_KEY]: false },
            });
            expect(store[ENABLED_KEY]).toBe(false);
        });

        it('R3.4: never touches chrome.storage directly (persistence is background-owned)', async () => {
            const localSet = vi.spyOn(chrome.storage.local, 'set');
            const syncSet = vi.spyOn(chrome.storage.sync, 'set');
            const Flag = await loadFlagModule();

            Flag.write(true);
            await vi.waitFor(() => {
                expect(store[ENABLED_KEY]).toBe(true);
            });

            expect(localSet).not.toHaveBeenCalled();
            expect(syncSet).not.toHaveBeenCalled();
        });

        // ---- rollback contract on a refused/rejected write (behavior not yet implemented) ----

        /** Let all pending microtasks + the current macrotask turn drain. */
        const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

        it('R3.5 (R-A): a rejected write rolls the cache back to the value that was actually persisted', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const Flag = await loadFlagModule();
            Flag.__setCache(true);                 // known persisted value = true
            chrome.runtime.sendMessage.mockRejectedValue(new Error('port closed'));
            Flag.write(false);                     // opposite value; background refuses it
            await settle();
            expect(Flag.isEnabled()).toBe(true);   // never persisted -> must revert to true
        });

        it('R3.6 (R-B): an ok:false response rolls the cache back the same way', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const Flag = await loadFlagModule();
            Flag.__setCache(true);                 // known persisted value = true
            chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'nope' });
            Flag.write(false);                     // background reports failure
            await settle();
            expect(Flag.isEnabled()).toBe(true);   // not persisted -> must revert to true
        });

        it('R3.7 (R-C): the optimistic cache update stays readable synchronously in the rejection scenario', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const Flag = await loadFlagModule();
            Flag.__setCache(false);
            chrome.runtime.sendMessage.mockRejectedValue(new Error('port closed'));
            Flag.write(true);
            expect(Flag.isEnabled()).toBe(true);   // read BEFORE the rejection settles
        });

        it('R3.8 (R-D): a rejected write must not clobber a newer value that arrived after it', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const Flag = await loadFlagModule();
            Flag.__setCache(true);                 // A (persisted)
            chrome.runtime.sendMessage.mockRejectedValue(new Error('port closed'));
            Flag.write(false);                     // B (refused)
            Flag.__setCache(false);                // C arrives before the rejection settles
            await settle();
            // C must survive; a blind restore-old-value rollback would resurrect A (true)
            expect(Flag.isEnabled()).toBe(false);
        });

    });

    describe('R4 - startSync()', () => {
        it('R4.1: a local broadcast of the enabled key updates the cache', async () => {
            const Flag = await loadFlagModule();
            Flag.startSync();
            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: true } });
            expect(Flag.isEnabled()).toBe(true);
        });

        it('R4.2: a local broadcast back to false updates the cache', async () => {
            const Flag = await loadFlagModule();
            Flag.write(true);
            Flag.startSync();
            broadcast({ [ENABLED_KEY]: { oldValue: true, newValue: false } });
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R4.3: a non-boolean newValue is not treated as enabled', async () => {
            const Flag = await loadFlagModule();
            Flag.startSync();
            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: 'true' } });
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R4.4: repeated startSync() calls still produce exactly one notification per change', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((isEnabled) => seen.push(isEnabled));
            Flag.startSync();
            Flag.startSync();
            Flag.startSync();

            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: true } });
            broadcast({ [ENABLED_KEY]: { oldValue: true, newValue: false } });

            expect(seen).toEqual([true, false]);
        });

        it('R4.5: a sync-area broadcast for the same key does not update the cache', async () => {
            const Flag = await loadFlagModule();
            Flag.startSync();
            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'sync');
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R4.6: a message of another type carrying the enabled key does not touch the cache', async () => {
            const Flag = await loadFlagModule();
            Flag.startSync();
            onMessage.callListeners(
                {
                    type: 'DSS_SOME_OTHER_MESSAGE',
                    area: 'local',
                    changes: { [ENABLED_KEY]: { oldValue: false, newValue: true } },
                },
                { id: 'test-extension-id' },
                () => {},
            );
            expect(Flag.isEnabled()).toBe(false);
        });
    });

    describe('R5 - subscribe(fn)', () => {
        it('R5.1: the subscriber receives the new boolean on an enabled-key broadcast', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((isEnabled) => seen.push(isEnabled));
            Flag.startSync();
            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: true } });
            expect(seen).toEqual([true]);
        });

        it('R5.2: every distinct subscriber is notified', async () => {
            const Flag = await loadFlagModule();
            const a = [];
            const b = [];
            Flag.subscribe((v) => a.push(v));
            Flag.subscribe((v) => b.push(v));
            Flag.startSync();
            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: true } });
            expect(a).toEqual([true]);
            expect(b).toEqual([true]);
        });

        it('R5.3: broadcasts about other keys do not notify subscribers', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((v) => seen.push(v));
            Flag.startSync();
            broadcast({ 'some-other-key': { oldValue: 1, newValue: 2 } });
            expect(seen).toEqual([]);
        });

        it('R5.4: a sync-area broadcast does not notify subscribers', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((v) => seen.push(v));
            Flag.startSync();
            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'sync');
            expect(seen).toEqual([]);
        });

        it('R5.5: the same fn subscribed twice is invoked once per change', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            const fn = (v) => seen.push(v);
            Flag.subscribe(fn);
            Flag.subscribe(fn);
            Flag.startSync();
            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: true } });
            expect(seen).toEqual([true]);
        });

        it('R5.6: subscribers are not notified before startSync()', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((v) => seen.push(v));
            broadcast({ [ENABLED_KEY]: { oldValue: false, newValue: true } });
            expect(seen).toEqual([]);
        });
    });
});
