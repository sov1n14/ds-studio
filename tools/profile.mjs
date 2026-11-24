/**
 * tools/ 腳本取得瀏覽器設定檔的唯一入口：統一使用 repo 根目錄的 `.browser-profile`（已登入 DeepSeek 的持久化 Chrome 設定檔）。
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROFILE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.browser-profile');

const IN_USE_MESSAGE = '`.browser-profile` is in use or failed to launch. Close E2E or any Chrome using it, then rerun.';

/**
 * 以 `.browser-profile` 啟動持久化 Chrome context；options 會覆蓋預設值（例如 headless、viewport、args）。
 * 工具腳本探測的是 DeepSeek 自身的 DOM，因此刻意不傳 `ignoreDefaultArgs: ['--disable-extensions']`，讓擴充功能保持停用（E2E 則會啟用它）。
 */
export async function launchProfile(chromium, options = {}) {
  if (!existsSync(PROFILE_DIR)) {
    throw new Error(`Browser profile missing: ${PROFILE_DIR}. Launch Chrome with this --user-data-dir, log in to DeepSeek, then rerun.`);
  }
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: false,
      ...options,
    });
  } catch (err) {
    throw new Error(`${IN_USE_MESSAGE}\n${err.message}`, { cause: err });
  }
}
