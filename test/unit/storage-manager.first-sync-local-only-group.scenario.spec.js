/**
 * 情境：首次同步（或升級）時，本機獨有的提示詞組在使用者按下「Merge Sync」後不得遺失。
 *
 * 需求（docs/FEATURES.md「Cloud Sync Conflict Handling」第 2 點；docs/spec/05-data-storage.md「Smart Merge」）：
 * Merge Sync 依 id 合併兩側的提示詞組，每個 id 保留 updatedAt 較新的版本，只在一側的 id 會被附加（"New IDs are appended. This prevents data loss"）。
 * 衝突對話框等待使用者選擇期間，本機仍列出本機獨有的群組。
 *
 * 狀態：雲端與本機都有 a–d；雲端那台裝置最後改動排序（雲端 orderUpdatedAt 較新）；本機這台新增了 E（只在本機）。
 * a 兩側同 updatedAt、內容不同，使衝突需要使用者決定；b 雲端較新；c 本機較新；d 只在雲端；e 只在本機。
 *
 * 使用真實 StorageManager 模組共享同一份記憶體 chrome.storage；只替身 chrome.storage，並讓 onChanged 照真實 Chrome 行為：
 * 寫入相同值不發事件，混合寫入只回報變動的鍵。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;
const IDS = ['a', 'b', 'c', 'd', 'e'];

const group = (id, side, updatedAt) => ({ id, name: `${id}-${side}`, content: `${id} ${side} content`, createdAt: 1, updatedAt });

const CLOUD = { a: group('a', 'cloud', 100), b: group('b', 'cloud-newer', 300), c: group('c', 'cloud-older', 100), d: group('d', 'cloud-only', 100) };
const LOCAL = { a: group('a', 'local', 100), b: group('b', 'local-older', 100), c: group('c', 'local-newer', 300), e: group('e', 'local-only', 100) };
// 每個 id 依 updatedAt 較新者勝出應得的版本；a 兩側同時間，只要求兩區一致且為兩版本之一。
const EXPECTED = { b: CLOUD.b, c: LOCAL.c, d: CLOUD.d, e: LOCAL.e };

const presetEntries = (groups) => Object.fromEntries(Object.values(groups).map((g) => [`dsPreset_${g.id}`, g]));

/** 兩種起始狀態：首次執行（兩區都沒有同步旗標鍵），以及升級後旗標為 false 的設定檔。 */
const PROFILES = [
    { label: 'first run (no sync flag keys)', flags: {} },
    { label: 'upgrade (sync flags stored as false)', flags: { [K.SYNC_INITIALIZED]: false, [K.SYNC_CONFLICT_PENDING]: false, [K.LOCAL_AUTHORITATIVE]: [], [K.OVERSIZED_KEYS]: [] } },
];

async function seed(flags) {
    await chrome.storage.sync.set({
        ...presetEntries(CLOUD),
        [K.PRESET_INDEX]: ['a', 'b', 'c', 'd'],
        [K.PRESET_ORDER_META]: { order: ['a', 'b', 'c', 'd'], orderUpdatedAt: 3000 },
        [K.PRESET_TOMBSTONES]: {},
    });
    await chrome.storage.local.set({
        ...presetEntries(LOCAL),
        [K.PRESET_INDEX]: ['a', 'b', 'c', 'e'],
        [K.PRESET_ORDER_META]: { order: ['a', 'b', 'c', 'e'], orderUpdatedAt: 1000 },
        [K.PRESET_TOMBSTONES]: {},
        ...flags,
    });
}

/** 讓記憶體替身的 onChanged 照真實 Chrome：相同值的寫入不發事件，混合寫入只回報變動的鍵。 */
function useRealOnChangedSemantics() {
    for (const area of [chrome.storage.local, chrome.storage.sync]) {
        const notify = Object.getPrototypeOf(area)._notify.bind(area);
        vi.spyOn(area, '_notify').mockImplementation((changes, areaName) => {
            const changed = Object.fromEntries(Object.entries(changes).filter(([, c]) => !isDeepStrictEqual(c.oldValue, c.newValue)));
            if (Object.keys(changed).length > 0) notify(changed, areaName);
        });
    }
}

async function readArea(area) {
    return chrome.storage[area].get([K.PRESET_INDEX, ...IDS.map((id) => `dsPreset_${id}`)]);
}

/** popup 開啟流程直到衝突對話框出現（popup/popup.js：initialize() 後以 checkSyncConflictPending() 決定是否顯示對話框）。 */
async function openPopupUntilDialog() {
    await StorageManager.initialize();
    return StorageManager.checkSyncConflictPending();
}

/** 使用者按下 Merge Sync：resolveSyncConflict()，接著 popup 重新載入，重新載入的 popup 無衝突時執行 syncNow()。 */
async function chooseMergeSyncAndReload() {
    await StorageManager.resolveSyncConflict();
    const isStillPending = await openPopupUntilDialog();
    if (!isStillPending) await StorageManager.syncNow();
    return isStillPending;
}

function expectMergedArea(name, area) {
    expect.soft([...(area[K.PRESET_INDEX] || [])].sort(), `${name} dsPresetIndex lists every group of both sides (a-d and the local-only e)`).toEqual(IDS);
    for (const [id, version] of Object.entries(EXPECTED)) {
        expect.soft(area[`dsPreset_${id}`], `${name} dsPreset_${id} holds the newer-updatedAt version`).toEqual(version);
    }
    expect.soft([CLOUD.a, LOCAL.a], `${name} dsPreset_a holds one of its two simultaneous versions`).toContainEqual(area.dsPreset_a);
}

beforeEach(() => {
    delete chrome.runtime.lastError;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useRealOnChangedSemantics();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe.each(PROFILES)('first sync, local-only group e, cloud order newer: $label', ({ flags }) => {
    it('keeps e listed in local while the conflict dialog waits for the user', async () => {
        await seed(flags);

        const isPending = await openPopupUntilDialog();

        expect(isPending, 'guard: initialize() raised the conflict dialog (manual conflict reached)').toBe(true);
        const local = await readArea('local');
        expect.soft(local[K.PRESET_INDEX], 'local dsPresetIndex still lists the local-only group e before the user chooses').toContain('e');
        expect.soft(local.dsPreset_e, 'local dsPreset_e content before the user chooses').toEqual(LOCAL.e);
    });

    it('Merge Sync keeps e and the newer version of a-d in both areas, then converges', async () => {
        await seed(flags);
        expect(await openPopupUntilDialog(), 'guard: initialize() raised the conflict dialog (manual conflict reached)').toBe(true);

        const isStillPending = await chooseMergeSyncAndReload();

        expect.soft(isStillPending, 'conflict dialog after Merge Sync and popup reload').toBe(false);
        const local = await readArea('local');
        const sync = await readArea('sync');
        expectMergedArea('local', local);
        expectMergedArea('sync', sync);
        expect.soft(sync.dsPreset_a, 'sync dsPreset_a equals local dsPreset_a').toEqual(local.dsPreset_a);

        const setSpy = vi.spyOn(chrome.storage.sync, 'set');
        await StorageManager.syncNow();
        expect.soft(setSpy.mock.calls.map(([items]) => Object.keys(items).sort()), 'sync.set key lists during the next syncNow() once converged').toEqual([]);
    });
});

/**
 * 頁面載入路徑：使用者通常先開著 DeepSeek 分頁才開 popup。content script 初始化（content/content-script.js initSettings()）先呼叫 syncNow()，
 * 接著初始對話處理（content/chat-binding-controller.js readSettings()）呼叫 getSettings()。從未合併過的裝置上，這些讀取不得讓本機獨有的 e 在 Merge Sync 後遺失。
 */
const PAGE_LOAD_READS = [
    { label: 'content script init: syncNow() then getSettings()', run: async () => { await StorageManager.syncNow(); await StorageManager.getSettings(); } },
    { label: 'getSettings() only', run: async () => { await StorageManager.getSettings(); } },
];

describe.each(PROFILES)('first sync, DeepSeek tab loaded before the popup opens: $label', ({ flags }) => {
    it.each(PAGE_LOAD_READS)('Merge Sync keeps e and the newer version of a-d in both areas after the page-load read ($label)', async ({ run }) => {
        await seed(flags);
        await run();
        // 頁面載入的讀取不得在首次合併前把雲端版本寫進本機；本機仍持有本機版 a，popup 才偵測得到衝突
        expect.soft((await readArea('local')).dsPreset_a, 'local dsPreset_a still holds the local copy after the page-load read, before the user chooses').toEqual(LOCAL.a);

        const isPending = await openPopupUntilDialog();
        expect.soft(isPending, 'popup raised the conflict dialog after the page-load read').toBe(true);
        // popup 無衝突時直接執行 syncNow()（同 chooseMergeSyncAndReload() 的重新載入分支）
        if (isPending) await chooseMergeSyncAndReload();
        else await StorageManager.syncNow();

        expectMergedArea('local', await readArea('local'));
        expectMergedArea('sync', await readArea('sync'));
    });
});
