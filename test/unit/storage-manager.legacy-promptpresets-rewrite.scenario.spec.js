/**
 * 情境：新版每組一鍵的佈局（dsPresetIndex + dsPreset_<id>）已存在後，舊版裝置又把舊格式 promptPresets 陣列寫回 sync。同一次 initialize() 同時含刪除路徑與建立路徑，屬於破壞性加建設性的情境測試。
 *
 * 需求：initialize() 不得把舊陣列裡缺少的群組視為刪除；目前佈局的群組順序、其 dsPreset_<id> 鍵與綁定該群組的聊天都要保留，不得為它們寫入 dsPresetTombstones（否則刪除會同步擴散到其他裝置）；舊的 promptPresets 鍵在 sync 與 local 都要清掉；舊陣列裡 updatedAt 較舊的同 id 內容不得覆蓋目前內容；只在舊陣列出現的群組接在目前順序之後寫入兩個區域，但留有刪除紀錄（dsPresetTombstones）的群組不得復活，該刪除紀錄也要保留。
 *
 * 真實的 service worker 與 client StorageManager 由 test/helpers/chat-map-writer-harness.js 載入；只替換 chrome.storage 與 chrome.runtime 訊息這兩個信任邊界，模組之間不做任何 mock。斷言只讀持久化的 storage 狀態與公開的 getSettings()；鍵名取自 docs/architecture/STORAGE.md，不讀實作的 KEYS。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChatMapWriterHarness, restoreChromeBoundaries } from '../helpers/chat-map-writer-harness.js';

const group = (id, content, updatedAt) => ({ id, name: `Group ${id}`, content, createdAt: 1000, updatedAt });
const A = group('a', 'A current', 5000);
const B = group('b', 'B content', 5000);
const C = group('c', 'C content', 5000);

let h;
let client;

/** 模擬舊版裝置把 promptPresets 陣列寫回 sync。 */
const writeLegacyList = (list) => h.sync.set({ promptPresets: list });

const readAreas = async () => ({ sync: await h.sync.get(null), local: await h.local.get(null) });

beforeEach(async () => {
    h = await createChatMapWriterHarness({ clientCount: 1 });
    [client] = h.clients;
    await client.savePromptPresets([A, B, C]);
    await h.sync.set({ syncInitialized: true });
    await h.local.set({ syncInitialized: true });
    const ids = (await client.getSettings()).promptPresets.map((p) => p.id);
    expect(ids, 'precondition: the per-group layout holds a, b, c before the legacy list appears').toEqual(['a', 'b', 'c']);
});

afterEach(() => {
    restoreChromeBoundaries();
    vi.restoreAllMocks();
});

describe('initialize() when a legacy promptPresets list reappears after the per-group layout exists', () => {
    it('keeps a group missing from the legacy list: order, dsPreset_<id> in both areas, no tombstone, legacy key removed', async () => {
        await writeLegacyList([A, B]);

        await client.initialize();

        const ids = (await client.getSettings()).promptPresets.map((p) => p.id);
        expect(ids, 'group ids from getSettings() after initialize').toEqual(['a', 'b', 'c']);
        const { sync, local } = await readAreas();
        expect(sync.dsPreset_c, 'sync dsPreset_c after initialize').toMatchObject({ id: 'c', content: C.content });
        expect(local.dsPreset_c, 'local dsPreset_c after initialize').toMatchObject({ id: 'c', content: C.content });
        expect(Object.keys(sync.dsPresetTombstones || {}), 'sync dsPresetTombstones ids').not.toContain('c');
        expect(Object.keys(local.dsPresetTombstones || {}), 'local dsPresetTombstones ids').not.toContain('c');
        expect('promptPresets' in sync, 'legacy promptPresets key left in sync').toBe(false);
        expect('promptPresets' in local, 'legacy promptPresets key left in local').toBe(false);
    });

    it('keeps a chat bound to a group missing from the legacy list', async () => {
        await h.seedChatMap([{ chat1: 'c' }]);
        expect((await h.readStored()).map, 'precondition: chat1 is bound to c').toEqual({ chat1: 'c' });
        await writeLegacyList([A, B]);

        await client.initialize();

        expect((await h.readStored()).map, 'stored chat map after initialize').toEqual({ chat1: 'c' });
    });

    it('does not let an older legacy copy of a current group overwrite its content', async () => {
        await writeLegacyList([{ ...A, content: 'A stale', updatedAt: 1000 }, B, C]);

        await client.initialize();

        const a = (await client.getSettings()).promptPresets.find((p) => p.id === 'a');
        expect(a?.content, 'group a content from getSettings() after initialize').toBe(A.content);
        const { sync, local } = await readAreas();
        expect(sync.dsPreset_a?.content, 'sync dsPreset_a content after initialize').toBe(A.content);
        expect(local.dsPreset_a?.content, 'local dsPreset_a content after initialize').toBe(A.content);
    });

    it('appends a group that only the legacy list holds, after the current order, in both areas', async () => {
        const D = group('d', 'D content', 5000);
        await writeLegacyList([A, B, D]);

        await client.initialize();

        const ids = (await client.getSettings()).promptPresets.map((p) => p.id);
        expect(ids, 'group ids from getSettings() after initialize').toEqual(['a', 'b', 'c', 'd']);
        const { sync, local } = await readAreas();
        expect(sync.dsPreset_d, 'sync dsPreset_d after initialize').toMatchObject({ id: 'd', content: D.content });
        expect(local.dsPreset_d, 'local dsPreset_d after initialize').toMatchObject({ id: 'd', content: D.content });
    });

    it('does not restore a legacy group that has a deletion tombstone, and keeps that tombstone', async () => {
        const tombstone = { e: { ts: Date.now() - 60000, deleted: true } };
        await h.sync.set({ dsPresetTombstones: tombstone });
        await h.local.set({ dsPresetTombstones: tombstone });
        await writeLegacyList([A, B, group('e', 'E content', 5000)]);

        await client.initialize();

        const ids = (await client.getSettings()).promptPresets.map((p) => p.id);
        expect(ids, 'group ids from getSettings() after initialize').not.toContain('e');
        const { sync, local } = await readAreas();
        expect('dsPreset_e' in sync, 'dsPreset_e restored in sync').toBe(false);
        expect('dsPreset_e' in local, 'dsPreset_e restored in local').toBe(false);
        expect(sync.dsPresetTombstones?.e, 'sync tombstone for e').toEqual(tombstone.e);
        expect(local.dsPresetTombstones?.e, 'local tombstone for e').toEqual(tombstone.e);
    });
});
