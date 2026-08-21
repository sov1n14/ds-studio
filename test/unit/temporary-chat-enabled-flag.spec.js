/**
 * RED-PHASE SPEC - content/temporary-chat-enabled-flag.js does not exist yet.
 *
 * Requirements source: consolidation of the duplicated "temporary chat enabled"
 * flag cache/read/onChanged logic. Assertions derive from the stated
 * requirements (observable inputs -> observable outputs) only:
 *   - storage key: 'dss-temporary-chat-enabled' in chrome.storage.local
 *   - coercion: a stored value counts as enabled ONLY when it is boolean true
 *   - default (pre-init, missing key, storage failure): false
 *
 * Every assertion observes public behavior: isEnabled() return values, what
 * lands in chrome.storage.local, and how many times subscribers are invoked
 * with which value. No internal call sequence is asserted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetStorageOnChangedListeners } from '../setup/vitest.setup.js';

const ENABLED_KEY = 'dss-temporary-chat-enabled';

/**
 * Load a pristine instance of the module under test.
 * Fresh per test because the module owns a process-lifetime cache and a
 * once-only onChanged registration; a shared instance would make these tests
 * order-dependent.
 */
async function loadFlagModule() {
    vi.resetModules();
    const mod = await import('../../content/temporary-chat-enabled-flag.js');
    return mod.default ?? mod;
}

/** Fire a storage change event as if it came from another tab or context. */
function fireStorageChange(changes, areaName) {
    chrome.storage.onChanged.callListeners(changes, areaName);
}

describe('TemporaryChatEnabledFlag', () => {
    beforeEach(() => {
        // The global beforeEach in vitest.setup.js clears both storage areas.
        // Drop listeners left behind by previously loaded module instances so
        // each test observes only the registrations of its own instance.
        resetStorageOnChangedListeners();
        vi.restoreAllMocks();
    });

    describe('R1 - isEnabled() before any initialization', () => {
        it('R1.1: returns false (the disabled default)', async () => {
            const Flag = await loadFlagModule();
            expect(Flag.isEnabled()).toBe(false);
        });
    });

    describe('R2 - initFromStorage()', () => {
        it('R2.1: stored true -> isEnabled() is true', async () => {
            await chrome.storage.local.set({ [ENABLED_KEY]: true });
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(true);
        });

        it('R2.2: stored false -> isEnabled() is false', async () => {
            await chrome.storage.local.set({ [ENABLED_KEY]: false });
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.3: missing key -> isEnabled() falls back to the false default', async () => {
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.4: a non-boolean truthy stored value is NOT enabled (strict boolean coercion)', async () => {
            await chrome.storage.local.set({ [ENABLED_KEY]: 'true' });
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.5: a storage read rejection does not throw and leaves the false default', async () => {
            const Flag = await loadFlagModule();
            vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('storage unavailable'));
            await Flag.initFromStorage();   // must not reject
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R2.6: a later initFromStorage reflects a value stored after the first read', async () => {
            const Flag = await loadFlagModule();
            await Flag.initFromStorage();
            expect(Flag.isEnabled()).toBe(false);
            await chrome.storage.local.set({ [ENABLED_KEY]: true });
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

        it('R3.2: persists true under the enabled key in chrome.storage.local', async () => {
            const Flag = await loadFlagModule();
            Flag.write(true);
            await vi.waitFor(async () => {
                const stored = await chrome.storage.local.get([ENABLED_KEY]);
                expect(stored[ENABLED_KEY]).toBe(true);
            });
        });

        it('R3.3: persists false, overwriting a previously stored true', async () => {
            await chrome.storage.local.set({ [ENABLED_KEY]: true });
            const Flag = await loadFlagModule();
            Flag.write(false);
            expect(Flag.isEnabled()).toBe(false);
            await vi.waitFor(async () => {
                const stored = await chrome.storage.local.get([ENABLED_KEY]);
                expect(stored[ENABLED_KEY]).toBe(false);
            });
        });

        it('R3.4: does not write the flag to the sync area', async () => {
            const Flag = await loadFlagModule();
            Flag.write(true);
            await vi.waitFor(async () => {
                const stored = await chrome.storage.local.get([ENABLED_KEY]);
                expect(stored[ENABLED_KEY]).toBe(true);
            });
            const syncStored = await chrome.storage.sync.get([ENABLED_KEY]);
            expect(syncStored[ENABLED_KEY]).toBeUndefined();
        });
    });

    describe('R4 - startSync()', () => {
        it('R4.1: a local change to the enabled key updates the cache', async () => {
            const Flag = await loadFlagModule();
            Flag.startSync();
            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'local');
            expect(Flag.isEnabled()).toBe(true);
        });

        it('R4.2: a local change back to false updates the cache', async () => {
            const Flag = await loadFlagModule();
            Flag.write(true);
            Flag.startSync();
            fireStorageChange({ [ENABLED_KEY]: { oldValue: true, newValue: false } }, 'local');
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R4.3: a non-boolean newValue is not treated as enabled', async () => {
            const Flag = await loadFlagModule();
            Flag.startSync();
            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: 'true' } }, 'local');
            expect(Flag.isEnabled()).toBe(false);
        });

        it('R4.4: repeated startSync() calls still produce exactly one notification per change', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((isEnabled) => seen.push(isEnabled));
            Flag.startSync();
            Flag.startSync();
            Flag.startSync();

            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'local');
            fireStorageChange({ [ENABLED_KEY]: { oldValue: true, newValue: false } }, 'local');

            expect(seen).toEqual([true, false]);
        });

        it('R4.5: a change in the sync area for the same key does not update the cache', async () => {
            const Flag = await loadFlagModule();
            Flag.startSync();
            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'sync');
            expect(Flag.isEnabled()).toBe(false);
        });
    });

    describe('R5 - subscribe(fn)', () => {
        it('R5.1: the subscriber receives the new boolean on an enabled-key change', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((isEnabled) => seen.push(isEnabled));
            Flag.startSync();
            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'local');
            expect(seen).toEqual([true]);
        });

        it('R5.2: every distinct subscriber is notified', async () => {
            const Flag = await loadFlagModule();
            const a = [];
            const b = [];
            Flag.subscribe((v) => a.push(v));
            Flag.subscribe((v) => b.push(v));
            Flag.startSync();
            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'local');
            expect(a).toEqual([true]);
            expect(b).toEqual([true]);
        });

        it('R5.3: changes to other keys do not notify subscribers', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((v) => seen.push(v));
            Flag.startSync();
            fireStorageChange({ 'some-other-key': { oldValue: 1, newValue: 2 } }, 'local');
            expect(seen).toEqual([]);
        });

        it('R5.4: a sync-area change does not notify subscribers', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((v) => seen.push(v));
            Flag.startSync();
            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'sync');
            expect(seen).toEqual([]);
        });

        it('R5.5: the same fn subscribed twice is invoked once per change', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            const fn = (v) => seen.push(v);
            Flag.subscribe(fn);
            Flag.subscribe(fn);
            Flag.startSync();
            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'local');
            expect(seen).toEqual([true]);
        });

        it('R5.6: subscribers are not notified before startSync()', async () => {
            const Flag = await loadFlagModule();
            const seen = [];
            Flag.subscribe((v) => seen.push(v));
            fireStorageChange({ [ENABLED_KEY]: { oldValue: false, newValue: true } }, 'local');
            expect(seen).toEqual([]);
        });
    });
});
