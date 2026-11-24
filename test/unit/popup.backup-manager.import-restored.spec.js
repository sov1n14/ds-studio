/**
 * Import of a Restored Messages backup file (popup "Import restore records" button, bindImportRestored of popup/popup.backup-manager.js).
 *
 * Requirement (user decision):
 *   - A file whose restored_messages map holds more than 200 records is rejected; exactly 200 is accepted. Only the file's own record count matters: a file that pushes the merged local total above 200 is accepted.
 *   - The rejection shows the Import Failed dialog with "Too many restore records: {count} (maximum 200)" (zh-TW 「還原記錄過多：{count} 筆（上限 200 筆）」) and leaves storage unchanged.
 *   - An array restored_messages, or a truthy non-object value (a string, a number, true), is rejected like a missing one, with "Invalid backup format: restored_messages is missing or not an object" (zh-TW 「備份格式無效：restored_messages 缺少或不是物件」).
 *
 * Trust boundaries faked: the file picked by the user (input.files[0].text()), the popup Modal and Toast UI, and timers (the success path schedules a page reload). chrome.storage is the suite's in-memory double with copy semantics; StorageManager is the real one. Every assertion reads what chrome.storage.local holds afterwards and what dialog or toast the user saw.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';

const KEY = 'restored_messages';
const MAX_RECORDS = 200;

const TEXT = {
    en: {
        title: 'Import Failed',
        invalid: 'Invalid backup format: restored_messages is missing or not an object',
        tooMany: (count) => `Too many restore records: ${count} (maximum 200)`,
        imported: 'Restored Messages backup imported successfully',
    },
    zh_TW: {
        title: '匯入失敗',
        invalid: '備份格式無效：restored_messages 缺少或不是物件',
        tooMany: (count) => `還原記錄過多：${count} 筆（上限 200 筆）`,
    },
};

/** One record in the shape content/censor-reply-restore.storage.js stores. */
function makeRecord(sessionId, messageId) {
    return {
        message_id: messageId,
        fragments: [{ type: 'RESPONSE', content: `restored reply ${messageId}` }],
        restored_at: 1760000000000 + messageId,
        thinking_elapsed_secs: 0,
        censored: true,
        chat_session_id: sessionId,
        prompt_key: null,
    };
}

/** An object map of `count` records keyed "<session>::<message_id>". */
function makeRecordMap(sessionId, count) {
    const map = {};
    for (let id = 1; id <= count; id++) map[`${sessionId}::${id}`] = makeRecord(sessionId, id);
    return map;
}

const readStoredRecords = async () => (await chrome.storage.local.get(KEY))[KEY];

/**
 * The user picks `fileContent` in the restore-import file picker. Binds a fresh backup manager to a real file input, fires its change event with a fake picked file, and drains the import chain in virtual time (1000 ms, short of the success path's reload timer). The pending reload timer is then discarded and real timers return, so the caller reads storage normally. Returns what the user saw.
 */
async function importRestoreFile(fileContent) {
    const dialogs = [];
    const toasts = [];
    const ctx = {
        StorageManager,
        refreshSyncStatus: async () => {},
        Modal: { confirm: async (options) => { dialogs.push(options); return true; } },
        Toast: { show: (message) => { toasts.push(message); } },
    };
    const button = document.createElement('button');
    const input = document.createElement('input');
    input.type = 'file';
    globalThis.__DS_PopupBackupManager.createBackupManager(ctx).bindImportRestored(button, input);

    const pickedFile = { name: 'restored-backup.json', text: async () => JSON.stringify(fileContent) };
    Object.defineProperty(input, 'files', { value: [pickedFile], configurable: true });
    vi.useFakeTimers();
    try {
        input.dispatchEvent(new Event('change'));
        await vi.advanceTimersByTimeAsync(1000);
    } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
    }
    return { dialogs, toasts };
}

beforeAll(() => {
    evalPopupScript('popup/popup.backup-manager.js');
    if (typeof globalThis.__DS_PopupBackupManager?.createBackupManager !== 'function') {
        throw new Error('popup/popup.backup-manager.js loaded but window.__DS_PopupBackupManager.createBackupManager is not a function');
    }
});

afterEach(() => {
    localStorage.removeItem('ds_studio_locale');
});

describe('Import restore records — en', () => {
    beforeEach(async () => {
        await globalThis.dsI18n.setLocale('en');
    });

    it('rejects a restored_messages array with the invalid-format message and leaves local records unchanged', async () => {
        const seeded = makeRecordMap('sessA', 3);
        await chrome.storage.local.set({ [KEY]: seeded });

        const { dialogs, toasts } = await importRestoreFile({ [KEY]: [makeRecord('sessB', 1), makeRecord('sessB', 2)] });

        expect(await readStoredRecords(), 'local restored_messages must stay exactly as seeded').toEqual(seeded);
        expect(dialogs, 'exactly one Import Failed dialog').toHaveLength(1);
        expect(dialogs[0].title).toBe(TEXT.en.title);
        expect(dialogs[0].message).toContain(TEXT.en.invalid);
        expect(toasts).not.toContain(TEXT.en.imported);
    });

    it('rejects a file holding 201 records with the record-count message and leaves local records unchanged', async () => {
        const seeded = makeRecordMap('sessA', 3);
        await chrome.storage.local.set({ [KEY]: seeded });

        const { dialogs, toasts } = await importRestoreFile({ [KEY]: makeRecordMap('sessB', MAX_RECORDS + 1) });

        expect(await readStoredRecords(), 'local restored_messages must stay exactly as seeded').toEqual(seeded);
        expect(dialogs, 'exactly one Import Failed dialog').toHaveLength(1);
        expect(dialogs[0].title).toBe(TEXT.en.title);
        expect(dialogs[0].message).toContain(TEXT.en.tooMany(201));
        expect(toasts).not.toContain(TEXT.en.imported);
    });

    it('accepts a file holding exactly 200 records and keeps the records already stored', async () => {
        const seeded = makeRecordMap('sessA', 2);
        await chrome.storage.local.set({ [KEY]: seeded });
        const imported = makeRecordMap('sessB', MAX_RECORDS);

        const { dialogs, toasts } = await importRestoreFile({ [KEY]: imported });

        expect(dialogs, 'no Import Failed dialog').toEqual([]);
        const stored = await readStoredRecords();
        expect(Object.keys(stored)).toHaveLength(202);
        expect(stored).toEqual({ ...seeded, ...imported });
        expect(toasts).toContain(TEXT.en.imported);
    });

    it('accepts 150 records when the merged local total (250) exceeds 200, because only the file count is capped', async () => {
        const seeded = makeRecordMap('sessA', 100);
        await chrome.storage.local.set({ [KEY]: seeded });
        const imported = makeRecordMap('sessB', 150);

        const { dialogs, toasts } = await importRestoreFile({ [KEY]: imported });

        expect(dialogs, 'no Import Failed dialog').toEqual([]);
        const stored = await readStoredRecords();
        expect(Object.keys(stored)).toHaveLength(250);
        expect(stored).toEqual({ ...seeded, ...imported });
        expect(toasts).toContain(TEXT.en.imported);
    });

    it.each([
        ['missing', { globalPrompt: 'a settings backup, not a restore backup' }],
        ['null', { [KEY]: null }],
        ['a non-empty string', { [KEY]: 'abc' }],
        ['a non-zero number', { [KEY]: 5 }],
        ['the boolean true', { [KEY]: true }],
    ])('rejects a file whose restored_messages is %s with the invalid-format message and leaves local records unchanged', async (_label, fileContent) => {
        const seeded = makeRecordMap('sessA', 3);
        await chrome.storage.local.set({ [KEY]: seeded });

        const { dialogs, toasts } = await importRestoreFile(fileContent);

        expect(await readStoredRecords(), 'local restored_messages must stay exactly as seeded').toEqual(seeded);
        expect(dialogs, 'exactly one Import Failed dialog').toHaveLength(1);
        expect(dialogs[0].title).toBe(TEXT.en.title);
        expect(dialogs[0].message).toContain(TEXT.en.invalid);
        expect(toasts).not.toContain(TEXT.en.imported);
    });
});

describe('Import restore records — zh-TW messages', () => {
    beforeEach(async () => {
        await globalThis.dsI18n.setLocale('zh_TW');
    });

    it('shows the zh-TW invalid-format message for a restored_messages array', async () => {
        const { dialogs } = await importRestoreFile({ [KEY]: [makeRecord('sessB', 1)] });

        expect(dialogs, 'exactly one Import Failed dialog').toHaveLength(1);
        expect(dialogs[0].title).toBe(TEXT.zh_TW.title);
        expect(dialogs[0].message).toContain(TEXT.zh_TW.invalid);
    });

    it('shows the zh-TW record-count message for a file holding 201 records', async () => {
        const { dialogs } = await importRestoreFile({ [KEY]: makeRecordMap('sessB', MAX_RECORDS + 1) });

        expect(dialogs, 'exactly one Import Failed dialog').toHaveLength(1);
        expect(dialogs[0].title).toBe(TEXT.zh_TW.title);
        expect(dialogs[0].message).toContain(TEXT.zh_TW.tooMany(201));
    });
});
