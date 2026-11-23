/**
 * 舊版 promptPresets 合併（I-59）的突變體殺除測試：補足 storage-manager.legacy-promptpresets-rewrite.scenario.spec.js 未覆蓋的輸入。
 *
 * 需求來源：docs/architecture/STORAGE.md「Data Migration」（合併保留目前群組與順序、僅附加未被墓碑覆蓋的舊版獨有群組、目前群組只被依 mergePresets() 規則勝出的舊版內容取代、索引列出但無內容的群組屬合法狀態），以及 dsPresetOrderMeta 的結構 `{ order: string[], orderUpdatedAt: number }`（跨裝置合併以 orderUpdatedAt 判定哪一側的順序較新）。mergeLegacyPresets() 回傳 `{ ids, presetsToWrite }`：新索引與需要寫入（內容與目前不同）的群組。
 *
 * initialize() 情境透過 test/helpers/chat-map-writer-harness.js 載入真實的 StorageManager，只替換 chrome.storage 與 chrome.runtime 訊息兩個信任邊界；斷言只讀持久化的 storage 狀態與公開方法的回傳值。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChatMapWriterHarness, restoreChromeBoundaries } from '../helpers/chat-map-writer-harness.js';

const group = (id, content, updatedAt) => ({ id, name: `Group ${id}`, content, createdAt: 1000, updatedAt });
const A = group('a', 'A current', 5000);
const B = group('b', 'B content', 5000);
const C = group('c', 'C content', 5000);
const D = group('d', 'D content', 5000);

let h;
let client;

const writeLegacyList = (list) => h.sync.set({ promptPresets: list });
const readAreas = async () => ({ sync: await h.sync.get(null), local: await h.local.get(null) });
/** 兩區都寫入同一份值，模擬已收斂的裝置狀態。 */
const setBoth = async (items) => {
    await h.sync.set(items);
    await h.local.set(items);
};

beforeEach(async () => {
    h = await createChatMapWriterHarness({ clientCount: 1 });
    [client] = h.clients;
    await client.savePromptPresets([A, B, C]);
    await setBoth({ syncInitialized: true });
});

afterEach(() => {
    restoreChromeBoundaries();
    vi.restoreAllMocks();
});

describe('mergeLegacyPresets() return value', () => {
    it('returns no group to write when the legacy list holds only unchanged copies of current groups', () => {
        const result = client.mergeLegacyPresets(['a', 'b', 'c'], [A, B, C], [{ ...A }, { ...B }], {});

        expect(result.ids, 'ids').toEqual(['a', 'b', 'c']);
        expect(result.presetsToWrite, 'presetsToWrite for an unchanged legacy subset').toEqual([]);
    });

    it('returns only the newer legacy copy and the legacy-only group to write, not the unchanged current groups', () => {
        const newerA = { ...A, content: 'A newer legacy', updatedAt: 6000 };

        const result = client.mergeLegacyPresets(['a', 'b', 'c'], [A, B, C], [newerA, { ...B }, D], {});

        expect(result.ids, 'ids').toEqual(['a', 'b', 'c', 'd']);
        expect(result.presetsToWrite, 'presetsToWrite').toHaveLength(2);
        expect(result.presetsToWrite, 'presetsToWrite').toEqual(expect.arrayContaining([newerA, D]));
    });

    it('lets a newer legacy copy replace a current group even when that current id carries a deletion tombstone', () => {
        // 墓碑只擋下僅存在於舊陣列的群組；目前群組依 mergePresets() 的新舊規則處理
        const newerA = { ...A, content: 'A newer legacy', updatedAt: 5500 };
        const tombstones = { a: { ts: 6000, deleted: true } };

        const result = client.mergeLegacyPresets(['a', 'b'], [A, B], [newerA], tombstones);

        expect(result.ids, 'ids').toEqual(['a', 'b']);
        expect(result.presetsToWrite, 'presetsToWrite').toEqual([newerA]);
    });

    it('ignores a null entry in the legacy list', () => {
        const result = client.mergeLegacyPresets(['a'], [A], [{ ...A }, null, D], {});

        expect(result.ids, 'ids').toEqual(['a', 'd']);
        expect(result.presetsToWrite, 'presetsToWrite').toEqual([D]);
    });

    it('ignores a legacy entry that has no id', () => {
        const result = client.mergeLegacyPresets(['a'], [A], [{ ...A }, { name: 'No id', content: 'orphan' }, D], {});

        expect(result.ids, 'ids').toEqual(['a', 'd']);
        expect(result.presetsToWrite, 'presetsToWrite').toEqual([D]);
    });
});

describe('initialize() importing a legacy promptPresets list', () => {
    it('leaves dsPresetIndex and dsPresetOrderMeta untouched in both areas when the legacy list adds no group', async () => {
        // 順序未變卻刷新 orderUpdatedAt，會讓本裝置在跨裝置合併時宣稱擁有較新的排序
        await setBoth({ dsPresetOrderMeta: { order: ['a', 'b', 'c'], orderUpdatedAt: Date.now() - 60000 } });
        const before = await readAreas();
        await writeLegacyList([A, B]);

        await client.initialize();

        const after = await readAreas();
        expect(after.sync.dsPresetIndex, 'sync dsPresetIndex').toEqual(before.sync.dsPresetIndex);
        expect(after.local.dsPresetIndex, 'local dsPresetIndex').toEqual(before.local.dsPresetIndex);
        expect(after.sync.dsPresetOrderMeta, 'sync dsPresetOrderMeta').toEqual(before.sync.dsPresetOrderMeta);
        expect(after.local.dsPresetOrderMeta, 'local dsPresetOrderMeta').toEqual(before.local.dsPresetOrderMeta);
        expect('promptPresets' in after.sync || 'promptPresets' in after.local, 'legacy promptPresets key left').toBe(false);
    });

    it('records the appended order in dsPresetOrderMeta with a newer orderUpdatedAt in both areas', async () => {
        const oldTs = Date.now() - 60000;
        await setBoth({ dsPresetOrderMeta: { order: ['a', 'b', 'c'], orderUpdatedAt: oldTs } });
        await writeLegacyList([A, B, C, D]);

        await client.initialize();

        const { sync, local } = await readAreas();
        for (const [area, stored] of [['sync', sync], ['local', local]]) {
            expect(stored.dsPresetIndex, `${area} dsPresetIndex`).toEqual(['a', 'b', 'c', 'd']);
            expect(stored.dsPresetOrderMeta?.order, `${area} dsPresetOrderMeta.order`).toEqual(['a', 'b', 'c', 'd']);
            expect(stored.dsPresetOrderMeta?.orderUpdatedAt, `${area} dsPresetOrderMeta.orderUpdatedAt`).toBeGreaterThan(oldTs);
        }
    });

    it('imports the legacy list when the current index lists a group that has no stored body', async () => {
        // STORAGE.md 將「索引列出但無內容」視為合法狀態
        await setBoth({ dsPresetIndex: ['a', 'b', 'c', 'x'] });
        const { sync: pre } = await readAreas();
        expect('dsPreset_x' in pre, 'precondition: dsPreset_x has no body').toBe(false);
        await writeLegacyList([A, D]);

        await expect(client.initialize(), 'initialize() with a bodiless index id').resolves.toBeUndefined();

        const { sync, local } = await readAreas();
        expect(sync.dsPreset_d, 'sync dsPreset_d').toMatchObject({ id: 'd', content: D.content });
        expect(local.dsPreset_d, 'local dsPreset_d').toMatchObject({ id: 'd', content: D.content });
        expect(sync.dsPreset_c, 'sync dsPreset_c kept').toMatchObject({ id: 'c', content: C.content });
        expect('promptPresets' in sync || 'promptPresets' in local, 'legacy promptPresets key left').toBe(false);
    });
});
