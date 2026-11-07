// Triggers the Markdown export the way the popup does and captures the downloaded file.

import { readFile } from 'node:fs/promises';
import { findTabId, sendToTab } from './extension.js';

const EXPORT_DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Sends EXPORT_MARKDOWN to the tab showing `page` and resolves the downloaded file.
 * The listener for the download starts before the message, so a fast export is not missed.
 * @returns {Promise<{ fileName: string, content: string, ack: unknown }>}
 */
export async function exportMarkdown(page, { includeThinking, includeReferences }) {
    const tabId = await findTabId(page.context(), new URL(page.url()).pathname);
    const downloadPromise = page.waitForEvent('download', { timeout: EXPORT_DOWNLOAD_TIMEOUT_MS });
    const ack = await sendToTab(page.context(), tabId, { action: 'EXPORT_MARKDOWN', includeThinking, includeReferences });
    if (!ack?.received) {
        downloadPromise.catch(() => {});
        throw new Error(`Content script did not acknowledge EXPORT_MARKDOWN: ${JSON.stringify(ack)}`);
    }
    const download = await downloadPromise;
    const filePath = await download.path();
    return { fileName: download.suggestedFilename(), content: await readFile(filePath, 'utf8'), ack };
}

/** Drops the "Exported at" line, the only part of an export that differs between two runs. */
export function withoutExportTimestamp(markdown) {
    return markdown.split('\n').filter((line) => !line.startsWith('> Exported at:')).join('\n');
}
