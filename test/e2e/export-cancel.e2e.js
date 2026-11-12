import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { startMarkdownExport } from './helpers/export.js';
import {
    HARVEST_TOAST_CANCEL_SELECTOR,
    HARVEST_TOAST_DISMISS_SELECTOR,
    HARVEST_TOAST_INCOMPLETE_SELECTOR,
    HARVEST_TOAST_SELECTOR,
    HARVEST_TOAST_TEXT_SELECTOR,
} from './helpers/extension-ui.js';
import { closeExtensionPages, openPopup } from './helpers/popup.js';
import { readListScroll, waitForListScrollToSettle } from './helpers/scroll.js';

// 匯出進度提示與取消匯出：以 popup 同樣的 EXPORT_MARKDOWN 訊息啟動匯出，在頁面上的進度提示按下取消，並讀取實際下載的檔案。
// 預期值來源：docs/spec/04-features.md:15-16（擷取階段文字含則數、取消後按鈕立即停用並改為「Cancelling…」）、:27（不完整註記格式）、:29（無論成功或中斷都還原捲動位置）、:36（中斷仍匯出並顯示警告提示）、:38-42（`## User`、`## DeepSeek` 標題）、:46（檔名）；docs/architecture/EXPORT.md:57-58（註記與警告提示帶實際擷取則數）、:216（cancelled 的原因子句）；docs/FEATURES.md:260-266。
// 只開啟並匯出保留的長對話（唯讀），不送出、不編輯、不刪除任何對話。

test.setTimeout(180_000);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// 下載檔案存放在作業系統暫存目錄；未指定時 Playwright 會放進 repo 內的 test/test-results。
const DOWNLOAD_DIR = path.join(os.tmpdir(), 'dss-e2e-export-cancel-downloads');
const VIEWPORT = { width: 1280, height: 720 };
const EXPORT_OPTIONS = { includeThinking: false, includeReferences: false };
// docs/spec/04-features.md:15-16 的英文原文；頁面顯示的是同一語系條目的在地化文字。
const CAPTURING_TEXT = 'Capturing full conversation… {count} messages captured';
const COUNT_PLACEHOLDER = '{count}';
const CANCELLING_LABEL = 'Cancelling…';
// docs/spec/04-features.md:27 的註記格式，<clause> 取 docs/architecture/EXPORT.md:216 的 cancelled 子句。
const CANCELLED_FOOTER = /^> ⚠️ Export may be incomplete \((\d+) messages captured\): the export was cancelled\.$/;
// docs/spec/04-features.md:46。
const FILE_NAME_PATTERN = /^deepseek-chat-\d{8}-\d{6}\.md$/;
// 還原後的 scrollTop 與匯出前相差不超過此值（四捨五入與次像素誤差）。
const SCROLL_RESTORE_TOLERANCE_PX = 2;
// 取消後下載應在下一個擷取步驟結束時出現（docs/FEATURES.md:262）；這個長對話完整匯出約 4 秒，30 秒內沒有下載即視為沒有匯出。
const CANCELLED_DOWNLOAD_TIMEOUT_MS = 30_000;

test.use({ launchOptions: { downloadsPath: DOWNLOAD_DIR } });

/** 回傳 `pending` 的結果；`timeoutMs` 內沒有解析時以 `message` 失敗。 */
async function within(pending, timeoutMs, message) {
    // 逾時後 pending 仍可能在稍後失敗（例如頁面關閉），先接住以免成為未處理的 rejection。
    pending.catch(() => {});
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${message} (no result within ${timeoutMs} ms)`)), timeoutMs);
    });
    try {
        return await Promise.race([pending, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** 在 popup 中找出英文語系表裡文字等於文件原文 `english` 的條目，回傳目前語系下的同一條目文字；英文表沒有這段文字時失敗。 */
async function localizedFromDocumentedEnglish(popup, english) {
    const text = await popup.evaluate((value) => {
        const en = globalThis.__DS_I18N_Locales?.en ?? {};
        const key = Object.keys(en).find((name) => en[name] === value);
        return key ? dsI18n.t(key) : null;
    }, english);
    expect(text, `the English locale table holds the documented text "${english}"`).not.toBeNull();
    return text;
}

/** 讀取文件中擷取階段文字與「Cancelling…」的在地化版本；在開啟對話前讀完並關閉 popup，匯出時 DeepSeek 分頁保持在前景。 */
async function readLocalizedToastTexts(context, extensionId) {
    const popup = await openPopup(context, extensionId);
    try {
        const capturingTemplate = await localizedFromDocumentedEnglish(popup, CAPTURING_TEXT);
        expect(capturingTemplate, 'the localized capture text keeps the {count} placeholder').toContain(COUNT_PLACEHOLDER);
        return { capturingTemplate, cancellingLabel: await localizedFromDocumentedEnglish(popup, CANCELLING_LABEL) };
    } finally {
        await closeExtensionPages(context);
    }
}

/** 依在地化的擷取階段文字範本，從狀態文字取出 {count} 位置上的則數；文字不符範本（例如捲動至頂端階段）時為 null。 */
function parseCapturedCount(text, capturingTemplate) {
    const [before, after] = capturingTemplate.split(COUNT_PLACEHOLDER);
    if (!text?.startsWith(before) || !text.endsWith(after)) return null;
    const digits = text.slice(before.length, text.length - after.length).trim();
    return /^\d+$/.test(digits) ? Number(digits) : null;
}

/** 開啟保留的長對話並等它停在穩定的捲動位置，回傳匯出前的 scrollTop。 */
async function openLongThread(page, settings, openConversation) {
    await page.setViewportSize(VIEWPORT);
    await page.bringToFront();
    await settings.set({ isEnabled: true });
    await openConversation(CONVERSATIONS.veryLongThread);
    await waitForListScrollToSettle(page);
    return (await readListScroll(page)).top;
}

/** 進度提示目前顯示的已擷取則數；尚在捲動至頂端階段時為 null。 */
async function readToastCount(page, capturingTemplate) {
    return parseCapturedCount(await page.locator(HARVEST_TOAST_TEXT_SELECTOR).textContent(), capturingTemplate);
}

/** 等到進度提示第一次顯示已擷取則數（大於 0）並回傳該則數。 */
async function waitForFirstCount(page, capturingTemplate) {
    let first = null;
    await expect.poll(async () => {
        first = await readToastCount(page, capturingTemplate);
        return first;
    }, { message: 'the progress toast shows a captured count', intervals: [50] }).toBeGreaterThan(0);
    return first;
}

/** 在取消按鈕上掛一個頁面端的 click 監聽，記下擴充功能處理完這次點擊當下按鈕的狀態與提示文字；監聽排在擴充功能的監聽之後，讀到的是點擊後立即的狀態。 */
function recordCancelClick(page) {
    return page.evaluate(({ cancelSelector, textSelector }) => {
        const button = document.querySelector(cancelSelector);
        const status = document.querySelector(textSelector);
        button.addEventListener('click', () => {
            window.__e2eCancelClick = { isDisabled: button.disabled, label: button.textContent, statusText: status.textContent };
        });
    }, { cancelSelector: HARVEST_TOAST_CANCEL_SELECTOR, textSelector: HARVEST_TOAST_TEXT_SELECTOR });
}

/** 下載檔案須落在作業系統暫存目錄，不在 repo 內。 */
function expectOutsideRepo(filePath) {
    const normalized = path.resolve(filePath).toLowerCase();
    expect(normalized.startsWith(REPO_ROOT.toLowerCase()), `download ${filePath} is outside the repo`).toBe(false);
    expect(normalized.startsWith(path.resolve(os.tmpdir()).toLowerCase()), `download ${filePath} lands in the OS temp dir`).toBe(true);
}

/** 檔案最後一個非空白行。 */
function lastNonBlankLine(content) {
    return content.split(/\r?\n/).filter((line) => line.trim() !== '').at(-1) ?? '';
}

test.describe('export progress toast and cancel', () => {
    test('the progress toast shows a cancel button and a captured count that grows while the export runs', async ({ page, context, extensionId, settings, openConversation }) => {
        const { capturingTemplate } = await readLocalizedToastTexts(context, extensionId);
        await openLongThread(page, settings, openConversation);

        const { download } = await startMarkdownExport(page, EXPORT_OPTIONS);
        await expect(page.locator(HARVEST_TOAST_SELECTOR), 'the progress toast appears').toBeVisible();
        await expect(page.locator(HARVEST_TOAST_CANCEL_SELECTOR), 'the progress toast carries a cancel button').toBeVisible();

        const firstCount = await waitForFirstCount(page, capturingTemplate);
        await expect.poll(() => readToastCount(page, capturingTemplate), { message: `the captured count grows past ${firstCount}`, intervals: [50] }).toBeGreaterThan(firstCount);

        // 這個長對話完整匯出只需數秒，因此讓它跑完並等到下載，下一個測試才不會撞上仍在執行的匯出；取消的行為由下一個測試獨立驗證。
        const { filePath } = await download;
        expectOutsideRepo(filePath);
    });

    test('cancelling mid-run disables the button, still downloads the captured turns with a cancelled footer, warns on the page and restores the scroll position', async ({ page, context, extensionId, settings, openConversation }) => {
        const { capturingTemplate, cancellingLabel } = await readLocalizedToastTexts(context, extensionId);
        const scrollTopBefore = await openLongThread(page, settings, openConversation);

        const { download } = await startMarkdownExport(page, EXPORT_OPTIONS);
        await waitForFirstCount(page, capturingTemplate);
        await recordCancelClick(page);
        await page.locator(HARVEST_TOAST_CANCEL_SELECTOR).click();
        const { fileName, filePath, content } = await within(download, CANCELLED_DOWNLOAD_TIMEOUT_MS, 'a cancelled export still downloads the messages captured so far (docs/FEATURES.md:262, docs/spec/04-features.md:36)');

        expectOutsideRepo(filePath);
        expect(fileName, 'file name follows deepseek-chat-YYYYMMDD-HHmmss.md').toMatch(FILE_NAME_PATTERN);
        const footer = lastNonBlankLine(content);
        expect(footer, 'the file ends with the documented cancelled footer').toMatch(CANCELLED_FOOTER);
        const footerCount = Number(CANCELLED_FOOTER.exec(footer)[1]);

        const click = await page.evaluate(() => window.__e2eCancelClick);
        test.info().annotations.push({ type: 'cancel click', description: JSON.stringify({ ...click, footerCount, scrollTopBefore }) });
        expect(click, 'the cancel click reached the button').toBeDefined();
        expect(click.isDisabled, 'the cancel button is disabled right after the click').toBe(true);
        expect(click.label.trim(), 'the cancel button switches to the documented "Cancelling…" label').toBe(cancellingLabel);
        const countAtClick = parseCapturedCount(click.statusText, capturingTemplate);
        expect(countAtClick, 'the toast showed a captured count when Cancel was clicked (precondition)').toBeGreaterThan(0);
        expect(footerCount, 'the footer counts at least the messages captured when Cancel was clicked').toBeGreaterThanOrEqual(countAtClick);

        expect(content, 'the partial export holds a user turn').toMatch(/^## User$/m);
        expect(content, 'the partial export holds a DeepSeek turn').toMatch(/^## DeepSeek$/m);

        const warning = page.locator(HARVEST_TOAST_INCOMPLETE_SELECTOR);
        await expect(warning, 'the page shows the incomplete-export warning toast').toBeVisible();
        await expect(warning, 'the warning toast names the captured count').toContainText(String(footerCount));
        await expect.poll(async () => Math.abs((await readListScroll(page)).top - scrollTopBefore), { message: `the list returns to its scrollTop before the export (${scrollTopBefore})` }).toBeLessThanOrEqual(SCROLL_RESTORE_TOLERANCE_PX);

        const dismiss = page.locator(HARVEST_TOAST_DISMISS_SELECTOR);
        await expect(dismiss, 'the warning toast carries a dismiss button').toBeVisible();
        await dismiss.click();
        await expect(page.locator(HARVEST_TOAST_SELECTOR), 'dismissing hides the warning toast').toBeHidden();
    });
});
