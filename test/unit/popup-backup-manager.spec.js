/**
 * popup/popup.backup-manager.js — bindExportJson/bindImportJson/bindExportRestored/
 * bindImportRestored/bindClearRestored unit tests.
 *
 * No dedicated spec existed for this module pre-refactor (previously
 * createBackupManager(ctx) had no test coverage at all). This module is a plain
 * classic-script file (5 top-level bind* functions, no window bridge) that
 * references bare globals Toast / Modal / StorageManager / dsI18n / chrome —
 * stubbed as globalThis properties before each test, mirroring the pattern used
 * in popup-preset-manager.spec.js / popup-live-sync.spec.js.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

beforeAll(() => {
    if (!globalThis.dsI18n) {
        const i18nCode = readFileSync(resolve(__dirname, '../../utils/i18n.js'), 'utf-8');
        eval('var chrome=globalThis.chrome,document=globalThis.document,window=globalThis;' + i18nCode);
    }

    const code = readFileSync(resolve(__dirname, '../../popup/popup.backup-manager.js'), 'utf-8');
    const globalEval = eval;
    globalEval(code);
    if (typeof globalThis.bindExportJson !== 'function') {
        throw new Error('bindExportJson was not exposed as a global after eval');
    }

    // happy-dom does not implement URL.createObjectURL/revokeObjectURL.
    if (typeof URL.createObjectURL !== 'function') {
        URL.createObjectURL = vi.fn(() => 'blob:stub');
    }
    if (typeof URL.revokeObjectURL !== 'function') {
        URL.revokeObjectURL = vi.fn();
    }
});

beforeEach(async () => {
    if (globalThis.dsI18n) {
        globalThis.dsI18n._reset();
        await globalThis.dsI18n.init();
    }

    globalThis.StorageManager = {
        getSettings: vi.fn().mockResolvedValue({ promptPresets: [], isEnabled: true }),
        restoreSettings: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.Modal = {
        confirm: vi.fn().mockResolvedValue(true),
    };
    globalThis.Toast = {
        show: vi.fn(),
    };
    globalThis.refreshSyncStatus = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

function makeFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    return input;
}

describe('bindExportJson(exportJsonBtn)', () => {
    it('does nothing when given a null button (guard clause)', () => {
        expect(() => bindExportJson(null)).not.toThrow();
    });

    it('exports current settings as a JSON download and shows a success toast', async () => {
        const btn = document.createElement('button');
        bindExportJson(btn);

        btn.dispatchEvent(new Event('click'));
        await Promise.resolve();
        await Promise.resolve();

        expect(globalThis.StorageManager.getSettings).toHaveBeenCalled();
        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(globalThis.Toast.show).toHaveBeenCalledWith(dsI18n.t('settingsExportedToast'));
    });

    it('shows a failure toast when getSettings() rejects', async () => {
        globalThis.StorageManager.getSettings.mockRejectedValue(new Error('boom'));
        const btn = document.createElement('button');
        bindExportJson(btn);

        btn.dispatchEvent(new Event('click'));
        await Promise.resolve();
        await Promise.resolve();

        expect(globalThis.Toast.show).toHaveBeenCalledWith(dsI18n.t('exportFailedToast'));
    });
});

describe('bindImportJson(importJsonBtn, importJsonInput)', () => {
    it('does nothing when either element is missing (guard clause)', () => {
        expect(() => bindImportJson(null, makeFileInput())).not.toThrow();
        expect(() => bindImportJson(document.createElement('button'), null)).not.toThrow();
    });

    it('clicking the button triggers the hidden file input', () => {
        const btn = document.createElement('button');
        const input = makeFileInput();
        const clickSpy = vi.spyOn(input, 'click');
        bindImportJson(btn, input);

        btn.dispatchEvent(new Event('click'));

        expect(clickSpy).toHaveBeenCalled();
    });

    it('rejects a file missing promptPresets with a failure Modal, without restoring', async () => {
        const btn = document.createElement('button');
        const input = makeFileInput();
        bindImportJson(btn, input);

        const file = new File([JSON.stringify({ notPresets: true })], 'backup.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        expect(globalThis.StorageManager.restoreSettings).not.toHaveBeenCalled();
        expect(globalThis.Modal.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ title: dsI18n.t('restoreFailedTitle') })
        );
    });

    it('restores settings and shows a success toast for a valid backup when the user confirms', async () => {
        globalThis.Modal.confirm.mockResolvedValue(true);
        const btn = document.createElement('button');
        const input = makeFileInput();
        bindImportJson(btn, input);

        const payload = { promptPresets: [{ id: 'p1', name: 'A', content: '' }] };
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        expect(globalThis.StorageManager.restoreSettings).toHaveBeenCalledWith(payload);
        expect(globalThis.Toast.show).toHaveBeenCalledWith(dsI18n.t('settingsRestoredToast'));
    });

    it('does not restore when the user cancels the confirm dialog', async () => {
        globalThis.Modal.confirm.mockResolvedValue(false);
        const btn = document.createElement('button');
        const input = makeFileInput();
        bindImportJson(btn, input);

        const payload = { promptPresets: [] };
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        expect(globalThis.StorageManager.restoreSettings).not.toHaveBeenCalled();
    });
});

describe('bindExportRestored(exportRestoredBtn)', () => {
    it('does nothing when given a null button (guard clause)', () => {
        expect(() => bindExportRestored(null)).not.toThrow();
    });

    it('exports restored_messages from chrome.storage.local as a download', async () => {
        await chrome.storage.local.set({ restored_messages: { m1: 'text' } });
        const btn = document.createElement('button');
        bindExportRestored(btn);

        btn.dispatchEvent(new Event('click'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(globalThis.Toast.show).toHaveBeenCalledWith(dsI18n.t('restoredBackupExportedToast'));
    });
});

describe('bindImportRestored(importRestoredBtn, importRestoredInput)', () => {
    it('does nothing when either element is missing (guard clause)', () => {
        expect(() => bindImportRestored(null, makeFileInput())).not.toThrow();
    });

    it('rejects a file whose restored_messages is not an object with a failure Modal', async () => {
        const btn = document.createElement('button');
        const input = makeFileInput();
        bindImportRestored(btn, input);

        const file = new File([JSON.stringify({ restored_messages: 'not-an-object' })], 'restore.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        expect(globalThis.Modal.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ title: dsI18n.t('importFailedTitle') })
        );
    });

    it('merges imported restored_messages into chrome.storage.local and shows a success toast', async () => {
        await chrome.storage.local.set({ restored_messages: { existing: 'A' } });
        const btn = document.createElement('button');
        const input = makeFileInput();
        bindImportRestored(btn, input);

        const file = new File([JSON.stringify({ restored_messages: { imported: 'B' } })], 'restore.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        const data = await chrome.storage.local.get('restored_messages');
        expect(data.restored_messages).toEqual({ existing: 'A', imported: 'B' });
        expect(globalThis.Toast.show).toHaveBeenCalledWith(dsI18n.t('restoredBackupImportedToast'));
    });
});

describe('bindClearRestored(clearRestoredBtn)', () => {
    it('does nothing when given a null button (guard clause)', () => {
        expect(() => bindClearRestored(null)).not.toThrow();
    });

    it('clears restored_messages in chrome.storage.local when the user confirms', async () => {
        await chrome.storage.local.set({ restored_messages: { m1: 'text' } });
        globalThis.chrome.tabs.query = vi.fn().mockResolvedValue([]);
        globalThis.Modal.confirm.mockResolvedValue(true);

        const btn = document.createElement('button');
        bindClearRestored(btn);
        btn.dispatchEvent(new Event('click'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        const data = await chrome.storage.local.get('restored_messages');
        expect(data.restored_messages).toEqual({});
        expect(globalThis.Toast.show).toHaveBeenCalledWith(dsI18n.t('restoredRecordsClearedToast'));
    });

    it('does not clear when the user cancels the confirm dialog', async () => {
        await chrome.storage.local.set({ restored_messages: { m1: 'text' } });
        globalThis.Modal.confirm.mockResolvedValue(false);

        const btn = document.createElement('button');
        bindClearRestored(btn);
        btn.dispatchEvent(new Event('click'));
        await new Promise((r) => setTimeout(r, 0));

        const data = await chrome.storage.local.get('restored_messages');
        expect(data.restored_messages).toEqual({ m1: 'text' });
    });
});
