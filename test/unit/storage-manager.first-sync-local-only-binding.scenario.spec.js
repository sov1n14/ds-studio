/**
 * 情境：從未合併過的裝置（本機沒有 syncInitialized），其本機獨有提示詞組 e 的聊天綁定，在使用者按下「Merge Sync」完成首次合併前後都不得被修剪。
 *
 * 需求（主導裁決）：從未合併過的裝置在首次合併前，任何讀取路徑都不得以雲端狀態改動本機；e 在 Merge Sync 後保留（docs/FEATURES.md「Cloud Sync Conflict Handling」第 2 點："New IDs are appended. This prevents data loss"），指向 e 的綁定也必須保留。
 * 對照（docs/architecture/STORAGE.md `DSS_CHAT_MAP_PRUNE_ORPHANS`）：指向兩側都不存在之提示詞組的綁定會被修剪，證明修剪確實執行過，e 的保留不是因為修剪從未發生。
 *
 * 狀態沿用 storage-manager.first-sync-local-only-group.scenario.spec.js：雲端與本機都有 a–c；d 只在雲端；e 只在本機；雲端排序較新。
 * 聊天綁定：CHAT_E 綁 e、CHAT_A 綁 a、CHAT_GONE 綁從未存在的 z；兩區佈局相同，如同寫入者留下的狀態。
 *
 * 真實模組：一個 service worker 寫入者（真實 background/chat-map-routes.js）、一個頁面 content script 用戶端、一個 popup 用戶端，共用同一份記憶體 chrome.storage。
 * 只替身信任邊界：chrome.storage 與 chrome.runtime 訊息（test/helpers/chat-map-writer-harness.js）；onChanged 照真實 Chrome：寫入相同值不發事件，混合寫入只回報變動的鍵。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { createChatMapWriterHarness, restoreChromeBoundaries } from '../helpers/chat-map-writer-harness.js';

const CHAT_E = 'eeeeeeee-1111-1111-1111-111111111111';
const CHAT_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const CHAT_GONE = 'dddddddd-1111-1111-1111-111111111111';

const group = (id, side, updatedAt) => ({ id, name: `${id}-${side}`, content: `${id} ${side} content`, createdAt: 1, updatedAt });
const CLOUD = { a: group('a', 'cloud', 100), b: group('b', 'cloud-newer', 300), c: group('c', 'cloud-older', 100), d: group('d', 'cloud-only', 100) };
const LOCAL = { a: group('a', 'local', 100), b: group('b', 'local-older', 100), c: group('c', 'local-newer', 300), e: group('e', 'local-only', 100) };
const presetEntries = (groups) => Object.fromEntries(Object.values(groups).map((g) => [`dsPreset_${g.id}`, g]));

let h;
let page;
let popup;
let K;

/** 兩種從未合併過的起始狀態：首次執行（沒有同步旗標鍵），以及升級後旗標為 false。 */
const PROFILES = [
    { label: 'first run (no sync flag keys)', flags: () => ({}) },
    { label: 'upgrade (sync flags stored as false)', flags: () => ({ [K.SYNC_INITIALIZED]: false, [K.SYNC_CONFLICT_PENDING]: false, [K.LOCAL_AUTHORITATIVE]: [], [K.OVERSIZED_KEYS]: [] }) },
];

async function seed(flags) {
    await h.sync.set({
        ...presetEntries(CLOUD),
        [K.PRESET_INDEX]: ['a', 'b', 'c', 'd'],
        [K.PRESET_ORDER_META]: { order: ['a', 'b', 'c', 'd'], orderUpdatedAt: 3000 },
        [K.PRESET_TOMBSTONES]: {},
    });
    await h.local.set({
        ...presetEntries(LOCAL),
        [K.PRESET_INDEX]: ['a', 'b', 'c', 'e'],
        [K.PRESET_ORDER_META]: { order: ['a', 'b', 'c', 'e'], orderUpdatedAt: 1000 },
        [K.PRESET_TOMBSTONES]: {},
        ...flags,
    });
    await h.seedChatMap([{ [CHAT_E]: 'e', [CHAT_A]: 'a', [CHAT_GONE]: 'z' }]);
}

/** 讓記憶體替身的 onChanged 照真實 Chrome：相同值的寫入不發事件，混合寫入只回報變動的鍵。 */
function useRealOnChangedSemantics() {
    for (const area of [h.local, h.sync]) {
        const notify = Object.getPrototypeOf(area)._notify.bind(area);
        vi.spyOn(area, '_notify').mockImplementation((changes, areaName) => {
            const changed = Object.fromEntries(Object.entries(changes).filter(([, c]) => !isDeepStrictEqual(c.oldValue, c.newValue)));
            if (Object.keys(changed).length > 0) notify(changed, areaName);
        });
    }
}

/** popup 開啟流程直到衝突對話框出現（popup/popup.js：initialize() 後以 checkSyncConflictPending() 決定是否顯示對話框）。 */
async function openPopupUntilDialog() {
    await popup.initialize();
    return popup.checkSyncConflictPending();
}

/** 使用者按下 Merge Sync：resolveSyncConflict()，接著 popup 重新載入；重新載入的 popup 無衝突時執行 syncNow()。 */
async function chooseMergeSyncAndReload() {
    await popup.resolveSyncConflict();
    const isStillPending = await openPopupUntilDialog();
    if (!isStillPending) await popup.syncNow();
    return isStillPending;
}

/** 頁面載入讀取：content script 初始化先呼叫 syncNow()，初始對話處理再呼叫 getSettings()（content/content-script.js）。 */
async function pageLoadReads() {
    await page.syncNow();
    await page.getSettings();
}

const SEQUENCES = [
    { label: 'popup opens first', beforePopup: async () => {} },
    { label: 'DeepSeek tab loads before the popup opens', beforePopup: pageLoadReads },
];

beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h = await createChatMapWriterHarness({ clientCount: 2 });
    [page, popup] = h.clients;
    K = h.sw.KEYS;
    useRealOnChangedSemantics();
});

afterEach(() => {
    restoreChromeBoundaries();
    vi.restoreAllMocks();
});

describe.each(PROFILES)('first sync, chat bound to local-only group e: $label', ({ flags }) => {
    it.each(SEQUENCES)('the binding to e survives until and after Merge Sync ($label)', async ({ beforePopup }) => {
        await seed(flags());
        await beforePopup();

        const isPending = await openPopupUntilDialog();
        expect(isPending, 'guard: the popup raised the conflict dialog (manual conflict reached)').toBe(true);
        // 對話框等待期間：雲端索引仍沒有 e，而首次合併前的修剪已執行（z 的綁定已消失）；e 的綁定仍須保留。
        expect((await h.sync.get(K.PRESET_INDEX))[K.PRESET_INDEX], 'precondition: the cloud dsPresetIndex still lacks e while the conflict dialog waits').not.toContain('e');
        const mapAtDialog = await page.getChatPresetMap();
        expect(mapAtDialog, 'precondition: the pre-merge orphan prune ran (the binding to z is gone while the conflict dialog waits)').not.toHaveProperty(CHAT_GONE);
        expect.soft(mapAtDialog[CHAT_E], 'binding of CHAT_E to the local-only group e while the conflict dialog waits').toBe('e');

        const isStillPending = await chooseMergeSyncAndReload();
        expect.soft(isStillPending, 'conflict dialog after Merge Sync and popup reload').toBe(false);

        const local = await h.local.get([K.PRESET_INDEX]);
        expect.soft(local[K.PRESET_INDEX], 'local dsPresetIndex lists the local-only group e after Merge Sync').toContain('e');
        const map = await page.getChatPresetMap();
        expect.soft(map[CHAT_E], 'binding of CHAT_E to the local-only group e after Merge Sync').toBe('e');
        expect.soft(map[CHAT_A], 'binding of CHAT_A to the shared group a after Merge Sync').toBe('a');
        expect.soft(map, 'the binding to z, a group on neither side, stays pruned after Merge Sync').not.toHaveProperty(CHAT_GONE);
    });
});
