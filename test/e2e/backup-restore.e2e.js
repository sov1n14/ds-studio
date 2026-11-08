import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures.js';
import { closeExtensionPages, openPopup, openPopupGroupList, popupGroupNames, waitForPopupFullyBound } from './helpers/popup.js';
import { differingKeys, readBothAreas, restoreFullSnapshot, setBothAreas, setLocal } from './helpers/settings.js';

// The popup Backup & Restore card (docs/FEATURES.md:315-325, docs/spec/05-data-storage.md:21-37, docs/architecture/EXPORT.md:66-79): Export Settings, Import Settings with its confirmation, rejected backup files, and the restored_messages export, clear and import controls.
// Popup only: no DeepSeek page is opened and no chat is touched.
// An import overwrites storage broadly, so every test runs inside a full snapshot of BOTH storage areas, restored key for key afterwards (keys the test created are removed), even when the test fails.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');
// Downloads go to this OS temp dir instead of Playwright's default artifacts dir, which sits under test/test-results inside the repo.
const DOWNLOAD_DIR = path.join(os.tmpdir(), 'dss-e2e-backup-restore-downloads');

// docs/architecture/POPUP.md:225 and docs/architecture/STORAGE.md:36: getSettings() returns exactly these 28 fields (23 synced keys, 3 local keys, promptPresets, chatPresetMap); docs/spec/05-data-storage.md:23 makes it the Export Settings file content.
const SETTINGS_FIELDS = [
    'presetIndex', 'activePresetId', 'pinnedPresetId', 'includeThinking', 'includeReferences', 'globalDefaultPrompt', 'sidebarAutoHide', 'hideThinking',
    'autoExpandMessages', 'autoRetry', 'autoContinue', 'autoOpenSidebar', 'autoCopyReply', 'autoCopyCode', 'preventAutoScroll', 'websearchToggle',
    'isShowSystemTime', 'chatWidth', 'chatWidthEnabled', 'inputWidth', 'inputWidthEnabled', 'syncInitialized', 'syncConflictPending',
    'isEnabled', 'globalPromptEnabled', 'replyNotification',
    'promptPresets', 'chatPresetMap',
];
// docs/spec/05-data-storage.md:17-18 and docs/architecture/content-navigation.md:132: the English toast texts; the popup shows the localized copy of the same locale entry.
const TOAST_SETTINGS_EXPORTED = 'Settings exported successfully';
const TOAST_SETTINGS_RESTORED = 'Settings restored successfully. Please refresh the page.';
const TOAST_RESTORED_EXPORTED = 'Restored Messages backup exported successfully';
const TOAST_RESTORED_IMPORTED = 'Restored Messages backup imported successfully';
const TOAST_RESTORED_CLEARED = 'All Restored Messages cleared';
// docs/spec/05-data-storage.md:28: the popup reloads 3 s after a successful import.
const RELOAD_TIMEOUT_MS = 10_000;
// A window long enough for a stray storage write (an import applied despite a cancel or a rejected file) to land before the areas are compared, and longer than the 3 s post-import reload delay (docs/spec/05-data-storage.md:28).
const QUIET_WINDOW_MS = 4_000;
const RESTORE_ATTEMPTS = 5;
const RESTORE_SETTLE_MS = 500;
const DEFAULT_INCLUDE_THINKING = true; // docs/architecture/STORAGE.md:55
const DEFAULT_CHAT_WIDTH = 70; // docs/architecture/STORAGE.md:74

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function bothDiffs(before, after) {
    return { local: differingKeys(before.local, after.local), sync: differingKeys(before.sync, after.sync) };
}

/** Restores the full snapshot, then re-reads both areas after a settle window and repeats while a late writer (a closing popup) drifted a key again. */
async function restoreAndVerify(context, snapshot) {
    let remaining = null;
    for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt += 1) {
        await restoreFullSnapshot(context, snapshot);
        await pause(RESTORE_SETTLE_MS);
        remaining = bothDiffs(snapshot, await readBothAreas(context, null));
        if (remaining.local.length === 0 && remaining.sync.length === 0) return;
    }
    throw new Error(`Storage restore left differing keys after ${RESTORE_ATTEMPTS} attempts: ${JSON.stringify(remaining)}`);
}

const test = base.extend({
    // Snapshot of both full storage areas taken before the test; teardown closes the popup first (no pending reload can write afterwards), then restores the snapshot exactly.
    storageSnapshot: [async ({ profileContext }, use) => {
        const snapshot = await readBothAreas(profileContext, null);
        try {
            await use(snapshot);
        } finally {
            await closeExtensionPages(profileContext);
            await restoreAndVerify(profileContext, snapshot);
        }
    }, { auto: true }],
});

/** A synced value as the extension reads it: sync first, then local, then the documented default. */
function syncedValue(dump, key, fallback) {
    if (key in dump.sync) return dump.sync[key];
    if (key in dump.local) return dump.local[key];
    return fallback;
}

/** The local calendar day of `date` as year, month and day joined by `separator`. */
function dayStamp(date, separator) {
    return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join(separator);
}

function todayStamp() {
    return dayStamp(new Date(), '');
}

/** A prompt group in the documented shape { id, name, content, createdAt, updatedAt, globalPromptEnabled } (docs/architecture/STORAGE.md:51). */
function makeGroup(label) {
    const stamp = Date.now();
    return { id: `e2e-backup-${label}-${stamp}`, name: `E2E backup ${label} ${stamp}`, content: `E2E backup ${label} content ${stamp}`, createdAt: stamp, updatedAt: stamp, globalPromptEnabled: true };
}

/** The localized text the popup shows for the locale entry whose English text is the documented `english`; fails when the English locale table lacks the documented text. */
async function localizedFromDocumentedEnglish(popup, english) {
    const text = await popup.evaluate((value) => {
        const en = globalThis.__DS_I18N_Locales?.en ?? {};
        const key = Object.keys(en).find((name) => en[name] === value);
        return key ? dsI18n.t(key) : null;
    }, english);
    expect(text, `the English locale table holds the documented text "${english}"`).not.toBeNull();
    return text;
}

async function expectToast(popup, english) {
    await expect(popup.locator('#toast'), `the toast shows "${english}" (localized)`).toHaveText(await localizedFromDocumentedEnglish(popup, english));
}

/** Clicks `selector` in the popup and resolves the downloaded file's name and text plus the click and arrival times; the file must sit in the OS temp dir, not in the repo or ~/Downloads. */
async function clickAndDownload(popup, selector) {
    const pending = popup.waitForEvent('download');
    const clickedAt = new Date();
    await popup.locator(selector).click();
    const download = await pending;
    const arrivedAt = new Date();
    const filePath = await download.path();
    const normalized = path.resolve(filePath).toLowerCase();
    expect(normalized.startsWith(path.resolve(os.tmpdir()).toLowerCase()), `download ${filePath} lands in the OS temp dir`).toBe(true);
    expect(normalized.startsWith(REPO_ROOT.toLowerCase()), `download ${filePath} is outside the repo`).toBe(false);
    expect(normalized.startsWith(DOWNLOADS_DIR.toLowerCase()), `download ${filePath} is outside ~/Downloads`).toBe(false);
    return { fileName: download.suggestedFilename(), text: await readFile(filePath, 'utf8'), clickedAt, arrivedAt };
}

/** Clicks the import control `buttonSelector` and answers its file picker with the in-memory `file` ({ name, mimeType, buffer }). */
async function importThroughPicker(popup, buttonSelector, file) {
    const chooser = popup.waitForEvent('filechooser');
    await popup.locator(buttonSelector).click();
    await (await chooser).setFiles(file);
}

function jsonFile(name, value) {
    return { name, mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2)) };
}

async function openBoundPopup(context, extensionId) {
    const popup = await openPopup(context, extensionId);
    await waitForPopupFullyBound(popup);
    return popup;
}

test.use({ launchOptions: { downloadsPath: DOWNLOAD_DIR } });

let fileStartDump = null;

test.beforeAll(async ({ profileContext }) => {
    fileStartDump = await readBothAreas(profileContext, null);
});

test.afterAll(async ({ profileContext }) => {
    const diffs = bothDiffs(fileStartDump, await readBothAreas(profileContext, null));
    console.log(`[backup-restore] whole-file storage diff: local differing keys: ${JSON.stringify(diffs.local)}`);
    console.log(`[backup-restore] whole-file storage diff: sync differing keys: ${JSON.stringify(diffs.sync)}`);
    expect(diffs, 'both storage areas end the file exactly as they began').toEqual({ local: [], sync: [] });
});

test.describe('backup and restore: Export Settings', () => {
    test('Export Settings downloads ds-studio-backup-YYYYMMDD.json holding exactly the documented 28 settings fields, the prompt groups and the pinned default', async ({ context, extensionId, storageSnapshot }) => {
        const group = makeGroup('export');
        const includeThinking = !syncedValue(storageSnapshot, 'includeThinking', DEFAULT_INCLUDE_THINKING);
        const chatWidth = syncedValue(storageSnapshot, 'dsChatWidth', DEFAULT_CHAT_WIDTH) === 41 ? 42 : 41;
        const presetIndex = syncedValue(storageSnapshot, 'dsPresetIndex', []);
        await setBothAreas(context, { [`dsPreset_${group.id}`]: group, dsPresetIndex: [...presetIndex, group.id], pinnedPresetId: group.id, includeThinking, dsChatWidth: chatWidth });
        const popup = await openBoundPopup(context, extensionId);

        const { fileName, text } = await clickAndDownload(popup, '#exportJsonBtn');

        await expectToast(popup, TOAST_SETTINGS_EXPORTED);
        expect(fileName, 'file name is ds-studio-backup-YYYYMMDD.json for today (docs/spec/05-data-storage.md:23)').toBe(`ds-studio-backup-${todayStamp()}.json`);
        const exported = JSON.parse(text);
        expect(Object.keys(exported).sort(), 'the file holds exactly the 28 getSettings() fields (docs/architecture/POPUP.md:225)').toEqual([...SETTINGS_FIELDS].sort());
        expect(exported.pinnedPresetId, 'the pinned default travels with the backup (docs/FEATURES.md:47)').toBe(group.id);
        expect(exported.promptPresets, 'the prompt groups travel with the backup (docs/FEATURES.md:321)').toContainEqual(expect.objectContaining({ id: group.id, name: group.name, content: group.content }));
        expect(exported.includeThinking, 'the includeThinking setting is exported as stored').toBe(includeThinking);
        expect(exported.chatWidth, 'the chat width setting is exported as stored').toBe(chatWidth);
    });
});

test.describe('backup and restore: Import Settings', () => {
    test('Import Settings with a backup file, confirmed, merges the new prompt group, overwrites the UI settings and the pin, keeps the device-local toggles, and the reloaded popup shows the imported values', async ({ context, extensionId, storageSnapshot }) => {
        const group = makeGroup('import');
        const includeThinking = !syncedValue(storageSnapshot, 'includeThinking', DEFAULT_INCLUDE_THINKING);
        const chatWidth = syncedValue(storageSnapshot, 'dsChatWidth', DEFAULT_CHAT_WIDTH) === 43 ? 44 : 43;
        const localToggles = { isEnabled: storageSnapshot.local.isEnabled, globalPromptEnabled: storageSnapshot.local.globalPromptEnabled, isReplyNotificationEnabled: storageSnapshot.local.isReplyNotificationEnabled };
        const backup = {
            promptPresets: [group], activePresetId: group.id, pinnedPresetId: group.id, includeThinking, chatWidth, chatPresetMap: {},
            // docs/spec/05-data-storage.md:30: an import must not overwrite the device-local toggles, so the file carries the opposite of each.
            isEnabled: !(localToggles.isEnabled ?? false), globalPromptEnabled: !(localToggles.globalPromptEnabled ?? true), replyNotification: !(localToggles.isReplyNotificationEnabled ?? false),
        };
        const popup = await openBoundPopup(context, extensionId);

        await importThroughPicker(popup, '#importJsonBtn', jsonFile('ds-studio-backup-e2e.json', backup));
        // docs/spec/05-data-storage.md:24: the import runs after the user confirms; a confirmation dialog offers cancel and confirm (docs/architecture/POPUP.md:33).
        await expect(popup.locator('#modalOverlay'), 'the import asks for confirmation').toBeVisible();
        await expect(popup.locator('#modalActions .modal-btn'), 'the confirmation offers cancel and confirm').toHaveCount(2);
        const reloaded = popup.waitForEvent('load', { timeout: RELOAD_TIMEOUT_MS });
        await popup.locator('#modalActions .modal-btn').last().click();

        await expectToast(popup, TOAST_SETTINGS_RESTORED);
        for (const areaName of ['sync', 'local']) {
            // docs/spec/05-data-storage.md:42: every synced write lands in sync and local.
            await expect.poll(async () => {
                const area = (await readBothAreas(context, null))[areaName];
                const stored = area[`dsPreset_${group.id}`];
                return {
                    group: stored && { name: stored.name, content: stored.content },
                    isIndexed: (area.dsPresetIndex ?? []).includes(group.id),
                    pinnedPresetId: area.pinnedPresetId,
                    activePresetId: area.activePresetId,
                    includeThinking: area.includeThinking,
                    chatWidth: area.dsChatWidth,
                };
            }, `${areaName}: the new group is merged in (docs/spec/05-data-storage.md:25), the pin is restored (docs/FEATURES.md:47), activePresetId, includeThinking and the chat width are overwritten (docs/architecture/EXPORT.md:75)`).toEqual({
                group: { name: group.name, content: group.content }, isIndexed: true, pinnedPresetId: group.id, activePresetId: group.id, includeThinking, chatWidth,
            });
        }
        const afterLocal = (await readBothAreas(context, ['isEnabled', 'globalPromptEnabled', 'isReplyNotificationEnabled'])).local;
        expect({ isEnabled: afterLocal.isEnabled, globalPromptEnabled: afterLocal.globalPromptEnabled, isReplyNotificationEnabled: afterLocal.isReplyNotificationEnabled }, 'the device-local toggles keep their values (docs/spec/05-data-storage.md:30)').toEqual(localToggles);

        // docs/spec/05-data-storage.md:28: the popup reloads 3 s after the toast.
        await reloaded;
        await expect(popup.locator('#presetSelectValue'), 'the reloaded popup has rendered (precondition)').not.toHaveText('');
        if (includeThinking) await expect(popup.locator('#includeThinkingToggle'), 'the reloaded popup shows the imported "Include Thinking Process"').toBeChecked();
        else await expect(popup.locator('#includeThinkingToggle'), 'the reloaded popup shows the imported "Include Thinking Process"').not.toBeChecked();
        await expect(popup.locator('#chatWidthSlider'), 'the reloaded popup shows the imported chat width').toHaveValue(String(chatWidth));
        await openPopupGroupList(popup);
        expect(await popupGroupNames(popup), 'the reloaded popup lists the imported prompt group').toContain(group.name);
    });
});

test.describe('backup and restore: Import Settings cancel', () => {
    test('Import Settings cancelled at the confirmation leaves both storage areas unchanged, shows no success toast and does not reload the popup', async ({ context, extensionId }) => {
        const group = makeGroup('cancel');
        const popup = await openBoundPopup(context, extensionId);
        const restoredToast = await localizedFromDocumentedEnglish(popup, TOAST_SETTINGS_RESTORED);
        let reloads = 0;
        popup.on('load', () => { reloads += 1; });
        const before = await readBothAreas(context, null);

        await importThroughPicker(popup, '#importJsonBtn', jsonFile('ds-studio-backup-e2e.json', { promptPresets: [group], activePresetId: group.id, pinnedPresetId: group.id, chatWidth: 31 }));
        await expect(popup.locator('#modalOverlay'), 'the import asks for confirmation (docs/spec/05-data-storage.md:24)').toBeVisible();
        await expect(popup.locator('#modalActions .modal-btn'), 'the confirmation offers cancel and confirm').toHaveCount(2);
        await popup.locator('#modalActions .modal-btn').first().click();

        await expect(popup.locator('#modalOverlay'), 'the confirmation closes on cancel').toBeHidden();
        await pause(QUIET_WINDOW_MS);
        // The toast element keeps its box while idle, so the check is on its text: the documented success text never appears (docs/spec/05-data-storage.md:18).
        await expect(popup.locator('#toast'), 'no success toast follows a cancel').not.toHaveText(restoredToast);
        expect(reloads, 'the popup does not reload after a cancel (the reload follows a successful import only, docs/spec/05-data-storage.md:28)').toBe(0);
        expect(bothDiffs(before, await readBothAreas(context, null)), 'a cancelled import writes nothing to either area').toEqual({ local: [], sync: [] });
    });
});

test.describe('backup and restore: rejected settings files', () => {
    const REJECTED_FILES = [
        { label: 'malformed JSON', content: '{ "promptPresets": [ { "id": "e2e-broken" ' },
        { label: 'valid JSON without a promptPresets array', content: JSON.stringify({ includeThinking: false, chatWidth: 31, pinnedPresetId: 'e2e-wrong-shape' }) },
    ];

    for (const { label, content } of REJECTED_FILES) {
        test(`Import Settings with ${label} shows the restore-failed alert without the confirmation and leaves both storage areas unchanged`, async ({ context, extensionId }) => {
            const popup = await openBoundPopup(context, extensionId);
            const before = await readBothAreas(context, null);
            // docs/spec/05-data-storage.md:29: a rejected file gets no confirmation, leaves storage unchanged and shows a single-button "Restore Failed" dialog; error alerts are single-button custom dialogs (docs/spec/02-popup-ui.md:23, docs/architecture/POPUP.md:33), and the title is the popup's own localized "Restore Failed" copy.
            const failedTitle = await popup.evaluate(() => dsI18n.t('restoreFailedTitle'));

            await importThroughPicker(popup, '#importJsonBtn', jsonFile('ds-studio-backup-e2e.json', content));

            await expect(popup.locator('#modalOverlay'), 'an alert is shown').toBeVisible();
            await expect(popup.locator('#modalTitle'), 'the alert is the restore-failed alert, not the import confirmation').toHaveText(failedTitle);
            await expect(popup.locator('#modalActions .modal-btn'), 'the alert has a single OK button').toHaveCount(1);
            await popup.locator('#modalActions .modal-btn').click();
            await expect(popup.locator('#modalOverlay'), 'the alert closes on OK').toBeHidden();
            await pause(QUIET_WINDOW_MS);
            expect(bothDiffs(before, await readBothAreas(context, null)), 'a rejected file writes nothing to either area').toEqual({ local: [], sync: [] });
        });
    }
});

test.describe('backup and restore: restored_messages', () => {
    // docs/spec/04-features.md:76: a record is keyed "<session>::<message_id>" and holds message_id, fragments, thinking_elapsed_secs, chat_session_id and prompt_key.
    function makeRestoredMessages() {
        const session = `e2e-session-${Date.now()}`;
        return {
            [`${session}::7`]: { message_id: 7, fragments: [{ type: 'RESPONSE', content: 'E2E restored reply seven' }], thinking_elapsed_secs: 3, chat_session_id: session, prompt_key: 'e2e prompt seven' },
            [`${session}::9`]: { message_id: 9, fragments: [{ type: 'RESPONSE', content: 'E2E restored reply nine' }], thinking_elapsed_secs: 0, chat_session_id: session, prompt_key: 'e2e prompt nine' },
        };
    }

    async function storedRestoredMessages(context) {
        return (await readBothAreas(context, ['restored_messages'])).local.restored_messages;
    }

    test('Export Restore Records downloads ds-studio-restore-backup-YYYY-MM-DD.json whose only top-level key restored_messages holds exactly the stored records', async ({ context, extensionId }) => {
        const records = makeRestoredMessages();
        await setLocal(context, { restored_messages: records });
        const popup = await openBoundPopup(context, extensionId);

        const { fileName, text, clickedAt, arrivedAt } = await clickAndDownload(popup, '#exportRestoredBtn');

        await expectToast(popup, TOAST_RESTORED_EXPORTED);
        // docs/spec/05-data-storage.md:33: the file is ds-studio-restore-backup-YYYY-MM-DD.json, dated the local day between the click and the download (two days only when the export crosses midnight).
        const allowedNames = [...new Set([clickedAt, arrivedAt].map((date) => `ds-studio-restore-backup-${dayStamp(date, '-')}.json`))];
        expect(allowedNames, `file name "${fileName}" is ds-studio-restore-backup-YYYY-MM-DD.json for the export day (docs/spec/05-data-storage.md:33)`).toContain(fileName);
        // docs/spec/05-data-storage.md:33: one JSON object whose only top-level key is restored_messages, mapping each record key to its record.
        const exported = JSON.parse(text);
        expect(Object.keys(exported), 'the file has exactly one top-level key, restored_messages (docs/spec/05-data-storage.md:33)').toEqual(['restored_messages']);
        expect(exported.restored_messages, 'restored_messages in the file equals the stored records (docs/spec/05-data-storage.md:33)').toEqual(records);
    });

    test('Clear All Restored Records empties restored_messages, and Import Restore Records with the exported file brings every record back to local storage only', async ({ context, extensionId }) => {
        const records = makeRestoredMessages();
        await setLocal(context, { restored_messages: records });
        const syncBefore = (await readBothAreas(context, ['restored_messages'])).sync;
        const popup = await openBoundPopup(context, extensionId);
        const exported = await clickAndDownload(popup, '#exportRestoredBtn');
        await expectToast(popup, TOAST_RESTORED_EXPORTED);

        await popup.locator('#clearRestoredBtn').click();
        // docs/FEATURES.md:325 and docs/spec/05-data-storage.md:37: the popup asks for confirmation before clearing, which the test accepts.
        await expect(popup.locator('#modalOverlay'), 'the clear asks for confirmation').toBeVisible();
        await popup.locator('#modalActions .modal-btn').last().click();
        await expectToast(popup, TOAST_RESTORED_CLEARED);
        await expect.poll(async () => Object.keys((await storedRestoredMessages(context)) ?? {}), 'no restored record is left (docs/FEATURES.md:325)').toEqual([]);

        await importThroughPicker(popup, '#importRestoredBtn', jsonFile(exported.fileName, exported.text));

        await expectToast(popup, TOAST_RESTORED_IMPORTED);
        await expect.poll(() => storedRestoredMessages(context), 'every exported record is back in local storage (docs/FEATURES.md:324)').toEqual(records);
        expect((await readBothAreas(context, ['restored_messages'])).sync, 'clear and import leave sync untouched: restored_messages is local-only (docs/architecture/STORAGE.md:80)').toEqual(syncBefore);
    });
});
