# 內容腳本模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › 內容腳本模組
>
> **相關規格**：[提示詞系統](../spec/01-prompt-system.md) · [UI 調整](../spec/03-ui-adjustments.md) · [功能規格](../spec/04-features.md)

## 模組索引

| 模組群組 | 涵蓋功能 | 詳細文件 |
|-|-|-|
| **UI 調整模組** | Sidebar Auto-Hide, Chat Width, Input Width, Hide Thinking, GoToTop, Mobile Sidebar Swipe | [→ content-ui.md](content-ui.md) |
| **導航與介面模組** | SPA Navigation, Overlay Preset Selector, Empty Preset, Toast | [→ content-navigation.md](content-navigation.md) |
| **使用者互動模組** | Quote Reply, PreventAutoScroll, System Time Injection, Edit Message Cleanup | [→ content-interaction.md](content-interaction.md) |
| **互動復原模組** | Censor Reply Restore (4 files + CSS) | [→ spec/04-features.md](../spec/04-features.md) |
| **臨時對話模組** | Temporary Conversation（`temporary-chat-constants.js`、`temporary-chat-toggle.js` + `.css`、`temporary-chat-delete.js`） | [→ spec/04-features.md](../spec/04-features.md) |
| **匯出工具模組** | Scroll-and-Harvest Markdown export engine | [→ EXPORT.md](EXPORT.md) |
| **工具模組** | Mobile Homepage DOM cleanup (v4.1.0)、`ds-selectors.js`（v4.11.13，共用選擇器常數） | — |

> **v4.0.0 模組化**：以下大型內容腳本已拆分為「入口檔 + 方法包」（行為不變，方法包經 `globalThis.__DS_*` 由入口檔 `Object.assign` 合併，載入順序於 `manifest.json` 強制：方法包先於入口檔）。此外，`content-script.harvest.js`（匯出工具）與 `mobile-homepage-cleanup.js`（行動版首頁 DOM 清理）也是透過 `manifest.json` 的 `content_scripts` 清單載入：
>
> - `content-script.js` → `content-script.js`（入口）+ `content-script.export.js`（Markdown 匯出）+ `prompt-injector.controller.js`（提示詞注入，v4.11.15 追加）<!-- overlay 於 v4.2.0 進一步拆分為 6 個獨立模組，詳見 ARCHITECTURE.md 目錄樹 -->
> - `go-top.js` → `go-top.js`（入口）+ `go-top.locate.js`（查詢/定位/可見性）+ `go-top.render.js`（渲染/注入/模式切換）+ `go-top.scroll.js`（捲動動畫引擎）
> - `censor-reply-restore.js` → `censor-reply-restore.js`（入口）+ `censor-reply-restore.markdown.js`（Markdown 渲染）+ `censor-reply-restore.dom.js`（DOM 注入）+ `censor-reply-restore.thinkblock.js`（思考區塊 widget，v4.11.12 追加）+ `censor-reply-restore.storage.js`（持久化）

> **v4.11.9 拆分**：`harvest.js` → `harvest.js`（入口，捲動擷取引擎）+ `harvest.toast.js`（進度提示 UI）。原檔 502 行超出 `coding-guidelines` §8 的 450 行 JS 主動拆分門檻，且同時承載「擷取引擎」與「toast UI」兩個關注點；拆分後為 426 行 + 102 行，行為不變。
>
> 此處採用的是**純函式方法包**慣例（同 `content-script.js`、`preset-overlay.controller.js`），與上述 `this` 綁定的 `Object.assign` 方法包不同：`harvest.toast.js` 以 `globalThis.__DS_Harvest_toast` 掛載，入口檔以 `globalThis.__DS_Harvest_toast || require('./harvest.toast.js')` 取得，兼容瀏覽器與 Node/vitest 兩種載入路徑。`manifest.json` 中 `harvest.toast.js` 排在 `harvest.js` 之前。

> **v4.11.15 拆分**：`content-script.js` 原為 491 行，超出 `coding-guidelines` §8 的 450 行門檻，同時裝著「聊天狀態」與「提示詞注入」兩個關注點。抽出後者至 `prompt-injector.controller.js`（179 行），入口檔降至 360 行。
>
> 選擇抽出「提示詞注入」而非「聊天狀態」，是因為 `test/unit/storage-manager.sync-now.spec.js` 以正則比對 `content-script.js` 的**原始碼字面**，抓取其中的 `initSettings` 區塊；聊天狀態那一側的函式都環繞著 `initSettings`，搬動會打斷該斷言。抽注入側則讓 `initSettings` 原地不動、零風險。
>
> 新檔採 `createPromptInjector(ctx)` 工廠慣例（同 `preset-overlay.controller.js`），透過 getter/setter 閉包存取入口檔的模組狀態；`isInjecting` 是唯一由新檔寫入的變數，以 getter + setter 成對傳入。`module.exports` 的 16 個鍵一個不少，`content-script.*.spec.js` 全系列的 default import 用法不變。

> **v4.11.13 共用選擇器**：`content/ds-selectors.js` 集中三個原本重複定義的 DeepSeek DOM 選擇器常數——`VIRTUAL_LIST_SELECTOR`（`.ds-virtual-list-items._6f2c522`）、`VIRTUAL_LIST_FALLBACK`（`[class*="ds-virtual-list-items"]`）、`SCROLL_AREA_CLASS`（`ds-scroll-area`）。此前前兩者在 `go-top.js` 與 `harvest.js` 各有一份相同字面值，第三者則在 `go-top.locate.js` 與 `harvest.js` 兩邊都以行內字串寫死，維持同步的機制只有一行註解。DeepSeek 是 React 應用、class name 帶雜湊，改版時修好一邊不會讓另一邊也修好，而兩邊的失效徵狀都不指向真正原因（go-top 退回 `document.scrollingElement`，按鈕看似能按卻捲不動；harvest 撞上 `no_container` 守衛，匯出直接失敗）。
>
> 命名空間採 `window.DSstudio.Selectors`（跨模組共用工具的慣例，同 `prevent-auto-scroll-bridge.js` 的 `window.DSstudio.PreventAutoScroll`），而非 `globalThis.__DS_*` 方法包慣例——後者是給單一模組拆成多檔、共享 `this` 綁定用的，性質不同。
>
> **v4.11.17 修正（重要慣例）**：初版讓 `harvest.js` 與 `go-top.js` 各自以 `const __DSSelectors = ...` 取得共用常數，結果兩支都在**真正的頂層**宣告同一個名字。`manifest.json` 的 `content_scripts` 全部以 classic script 身分載入、共用 isolated world 的同一個全域作用域，因此第二支（`go-top.js`）拋出 `SyntaxError: Identifier '__DSSelectors' has already been declared` 而整支不執行，「回到頂部」按鈕完全不出現。已改為各自唯一的 `__DSSelectorsHarvest` 與 `__DSSelectorsGoTop`。
>
> 此類缺陷**單元測試結構上抓不到**——vitest 下每個檔案是獨立模組、各有作用域，碰撞無法重現（當時 1746 個測試全綠）。守門機制改由 `test/unit/content-script-global-collisions.spec.js` 提供：它以 `manifest.json` 的清單為準，靜態掃描每支 content script 的頂層宣告，任兩支撞名即失敗（IIFE 內的宣告不計入，因此 `go-top.locate.js` 內同名的 `__DSSelectors` 不受影響）。**在未包 IIFE 的 content script 頂層新增任何 `const`／`let`／`var`／`function` 之前，請先確認名稱在全體 content scripts 中唯一。**
>
> **刻意未做**：`_findScrollContainer()`（go-top）與 `_findHarvestScrollContainer()`（harvest）兩個 walk-up 函式**維持各自獨立**，未合併。兩者的策略集不是包含關係（go-top 有 4 條含 anchor 起點與側邊欄防護，harvest 只有 2 條且無 anchor 概念），快取語意也不同（go-top 快取於 `this._scrollContainer` 且刻意不快取 document 退回，harvest 完全不快取）。取聯集會讓 harvest 靜默停用兩條策略、製造虛假一致性；取交集會讓 go-top 失去側邊欄防護。共用選擇器與共用 walk-up 邏輯是兩件可分離的事，前者安全，後者不是。
