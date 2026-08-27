# 技術債償還剩餘工作總覽

> **狀態：已歸檔。** 本分支 `refactor/debt-registry-paydown` 的全部工作已完成，manifest 版本 `4.31.29`。段 L 檔案拆分、文件同步、登記簿更新皆已結案。最終提交紀錄見 [refactor-paydown-handoff.md](refactor-paydown-handoff.md#四已完成歷史20-個提交由舊至新)。

Date: 2026-08-27. Branch: `refactor/debt-registry-paydown`. Manifest: `4.31.29`. Test baseline: 149 files / 2503 tests, all green.

## 一、段 L — 超過 250 行的檔案拆分（26 檔）

全部 26 檔已處理完畢：18 檔完成拆分，7 檔經評估後跳過，1 檔（`utils/storage-manager.js`）於 Task #5 提前完成。

### 已完成拆分（18 檔）

`utils/storage-manager.js`、`utils/storage-manager.chatmap.js`、`content/content-script.export.js`、`content/go-top.js`、`content/sidebar-auto-hide.js`、`content/edit-message-cleanup.js`、`utils/i18n.locales.js`、`content/censor-reply-restore.dom.js`、`content/go-top.render.js`、`content/mobile-sidebar-swipe.js`、`popup/editor/editor.js`、`utils/storage-manager.presets.js`、`content/censor-reply-restore.js`、`popup/popup.css`、`content/chat-binding-controller.js`、`content/quote-reply.js`、`popup/popup-controls.css`、`content/go-top.locate.js`

### 跳過（7 檔，附理由）

| 檔案 | 行數 | 跳過理由 |
|-|-|-|
| `content/temporary-chat-toggle.js` | 337 | IIFE closure，HIGH risk |
| `popup/popup.js` | 330 | DOMContentLoaded closure + regex-parsing specs，HIGH risk |
| `content/harvest.js` | 299 | monolithic async loop，無法拆分 |
| `content/content-script.js` | 252 | composition root，僅超過門檻 2 行 |
| `popup/popup.html` | 308 | 無 HTML include 機制 |
| `popup/popup-select.css` | 245 | 低於 250 行門檻 |
| `content/preset-overlay.controller.js` | 314 | factory closure coupling |

### 已於其他任務完成（1 檔）

`utils/storage-manager.js`（Task #5 提前處理，超過 450 行硬限）

## 二、文件同步

### 過時引用修正（10 處）

全部 10 處過時引用已修正完畢。涵蓋 `docs/ARCHITECTURE.md`、`docs/spec/04-features.md`、`docs/architecture/POPUP.md`、`.claude/skills/chrome-extension-coding-guidelines/SKILL.md`、`.claude/agent-memory/code-implementer/project_edit_tooling.md`、`docs/architecture/CONTENT_SCRIPTS.md` 中對 `content/temporary-chat-pending-store.js`、`utils/messaging.js`、`SEND_BUTTON_ICON_PATH_PREFIX` 的引用。

### Changelog 補寫

`docs/CHANGELOG.md` 與 `docs/changelog/v4.md` 已補寫 v4.31.2 至 v4.31.29 全部條目。

### 歷史性 changelog 條目（不需修改）

`docs/changelog/v4.md` 與 `docs/changelog/v3.md` 中引用舊路徑的條目屬於歷史紀錄，記載當時發生的事實，應維持原樣不動。

## 三、登記簿更新（`to-do/plans/archive/refactor-debt-registry.md`）

### 已結案項目（6 項） ✅

全部標記於歸檔登記簿。

### 查證為假項目（2 項） ❌

全部標記於歸檔登記簿。

### 新增 when-touched 債（3 項）— 全部已完成

| 項目 | 結果 |
|-|-|
| `content/chat-binding-controller.js` 測試鏡像 | ✅ 已完成：14 支 spec 遷移，`__getState`/`__setState` 已移除 |
| 四個布林命名 | ✅ 已完成：全部加上 `is`/`has` 前綴 |
| `DEEPSEEK_TAB_URL` 副本 | ✅ 已完成：抽取至 `utils/url-constants.js` |

### 原有 when-touched 項目（7 項）

| 項目 | 結果 |
|-|-|
| `censor-reply-restore.dom.js` 雙來源 | ✅ 已修正 |
| toggle `dss-temporary-chat-changed` 雙重派送 | 已接受並關閉 |
| `DSS_CHAT_CREATE_ENDPOINT` 無 production 消費者 | ✅ 已移除 |
| 模組層級 `start()`/`init()` | 已接受並關閉 |
| messaging 遷移預設值分歧 | 已接受並關閉 |
| B9 popup 殘留 | 已接受為 not-worth-doing |
| `utils/storage-manager.sync.js` 的 `restoreSettings` 搬移 | ✅ 拆分期間已完成 |

## 四、刻意未做的項目

以下項目經評估後決定不處理，保留紀錄以避免重複分析：

1. **`escapeHtml` 跨層上移**：兩版本契約不同（`"` 轉義行為不同）。
2. **`ds-selectors.js` selector 解析前言統一**：`ds-selectors.js` 只發布到 `window.DSstudio`，Vitest 下 `require` 分支相依，天真統一會打壞 spec。

## 五、建議執行順序

全部步驟已完成：

1. ✅ `utils/storage-manager.js` 拆分（Task #5）
2. ✅ 其餘 25 檔拆分處理（18 完成 + 7 跳過）
3. ✅ 登記簿更新（結案、修正、新增）
4. ✅ 文件過時引用修正（10 處）
5. ✅ Changelog 補寫（v4.31.2–v4.31.29）
