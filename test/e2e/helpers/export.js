// Triggers the Markdown export the way the popup does and captures the downloaded file.

import { readFile } from 'node:fs/promises';
import { findTabId, sendToTab } from './extension.js';

const EXPORT_DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * 對顯示 `page` 的分頁送出 EXPORT_MARKDOWN，內容腳本一確認收到就回傳，匯出則在背景繼續執行。
 * `download` 在匯出結束時解析出下載的檔案，因此呼叫端可在匯出途中操作頁面（例如按下提示上的取消按鈕）後再等待它。
 * 下載監聽在送出訊息前就開始，快速完成的匯出不會漏接。
 * @returns {Promise<{ ack: unknown, download: Promise<{ fileName: string, filePath: string, content: string }> }>}
 */
export async function startMarkdownExport(page, { includeThinking, includeReferences }) {
    const tabId = await findTabId(page.context(), new URL(page.url()).pathname);
    const downloadEvent = page.waitForEvent('download', { timeout: EXPORT_DOWNLOAD_TIMEOUT_MS });
    let ack;
    try {
        ack = await sendToTab(page.context(), tabId, { action: 'EXPORT_MARKDOWN', includeThinking, includeReferences });
    } catch (error) {
        downloadEvent.catch(() => {});
        throw error;
    }
    if (!ack?.received) {
        downloadEvent.catch(() => {});
        throw new Error(`Content script did not acknowledge EXPORT_MARKDOWN: ${JSON.stringify(ack)}`);
    }
    const download = downloadEvent.then(async (event) => {
        const filePath = await event.path();
        return { fileName: event.suggestedFilename(), filePath, content: await readFile(filePath, 'utf8') };
    });
    return { ack, download };
}

/**
 * 對顯示 `page` 的分頁送出 EXPORT_MARKDOWN，並等到匯出結束後解析出下載的檔案。
 * @returns {Promise<{ fileName: string, content: string, ack: unknown }>}
 */
export async function exportMarkdown(page, options) {
    const { ack, download } = await startMarkdownExport(page, options);
    const { fileName, content } = await download;
    return { fileName, content, ack };
}

/** Drops the "Exported at" line, the only part of an export that differs between two runs. */
export function withoutExportTimestamp(markdown) {
    return markdown.split('\n').filter((line) => !line.startsWith('> Exported at:')).join('\n');
}
