import { test as base, expect } from './fixtures.js';
import { evaluateInWorker } from './helpers/extension.js';
import { closeExtensionPages, openEditorWith, openPopup, openPopupGroupList, pickGroupInPopup, popupGroupNames } from './helpers/popup.js';
import { differingKeys, readBothAreas, restoreFullSnapshot } from './helpers/settings.js';

// Legacy Data Migration (docs/FEATURES.md:373-375): an upgrade from an older version keeps the existing prompt content, with no manual action.
// The legacy shape still migrated is the v1.6.x single `promptPresets` array (docs/architecture/STORAGE.md:88 and :275, utils/storage-manager.keys.js PROMPT_PRESETS); `StorageManager.initialize()` runs it when the popup opens (docs/architecture/STORAGE.md:282).
// Each test empties both storage areas and seeds only what an older version stored, so no key a newer version writes exists before the popup opens (the first-run trigger).
// Popup only: no DeepSeek page is opened. Every test runs inside a full snapshot of both areas, restored key for key afterwards, even when the test fails.

const LEGACY_KEY = 'promptPresets';
const RESTORE_ATTEMPTS = 5;
const RESTORE_SETTLE_MS = 500;

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 還原完整快照後等待一段時間再比對；仍有晚到的寫入（關閉中的 popup）造成差異時重試。 */
async function restoreAndVerify(context, snapshot) {
    let remaining = null;
    for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt += 1) {
        await restoreFullSnapshot(context, snapshot);
        await pause(RESTORE_SETTLE_MS);
        const now = await readBothAreas(context, null);
        remaining = { local: differingKeys(snapshot.local, now.local), sync: differingKeys(snapshot.sync, now.sync) };
        if (remaining.local.length === 0 && remaining.sync.length === 0) return;
    }
    throw new Error(`Storage restore left differing keys after ${RESTORE_ATTEMPTS} attempts: ${JSON.stringify(remaining)}`);
}

const test = base.extend({
    // 測試前取兩區完整快照；收尾先關閉所有擴充功能頁面（之後不會再有寫入），再逐鍵還原。
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

/** v1.6.x 的提示詞組形狀：單一陣列中的物件，各自帶 id、名稱、內容與時間戳記；內容為唯一標記，方便辨認落點。 */
function legacyGroups(label) {
    const stamp = Date.now();
    return ['Alpha', 'Beta', 'Gamma'].map((part, i) => ({
        id: `legacy-e2e-${label}-${part.toLowerCase()}-${stamp}`,
        name: `Legacy E2E ${label} ${part} ${stamp}`,
        content: `E2E-LEGACY-CONTENT-${label}-${part}-${stamp}\nsecond line of ${part}`,
        createdAt: stamp - 1000 * (3 - i),
        updatedAt: stamp - 100 * (3 - i),
    }));
}

/** 清空兩個儲存區，再把舊版會存的鍵寫入兩區（舊版以同一份資料寫入 sync 與 local），模擬尚未開啟過新版的升級狀態。 */
async function seedLegacyInstall(context, values) {
    await evaluateInWorker(context, async (payload) => {
        await chrome.storage.sync.clear();
        await chrome.storage.local.clear();
        await chrome.storage.sync.set(payload);
        await chrome.storage.local.set(payload);
    }, values);
}

/** 前置條件：兩區都只有舊格式清單，沒有新版的提示詞組索引。 */
async function expectOnlyLegacyShape(context) {
    const stored = await readBothAreas(context, [LEGACY_KEY, 'dsPresetIndex']);
    for (const area of ['sync', 'local']) {
        expect(stored[area][LEGACY_KEY], `${area} holds the legacy prompt-group list before the popup opens (precondition)`).toBeDefined();
        expect(stored[area].dsPresetIndex, `${area} holds no prompt-group index of the newer layout before the popup opens (precondition)`).toBeUndefined();
    }
}

/** 開啟 popup 並確認沒有任何對話框要使用者處理（同步衝突詢問會在 popup 渲染前跳出）。 */
async function openPopupWithoutPrompt(context, extensionId) {
    const popup = await openPopup(context, extensionId);
    await expect(popup.locator('#modalOverlay'), 'no dialog asks the user to act after the upgrade').toBeHidden();
    return popup;
}

async function listedGroupNames(popup) {
    await openPopupGroupList(popup);
    return popupGroupNames(popup);
}

test.describe('legacy data migration', { tag: '@offline' }, () => {
    test('an upgrade from the legacy prompt-group list shows every group in the popup, in the stored order, without any prompt to act', async ({ context, extensionId }) => {
        const groups = legacyGroups('order');
        await seedLegacyInstall(context, { [LEGACY_KEY]: groups });
        await expectOnlyLegacyShape(context);

        const popup = await openPopupWithoutPrompt(context, extensionId);
        expect(await listedGroupNames(popup), 'the popup lists exactly the legacy groups, in their stored order').toEqual(groups.map((group) => group.name));
    });

    test('each migrated group keeps its content: the editor opened from the popup shows the legacy text', async ({ context, extensionId }) => {
        const groups = legacyGroups('content');
        await seedLegacyInstall(context, { [LEGACY_KEY]: groups });
        await expectOnlyLegacyShape(context);

        const popup = await openPopupWithoutPrompt(context, extensionId);
        for (const group of [groups[0], groups[2]]) {
            await pickGroupInPopup(popup, group.name);
            const editor = await openEditorWith(context, popup.locator('#editPresetBtn'));
            await expect(editor.locator('#editorNameInput'), `the editor opened for ${group.name} shows its legacy name`).toHaveValue(group.name);
            await expect(editor.locator('#editorTextarea'), `the editor opened for ${group.name} shows its legacy content unchanged`).toHaveValue(group.content);
            await editor.close();
        }
    });

    test('settings stored beside the legacy list are kept through the migration', async ({ context, extensionId }) => {
        const groups = legacyGroups('settings');
        // 兩個值皆與預設相反（includeThinking 預設 true，dsHideThinking 預設 false），被預設值覆寫時看得出來。
        await seedLegacyInstall(context, { [LEGACY_KEY]: groups, includeThinking: false, dsHideThinking: true });
        await expectOnlyLegacyShape(context);

        const popup = await openPopupWithoutPrompt(context, extensionId);
        await expect(popup.locator('#includeThinkingToggle'), 'Include Thinking Process stays off as the older version stored it').not.toBeChecked();
        await expect(popup.locator('#hideThinkingToggle'), 'Hide Thinking Process stays on as the older version stored it').toBeChecked();
        expect(await listedGroupNames(popup), 'the legacy groups are listed beside the kept settings').toEqual(groups.map((group) => group.name));
        const stored = await readBothAreas(context, ['includeThinking', 'dsHideThinking']);
        for (const area of ['sync', 'local']) {
            expect(stored[area], `${area} still holds the settings the older version stored`).toEqual({ includeThinking: false, dsHideThinking: true });
        }
    });

    test('a second popup opening, also after an older device writes the same legacy list to sync again, never duplicates a group', async ({ context, extensionId }) => {
        const groups = legacyGroups('rerun');
        const names = groups.map((group) => group.name);
        await seedLegacyInstall(context, { [LEGACY_KEY]: groups });
        await expectOnlyLegacyShape(context);

        const first = await openPopupWithoutPrompt(context, extensionId);
        expect(await listedGroupNames(first), 'the first opening lists each legacy group once').toEqual(names);
        await first.close();
        const afterFirst = await readBothAreas(context, [LEGACY_KEY]);
        expect(afterFirst, 'the migration retires the legacy list from both areas, so a later opening has nothing left to migrate').toEqual({ sync: {}, local: {} });

        const second = await openPopupWithoutPrompt(context, extensionId);
        expect(await listedGroupNames(second), 'a second opening still lists each group once').toEqual(names);
        await second.close();

        // 舊版裝置透過同步再次寫入同一份舊格式清單：觸發條件與首次升級相同，但群組已存在。
        await evaluateInWorker(context, (payload) => chrome.storage.sync.set(payload), { [LEGACY_KEY]: groups });
        const third = await openPopupWithoutPrompt(context, extensionId);
        expect(await listedGroupNames(third), 'the same legacy list arriving again adds no duplicate group').toEqual(names);
    });
});
