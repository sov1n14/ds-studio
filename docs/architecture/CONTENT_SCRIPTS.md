# 內容腳本模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › 內容腳本模組
>
> **相關規格**：[提示詞系統](../spec/01-prompt-system.md) · [UI 調整](../spec/03-ui-adjustments.md) · [功能規格](../spec/04-features.md)

## 模組索引

| 模組群組 | 涵蓋功能 | 詳細文件 |
|-|-|-|
| **UI 調整模組** | Sidebar Auto-Hide, Chat Width, Input Width, Hide Thinking, GoToTop, Mobile Sidebar Swipe | [→ content-ui.md](content-ui.md) |
| **歷史面板模組** | Full Conversation History Panel（IndexedDB 讀取、面板／搜尋、Markdown 匯出，v4.11.0） | [→ content-ui.md](content-ui.md#history-panel-module-v4110) |
| **導航與介面模組** | SPA Navigation, Overlay Preset Selector, Empty Preset, Toast | [→ content-navigation.md](content-navigation.md) |
| **使用者互動模組** | Quote Reply, PreventAutoScroll, System Time Injection, Edit Message Cleanup | [→ content-interaction.md](content-interaction.md) |
| **互動復原模組** | Censor Reply Restore (4 files + CSS) | [→ spec/04-features.md](../spec/04-features.md) |
| **臨時對話模組** | Temporary Conversation（`temporary-chat-constants.js`、`temporary-chat-toggle.js` + `.css`、`temporary-chat-delete.js`） | [→ spec/04-features.md](../spec/04-features.md) |
| **匯出工具模組** | Scroll-and-Harvest Markdown export engine | [→ EXPORT.md](EXPORT.md) |
| **工具模組** | Mobile Homepage DOM cleanup (v4.1.0) | — |

> **v4.0.0 模組化**：以下大型內容腳本已拆分為「入口檔 + 方法包」（行為不變，方法包經 `globalThis.__DS_*` 由入口檔 `Object.assign` 合併，載入順序於 `manifest.json` 強制：方法包先於入口檔）。此外，`content-script.harvest.js`（匯出工具）與 `mobile-homepage-cleanup.js`（行動版首頁 DOM 清理）也是透過 `manifest.json` 的 `content_scripts` 清單載入：
>
> - `content-script.js` → `content-script.js`（入口）+ `content-script.export.js`（Markdown 匯出）<!-- overlay 於 v4.2.0 進一步拆分為 6 個獨立模組，詳見 ARCHITECTURE.md 目錄樹 -->
> - `go-top.js` → `go-top.js`（入口）+ `go-top.locate.js`（查詢/定位/可見性）+ `go-top.render.js`（渲染/注入/模式切換）+ `go-top.scroll.js`（捲動動畫引擎）
> - `censor-reply-restore.js` → `censor-reply-restore.js`（入口）+ `censor-reply-restore.markdown.js`（Markdown 渲染）+ `censor-reply-restore.dom.js`（DOM 注入）+ `censor-reply-restore.storage.js`（持久化）
