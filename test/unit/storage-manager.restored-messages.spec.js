/**
 * RED-phase spec for backlog finding B2 (to-do/refactor-backlog-2026-08-22.md:229).
 *
 * Requirement: the 'restored_messages' storage concern must move out of
 * popup/popup.backup-manager.js and into the storage layer
 * (utils/storage-manager.local.js, mixed into the StorageManager global).
 *
 * The data-shape contract below is the one the CURRENT consumer already relies
 * on, cited from popup/popup.backup-manager.js:
 *   - :112-113  `data.restored_messages || {}`  -> a plain OBJECT MAP, default {}
 *   - :141      `typeof importedData.restored_messages !== 'object'` -> object, not array
 *   - :145-146  `{ ...(existing.restored_messages || {}), ...incoming }`
 *               -> shallow merge, INCOMING WINS on key collision (overwrite, not append)
 *   - :182      clear resets the stored value so nothing remains
 *
 * These specs assert observable behavior (resolved values + what actually
 * landed in chrome.storage.local) only.
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const KEY = 'restored_messages';

const readRaw = async () => (await chrome.storage.local.get(KEY))[KEY];

describe('StorageManager — restored-messages API (backlog B2)', () => {

    describe('KEYS constant ownership', () => {
        it('exposes the literal storage key so consumers stop hardcoding the string', () => {
            expect(StorageManager.KEYS.RESTORED_MESSAGES).toBe(KEY);
        });
    });

    describe('getRestoredMessages()', () => {
        it('resolves a defined empty object map when the key was never written', async () => {
            const result = await StorageManager.getRestoredMessages();
            expect(result).toBeDefined();
            expect(result).toEqual({});
        });

        it('resolves the message map itself, not a { restored_messages: ... } wrapper', async () => {
            const stored = { 'msg-1': { text: 'alpha' }, 'msg-2': { text: 'beta' } };
            await chrome.storage.local.set({ [KEY]: stored });

            const result = await StorageManager.getRestoredMessages();
            expect(result).toEqual(stored);
            expect(result).not.toHaveProperty(KEY);
        });

        it('resolves {} — not a wrapper — when an explicitly empty map is stored', async () => {
            await chrome.storage.local.set({ [KEY]: {} });

            const result = await StorageManager.getRestoredMessages();
            expect(result).toEqual({});
            expect(result).not.toHaveProperty(KEY);
        });

        it('is keyed by message id — the shape backup-manager JSON.stringify-s', async () => {
            await chrome.storage.local.set({ [KEY]: { 'msg-1': { text: 'alpha' } } });

            const result = await StorageManager.getRestoredMessages();
            expect(Array.isArray(result)).toBe(false);
            expect(Object.keys(result)).toEqual(['msg-1']);
        });

        // Regression guard for the existing content-layer writer
        // (content/censor-reply-restore.storage.js -> StorageManager.saveRestoredMessages).
        it('round-trips a map written by saveRestoredMessages() without a wrapper', async () => {
            await StorageManager.saveRestoredMessages({ 'msg-1': { text: 'alpha' } });

            await expect(StorageManager.getRestoredMessages()).resolves.toEqual({ 'msg-1': { text: 'alpha' } });
        });
    });

    describe('mergeRestoredMessages(entries)', () => {
        it('adds new entries to an empty store and resolves the merged map', async () => {
            const merged = await StorageManager.mergeRestoredMessages({ 'msg-1': { text: 'alpha' } });

            expect(merged).toEqual({ 'msg-1': { text: 'alpha' } });
        });

        it('keeps pre-existing entries whose keys are not in the incoming payload', async () => {
            await chrome.storage.local.set({ [KEY]: { 'msg-1': { text: 'alpha' } } });

            const merged = await StorageManager.mergeRestoredMessages({ 'msg-2': { text: 'beta' } });

            expect(merged).toEqual({
                'msg-1': { text: 'alpha' },
                'msg-2': { text: 'beta' },
            });
        });

        it('OVERWRITES an existing entry on key collision — incoming wins (backup-manager.js:146)', async () => {
            await chrome.storage.local.set({ [KEY]: { 'msg-1': { text: 'old' } } });

            const merged = await StorageManager.mergeRestoredMessages({ 'msg-1': { text: 'new' } });

            expect(merged['msg-1']).toEqual({ text: 'new' });
        });

        it('persists the merged map to chrome.storage.local under the restored_messages key', async () => {
            await chrome.storage.local.set({ [KEY]: { 'msg-1': { text: 'alpha' } } });

            await StorageManager.mergeRestoredMessages({ 'msg-2': { text: 'beta' } });

            await expect(readRaw()).resolves.toEqual({
                'msg-1': { text: 'alpha' },
                'msg-2': { text: 'beta' },
            });
        });

        it('is durable across calls: a later getRestoredMessages() sees every merged entry', async () => {
            await StorageManager.mergeRestoredMessages({ 'msg-1': { text: 'alpha' } });
            await StorageManager.mergeRestoredMessages({ 'msg-2': { text: 'beta' } });

            await expect(StorageManager.getRestoredMessages()).resolves.toEqual({
                'msg-1': { text: 'alpha' },
                'msg-2': { text: 'beta' },
            });
        });

        it('never writes restored_messages to chrome.storage.sync — this is device-local data', async () => {
            await StorageManager.mergeRestoredMessages({ 'msg-1': { text: 'alpha' } });

            const syncData = await chrome.storage.sync.get(KEY);
            expect(syncData[KEY]).toBeUndefined();
        });
    });

    describe('clearRestoredMessages()', () => {
        it('removes the key so nothing is left behind in local storage', async () => {
            await chrome.storage.local.set({ [KEY]: { 'msg-1': { text: 'alpha' } } });

            await StorageManager.clearRestoredMessages();

            await expect(readRaw()).resolves.toBeUndefined();
        });

        it('leaves getRestoredMessages() resolving the empty default afterwards', async () => {
            await StorageManager.mergeRestoredMessages({ 'msg-1': { text: 'alpha' } });
            await StorageManager.clearRestoredMessages();

            await expect(StorageManager.getRestoredMessages()).resolves.toEqual({});
        });

        it('is a no-op that still resolves when nothing was ever stored', async () => {
            await StorageManager.clearRestoredMessages();

            await expect(StorageManager.getRestoredMessages()).resolves.toEqual({});
        });
    });
});
