# 內容腳本模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › 內容腳本模組
>
> **相關規格**：[提示詞系統](../spec/01-prompt-system.md) · [UI 調整](../spec/03-ui-adjustments.md) · [功能規格](../spec/04-features.md)

## 模組索引

| 模組群組 | 涵蓋功能 | 詳細文件 |
|-|-|-|
| **UI 調整模組** | Sidebar Auto-Hide, Chat Width, Input Width, Hide Thinking, GoToTop, Mobile Sidebar Swipe | [→ content-ui.md](content-ui.md) |
| **導航與介面模組** | SPA Navigation, Overlay Preset Selector, Empty Preset, Toast | [→ content-navigation.md](content-navigation.md) |
| **使用者互動模組** | Quote Reply, PreventAutoScroll, System Time Injection | [→ content-interaction.md](content-interaction.md) |

> **v4.0.0 模組化**：以下大型內容腳本已拆分為「入口檔 + 方法包」（行為不變，方法包經 `globalThis.__DS_*` 由入口檔 `Object.assign` 合併，載入順序於 `manifest.json` 強制：方法包先於入口檔）：
>
> - `content-script.js` → `content-script.js`（入口）+ `content-script.export.js`（Markdown 匯出）+ `content-script.overlay.js`（PresetOverlay，`createPresetOverlay(ctx)` 工廠）
> - `go-top.js` → `go-top.js`（入口）+ `go-top.locate.js`（查詢/定位/可見性）+ `go-top.render.js`（渲染/注入/模式切換）+ `go-top.scroll.js`（捲動動畫引擎）
> - `censor-reply-restore.js` → `censor-reply-restore.js`（入口）+ `censor-reply-restore.markdown.js`（Markdown 渲染）+ `censor-reply-restore.dom.js`（DOM 注入）+ `censor-reply-restore.storage.js`（持久化）
