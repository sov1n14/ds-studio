// 附件上傳：在瀏覽器內以替身回應 DeepSeek 的上傳與檔案狀態請求，讓測試能在輸入框只附檔案（沒有文字）時送出，而不在測試帳號留下任何檔案。
// 替身回應的形狀照抄 2026-11-12 在真實頁面觀察到的回應：選檔後頁面送出 POST /api/v0/file/upload_file（multipart，欄位 file），回應狀態為 PENDING，送出按鈕在此回應後即解除停用；約 2.5 秒後頁面以 GET /api/v0/file/fetch_files?file_ids=<id> 查詢，回應狀態為 SUCCESS。

import { expect } from '@playwright/test';
import { DSSelectors } from './selectors.js';

const UPLOAD_PATH = '/api/v0/file/upload_file';
const FETCH_FILES_PATH = '/api/v0/file/fetch_files';
// 附上的文字檔內容；替身回應的 file_size 取其位元組數。
const ATTACHMENT_BYTES = Buffer.from('ds-studio e2e attachment\n');

/** DeepSeek API 的成功外層：`{ code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data } }`。 */
function deepSeekOk(bizData) {
    return { status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data: bizData } }) };
}

/** 從 multipart 請求內文取出上傳的檔名。 */
function uploadedFileName(request) {
    const match = /filename="([^"]*)"/.exec(request.postDataBuffer()?.toString('latin1') ?? '');
    return match ? match[1] : 'unknown.txt';
}

/** 頁面讀取的檔案紀錄，欄位照抄真實回應。 */
function fileRecord(upload, status) {
    const now = Date.now() / 1000;
    return { id: upload.id, status, file_name: upload.fileName, from_share: false, file_size: ATTACHMENT_BYTES.length, model_kind: 'VISION', token_usage: status === 'SUCCESS' ? 8 : null, error_code: null, inserted_at: now, updated_at: now, is_image: false, audit_result: null };
}

/**
 * 以替身回應 `page` 的上傳請求與檔案狀態查詢，兩者都不會離開瀏覽器。
 * @returns {Promise<{ uploads: () => Array<{ id: string, fileName: string }>, statusChecks: () => number }>} 每次上傳得到的替身檔案 id 與檔名，以及頁面查詢檔案狀態（得到 SUCCESS）的次數。
 */
export async function stubFileUploads(page) {
    const uploads = [];
    let statusChecks = 0;
    await page.route((url) => url.pathname === UPLOAD_PATH, (route) => {
        const upload = { id: `file-e2e-stub-${Date.now()}-${uploads.length}`, fileName: uploadedFileName(route.request()) };
        uploads.push(upload);
        return route.fulfill(deepSeekOk(fileRecord(upload, 'PENDING')));
    });
    await page.route((url) => url.pathname === FETCH_FILES_PATH, (route) => {
        statusChecks += 1;
        const ids = (new URL(route.request().url()).searchParams.get('file_ids') ?? '').split(',');
        const files = uploads.filter((upload) => ids.includes(upload.id)).map((upload) => ({ ...fileRecord(upload, 'SUCCESS'), signed_path: `/file?file_id=${upload.id}` }));
        return route.fulfill(deepSeekOk({ files }));
    });
    return { uploads: () => [...uploads], statusChecks: () => statusChecks };
}

/** 主輸入框動作列內的檔案選擇欄位（編輯框另有自己的檔案欄位，因此限定在主輸入框的送出按鈕列）。 */
function composerFileInput(page) {
    return page.locator(`.${DSSelectors.SEND_BUTTON_ROW_CLASS} input[type="file"]`);
}

/** 經由主輸入框的檔案欄位附上一個小文字檔 `fileName`，並等待頁面顯示其檔案卡片。 */
export async function attachTextFile(page, fileName) {
    await composerFileInput(page).setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: ATTACHMENT_BYTES });
    await expect(page.getByText(fileName, { exact: true }), 'the composer shows the attached file card (precondition)').toBeVisible();
}
