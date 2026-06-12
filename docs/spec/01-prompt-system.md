# 提示詞系統規格

> 📂 [DS studio 文件](../) › [功能規格](../SPEC.md) › 提示詞系統
>
> **相關架構**：[儲存架構](../architecture/STORAGE.md) · [內容腳本](../architecture/CONTENT_SCRIPTS.md) · [Popup 架構](../architecture/POPUP.md)

## 1. 提示詞組管理

- **多組提示詞支援**：使用者可以建立、重新命名、刪除多組提示詞組，每組有唯一的名稱與內容。系統允許刪除所有自訂提示詞組，因為下拉選單永遠保留一個空白選項作為預設。
- **切換提示詞組**：彈出選單中的自訂下拉選單可即時切換提示詞組。提示詞內容的檢視與編輯改於獨立編輯視窗進行（見「獨立提示詞編輯視窗」），彈出選單本身不再含內容文字輸入區。
- **新增流程**：點擊 `+` 開啟內嵌命名對話框。名稱為必填 — 空輸入時確認按鈕會停用，並顯示紅色 `* 必填` 指示。重複名稱會以警示對話框拒絕。
- **重新命名流程**：點擊 `✎` 開啟預填當前名稱的內嵌對話框。重複名稱會被拒絕。
- **刪除流程**：點擊 `✕` 開啟確認對話框，附有紅色危險樣式按鈕。若刪除的提示詞組為當前啟用中，系統會重設為空狀態（`activePresetId = ''`），而非自動選取其他提示詞組。所有指向被刪除提示詞組的 `chatPresetMap` 綁定都會被清理。空狀態選取時刪除按鈕為停用狀態。
- **提示詞資料模型**：每組提示詞包含 `id`（字串）、`name`（字串）、`content`（字串）、`createdAt`（數字，紀元毫秒）、`updatedAt`（數字，紀元毫秒）。`id` 以 `preset-{timestamp}-{random}` 格式產生。內容於獨立編輯視窗中自動儲存：`input` 事件設定 dirty flag 並觸發 600ms 防抖寫入，`blur`、`visibilitychange` 與 `pagehide` 事件提供立即寫入保險（獨立視窗可能被作業系統直接關閉），僅在 dirty 時寫入以避免耗盡 Chrome sync 配額。
- **獨立提示詞編輯視窗**（v3.0.0）：點擊鉛筆按鈕透過 `chrome.windows.create`（`type: 'popup'`，1280×720）開啟 `popup/editor/editor.html`。Query string 契約：`?target=global` 編輯全域預設提示詞；`?target=preset&id=<presetId>` 編輯該提示詞組內容。視窗標題顯示「全域預設提示詞」或提示詞組名稱，並有「已儲存」狀態指示。每種目標各為單例 — 重複點擊鉛筆會聚焦既有視窗（`chrome.windows.update`），視窗已關閉時才重新建立。提示詞組儲存後會廣播 `ACTIVE_PRESET_CHANGED` 使開啟中的 DeepSeek 分頁即時更新。無效的 query 參數或提示詞組已被刪除時，視窗呈現停用狀態並顯示說明文字。所有儲存一律經由 `StorageManager`。

## 2. 提示詞注入邏輯

- **注入內容**：當功能啟用時，系統會在使用者輸入前加入組合前綴（全域預設提示詞 + 各提示詞組內容），以 XML 標籤包裹：
  ```
  <system-prompt>
  [全域預設提示詞 + 各提示詞組內容（以 \n\n 連接）]
  </system-prompt>

  <user-input>
  [使用者原始輸入]
  </user-input>
  ```
  - `globalDefaultPrompt` 與各提示詞組的 `promptPrefix` 以 `\n\n` 連接。`globalDefaultPrompt` 僅在全域提示詞開關（`globalPromptEnabled`）開啟時納入組合（v3.0.0）。
  - 若兩者皆為空，則完全省略 `<system-prompt>` 區塊，但仍保留 `<user-input>` 包裹。
  - 系統不會自動插入 `---` 分隔線。使用者對注入內容有完整控制權 — 任何分隔線、換行或格式都必須包含在提示詞文字中。
- **注入觸發**：在以下情況執行注入：
  - 使用者按下 `Enter` 鍵（排除 `Shift + Enter` 換行及 IME 組字狀態）。
  - 使用者點擊畫面上的發送按鈕（CSS 選擇器：`div.ds-icon-button[role="button"]`（桌面版）或 `div.ds-button[role="button"]`（行動版），亦可透過父層類別選擇器識別）。
- **防護條件**：以下情況跳過注入：
  - 透過開關停用功能。
  - 使用者輸入為空（僅含空白字元）。
  - 文字輸入區已含有先前注入的前綴（開頭為 `<system-prompt>` 或 `<user-input>`）。

## 3. 編輯訊息清理（解除包裹）

- **目的**：使用者送出的訊息會被注入邏輯（§2）包裹為 `<system-prompt>...</system-prompt>` 與 `<user-input>\n...\n</user-input>` 結構。當使用者點擊 DeepSeek 的編輯按鈕重新編輯該訊息時，編輯框會載入**完整的包裹內容**。此功能負責解除包裹，使使用者僅編輯自己的原始文字。（實作於 `content/edit-message-cleanup.js`，v3.2.1）
- **觸發**：文件層級委派的 `click` 監聽器，透過 `e.target.closest('.d4910adc')` 辨識編輯按鈕（混淆類別 `d4910adc`）。非編輯按鈕的點擊直接忽略。
- **非同步偵測（快照式）**：編輯框 textarea 於點擊後才渲染。點擊當下唯一的 textarea 是頁面底部主輸入框，故不可用「往上找含 textarea 的祖先」策略（會誤抓主輸入框）。改為：點擊當下先以 `new Set(document.querySelectorAll('textarea'))` 建立快照，再以 `MutationObserver` 觀察 `document.body`，挑出**不在快照內的新 textarea**即為編輯框。硬性逾時 2000ms；若新 textarea 的 value 尚未填入，另以最多 800ms 的次級觀察等待其填值。
- **展開編輯區（max-height 調整）**：偵測到編輯框當下計算並套用一次（不隨視窗縮放重算、離開編輯後不還原）：
  - `.cc852ac5`：移除 `max-height`（inline style 設為 `none`），所有匹配元素皆套用。
  - `._646a522`：將 `max-height` 設為 `(window.innerHeight − _2be88ba 高度 − _871cbca 高度 − 32)px`。三項高度於當下即時取得（`window.innerHeight` 與兩來源元素的 `getBoundingClientRect().height`）。**缺元素規則**：若 `_2be88ba` 或 `_871cbca` 任一不存在，則跳過 `._646a522` 的設定（保持原狀）；`.cc852ac5` 的移除不受影響。
- **解除包裹條件**：偵測到 textarea 後，若其內容符合 `/<user-input>\n([\s\S]*)\n<\/user-input>$/`，則僅保留 `<user-input>` 內的原文（透過 native value setter + `input`/`change` 事件寫回，與注入採用相同的 React-aware 寫入技術）。
- **保護條件**：若編輯框內容**找不到** `<user-input>...</user-input>` 結構（例如未經注入的純文字訊息），則完全不更動編輯框內容，亦不觸發任何事件。
- **再次送出**：清理後僅保留原文；使用者修改後點擊編輯送出按鈕時，注入邏輯（§2）會依當前設定重新包裹，行為與一般送出一致。

## 4. UUID 對話綁定提示詞組

- **UUID 提取**：Content Script 從 URL 路徑（`/a/chat/s/{uuid}`）透過 `extractUuidFromUrl()` 提取對話 UUID。新對話（無 UUID）的 UUID 為 `null`。
- **首次訊息自動綁定**：當新對話（無 UUID）發送第一則訊息，且 SPA 導航至帶有 UUID 的 URL 時，系統會自動將新 UUID 綁定至各分頁的 `pendingPresetId`（若非空值），透過 `chatPresetMap` 記錄。自動綁定受到 `awaitingNewChatUuid` 旗標保護——該旗標僅在使用者實際在無 UUID 頁面上觸發發送動作（Enter 鍵或點擊發送按鈕）時才會設定。單純從新對話頁面導航至其他未綁定的現有對話**不會**觸發自動綁定——每個對話維持獨立的綁定關係，絕不繼承其他對話的狀態。該旗標在 5 秒後自動清除，避免發送失敗後的殘留旗標污染。
- **新分頁隔離**：在新分頁中開啟新對話頁面絕不會繼承其他分頁的 `activePresetId`。Content Script 在無 UUID 頁面上的 `handleChatChange()` 中會無條件清除 `promptPrefix`。
- **對話記憶**：每個對話 UUID 可獨立綁定至不同的提示詞組，透過 `chatPresetMap[uuid] = presetId` 記錄。切換對話時會自動恢復正確的提示詞組綁定。
- **彈出選單同步**：當彈出選單在已綁定的對話上開啟時，下拉選單會自動選取已綁定的提示詞組。在未綁定的對話上時，下拉選單會透過 `GET_PENDING_PRESET` 訊息查詢 Content Script 的記憶體中 `pendingPresetId`，若無待選選取則顯示空白選項。
- **解除綁定**：在有 UUID 的對話上選取下拉選單的空白選項，會從 `chatPresetMap` 中移除綁定。
- **新建提示詞組綁定**：在已綁定的對話上建立新提示詞組時，會更新綁定至新提示詞組。
- **分頁獨立性**：提示詞組選取為各分頁獨立。當彈出選單在一個分頁上選取提示詞組時，會透過 `chrome.tabs.sendMessage` 將 `ACTIVE_PRESET_CHANGED` 訊息直接發送至該分頁的 Content Script。其他分頁的 Content Script 透過各自的 `chatPresetMap` 綁定保留自己的提示詞組選取，避免跨分頁污染。

## 5. 全域預設提示詞

- **範圍**：透過獨立編輯視窗（鉛筆按鈕 → `editor.html?target=global`）編輯的多行文字。若非空值且全域提示詞開關開啟，該文字會在所有對話中預先附加至各提示詞組之前。
- **編輯入口**（v3.0.0）：彈出選單 Global Prompt 卡片中「全域預設提示詞」文字右側的鉛筆按鈕（`#editGlobalPromptBtn`，樣式與新增提示詞組的 `+` 按鈕一致），點擊開啟 1280×720 獨立編輯視窗，維持自動儲存。
- **專屬注入開關**（v3.0.0）：卡片右緣的 `#globalPromptToggle` 開關（外觀與主開關相同，與上方主開關垂直對齊）。開啟時注入全域預設提示詞；關閉時不注入。儲存於 `globalPromptEnabled` 鍵（預設 `true`，既有使用者升級後行為不變）。
- **優先權**：主開關（`isEnabled`）優先權最高 — 主開關關閉時，無論 `globalPromptEnabled` 狀態為何，全域預設提示詞一律不注入（由 `injectPrefix()` 的 early return 保證）。
- **儲存**：獨立儲存在 `globalDefaultPrompt` 鍵下，透過 `chrome.storage.sync` 同步。
- **與各提示詞組的互動**：在 `buildInjectionPrefix()` 中，全域預設提示詞（開關開啟時）與各提示詞組的 `promptPrefix` 以 `\n\n` 連接。合併結果在注入前以 `<system-prompt>` 標籤包裹。
- **提示詞組獨立性**：變更全域預設提示詞不會影響任何提示詞組的內容，反之亦然。`globalPromptEnabled` 開關也不影響提示詞組內容的注入。

## 6. 空白選項模式（無操作模式）

- **永遠可見**：在所有 DeepSeek 頁面上，下拉選單頂端永遠有一個空白選項（`value = ''`），不受綁定狀態影響。
- **選取時的行為**：
  - 不注入各提示詞組的內容——僅包含全域預設提示詞（若有設定且其開關開啟）。
  - 提示詞組的鉛筆編輯按鈕（`#editPresetBtn`）為停用狀態，無法開啟編輯視窗。
  - 重新命名（`✎`）與刪除（`✕`）按鈕為停用狀態。
- **新對話時的選取**：當彈出選單在新對話頁面（無 UUID）上開啟時，使用者明確選取或新增提示詞組的動作會透過查詢 Content Script 記憶體中的 `pendingPresetId` 在重新開啟時保留。此待選狀態在每次聊天狀態轉換時清除。若無待選選取存在，`activePresetId` 會清除為 `''`，因此預設選取空白選項。在新分頁開啟新對話頁面時，Content Script 的 `promptPrefix` 一律由當前 URL 的 UUID 綁定決定，不會繼承其他分頁的全域 `activePresetId`。
- **刪除後的選取**：當啟用中的提示詞組被刪除時，系統會重設為空狀態，而非自動選取其他提示詞組。
