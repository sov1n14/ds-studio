# 資料儲存、同步與備份規格

> 📂 [DS studio 文件](../) › [功能規格](../SPEC.md) › 資料儲存與同步
>
> **相關架構**：[儲存架構](../architecture/STORAGE.md)

## 8. 資料遷移

- 從 v1.2.x 升級後首次執行時，若 `promptPrefix`（舊鍵）包含內容但 `promptPresets`（新鍵）不存在，則將舊內容遷移至名為「我的提示詞」的提示詞組中，並設為啟用。
- 若 `promptPrefix` 為空或不存在，則 `promptPresets` 以空陣列啟動，`activePresetId` 設為空字串。

## 12. Toast 通知系統與儲存狀態

- **儲存狀態指示器**：彈出選單標題旁的 `<span id="saveStatus">`。`showSaveStatus()` 使綠色「已儲存」文字顯示 1 秒。用於所有自動儲存確認（開關、提示詞組、滑桿）。
- **Toast 通知**：彈出選單底部的 `<div id="toast" class="toast" hidden>`。`Toast.show(message, durationMs?)` 取消隱藏、顯示文字設定 `opacity: 1`，然後在 `durationMs`（預設 2000ms）後淡出（400ms CSS 轉場）。用於：
  - 匯出失敗：「匯出失敗，請重整頁面後再試」（2 秒）
  - JSON 匯出成功：「設定已成功匯出」（2 秒）
  - JSON 匯入成功：「設定已成功還原，請重新整理頁面。」（2 秒，頁面在 3 秒後重新載入）
  - 同步衝突解決成功：「資料已成功合併同步」（約 1 秒，頁面在 1 秒後重新載入）

## 13. JSON 備份與還原

- **匯出**：「備份設定（匯出 JSON）」按鈕透過 `StorageManager.getSettings()` 讀取所有設定，序列化為 JSON，以下載方式觸發，檔名為 `ds-studio-backup-YYYYMMDD.json`。
- **匯入**：「還原設定（匯入 JSON）」按鈕開啟檔案選取器。在選取檔案並經使用者確認後：
  - 提示詞組使用 `mergePresets()` **合併** — 相同 ID 保留較新的 `updatedAt`，新 ID 附加於後。
  - `chatPresetMap` 透過展開合併（本地端基底 + 匯入新增）。
  - UI 設定（globalDefaultPrompt、includeThinking、includeReferences、側邊欄自動隱藏、寬度）由匯入值**覆寫**。
  - 成功後顯示 Toast，3 秒後重新載入彈出選單。
  - （v4.7.3）+ isEnabled／globalPromptEnabled 為裝置層級的本機開關（local-only），匯入備份**不應覆寫**當前裝置的開關狀態，以避免關閉中的擴充功能因匯入而意外啟用。
- 此外，備份與還原卡片還包含「匯出復原備份」、「匯入復原備份」、「清除所有已還原紀錄」三個按鈕，專門用於管理 `restored_messages`（審查回覆還原記錄），獨立於一般設定備份。

## 14. 雲端同步與衝突處理

- **同步目標**：使用 `chrome.storage.sync` 作為跨裝置同步的主要儲存目標。若同步配額超出，自動備援至 `chrome.storage.local`。
- **自動同步**：所有寫入操作（`_set()`）為安全起見同時寫入同步與本地端儲存空間。
- **衝突偵測**：首次執行（或升級）時，比較本地端與同步的 `promptPresets`。若兩者不同且同步有資料，則設定 `syncConflictPending = true`，並阻止讀取使用同步資料（僅回傳本地端資料）。
- **衝突解決 UI**：當 `syncConflictPending` 為 true 時，彈出選單開啟時會顯示「雲端同步衝突」對話框，附有「合併同步」按鈕。
- **解決邏輯**：`StorageManager.resolveSyncConflict()` 讀取兩個儲存空間，透過 `mergePresets()` 合併提示詞組，以雲端版本覆寫 UI 設定（isEnabled／globalPromptEnabled 除外——兩者為裝置層級本機開關，不參與同步衝突解決），清除衝突旗標。
- **智慧合併**：`mergePresets()` 使用以提示詞組 `id` 為鍵的 Map。對每個 ID，保留 `updatedAt` 較新的提示詞組。新 ID 附加於後。這可防止雙方各自獨立修改提示詞組時的資料遺失。
- **刪除墓碑（v4.8.3）**：刪除提示詞組時會記錄一筆帶刪除時間戳的墓碑於 `dsPresetTombstones`（本地與同步兩端）。`resolveSyncConflict()` 合併時會先合併雙邊墓碑（保留較新的 `deletedAt`）並清理超過 30 天保留期的舊墓碑，再交給 `mergePresets()` 判斷：任一側資料的 `updatedAt` 不晚於其墓碑時間即會被排除，防止某裝置刪除的提示詞組被另一裝置（或同步備份中）仍保留的舊資料復活。

## 技術規格

### 目標環境

- **網域**：`chat.deepseek.com`
- **平台**：Chrome 擴充功能 Manifest V3
- **權限**：`storage`、`activeTab`、`alarms`（用於 background service worker 的排程重試與同步）

### DOM 選取

- **輸入區域**：DeepSeek 聊天介面中的 `textarea` 元素。
- **發送按鈕**：CSS 類別為 `div.ds-icon-button[role="button"]`（桌面版）或 `div.ds-button[role="button"]`（行動版）的 `div` 元素，包含路徑以 `M8.3125` 開頭的 SVG。
- **訊息容器**：`.ds-virtual-list-visible-items .ds-message`，用於列舉對話輪次。
- **Markdown 內容**：`.ds-markdown`，用於 AI 回應內容。
- **思考過程**：`.ds-think-content`，用於 AI 推理內容。
- **側邊欄容器**：`div.dc04ec1d` — 自動隱藏模組目標的側邊欄容器。
- **側邊欄內部內容**：`div.b8812f16.a2f3d50e` — 收合時透過負值 `margin-left` 位移的內部內容。
- **訊息清單區域**：`.ds-virtual-list-items._6f2c522` — 對話區域寬度 CSS 注入的目標。
- **輸入/容器區域**：`._871cbca` — 同時為對話區域寬度（置中）與輸入框寬度（max-width）CSS 注入的目標。
- **主要應用區域**：`._765a5cd` — MutationObserver 監控的目標，用於 UI 調整的 SPA 重新套用。
- **對話標題列**：`._2be88ba` — Overlay 提示詞組選單的定位錨點。
- **Go Down 原生按鈕**：`._0706cde`（含 `ds-button--floating ds-button--circle` 等 class）— GoToTop 的偵測目標與定位基準。
- **浮動按鈕包裝容器**：`.aaff8b8f`（`position: relative`）— GoToTop 按鈕的注入目標容器；外層 sticky 容器 `._871cbca`。
- **對話起始錨點**：`._9663006._2c189bc` / `[data-virtual-list-item-key="1"]` — GoToTop 隱藏條件與「已達頂部」判定錨點。

### 儲存結構

| 鍵 | 型別 | 預設值 | 說明 |
|-|-|-|-|
| `dsPresetIndex` | `string[]` | `[]` | 提示詞組 ID 的有序陣列（v1.7.0 新格式）。 |
| `dsPreset_<id>` | `PromptPreset` | — | 各提示詞組獨立儲存於此鍵，繞過 sync 每項 8KB 限制。每組：`{ id, name, content, createdAt, updatedAt }`。 |
| `activePresetId` | string | `""` | 當前啟用提示詞組的 ID。 |
| `isEnabled` | boolean | `false` | 提示詞注入是否啟用（主開關）。 |
| `includeThinking` | boolean | `true` | 匯出的 MD 是否包含 AI 思考過程。 |
| `includeReferences` | boolean | `true` | 匯出的 MD 是否包含引用參考連結。 |
| `globalDefaultPrompt` | string | `''` | 在所有對話中預先附加至各提示詞組前的全域提示詞。 |
| `globalPromptEnabled` | boolean | `true` | 全域預設提示詞是否注入（v3.0.0）。主開關優先權更高。 |
| `chatPresetMap` | object | `{}` | *已於 v2.4.0 遷移為分塊儲存*：舊版扁平鍵，僅於遷移時讀取，遷移後清理。 |
| `chatPresetMapMeta` | `{ version, chunkCount, chunkSizes[] }` | `{ version:0, ... }` | （v2.4.0+）分塊索引：版本號（樂觀並發權杖）、分塊數量、各塊位元組大小。 |
| `chatPresetMap_0`, `chatPresetMap_1`, ... | `{ [uuid]: presetId }` | — | （v2.4.0+）實際資料分塊，每塊 ≤ 7168 bytes，合併後即完整的 chatPresetMap。 |
| `dsSidebarAutoHide` | boolean | `false` | 側邊欄自動隱藏功能是否啟用。 |
| `dsChatWidth` | number | `70` | 對話區域寬度百分比（30–100）。 |
| `dsChatWidthEnabled` | boolean | `false` | 對話區域寬度調整是否啟用。 |
| `dsInputWidth` | number | `70` | 輸入框寬度百分比（30–100）。 |
| `dsInputWidthEnabled` | boolean | `false` | 輸入框寬度調整是否啟用。 |
| `dsHideThinking` | boolean | `false` | 隱藏思考過程功能是否啟用。 |
| `dsShowSystemTime` | boolean | `false` | 是否在訊息開頭注入目前系統時間。 |
| `dsLocalAuth` | `string[]` | `[]` | 本地端權威金鑰清單（Plan A）。記錄上次 sync 寫入失敗、改為寫入 local 的金鑰名稱，讓後續讀取優先取用 local 值（僅本地端）。 |
| `syncInitialized` | boolean | `false` | 初始同步是否已完成（僅本地端）。 |
| `syncConflictPending` | boolean | `false` | 是否有同步衝突待使用者解決（僅本地端）。 |
| `dsPresetTombstones` | `Object<id, deletedAt>` | `{}` | （v4.8.3）提示詞組刪除墓碑，同步於本地與雲端。合併時用於判斷某 id 是否已被刪除，避免舊資料復活。 |
| `dsOversizedKeys` | `string[]` | `[]` | （v4.8.2）永久超出 8KB 同步配額的金鑰清單（僅本地端）。自癒：下次寫入尺寸低於限制時自動移除。 |
| `dsPresetOrderMeta` | `{ order: string[], orderUpdatedAt: number }` | `{ order:[], orderUpdatedAt:0 }` | （v4.6.2）提示詞組排序的權威時間戳，用於跨裝置合併時決定哪一端的排序較新。 |
| `promptPresets` | `PromptPreset[]` | — | *已於 v1.7.0 退役*：v1.7.0 之前用於儲存所有提示詞組的陣列，已被 `dsPresetIndex` + `dsPreset_<id>` 取代。 |
| `restored_messages` | object | {} | 已復原的審查回覆記錄，含 message_id、fragments 等（僅本地端，最多 200 筆）。 |

### 實作細節

- **Content Script**：從對話的 UUID 綁定透過 `updatePromptPrefixFromBinding()` 推導注入前綴。監聽 `chrome.storage.onChanged` 的 `dsPresetIndex`、`dsPreset_*`（新式獨立鍵）與 `CHAT_PRESET_MAP` 變更，不再依賴已退役的 `promptPresets` 鍵。`handleChatChange()` 中驗證 binding 的有效性時使用 `StorageManager.getSettings()` 而非直接讀取原始儲存鍵，確保正確透過新 schema 解析提示詞組資料。同時監聽來自彈出選單的 `ACTIVE_PRESET_CHANGED` 訊息，實現各分頁提示詞組追蹤。每個分頁獨立追蹤 `pendingPresetId`，避免跨分頁污染。`awaitingNewChatUuid` 旗標與 5 秒逾時控制自動綁定機制。內建 `PresetOverlay` 模組，在對話頁面標題列呈現浮動提示詞組選單，支援雙向同步與 SPA 導航自動重新掛載。
- **儲存 API**：以 `chrome.storage.sync` 為主要儲存，在配額錯誤時自動備援至 `chrome.storage.local`。讀取時合併同步與本地端資料（衝突期間除外，僅回傳本地端）。
- **Plan A 本地端權威追蹤**：當 sync 寫入失敗時，受影響的金鑰會被加入 `dsLocalAuth` 清單，後續讀取時這些金鑰的 local 值優先於 sync 值，防止資料遺失。成功寫入 sync 後，對應金鑰自 `dsLocalAuth` 移除。
- **事件處理**：在捕獲階段攔截輸入事件，確保注入在原始發送邏輯執行前完成。使用原生 HTMLTextAreaElement 值設定器繞過 React 的合成值追蹤。透過 `requestAnimationFrame` 重新發送被抑制的事件。
- **對話框系統**：`Modal` 控制器物件以 `position: fixed` 覆蓋層呈現內嵌對話框。`Modal.prompt()` 強制執行必填輸入驗證。`Modal.confirm()` 支援危險變體與單按鈕（警示）模式。
- **側邊欄自動隱藏模組**：`content/sidebar-auto-hide.js` 中的 `SidebarAutoHide` 物件。透過 CSS 類別、內聯樣式與 CSS 轉場管理側邊欄收合/展開。使用兩個 `MutationObserver` 實例（一個用於 SPA DOM 取代，一個用於原生收合/展開循環）。透過 `document` 上的捕獲階段 `mouseover` 包含下拉選單懸停偵測。
- **對話區域寬度模組**：`content/chat-width.js` 中的 `ChatWidth` 物件。注入帶有基於 `vw` 的 `!important` 覆寫的動態 `<style>` 元素。透過 SPA DOM 變更上的 `MutationObserver` 重新套用。
- **輸入框寬度模組**：`content/input-width.js` 中的 `InputWidth` 物件。與 `ChatWidth` 相同的架構，但針對輸入專用選取器，使用獨立的儲存鍵與 `getEffectivePercent()` 實現對話區域寬度限制。
- **儲存狀態與 Toast**：`showSaveStatus()` 切換 `#saveStatus` 標題跨度。`popup.js` 中的 `Toast` 物件以透明度轉場管理 `#toast` div。
- **自動啟動模式**：每個內容模組（`SidebarAutoHide`、`ChatWidth`、`InputWidth`）遵循相同的啟動模式：`start()` 讀取儲存空間 → 若條件符合則啟用 → 註冊 `chrome.storage.onChanged` 監聽器實現即時切換，並具備主開關感知能力。
