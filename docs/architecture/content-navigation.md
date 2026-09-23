# 導航與介面模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › [內容腳本模組](CONTENT_SCRIPTS.md) › 導航與介面
>
> **相關規格**：[Popup UI 規格](../spec/02-popup-ui.md) · [提示詞系統規格](../spec/01-prompt-system.md)

## SPA 導航偵測 (SPA Navigation Detection)

DeepSeek 的對話介面是單頁應用程式（SPA）。使用者切換對話或開啟新對話時，URL 路徑會改變，但頁面不會完整重新載入。`document.body` 上的 `MutationObserver` 監看 DOM 變動，並將 `window.location.pathname` 與上次記錄的值比較。偵測到路徑變更時，呼叫 `handleChatChange()` 執行以下步驟：

1. 從 URL 路徑（`/a/chat/s/{uuid}`）擷取新的 UUID。
2. 從 storage 重新載入 `chatPresetMap`。
3. 若該 UUID 已綁定提示詞組 → 將 `promptPrefix` 設為該提示詞組的內容（經由採用新版逐鍵 schema 的 `StorageManager.getSettings()` 確認該提示詞組仍存在；若已失效則清除綁定）。
4. 若該 UUID 尚無紀錄，但是從無 UUID 狀態轉換而來，**且**分頁層級的 `awaitingNewChatUuid` 旗標已設定（代表使用者確實在新對話頁面觸發了送出）→ 將分頁層級的 `pendingPresetId` 自動綁定到新的 UUID。若旗標未設定（例如使用者從新對話頁面手動點擊既有對話），此轉換視為一般導航，不建立綁定。如此確保每個對話都維持獨立的綁定關係。
5. 無 UUID 頁面：無條件清除 `promptPrefix`、`pendingPresetId` 與 `awaitingNewChatUuid`，避免提示詞組狀態跨分頁殘留沿用。
6. 瀏覽器上一頁／下一頁導航另外經由 `popstate` 事件處理。

### `awaitingNewChatUuid` 旗標機制

為避免非預期的自動綁定（例如在新對話頁面選擇提示詞組後，又手動切換到一個未綁定的既有對話），自動綁定以 `awaitingNewChatUuid` 布林值作為閘門：

- **設定**：只由 `markChatCreationAttempt()` 設定，該函式在使用者於無 UUID 頁面、輸入非空的情況下實際按下 Enter 或點擊送出按鈕時呼叫。
- **消耗**：由 `handleChatChange()` 在從無 UUID 轉換到有 UUID 時消耗——若 `awaitingNewChatUuid` 為 true 且 `pendingPresetId` 非空，即建立綁定。
- **自動清除**：5 秒後經由 `setTimeout` 自動清除，避免送出失敗後殘留的旗標造成污染。
- **其他清除時機**：手動離開新對話頁面時，以及 `handleChatChange()` 的無 UUID 分支中。

如此確保在新對話頁面只是開啟 popup 並選擇提示詞組，再點擊既有對話時，**不會**自動綁定該對話。

## Overlay 提示詞組選擇器 (Overlay Preset Selector)

`PresetOverlay` 模組（由 `content/content-script.js` 經工廠協調，UI 邏輯分散於 `preset-overlay.controller.js`、`preset-overlay.resolvers.js`、`preset-overlay.styles.js`、`preset-viewport-sync.js`、`preset-id.resolver.js`、`preset-dropdown.component.js`、`preset-dropdown.position.js`、`preset-dropdown.menu-position.js`、`preset-dropdown.width.js`、`preset-dropdown.options.js`、`preset-dropdown.keyboard.js` 與 `preset-settle.scheduler.js`）在 DeepSeek 頁面的對話標題列（`div._2be88ba`）上渲染一個置中的浮動下拉選單，無需開啟 popup 即可切換提示詞組。

**DOM 結構**：
- `<div id="dss-preset-overlay" role="combobox">` 外層容器作為自訂 combobox 容器。其定位由 `content/preset-dropdown.position.js` 的 `computePlacement()` 逐幀動態計算（而非靜態 CSS）——定位模式見下文。
- 內部的 `<button class="dss-preset-trigger">` 顯示目前選取的提示詞組名稱，`<ul id="dss-preset-menu" role="listbox">` 下拉選單列出可用的提示詞組。標題列經由選擇器 `._2be88ba:not(._1551317)` 取得 `position: relative !important`，作為定位錨點——`:not(._1551317)` 排除條件保留 DeepSeek 在新對話頁面原生的 `position: absolute`，避免破壞歡迎畫面（`_9a2f8e4`）的版面。
- CSS 經由 `injectOverlayStyles()` 注入，並以防護（`#dss-overlay-style`）避免重複注入；也可經由 `removeOverlayStyles()` 完整移除。

#### 響應式定位 (v4.2.0–v4.2.2)

Overlay 使用 `content/preset-dropdown.position.js` 計算的三種定位模式：

- **置中模式**（可視寬度 ≥ 768px）：在標題列容器內垂直置中（`top: 50%; transform: translateY(-50%)`）。水平位置由 `computePlacement()` 經 inline `left` 與 `width` 動態設定。
- **間隙模式**（< 768px）：定位於對話標題右緣與新對話按鈕左緣之間的間隙。有上限的穩定重試迴圈（`preset-settle.scheduler.js`）每個 animation frame 輪詢按鈕的 `left` 位置，直到連續 3 幀穩定為止，避免頁面載入期間過早量測出錯誤數值。
- **隱藏模式**：間隙過小時完全隱藏 overlay。

支援機制包括目標元素上的 `ResizeObserver`，以及以 rAF 節流的視窗 resize 監聽器。兩者連同穩定迴圈的接線都位於 `content/preset-viewport-sync.js`（v4.18.1）——controller 保有狀態欄位與 DOM 寫入本身的所有權，並將元素參照與套用回呼以明確參數傳入，因此模組層級不共用任何可變狀態。

#### 觸發器寬度 (v4.18.1)

Overlay 佔用的寬度貼合**最寬**的候選標籤，而非目前顯示的標籤。`content/preset-dropdown.width.js` 以所有選項名稱加上 placeholder 文字建立候選清單，將每個候選暫時寫入實際的標籤 span 並讀取 `scrollWidth` 來量測（因此量測結果帶有標籤本身計算後的字型），於 `finally` 中還原原始文字，再將寬度交給 `preset-dropdown.position.js` 中的純函式 `pickNaturalWidth()`。該函式回傳 `max(labelWidths) + arrowWidth + paddingLeft + paddingRight + gap`，下限為 `minWidth`（80），且刻意**不設上限**——依可用水平空間設上限的工作留給 `computePlacement()`，它會限制在 `maxWidth`（200）以內，間隙模式下則限制在量測到的間隙以內。

由於 `getNaturalWidth()` 位於穩定迴圈每個 animation frame 都會執行的定位路徑上，量測器會依下拉選單實例快取結果，只在輸入改變時重新計算：快取於 `setOptions()`（選項資料重建）與 `updateLocale()`（placeholder 文字改變）中失效。若每幀重新量測，每一幀都會改寫標籤文字 N 次並強制 N 次 reflow。

> 量測所有候選，讓自訂 combobox 得到與原生 `<select>` 依最寬 `<option>` 貼合內容相同的效果（`min-width: 80px; max-width: 200px`），因此不論選取哪個選項，觸發器寬度都保持一致。

**生命週期**：
1. `start(presets, activeId, enable)`——於 `initSettings()` 中、`setupNavigationDetection()` 之後呼叫。注入 overlay 樣式、設定 DOM observer、尋找並掛載到標題列、渲染提示詞組清單，並依 `enable` 參數（連動總開關 `isEnabled`）設定初始可見性。
2. `findAndMount()`——查詢 `._2be88ba`。若找到且與目前目標不同，呼叫 `mountTo()` 建構 DOM 並附加到標題列，接著依 `isEnabled` 同步可見性，並讀取 storage 以渲染目前狀態。
3. `mountTo()` 經由 `_applyPlacementSync()`，**在與 `appendChild` 相同的 task 中同步**套用定位，並在穩定迴圈啟動之前完成（v4.18.1）。若先附加再等待 animation frame，瀏覽器會以元素未設定尺寸的預設幾何繪製一幀，從該幀跳到第一次量測後的定位，在頁面載入時看起來就像「展開」動畫。overlay 本身完全沒有 CSS transition——`preset-dropdown.css` 中唯一的 transition 是 `.dss-preset-arrow` 的開合旋轉——因此這項修正純粹是調整順序，而非遮掩。穩定迴圈之後仍會執行，因為 DeepSeek 宿主頁面本身的版面在載入期間確實持續變動。
4. `scheduleFindAndMount()`——150 ms debounce 的重新掛載（`FIND_AND_MOUNT_DEBOUNCE_MS`），在 SPA 導航替換標題列時重新觸發 `findAndMount()`。controller 本身不持有任何 `MutationObserver`：`content/content-script.js` 為整個內容層持有唯一的 `document.body` `childList + subtree` observer，並將其回呼分派給導航檢查與此方法，各自保有自己的 debounce 語意。新的 body 層級偵測需求必須接到這個分派上——不允許第二個 body observer。
5. `setVisible(enabled)`——切換外層容器的 `display: none`。於總開關變更與 SPA 重新掛載時呼叫，以遵循目前的 `isEnabled` 狀態。

#### Overlay 顯示哪個提示詞組 Id (v4.18.1)

使用者在頁面內點擊開啟新對話時，React 會替換標題列，因此每次重新掛載都會重新渲染 overlay。對於沒有 UUID 的對話，`findAndMount()` 因此必須參考 `pendingPresetId` 與 `pinnedPresetId`；若在此渲染字面值 `''`，會覆寫 `handleChatChange()` 剛經由 `updateActiveId()` 推入的值，釘選的預設提示詞組就只能在完整重新整理頁面或送出第一則訊息後才保留下來。

此判斷位於純模組 `content/preset-id.resolver.js`：

    resolveOverlayPresetId({ chatUuid, chatPresetMap, pendingPresetId, pinnedPresetId, presets })

- 非空的 `chatUuid` **只**從 `chatPresetMap` 取得 id，`pendingPresetId`／`pinnedPresetId` 永遠無法影響它。這讓既有對話的提示詞組不受釘選預設值影響。
- 沒有對話 id 時，pending id 是**三值**的：提示詞組仍存在的非空字串優先；空字串 `''` 代表使用者明確選擇了空白（no-op）提示詞組，**不得**退回釘選預設值；`null`／`undefined` 代表尚未做任何選擇，因此套用釘選預設值（同樣只在該提示詞組仍存在時）。
- 任一路徑上的失效 id——提示詞組已被刪除——都降級為 `''`。

controller 經由 `content/content-script.js` 提供的選用 getter `ctx.getPendingPresetId()` 讀取即時的 pending id，並從 `findAndMount()` 本就會執行的 `getSettings()` 呼叫取得 `pinnedPresetId` 與提示詞組陣列——不需第二次讀取 storage。getter 不存在時降級為 `undefined`，resolver 會正確將其解讀為「尚未做任何選擇」。

> 保留三值訊號需要使用 `??` 而非 `||`。controller 中的 `onSelectChange()` 與 `content-script.js` 中的 `ACTIVE_PRESET_CHANGED` 處理器都寫入 `id ?? null`：`'' || null` 的結果是 `null`，會把「使用者明確選擇空白」壓縮成「尚未做任何選擇」，使釘選預設值在下一次重新掛載時蓋過明確的選擇重新出現。

**雙向同步**：
- **Overlay → Popup**：`onSelectChange(newId)` 呼叫 `StorageManager.saveActivePresetId(newId)`。在有 UUID 的對話上，它先樂觀地在記憶體中發布新的 `chatPresetMap`，再透過 service worker 以 `StorageManager.bindChatToPreset(uuid, newId)`（選擇空白選項時為 `unbindChat(uuid)`）持久化，之後採用儲存後的對照表。該寫入被拒絕時，它重新讀取已儲存的對照表，以 `updateActiveId(storedId)` 將 overlay 回滾到已儲存的綁定，並呼叫 `saveActivePresetId(storedId)`，確保失敗的選擇不會以 `activePresetId` 的形式殘留；顯示中的提示詞組與實際注入結果保持一致。沒有 UUID 時則改為設定 `pendingPresetId`。popup 開啟時從 storage 讀取這些值。
- **Popup → Overlay**：popup 送出 `ACTIVE_PRESET_CHANGED` 訊息——內容腳本的處理器呼叫 `PresetOverlay.updateActiveId()`。另外，`ACTIVE_PRESET_ID` 的 `chrome.storage.onChanged` 也會觸發 `updateActiveId()` 作為安全網。
- **提示詞組清單同步**：`dsPresetIndex` 或任何 `dsPreset_<id>` 鍵變更時，呼叫 `StorageManager.getSettings()`，並由 `PresetOverlay.render()` 重新填入下拉選單。

**SPA 韌性**：
- DOM observer 偵測切換對話期間的標題列替換。
- `handleChatChange()` 在提早返回（無 UUID → 清除）與主要返回（有 UUID → 顯示綁定的提示詞組）兩處都呼叫 `PresetOverlay.updateActiveId(resolvedId)`。
- `findAndMount()` 比較 `this.targetEl` 與找到的元素，避免多餘的掛載。

**ARIA 與無障礙**：
Overlay 下拉選單遵循 ARIA 撰寫實務：
- 觸發器（`<div id="dss-preset-overlay">`）具有 `role="combobox"`、`aria-haspopup="listbox"` 與 `aria-expanded`。
- 選單（`<ul id="dss-preset-menu">`）具有 `role="listbox"` 與 `aria-label="提示詞組清單"`。
- 每個提示詞組項目具有 `role="option"`。
- 鍵盤導覽：上／下方向鍵循環切換選項，Enter 選取，Escape 關閉。
- （popup 的 `custom-select.js` 為編輯／刪除按鈕與拖曳把手設有自己的 ARIA 屬性——與此 overlay 元件各自獨立。）

## 空白提示詞組 (Empty Preset, No-Op Mode)

空白提示詞組模式提供一個明確的方式，在不停用整個擴充功能的情況下停用逐提示詞組的注入：

- **永遠可見**：popup 的提示詞組下拉選單頂端永久存在一個空的 `<option value="">`，不論頁面情境或 UUID 綁定狀態為何。如此即使沒有任何自訂提示詞組，UI 也保持一致。
- **選取時的行為**：提示詞內容 textarea 被停用（呈灰色，`cursor: not-allowed`），重新命名／刪除按鈕也被停用。
- **自動選取**：新對話（無 UUID）時，`activePresetId` 被清為 `''`，因此預設選取空白選項——除非存在釘選的預設提示詞組（v4.18.0）。當 `pinnedPresetId` 指向仍存在的提示詞組時，`handleChatChange()` 的無 UUID 分支改以它填入 `pendingPresetId`，將其持久化為 `activePresetId` 並更新 overlay，讓新對話開啟時即預選該提示詞組。失效的釘選 id（提示詞組已被刪除）則退回上述空白選項行為。此分支只在 URL 不含對話 id 時才會進入，這正是既有對話不受影響的原因——不涉及額外的防護。刪除提示詞組時，若被刪除的是目前啟用的提示詞組，系統會重置為空白狀態。
- **與全域提示詞的互動**：即使選取空白提示詞組，全域提示詞（若有設定）仍會注入——只略過逐提示詞組的注入。（v4.20.0）無顯示中的提示詞組時，沒有逐提示詞組的 `globalPromptEnabled` 可讀，因此開關改由舊版裝置層級的鍵決定。
- **導航時重新解析**（v4.20.0）：SPA 導航不會觸發 `chrome.storage.onChanged`，因此 `handleChatChange()` 在每個分支都重新計算 `isGlobalPromptEnabled`——已綁定、失效綁定、自動綁定、未綁定的既有對話，以及全新對話。這項計算所用的有效提示詞組 id 來自 `resolveOverlayPresetId()`，也就是浮動 overlay 使用的同一個優先序輔助函式。若缺少這項處理，從綁定到旗標關閉之提示詞組的對話離開後，失效的旗標會持續生效，直到重新載入頁面。

## Toast 通知系統與儲存狀態指示器 (Toast Notification System & Save Status Indicator)

popup 包含兩種不同的回饋機制：

**儲存狀態指示器**：
- **DOM**：popup 標頭中標題旁的 `<span id="saveStatus" class="status-hidden">已儲存</span>` 元素。
- **API**（`popup.js`）：`showSaveStatus()`——移除 `status-hidden` class（使綠色文字可見），清除任何待執行的計時器，再設定 1000ms 計時器重新加回該 class。用於所有自動儲存的確認（提示詞組內容、開關、滑桿變更）。

**同步狀態指示器**（v2.0.0 新增）：
- **DOM**：popup 標頭中緊接在 `#saveStatus` 之後的 `<span id="syncStatus">` 元素。
- **API**（`popup.js`）：`refreshSyncStatus()`——呼叫 `StorageManager.isSyncedWithCloud()` 與 `StorageManager.hasOversizedItems()`（v4.8.2），切換 `.synced` 或 `.unsynced` CSS class，並將文字設為 `雲端同步`（綠色）、`未同步`（紅色）或 `內容過大，僅存本機`（紅色，過大）。

同步狀態共有三種：`synced`（綠色）、`unsynced`（紅色，暫時性）與 `oversized`（紅色，永久性——鍵超過 8KB 同步上限）。於每次 storage 寫入後與初始化時呼叫。錯誤會被靜默吞下——此指示器僅供參考。
- **CSS**：`#syncStatus.synced { color: var(--success-color) }` 與 `#syncStatus.unsynced { color: #dc2626 }`。

**Toast 通知**：
- **DOM**：位於 `popup.html` 底部、主容器之外以便固定定位的 `<div id="toast" class="toast" hidden>` 元素。
- **API**（`popup.js`）：`Toast.show(message, durationMs?)`——取消隱藏 toast、設定文字、套用 `opacity: 1`，在 `durationMs`（預設 2000ms）後設定 `opacity: 0` 並隱藏（400ms CSS 過渡延遲）。用於：
  - **匯出失敗**：Markdown 匯出的 `chrome.tabs.sendMessage` 失敗時，顯示「匯出失敗，請重整頁面後再試」2 秒。
  - **JSON 匯出成功**：顯示「設定已成功匯出」2 秒。
  - **JSON 匯入成功**：顯示「設定已成功還原，請重新整理頁面。」2 秒（3 秒時重新載入頁面）。
  - **同步衝突解決成功**：顯示「資料已成功合併同步」2 秒（1 秒時重新載入頁面）。
- **備份／還原操作**：「設定已成功匯出」、「匯出失敗」、「設定已成功還原」、「復原備份已匯出」、「復原備份已匯入」、「已清除所有已還原紀錄」、「清除失敗」——全部由 `popup/popup.backup-manager.js` 驅動。
