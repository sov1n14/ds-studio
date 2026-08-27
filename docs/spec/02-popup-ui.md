# 彈出選單與頁面內 Overlay 規格

> 📂 [DS studio 文件](../) › [功能規格](../SPEC.md) › Popup UI 與 Overlay
>
> **相關架構**：[Popup 架構](../architecture/POPUP.md) · [內容腳本](../architecture/CONTENT_SCRIPTS.md)

## 7. 擴充功能彈出選單

- **雙欄版面**（v3.0.0 改版）：彈出選單使用左右並排的雙欄 flex 版面（`body` 寬度 660px）。左欄由上而下為：標題列卡片（標題 + 主開關）、Global Prompt 卡片（「全域提示詞」標籤 + 鉛筆編輯按鈕 + 專屬注入開關）、Prompt Group 卡片（提示詞組選取器 + `+` 按鈕 + 鉛筆編輯按鈕）、**Features 卡片**（隱藏思考過程、自動展開訊息、防止自動回滾、連網搜索）、**備份與還原卡片**（含五項功能按鈕：`#exportJsonBtn` 匯出設定、`#importJsonBtn` 匯入設定、`#exportRestoredBtn` 匯出復原備份、`#importRestoredBtn` 匯入復原備份、`#clearRestoredBtn` 清除所有已還原紀錄）。右欄包含 Export 卡片（匯出相關功能與語言切換）、UI 調整卡片（側邊欄自動隱藏、對話區域寬度、輸入框寬度）。
- **提示詞組選取器**：一個自訂 combobox 元件（`role="combobox"`）用於選擇啟用的提示詞組，觸發器彈性撐滿標籤與右側按鈕之間的剩餘寬度，過長名稱以省略號截斷。展開後面板包含搜尋輸入框，可即時篩選提示詞組（面板寬度仍橫跨整列控制區）。每個提示詞組項目左側有拖曳把手可拖曳排序，滑鼠懸浮時右側顯示圖釘與刪除（`✕`）兩顆圖示按鈕（v4.14.0 移除列內重新命名鉛筆，改名移至編輯視窗；v4.18.0 新增圖釘按鈕於 `✕` 左側）。圖釘代表「預設提示詞組」—— 已釘選者以 `var(--primary-color)` 亮起且不受 hover 進出影響而消失或位移（列內按鈕以 `visibility` 切換顯隱，版面盒常駐），未釘選者僅在列 hover 時顯現。圖示為 `viewBox="0 0 20 20"` 的實心內嵌 SVG（`fill="currentColor"`，12×12，與同列 `✕` 字形的視覺尺寸一致）。下拉選單右側緊鄰依序為新增（`+`）按鈕與鉛筆編輯按鈕，鉛筆按鈕右緣對齊卡片內容右緣（與其他卡片的開關同一垂直線），選單與按鈕之間的間距與兩顆按鈕彼此間距一致（2px）。
- **鉛筆編輯按鈕**（v3.0.0）：兩顆鉛筆按鈕（全域提示詞 `#editGlobalPromptBtn`、提示詞組 `#editPresetBtn`）沿用 `.icon-btn` 樣式（26×26、圓角 4px、白底），圖示為內嵌 SVG 鉛筆（筆身由右上至左下）。點擊開啟對應目標的獨立編輯視窗（見「獨立提示詞編輯視窗」）。提示詞組鉛筆於空白選項選取時停用。
- **全域提示詞開關**（v3.0.0，改為逐提示詞組獨立 v4.20.0）：Global Prompt 卡片右緣的 `#globalPromptToggle`，外觀與主開關相同，控制 `globalPromptEnabled`。v4.20.0 起讀寫目標視是否有作用中的提示詞組而定：有的話讀寫該組的 `globalPromptEnabled` 欄位（同時更新其 `updatedAt`），無的話沿用裝置層級的 legacy 鍵。開關狀態在彈出選單開啟時、切換提示詞組時、以及刪除提示詞組導致 `activePresetId` 清空時各重新渲染一次（`popup/popup.toggles.js` 的 `renderGlobalPromptToggle()`）。未新增任何 UI 元件。
- **同步狀態指示器**（v2.0.0）：標題列中「已儲存」旁的 `#syncStatus` 元素，依 `dsLocalAuth` 是否為空顯示綠色「雲端同步」或紅色「未同步」。每次儲存操作後更新。
- **語言切換器**（v4.3.3）：Export 卡片中的地球圖示按鈕（`#localeSwitcherBtn`）點擊後顯示語言面板（`#localePanel`），可切換繁體中文（zh_TW）與英文（en）。實作於 `popup/popup.locale.js`，使用 `utils/i18n.js` 的 `dsI18n.setLocale()` 進行切換，切換後重新載入彈出選單。
- **啟用/停用開關（主開關）**：控制提示詞注入功能是否啟用的開關。關閉時，所有子控制項（側邊欄自動隱藏、隱藏思考過程、自動展開訊息、防止自動回滾、連網搜索、注入系統時間、對話區域寬度、輸入框寬度）會透過 `disabled` 屬性停用。
- **思考過程開關**：控制匯出的 Markdown 是否包含 AI 思考過程的核取方塊。
- **參考連結開關**：控制匯出的 Markdown 是否包含引用參考連結的核取方塊。
- **系統時間開關**：控制是否在每則訊息開頭自動注入目前時間的核取方塊。
- **匯出按鈕**：在啟用的 `chat.deepseek.com` 分頁上觸發 Markdown 匯出的按鈕。
- **狀態持久化**：所有設定必須儲存在 `chrome.storage.sync` 中（附本地端備援）。
- **自動儲存**：設定變更時自動儲存，在標題旁短暫顯示綠色「已儲存」文字指示。
- **自訂對話框系統**：所有對話框（新增提示詞組、刪除確認、錯誤警示）均使用內嵌對話框控制器（`Modal`），在彈出選單內呈現垂直置中的覆蓋層，取代瀏覽器原生的 `prompt()`/`confirm()`/`alert()`。（v4.14.0 起重新命名不再走 `Modal.prompt`，改於編輯視窗的名稱輸入框進行。）

## 15. 頁面內 Overlay 提示詞組切換

- **位置與樣式**：在 DeepSeek 對話頁面的頂端標題列（`div._2be88ba`）正中央顯示一個絕對定位的下拉選單，覆蓋在標題列上方（`z-index: 1000`）。選單採用深色半透明背景（`rgba(0,0,0,0.45)`）、白色文字、圓角邊框，最大寬度 200px。
- **行動版定位**（v4.2.2）：在行動版（viewport < 768px）上，overlay 採用 gap 定位模式，置於 DeepSeek 新增對話／分享按鈕（`._1aa2651` 內）與對話標題之間。由於這些按鈕在頁面載入時延遲渲染（版面尚未安定前位置偏左），overlay 配備有界 settle 重試迴圈：持續逐幀量測按鈕 `left` 位置，直到連續 K 幀穩定（收斂）或達到最大幀數上限，確保最終定位精準。桌面版（>= 768px）的置中模式不受影響。
- **啟動時機**：在 Content Script 初始化階段（`initSettings()`）自動啟動，無需使用者額外操作。
- **雙向同步**：
  - Overlay 選取變更 → 寫入 `activePresetId` 與 `chatPresetMap` → Popup 下次開啟時自動反映變更。
  - Popup 變更 → `ACTIVE_PRESET_CHANGED` 訊息 → overlay 即時更新選中值。
  - 提示詞組清單變動（新增/刪除/重新命名）→ `storage.onChanged` → overlay 重新渲染選項清單。
- **對話綁定支援**：在有 UUID 的對話上透過 overlay 選取提示詞組時，會同步更新 `chatPresetMap` 綁定。選取空白選項時解除綁定。
- **SPA 導航韌性**：透過 `MutationObserver` 監控 DOM 變化，當對話切換導致標題列被重建時，自動重新掛載 overlay 並還原正確的綁定狀態。
- **無 UUID 處理**：在新對話頁面（無 UUID）上，overlay 的選取會寫入 `pendingPresetId`，由 Content Script 的既有自動綁定機制在首次發送時處理。
