/**
 * StorageManager.syncNow() — unified sync entry point (report.md §4.1)
 *
 * Spec under test (per item: dsPreset_<id>, dsPresetIndex/dsPresetOrderMeta,
 * and settings keys):
 *   1. Fetch remote (sync) snapshot vs local snapshot.
 *   2. Compare updatedAt.
 *   3. Remote newer  -> overwrite local (persisted to chrome.storage.local,
 *      not merely returned in-memory).
 *   4. Local newer   -> keep local, then auto-push to remote (reusing
 *      _shouldPushPreset-style logic) — regardless of whether the item was
 *      ever parked in dsLocalAuth.
 *   5. Exact tie     -> no push, no overwrite.
 *   6. Each item resolves independently within one syncNow() call.
 *
 * Current implementation (utils/storage-manager.syncnow.js):
 *   async syncNow() { await this.retrySync(); return this.getSettings(); }
 *
 * retrySync() only iterates keys parked in dsLocalAuth (the pending-retry
 * queue for previously *failed* writes). getSettings() -> _get() only pins
 * a local value into the *returned* merged object when dsLocalAuth already
 * contains that key; it never issues a chrome.storage.sync.set() push.
 *
 * Therefore a normal, never-parked local edit that is simply newer than a
 * stale remote copy is expected to be a gap: neither retrySync() (nothing
 * queued) nor getSettings() (read-only) will push it to remote. That test
 * is intentionally kept red if the implementation has not been fixed — see
 * the inline comments below.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete chrome.runtime.lastError;
});

afterEach(() => {
    chrome.storage.sync.setQuotaError(false);
    delete chrome.runtime.lastError;
    vi.restoreAllMocks();
});

describe('syncNow() — remote newer for a preset', () => {
    it('overwrites local storage with remote content (persisted, not just returned in-memory)', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'StaleLocal', content: 'stale', createdAt: 1, updatedAt: 50 },
            [K.PRESET_INDEX]: ['p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'FreshRemote', content: 'fresh', createdAt: 1, updatedAt: 500 },
            [K.PRESET_INDEX]: ['p1'],
        });

        const settings = await StorageManager.syncNow();

        // The returned settings must reflect the remote-newer value.
        const returned = settings.promptPresets.find(p => p.id === 'p1');
        expect(returned.name).toBe('FreshRemote');

        // The overwrite must also be persisted to chrome.storage.local, so a
        // subsequent read (even offline) sees the converged value.
        const localAfter = await chrome.storage.local.get(['dsPreset_p1']);
        expect(localAfter.dsPreset_p1.name).toBe('FreshRemote');
    });

    it('does not issue a redundant sync push for the remote-newer item in the same pass', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'StaleLocal', content: 'stale', createdAt: 1, updatedAt: 50 },
            [K.PRESET_INDEX]: ['p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'FreshRemote', content: 'fresh', createdAt: 1, updatedAt: 500 },
            [K.PRESET_INDEX]: ['p1'],
        });

        await StorageManager.syncNow();

        // Remote must remain untouched by a push of the stale local value.
        const syncAfter = await chrome.storage.sync.get(['dsPreset_p1']);
        expect(syncAfter.dsPreset_p1.name).toBe('FreshRemote');
    });
});

describe('syncNow() — local newer, never parked in dsLocalAuth (critical case)', () => {
    it('pushes an unparked local edit to remote when local is newer than a stale remote copy', async () => {
        // Simulates a normal successful local edit (never failed, so it was
        // never added to dsLocalAuth) that simply has not reached the cloud
        // yet because no push was ever attempted for it in this pass.
        await chrome.storage.local.set({
            dsPreset_p2: { id: 'p2', name: 'FreshLocal', content: 'fresh', createdAt: 1, updatedAt: 900 },
            [K.PRESET_INDEX]: ['p2'],
            [K.LOCAL_AUTHORITATIVE]: [], // explicitly NOT parked
        });
        await chrome.storage.sync.set({
            dsPreset_p2: { id: 'p2', name: 'StaleRemote', content: 'stale', createdAt: 1, updatedAt: 100 },
            [K.PRESET_INDEX]: ['p2'],
        });

        await StorageManager.syncNow();

        // Per report.md §4.1 item 4, local-newer items must be auto-pushed
        // to remote regardless of dsLocalAuth parking history.
        const syncAfter = await chrome.storage.sync.get(['dsPreset_p2']);
        expect(syncAfter.dsPreset_p2.name).toBe('FreshLocal');
    });
});

describe('syncNow() — exact tie (equal updatedAt, differing content)', () => {
    it('resolves deterministically and issues zero additional push calls', async () => {
        const tieTs = 777;
        await chrome.storage.local.set({
            dsPreset_p3: { id: 'p3', name: 'LocalVariant', content: 'local-content', createdAt: 1, updatedAt: tieTs },
            [K.PRESET_INDEX]: ['p3'],
        });
        await chrome.storage.sync.set({
            dsPreset_p3: { id: 'p3', name: 'RemoteVariant', content: 'remote-content', createdAt: 1, updatedAt: tieTs },
            [K.PRESET_INDEX]: ['p3'],
        });

        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        const settings = await StorageManager.syncNow();
        const returned = settings.promptPresets.find(p => p.id === 'p3');

        // Deterministic per existing tie-break rule: _pickNewerPreset treats
        // sync as authoritative on an exact tie (sync-wins merge, no winner
        // swap triggered since neither side is strictly newer).
        expect(returned.name).toBe('RemoteVariant');

        // Remote content must remain exactly what it was — no push occurred
        // as a result of resolving this tie.
        const syncAfter = await chrome.storage.sync.get(['dsPreset_p3']);
        expect(syncAfter.dsPreset_p3.name).toBe('RemoteVariant');
        expect(setSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ dsPreset_p3: expect.objectContaining({ name: 'LocalVariant' }) }),
        );
    });
});

describe('syncNow() — two different items resolve independently in the same call', () => {
    it('item A goes remote-newer while item B goes local-newer, both correct simultaneously', async () => {
        await chrome.storage.local.set({
            dsPreset_a: { id: 'a', name: 'StaleLocalA', content: 'stale-a', createdAt: 1, updatedAt: 10 },
            dsPreset_b: { id: 'b', name: 'FreshLocalB', content: 'fresh-b', createdAt: 1, updatedAt: 999 },
            [K.PRESET_INDEX]: ['a', 'b'],
            [K.LOCAL_AUTHORITATIVE]: [], // neither item parked
        });
        await chrome.storage.sync.set({
            dsPreset_a: { id: 'a', name: 'FreshRemoteA', content: 'fresh-a', createdAt: 1, updatedAt: 500 },
            dsPreset_b: { id: 'b', name: 'StaleRemoteB', content: 'stale-b', createdAt: 1, updatedAt: 20 },
            [K.PRESET_INDEX]: ['a', 'b'],
        });

        const settings = await StorageManager.syncNow();

        const returnedA = settings.promptPresets.find(p => p.id === 'a');
        const returnedB = settings.promptPresets.find(p => p.id === 'b');
        expect(returnedA.name).toBe('FreshRemoteA');
        expect(returnedB.name).toBe('FreshLocalB');

        // Item A: remote-newer overwrite must persist to local.
        const localAfter = await chrome.storage.local.get(['dsPreset_a']);
        expect(localAfter.dsPreset_a.name).toBe('FreshRemoteA');

        // Item B: local-newer, unparked, must still be pushed to remote.
        const syncAfter = await chrome.storage.sync.get(['dsPreset_b']);
        expect(syncAfter.dsPreset_b.name).toBe('FreshLocalB');
    });
});

describe('syncNow() call-site wiring', () => {
    it('popup.js invokes StorageManager.syncNow() during its refresh/init flow', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const popupCode = readFileSync(resolve(__dirname, '../../popup/popup.js'), 'utf-8');

        expect(popupCode).toMatch(/StorageManager\.syncNow\s*\(\s*\)/);
    });

    it('content-script.js initSettings() invokes StorageManager.syncNow()', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const contentCode = readFileSync(resolve(__dirname, '../../content/content-script.js'), 'utf-8');

        const initSettingsMatch = contentCode.match(/async function initSettings\(\)\s*\{[\s\S]*?\n\}/);
        expect(initSettingsMatch).not.toBeNull();
        expect(initSettingsMatch[0]).toMatch(/StorageManager\.syncNow\s*\(\s*\)/);
    });
});
