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
import { describe, it, expect, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { failRestoredReads, requestsGenerationKey } from '../helpers/censor-reply-restore-harness.js';

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

// A clear whose clear-generation read fails must not write anything: the records stay and the generation is neither raised nor lowered (docs/spec/05-data-storage.md "Clear All Restored Records")
describe('clearRestoredMessages() — the clear-generation read fails', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([['lastError'], ['throw']])('rejects and leaves restored_messages and the generation unchanged when the generation read fails with %s', async (mode) => {
        const generationKey = StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY;
        // 兩次真實清除把世代推到 2 以上，再存一筆記錄
        await StorageManager.clearRestoredMessages();
        await StorageManager.clearRestoredMessages();
        await StorageManager.mergeRestoredMessages({ 'msg-1': { text: 'alpha' } });
        const before = await chrome.storage.local.get([KEY, generationKey]);
        expect(before[generationKey], 'precondition: two clears must have raised the clear generation to 2 or more').toBeGreaterThanOrEqual(2);
        expect(before[KEY], 'precondition: the record must be stored').toEqual({ 'msg-1': { text: 'alpha' } });

        const failure = failRestoredReads(mode, { matches: requestsGenerationKey });
        let rejection = null;
        await StorageManager.clearRestoredMessages().catch((err) => { rejection = err ?? 'rejected without a reason'; });
        failure.disarm();

        expect(failure.failedForms().length, 'precondition: the clear must have hit the failing generation read').toBeGreaterThan(0);
        expect(rejection, 'the clear must reject when its generation read fails').not.toBeNull();
        expect(await chrome.storage.local.get([KEY, generationKey]), 'the failed clear must leave the records and the generation as they were').toEqual(before);
    });
});

// A failed restored-message read rejects with the platform's own lastError message, so the caller (the popup clear-failed path, a tab save's warning) can report what failed
describe('restored-message reads that fail with chrome.runtime.lastError', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([['getRestoredMessagesClearGeneration'], ['getRestoredMessagesSnapshot'], ['clearRestoredMessages']])('%s() rejects with an Error carrying the lastError message', async (method) => {
        const failure = failRestoredReads('lastError', { matches: requestsGenerationKey });

        const rejection = await StorageManager[method]().then(() => null, (err) => err);
        failure.disarm();

        expect(failure.failedForms(), 'precondition: the call must have hit the failing callback-form read').toContain('callback lastError');
        expect(rejection, 'the call must reject with an Error').toBeInstanceOf(Error);
        expect(rejection.message, 'the rejection must carry the lastError message').toBe('IO error: restored_messages read failed');
    });
});

// docs/architecture/STORAGE.md and docs/spec/05-data-storage.md name the persisted key; a stored generation under another name would read as 0 after an update
describe('the clear generation storage key', () => {
    it('persists the clear generation under dsRestoredMessagesClearGeneration in chrome.storage.local', async () => {
        const previousManager = globalThis.StorageManager;
        const previousKeys = globalThis.__DS_StorageManager_keys;
        try {
            // 在測試內重新載入鍵值群組與入口檔，取得以本次載入結果組成的 StorageManager
            vi.resetModules();
            await import('../../utils/storage-manager.keys.js');
            const mod = await import('../../utils/storage-manager.js');
            const fresh = mod.default ?? mod;
            expect(fresh, 'precondition: the StorageManager must be freshly composed').not.toBe(previousManager);

            await fresh.clearRestoredMessages();
            await fresh.clearRestoredMessages();

            const stored = await chrome.storage.local.get('dsRestoredMessagesClearGeneration');
            expect(stored.dsRestoredMessagesClearGeneration, 'two clears must leave generation 2 under the documented key').toBe(2);
        } finally {
            globalThis.StorageManager = previousManager;
            if (typeof window !== 'undefined') window.StorageManager = previousManager;
            globalThis.__DS_StorageManager_keys = previousKeys;
        }
    });
});

// A synchronous throw of chrome.storage.local.set (such as "Extension context invalidated.") must not hang the caller and must leave a readable trace (CHANGELOG v4: "`_safeSet` logs a `[DSS]` warning for a synchronous throw and still resolves")
describe('saveRestoredMessages() — chrome.storage.local.set throws synchronously', () => {
    const THROW_MESSAGE = 'Extension context invalidated.';
    const SETTLE_BUDGET_MS = 500;

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // 讓寫入 restored_messages 的 chrome.storage.local.set 同步拋出，回傳拋出的錯誤與次數
    function throwOnRestoredWrite() {
        const area = chrome.storage.local;
        const originalSet = area.set.bind(area);
        const thrown = [];
        vi.spyOn(area, 'set').mockImplementation((items, callback) => {
            if (items && typeof items === 'object' && KEY in items) {
                const error = new Error(THROW_MESSAGE);
                thrown.push(error);
                throw error;
            }
            return originalSet(items, callback);
        });
        return { thrown: () => thrown.slice() };
    }

    // 在時限內等待 promise 結算：回傳 'resolved'、'rejected' 或 'did not settle'，永不結算的 promise 讓測試失敗而不是卡住
    async function settlementWithin(promise, ms) {
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('did not settle within ' + ms + ' ms'), ms); });
        try {
            return await Promise.race([promise.then(() => 'resolved', () => 'rejected'), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    it('resolves the save promise instead of leaving the caller waiting forever', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const write = throwOnRestoredWrite();

        const outcome = await settlementWithin(StorageManager.saveRestoredMessages({ 'msg-1': { text: 'alpha' } }), SETTLE_BUDGET_MS);

        expect(write.thrown(), 'precondition: the save must have hit the throwing set').toHaveLength(1);
        expect(outcome, 'the save must resolve after a synchronous set throw').toBe('resolved');
    });

    it('logs one [DSS] warning that names the throwing call and carries the thrown error', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const write = throwOnRestoredWrite();

        await settlementWithin(StorageManager.saveRestoredMessages({ 'msg-1': { text: 'alpha' } }), SETTLE_BUDGET_MS);

        expect(write.thrown(), 'precondition: the save must have hit the throwing set').toHaveLength(1);
        expect(warnSpy.mock.calls, 'the console must show which storage call threw, followed by the thrown error').toEqual([
            ['[DSS] storage-manager: chrome.storage.local.set threw:', write.thrown()[0]]
        ]);
    });
});
