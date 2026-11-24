import { isDeepStrictEqual } from 'node:util';
import { test as base, expect } from './fixtures.js';
import { closeExtensionPages, openPopup, openPopupGroupList, popupGroupNames, waitForPopupFullyBound } from './helpers/popup.js';
import { differingKeys, readBothAreas, restoreFullSnapshot, setLocal, setSync } from './helpers/settings.js';

// 雲端同步衝突處理（docs/FEATURES.md:341-350）：衝突對話框、Merge Sync 的合併結果、雲端讀取失敗，以及 popup 標題列的同步狀態。
// 只開 popup，不開任何 DeepSeek 頁面。兩個 storage 區的衝突狀態都從 service worker 直接寫入，等同兩台裝置各自寫入後 Chrome 同步留下的狀態。
// 每個測試前後對兩個 storage 區做完整快照並逐鍵還原，測試失敗時也一樣。

const POPUP_URL_PATH = 'popup/popup.html';
// 讓遲到的寫入（失敗後仍被套用的合併）有時間落地，再比較兩個區域。
const QUIET_WINDOW_MS = 3_000;
const RESTORE_ATTEMPTS = 5;
const RESTORE_SETTLE_MS = 500;
// 本機各裝置開關的值；雲端放相反值，證明合併時它們不被雲端覆寫（docs/FEATURES.md:349）。
const DEVICE_LOCAL = { isEnabled: true, globalPromptEnabled: false, isReplyNotificationEnabled: false };
// 一個提示詞組超過 chrome.storage.sync 單項 8 KB 上限（docs/architecture/STORAGE.md:122），但遠低於整個 sync 區的容量。
const OVERSIZED_CONTENT_CHARS = 9_000;

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function bothDiffs(before, after) {
    return { local: differingKeys(before.local, after.local), sync: differingKeys(before.sync, after.sync) };
}

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
    // 先關閉 popup（之後不會再有重新載入寫入），再把兩個區域還原成測試前的快照。
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

/** popup 對文件所寫英文字串顯示的在地化文字；英文語系表沒有該字串時失敗。 */
async function localized(popup, english) {
    const text = await popup.evaluate((value) => {
        const en = globalThis.__DS_I18N_Locales?.en ?? {};
        const key = Object.keys(en).find((name) => en[name] === value);
        return key ? dsI18n.t(key) : null;
    }, english);
    expect(text, `the English locale table holds the documented text "${english}"`).not.toBeNull();
    return text;
}

/** 文件格式的提示詞組 { id, name, content, createdAt, updatedAt, globalPromptEnabled }（docs/architecture/STORAGE.md:51）。 */
function makeGroup(id, name, createdAt, updatedAt) {
    return { id, name, content: `${name} content`, createdAt, updatedAt, globalPromptEnabled: true };
}

function presetEntries(groups) {
    return Object.fromEntries(groups.map((group) => [`dsPreset_${group.id}`, group]));
}

/** 開啟 popup 但不等待下拉選單：衝突對話框在選單渲染前就會擋住初始化。 */
async function openPopupPage(context, extensionId) {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/${POPUP_URL_PATH}`);
    return popup;
}

async function expectConflictDialog(popup) {
    await expect(popup.locator('#modalOverlay'), 'the Cloud Sync Conflict dialog appears on popup open').toBeVisible();
    await expect(popup.locator('#modalTitle'), 'the dialog is titled "Cloud Sync Conflict" (localized)').toHaveText(await localized(popup, 'Cloud Sync Conflict'));
}

async function clickMergeSync(popup) {
    await popup.locator('#modalActions').getByRole('button', { name: await localized(popup, 'Merge Sync'), exact: true }).click();
}

/** 兩台裝置都把同一個提示詞組在同一時間點改成不同內容：雙側同 id、同 updatedAt、內容不同。 */
function simultaneousEdit(id, label, stamp) {
    return { cloud: makeGroup(id, `E2E sync ${label} cloud`, stamp, stamp), local: makeGroup(id, `E2E sync ${label} local`, stamp, stamp) };
}

test.describe('cloud sync conflict: Merge Sync', { tag: '@offline' }, () => {
    test('simultaneous edits on two devices show the Cloud Sync Conflict dialog; Merge Sync keeps every group of both sides by id with the newer updatedAt in both areas, takes the cloud interface settings, keeps the device-local toggles, and the reopened popup lists the merged groups without the dialog', async ({ context, extensionId }) => {
        const stamp = Date.now();
        const t = stamp - 600_000;
        const id = (label) => `e2e-sync-${label}-${stamp}`;
        const [A, B, C, D, E] = ['a', 'b', 'c', 'd', 'e'].map(id);
        const tie = simultaneousEdit(A, 'A', t);
        const cloudB = makeGroup(B, 'E2E sync B cloud newer', t, t + 2_000);
        const localB = makeGroup(B, 'E2E sync B local older', t, t);
        const cloudC = makeGroup(C, 'E2E sync C cloud older', t, t);
        const localC = makeGroup(C, 'E2E sync C local newer', t, t + 2_000);
        const cloudOnlyD = makeGroup(D, 'E2E sync D cloud only', t, t);
        const localOnlyE = makeGroup(E, 'E2E sync E local only', t, t);
        const localIncludeThinking = true;
        const cloud = { includeThinking: !localIncludeThinking, dsChatWidth: 41 };
        // 雲端那台裝置最後改動排序（D 是它新增的），本機這台新增了 E。
        await setSync(context, {
            ...presetEntries([tie.cloud, cloudB, cloudC, cloudOnlyD]),
            dsPresetIndex: [A, B, C, D], dsPresetOrderMeta: { order: [A, B, C, D], orderUpdatedAt: t + 3_000 }, dsPresetTombstones: {},
            ...cloud,
            isEnabled: !DEVICE_LOCAL.isEnabled, globalPromptEnabled: !DEVICE_LOCAL.globalPromptEnabled, isReplyNotificationEnabled: !DEVICE_LOCAL.isReplyNotificationEnabled,
        });
        await setLocal(context, {
            ...presetEntries([tie.local, localB, localC, localOnlyE]),
            dsPresetIndex: [A, B, C, E], dsPresetOrderMeta: { order: [A, B, C, E], orderUpdatedAt: t + 1_000 }, dsPresetTombstones: {},
            includeThinking: localIncludeThinking, dsChatWidth: 59, ...DEVICE_LOCAL,
            syncInitialized: false, syncConflictPending: false, dsLocalAuth: [], dsOversizedKeys: [],
        });

        const popup = await openPopupPage(context, extensionId);
        await expectConflictDialog(popup);
        await clickMergeSync(popup);

        const ids = [A, B, C, D, E];
        const names = (area) => Object.fromEntries(ids.map((key) => [key, area[`dsPreset_${key}`]?.name ?? null]));
        const indexed = (area) => ids.filter((key) => (area.dsPresetIndex ?? []).includes(key));
        const expectedNames = { [A]: expect.any(String), [B]: cloudB.name, [C]: localC.name, [D]: cloudOnlyD.name, [E]: localOnlyE.name };
        // A 兩側的 updatedAt 與 createdAt 完全相同，合併剛完成時兩區可能各留一份，popup 重新載入後的同步才把兩區收斂成同一份；輪詢也等兩區的 A 相同，下面的讀取才看到收斂後的狀態。
        await expect.poll(async () => {
            const { sync, local } = await readBothAreas(context, null);
            const isTieAgreed = isDeepStrictEqual(sync[`dsPreset_${A}`], local[`dsPreset_${A}`]);
            return { sync: names(sync), local: names(local), syncIndexed: indexed(sync), localIndexed: indexed(local), isTieAgreed };
        }, 'both areas hold every group of both sides, each id with its newer-updatedAt version, all indexed (docs/FEATURES.md:348), and agree on the simultaneously edited group').toEqual({ sync: expectedNames, local: expectedNames, syncIndexed: ids, localIndexed: ids, isTieAgreed: true });

        const { sync, local } = await readBothAreas(context, null);
        expect([tie.cloud.name, tie.local.name], 'the simultaneously edited group keeps one of its two versions').toContain(local[`dsPreset_${A}`].name);
        expect(sync[`dsPreset_${A}`], 'both areas agree on the simultaneously edited group').toEqual(local[`dsPreset_${A}`]);
        expect({ includeThinking: local.includeThinking, dsChatWidth: local.dsChatWidth }, 'local interface settings are overwritten by the cloud version (docs/FEATURES.md:349)').toEqual(cloud);
        expect({ isEnabled: local.isEnabled, globalPromptEnabled: local.globalPromptEnabled, isReplyNotificationEnabled: local.isReplyNotificationEnabled }, 'the device-local toggles keep their local values (docs/FEATURES.md:349)').toEqual(DEVICE_LOCAL);

        await closeExtensionPages(context);
        const reopened = await openPopup(context, extensionId);
        await expect(reopened.locator('#modalOverlay'), 'the dialog does not return once merged').toBeHidden();
        await openPopupGroupList(reopened);
        const listed = await popupGroupNames(reopened);
        expect(listed, 'the popup lists the winning version of each group').toEqual(expect.arrayContaining([cloudB.name, localC.name, cloudOnlyD.name, localOnlyE.name]));
        expect(listed.filter((name) => name === tie.cloud.name || name === tie.local.name), 'the simultaneously edited group is listed once').toHaveLength(1);
        for (const loser of [localB.name, cloudC.name]) expect(listed, `the older version "${loser}" is not listed`).not.toContain(loser);
    });
});

test.describe('cloud sync conflict: cloud unreadable', { tag: '@offline' }, () => {
    test('Merge Sync while the cloud cannot be read shows the sync-failed message, changes nothing in either area, and the dialog returns on the next popup open', async ({ context, extensionId }) => {
        const stamp = Date.now();
        const t = stamp - 600_000;
        const A = `e2e-sync-fail-${stamp}`;
        const tie = simultaneousEdit(A, 'fail', t);
        const order = { dsPresetIndex: [A], dsPresetOrderMeta: { order: [A], orderUpdatedAt: t }, dsPresetTombstones: {} };
        await setSync(context, { ...presetEntries([tie.cloud]), ...order });
        await setLocal(context, { ...presetEntries([tie.local]), ...order, syncInitialized: false, syncConflictPending: false, dsLocalAuth: [], dsOversizedKeys: [] });

        const popup = await openPopupPage(context, extensionId);
        await expectConflictDialog(popup);
        const before = await readBothAreas(context, null);
        // 讓這個 popup 下一次讀取整個雲端區時同步拋出錯誤（只失敗一次），模擬雲端無法讀取。
        const isArmed = await popup.evaluate(() => {
            const area = chrome.storage.sync;
            const original = area.get;
            area.get = function failOnFullRead(keys, ...rest) {
                if (keys !== null) return original.call(this, keys, ...rest);
                area.get = original;
                throw new Error('E2E: cloud storage read failure');
            };
            return area.get !== original;
        });
        expect(isArmed, 'the cloud read failure is armed (precondition)').toBe(true);
        await clickMergeSync(popup);

        await expect(popup.locator('#toast'), 'a sync-failed message appears (docs/FEATURES.md:348)').toHaveText(await localized(popup, 'Sync failed'));
        await expect(popup.locator('#presetSelectValue'), 'the popup goes on loading after the failure').not.toHaveText('');
        await pause(QUIET_WINDOW_MS);
        expect(bothDiffs(before, await readBothAreas(context, null)), 'nothing changes in either area (docs/FEATURES.md:348)').toEqual({ local: [], sync: [] });

        await closeExtensionPages(context);
        await expectConflictDialog(await openPopupPage(context, extensionId));
    });
});

/** popup 標題列同步狀態的文字與色系（以計算後顏色的紅、綠分量比較）。 */
async function syncStatusOf(popup) {
    const status = popup.locator('#syncStatus');
    await expect(status, 'the title bar shows a sync status').not.toHaveText('');
    const color = await status.evaluate((el) => getComputedStyle(el).color);
    const [red, green] = color.match(/\d+/g).map(Number);
    const hue = red > green ? 'red' : 'green';
    return { text: (await status.textContent()).trim(), hue: red === green ? color : hue };
}

test.describe('cloud sync conflict: title bar sync status', { tag: '@offline' }, () => {
    // 先開關一次 popup 補齊預設值，之後的開啟才會在顯示狀態前就推送本機獨有的提示詞組，狀態因此反映當下（docs/FEATURES.md:350）。
    test.beforeEach(async ({ context, extensionId }) => {
        await setLocal(context, { syncInitialized: true, syncConflictPending: false, dsLocalAuth: [], dsOversizedKeys: [] });
        await waitForPopupFullyBound(await openPopup(context, extensionId));
        await closeExtensionPages(context);
    });

    test('with nothing pending the title bar shows green "Cloud Synced"', async ({ context, extensionId }) => {
        const popup = await openPopup(context, extensionId);
        expect(await syncStatusOf(popup), 'green Cloud Synced (docs/FEATURES.md:350)').toEqual({ text: await localized(popup, 'Cloud Synced'), hue: 'green' });
    });

    test('with a local write still waiting to reach the cloud the title bar shows red "Not Synced"', async ({ context, extensionId }) => {
        await setLocal(context, { dsLocalAuth: ['includeThinking'] });
        const popup = await openPopup(context, extensionId);
        expect(await syncStatusOf(popup), 'red Not Synced (docs/FEATURES.md:350)').toEqual({ text: await localized(popup, 'Not Synced'), hue: 'red' });
    });

    test('a prompt group too large for chrome.storage.sync is kept local only and the title bar shows "Too Large — Local Only"', async ({ context, extensionId }) => {
        const stamp = Date.now();
        const big = { ...makeGroup(`e2e-sync-big-${stamp}`, `E2E sync big ${stamp}`, stamp, stamp), content: 'x'.repeat(OVERSIZED_CONTENT_CHARS) };
        const index = [...((await readBothAreas(context, ['dsPresetIndex'])).local.dsPresetIndex ?? []), big.id];
        await setLocal(context, { ...presetEntries([big]), dsPresetIndex: index, dsPresetOrderMeta: { order: index, orderUpdatedAt: stamp } });

        const popup = await openPopup(context, extensionId);
        expect(await syncStatusOf(popup), 'Too Large — Local Only in the red unsynced style (docs/FEATURES.md:350, docs/architecture/STORAGE.md:122)').toEqual({ text: await localized(popup, 'Too Large — Local Only'), hue: 'red' });
        const key = `dsPreset_${big.id}`;
        const stored = await readBothAreas(context, [key]);
        expect({ localChars: stored.local[key]?.content.length, isInSync: key in stored.sync }, 'the group is kept locally and cloud sync is skipped (docs/FEATURES.md:350)').toEqual({ localChars: OVERSIZED_CONTENT_CHARS, isInSync: false });
    });
});
