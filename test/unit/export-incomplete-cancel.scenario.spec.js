// @vitest-environment jsdom
/**
 * 情境：使用者在匯出途中按下進度 toast 的取消鈕，匯出以「已取消」的不完整狀態結束。
 *
 * 需求（docs/spec/04-features.md 第 3 節第 9 點、docs/architecture/EXPORT.md「Incomplete-export reporting」與「Cleanup」）：任何提前停止（stalled、cancelled、scroll_interrupted）都照樣下載已擷取的內容，檔尾附上 `> ⚠️ Export may be incomplete (<N> messages captured): <clause>.`，並在頁面上顯示警示 toast（showHarvestToastIncomplete，樣式 .dss-harvest-toast--incomplete）。取消時的 clause 為 `the export was cancelled`。
 *
 * 為何以 vm 共用全域載入：manifest content_scripts 以 classic script 在同一個 isolated world 執行，彼此只透過全域交換函式；vitest 的 import 讓每個檔案各自成為模組範圍，既有規格又以 vi.stubGlobal 補上瀏覽器中並不存在的全域，因此看不到全域缺漏。本檔沿用 service-worker.*-wiring.spec.js 的作法：每個測試建立一個新的 vm context 充當 isolated world 的全域，依 manifest content_scripts 的順序，以 classic script 執行匯出路徑用到的真實檔案，頂層宣告共用的方式與 Chrome 相同。
 *
 * 只替換信任邊界：Blob 與 URL.createObjectURL / revokeObjectURL（瀏覽器下載）、alert，以及下載連結點擊後的瀏覽器導覽。DOM、計時器與 Date 由 jsdom 與 vitest 提供，並以 getter 轉交給 vm context，讓假計時器同樣作用於載入的腳本。任何 harvest / toast 函式都不 stub。
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { loadMessagesWithoutThinkBlock } from '../helpers/think-block-fixtures.js';

const REPO_ROOT = path.resolve(__dirname, '../..');

/** 匯出路徑在 isolated world 中用到的腳本；實際載入順序取自 manifest，而非此清單的順序。 */
const EXPORT_PATH_SCRIPTS = new Set([
    'utils/i18n.locales.zhTW.js',
    'utils/i18n.locales.en.js',
    'utils/i18n.locales.js',
    'utils/i18n.js',
    'utils/logger.js',
    'utils/message-constants.js',
    'content/ds-selectors.js',
    'content/retry-until.js',
    'content/harvest.toast.js',
    'content/harvest.dom.js',
    'content/harvest.think.js',
    'content/harvest.policy.js',
    'content/harvest.js',
    'content/content-script.export.time.js',
    'content/content-script.export.markdown.js',
    'content/content-script.export.js',
]);

/** 交給 vm context 的瀏覽器全域；以 getter 讀取測試 realm 當下的值，vi.useFakeTimers 換掉的計時器與 Date 因此同樣生效。 */
const DELEGATED_GLOBALS = [
    'document', 'navigator', 'location', 'innerHeight', 'innerWidth', 'getComputedStyle',
    'Node', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'Text', 'DocumentFragment', 'NodeFilter',
    'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'AbortController', 'AbortSignal',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'Date', 'performance', 'console', 'queueMicrotask', 'structuredClone',
];

const CANCELLED_CLAUSE = 'the export was cancelled';

/** manifest 中 isolated world 那一組 content_scripts 裡、屬於匯出路徑的檔案，保持 manifest 順序。 */
function exportPathScriptsInManifestOrder() {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
    const isolated = manifest.content_scripts.find((entry) => !entry.world || entry.world === 'ISOLATED');
    const files = isolated.js.filter((file) => EXPORT_PATH_SCRIPTS.has(file));
    expect(files.slice().sort(), 'harness: every export-path script is listed in manifest content_scripts').toEqual([...EXPORT_PATH_SCRIPTS].sort());
    return files;
}

/**
 * 建立一個 isolated world：新的 vm context 充當全域（window === globalThis），依 manifest 順序執行匯出路徑的 classic script。
 * 回傳 context 與下載邊界的紀錄：blobs 收集 Blob 內容，createObjectURL 為 spy。
 */
async function bootIsolatedWorld() {
    const blobs = [];
    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    const RealURL = globalThis.URL;
    const world = {
        Blob: class CapturingBlob {
            constructor(parts) { blobs.push(parts.join('')); }
        },
        URL: class extends RealURL {
            static createObjectURL(blob) { return createObjectURL(blob); }
            static revokeObjectURL(url) { return revokeObjectURL(url); }
        },
        alert: vi.fn(),
    };
    DELEGATED_GLOBALS.forEach((name) => {
        Object.defineProperty(world, name, { get: () => globalThis[name], configurable: true, enumerable: true });
    });
    vm.createContext(world);
    const worldGlobal = vm.runInContext('globalThis', world);
    world.window = worldGlobal;
    world.self = worldGlobal;
    for (const rel of exportPathScriptsInManifestOrder()) {
        const file = path.join(REPO_ROOT, rel);
        if (!fs.existsSync(file)) throw new Error('manifest lists ' + rel + ', which does not exist');
        vm.runInContext(fs.readFileSync(file, 'utf8'), world, { filename: file });
    }
    await world.dsI18n.init();
    return { world, blobs, createObjectURL, revokeObjectURL };
}

/**
 * 掛上一段 DeepSeek 對話（真實的使用者訊息與回覆），放在 harvest 掃描的 virtual-list 結構中，回傳掛上的訊息數。
 * isOverflowing 為 true 時對話遠高於視窗、捲動不帶來新內容，harvest 會一直跑到被取消；為 false 時整段對話都在視窗內，harvest 會完整結束。
 */
function mountConversation(isOverflowing) {
    const scrollArea = document.createElement('div');
    scrollArea.className = 'ds-virtual-list ds-scroll-area';
    Object.defineProperty(scrollArea, 'scrollHeight', { value: isOverflowing ? 200000 : 400, configurable: true });
    Object.defineProperty(scrollArea, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });
    scrollArea.scrollBy = () => {};
    scrollArea.scrollTo = () => {};
    const listItems = document.createElement('div');
    listItems.className = 'ds-virtual-list-items';
    const visibleItems = document.createElement('div');
    visibleItems.className = 'ds-virtual-list-visible-items';
    listItems.appendChild(visibleItems);
    scrollArea.appendChild(listItems);
    const { userMessage, assistantMessage } = loadMessagesWithoutThinkBlock();
    userMessage.querySelector('.ds-collapsible-text span').textContent = 'partial prompt kept';
    assistantMessage.querySelector('.ds-assistant-message-main-content').innerHTML = '<p>partial answer kept</p>';
    [userMessage, assistantMessage].forEach((msg, key) => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-virtual-list-item-key', String(key));
        wrapper.appendChild(msg);
        visibleItems.appendChild(wrapper);
    });
    document.body.appendChild(scrollArea);
    return 2;
}

/** 記錄被點擊的下載連結，並阻止瀏覽器導覽（jsdom 不實作 blob: 導覽）；這是下載的信任邊界。 */
function watchDownloads() {
    const downloads = [];
    const onClick = (event) => {
        const anchor = event.target && event.target.closest && event.target.closest('a[download]');
        if (!anchor) return;
        downloads.push({ name: anchor.download, href: anchor.getAttribute('href') });
        event.preventDefault();
    };
    document.addEventListener('click', onClick, true);
    return { downloads, stop: () => document.removeEventListener('click', onClick, true) };
}

/** 每次推進 100 ms 假時間，直到 pending 結束（上限 20 秒）；回傳 reject 的錯誤，resolve 時回傳 null。 */
async function settle(pending) {
    let isSettled = false;
    let error = null;
    pending.then(() => { isSettled = true; }, (err) => { isSettled = true; error = err; });
    for (let elapsed = 0; elapsed < 20000 && !isSettled; elapsed += 100) {
        await vi.advanceTimersByTimeAsync(100);
    }
    expect(isSettled, 'harness: the export did not settle within 20 s of fake time').toBe(true);
    return error;
}

/** 頁面上可見的不完整警示 toast；不存在或被隱藏時回傳 null。 */
function visibleIncompleteToast() {
    const toast = document.querySelector('.dss-harvest-toast--incomplete');
    if (!toast || !toast.isConnected) return null;
    return getComputedStyle(toast).display === 'none' ? null : toast;
}

const hadOwnInnerText = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'innerText');
beforeAll(() => {
    if (!hadOwnInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    }
});
afterAll(() => {
    if (!hadOwnInnerText) delete HTMLElement.prototype.innerText;
});

let isolated;
let downloadWatch;

beforeEach(async () => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    isolated = await bootIsolatedWorld();
    downloadWatch = watchDownloads();
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    downloadWatch.stop();
    document.body.innerHTML = '';
});

describe('scenario: export path loaded as classic scripts in one isolated world', () => {
    it('harness: a complete export downloads the conversation with no incomplete footer and no warning toast', async () => {
        mountConversation(false);
        vi.useFakeTimers();

        const error = await settle(isolated.world.__DS_ContentExport.exportConversationToMarkdown(false, true));

        expect(error, 'harness: the complete export rejected').toBeNull();
        expect(downloadWatch.downloads, 'harness: the complete export clicked no download link').toHaveLength(1);
        expect(isolated.blobs, 'harness: the complete export built no Markdown file').toHaveLength(1);
        expect(isolated.blobs[0]).toContain('partial prompt kept');
        expect(isolated.blobs[0]).not.toContain('Export may be incomplete');
        expect(visibleIncompleteToast()).toBeNull();
    });

    it('a cancelled export still downloads the captured messages, ends the file with the cancelled footer and shows the incomplete warning toast', async () => {
        const mountedCount = mountConversation(true);
        vi.useFakeTimers();

        const pending = isolated.world.__DS_ContentExport.exportConversationToMarkdown(false, true);
        await vi.advanceTimersByTimeAsync(3500);
        const cancelButton = document.querySelector('.dss-harvest-toast__cancel-btn');
        expect(cancelButton, 'harness: the progress toast shows no cancel button 3.5 s into the export').not.toBeNull();
        cancelButton.click();
        const error = await settle(pending);

        const markdown = isolated.blobs[0];
        expect(isolated.blobs, 'the cancelled export downloaded no Markdown file; the export ' + (error ? 'rejected with ' + error : 'resolved')).toHaveLength(1);
        expect(downloadWatch.downloads, 'the cancelled export clicked no download link').toHaveLength(1);
        expect(downloadWatch.downloads[0].name).toMatch(/^deepseek-chat-\d{8}-\d{6}\.md$/);
        expect(markdown, 'the partial file lost the captured user message').toContain('partial prompt kept');
        expect(markdown, 'the partial file lost the captured reply').toContain('partial answer kept');
        const footer = '> ⚠️ Export may be incomplete (' + mountedCount + ' messages captured): ' + CANCELLED_CLAUSE + '.';
        expect(markdown.trimEnd().split('\n').pop(), 'the partial file does not end with the cancelled footer').toBe(footer);

        const toast = visibleIncompleteToast();
        expect(toast, 'no incomplete-export warning toast is shown after the cancelled export').not.toBeNull();
        expect(toast.textContent).toContain(CANCELLED_CLAUSE);
        expect(toast.textContent, 'the toast does not name the captured count').toMatch(new RegExp('(^|\\D)' + mountedCount + '(\\D|$)'));
        expect(error, 'the cancelled export rejected').toBeNull();
        expect(isolated.world.alert).not.toHaveBeenCalled();
    });
});
