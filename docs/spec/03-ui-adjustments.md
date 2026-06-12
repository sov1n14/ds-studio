# UI 調整功能規格

> 📂 [DS studio 文件](../) › [功能規格](../SPEC.md) › UI 調整
>
> **相關架構**：[內容腳本](../architecture/CONTENT_SCRIPTS.md)

## 9. 側邊欄自動隱藏

- **開關**：彈出選單「UI 調整」卡片中的核取方塊，用於啟用/停用此功能。
- **儲存鍵**：`dsSidebarAutoHide`（布林值，預設 `false`）。
- **收合行為**：啟用時，側邊欄（`div.dc04ec1d`）在滑鼠離開時收合至 60px 寬度。內部內容（`div.b8812f16.a2f3d50e`）透過負值 `margin-left` 位移，隱藏在收合的容器後方。
- **展開行為**：滑鼠懸停時，經過 150ms 延遲（進入延遲），側邊欄展開至原始儲存寬度，內部邊距清除。
- **收合觸發**：滑鼠離開時，經過 400ms 延遲（離開延遲），側邊欄收合回 60px。視窗縮放也會透過防抖（200ms）的調整大小處理器觸發重新收合。
- **下拉選單感知**：當側邊欄有待處理的收合計時器，且滑鼠進入浮動/下拉式元素（透過類別 `ds-elevated` 或 `.ds-floating-position-wrapper` 偵測），收合計時器會取消，側邊欄保持展開。浮動元素上的 `mouseleave` 監聽器會在使用者移開時觸發收合。此功能透過 `document` 上的捕獲階段 `mouseover` 監聽器（在 `setupHoverZone()` 中）實作，使用 `el.closest()` 支援精確的子元素層級判定，對 React portal 渲染在側邊欄 DOM 階層外的下拉選單具有穩固性。
- **CSS 轉場**：透過注入的 `<style>` 實現流暢動畫：`transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1)` 及 `transition: margin-left 0.22s cubic-bezier(0.4, 0, 0.2, 1)`。
- **溢位處理**：容器設有 `overflow: hidden`，但 DeepSeek 原生收合啟用時除外（此時窄條必須完全可見）。
- **主開關感知**：當主開關（`isEnabled`）關閉時，無論自身開關狀態為何，模組都會停用。重新開啟時，模組會重新讀取自身開關狀態。
- **SPA 韌性**：
  - `document.body` 上的 `MutationObserver` 偵測側邊欄 DOM 節點是否被取代（SPA 導航），重新綁定事件並重新收合。
  - 側邊欄專屬的 `MutationObserver` 監控 DeepSeek 的原生收合/展開循環，在需要時重新套用自訂收合狀態。
- **儲存監聽器**：註冊 `chrome.storage.onChanged` 監聽器，即時監控 `dsSidebarAutoHide` 與 `isEnabled` 的變化，無須重新整理頁面即可啟用/停用。
- **啟動**：從儲存空間讀取 `dsSidebarAutoHide` 與 `isEnabled`，若兩者皆為 true 則啟用。

## 10. 對話區域寬度調整

- **開關與滑桿**：彈出選單「UI 調整」卡片中的切換開關與範圍滑桿控制此功能。
- **儲存鍵**：`dsChatWidth`（數字，30–100，預設 `70`）與 `dsChatWidthEnabled`（布林值，預設 `false`）。
- **範圍**：30% 至 100% 視口寬度，透過 `Math.min(Math.max(...))` 限制。
- **CSS 注入**：注入 `<style>` 元素，設定：
  - `max-width: Xvw !important` 作用於 `.ds-virtual-list-items._6f2c522`（訊息清單），透過 `--message-list-max-width` 自訂屬性
  - `margin-left: auto !important; margin-right: auto !important; padding-left: 0 !important; padding-right: 0 !important` 作用於 `._871cbca`（置中）
- **主開關感知**：當主開關（`isEnabled`）關閉時停用；開啟時重新讀取自身開關。
- **SPA 韌性**：`._765a5cd`（或 `document.body` 備援）上的 `MutationObserver` 在 DOM 變更後重新注入 CSS，防抖 200ms。
- **儲存監聽器**：監聽 `dsChatWidth`、`dsChatWidthEnabled` 與 `isEnabled` 的變化，即時套用或移除樣式。

## 11. 輸入框寬度調整

- **開關與滑桿**：彈出選單「UI 調整」卡片中的獨立切換開關與範圍滑桿。
- **儲存鍵**：`dsInputWidth`（數字，30–100，預設 `70`）與 `dsInputWidthEnabled`（布林值，預設 `false`）。
- **範圍**：30% 至 100% 視口寬度，與對話區域寬度獨立。
- **CSS 注入**：注入 `<style>` 元素，設定 `max-width: Xvw !important` 與 `width: min(100%, Xvw) !important` 作用於 `._871cbca`、`._871cbca .aaff8b8f`、`.aaff8b8f`（新對話頁面的獨立選取器）、`._871cbca ._77cefa5._3d616d3`（輸入區域容器與文字輸入區），並設定 `margin-left: auto` 與 `margin-right: auto` 以置中。
- **對話區域寬度限制**：當對話區域寬度調整啟用時，有效輸入框寬度會受對話區域寬度限制（`getEffectivePercent()`）。若對話區域寬度為 70% 而輸入框寬度設為 100%，實際套用的寬度為 70%。這確保輸入框不會超過對話容器寬度。該模組也會監控 `dsChatWidth` 與 `dsChatWidthEnabled` 的變化，進行即時重新限制。
- **主開關感知**：模式與對話區域寬度相同。
- **SPA 韌性**：相同的 `MutationObserver` 模式，200ms 防抖，監控 `._765a5cd` 的 `class` 屬性變化。
- **獨立性**：對話區域寬度與輸入框寬度獨立運作——不同的儲存鍵、開關、滑桿與 CSS 目標。

## 17. 隱藏思考過程 (Hide Thinking Process)

- **開關位置**：彈出選單「UI 調整」卡片中的 `#hideThinkingToggle` 核取方塊，用於啟用/停用此功能。
- **儲存鍵**：`dsHideThinking`（布林值，預設 `false`）。
- **觀察器設定**：`MutationObserver` 以 `{ childList: true, subtree: true }` 設定掛載於 `document.body`，僅監聽 DOM 節點新增事件。不監聽 `attributes`，因此使用者手動展開思考區塊（修改 CSS class）不會觸發回調，確保展開的區塊不受影響。
- **兩層搜尋**：回調先在新增節點自身尋找思考區塊容器（`._74c0879`），若未找到則搜尋每個新增節點的子孫節點——處理容器為直接新增節點或深層嵌套兩種情況。
- **安全防護**：點擊展開按鈕前執行 `isConnected` 與 CSS class 雙重驗證，防止對已移除節點（`isConnected === false`）或已收合狀態（缺少展開 class）的按鈕執行無效點擊。
- **啟用行為**：呼叫 `enable()` 時，先以 `applyToExisting()` 收合頁面上已存在的所有展開思考區塊，再啟動 MutationObserver 監聽後續新增節點。
- **停用行為**：呼叫 `disable()` 時，斷開 MutationObserver，並自動展開所有先前由本功能收合的思考區塊（依 `data-ht-collapsed` 標記識別），使頁面恢復至功能啟用前的展開狀態。
- **即時切換**：`chrome.storage.onChanged` 監聽器同時監控 `dsHideThinking` 與 `isEnabled`，使功能可在不重新整理頁面的情況下即時啟用/停用。
- **主開關感知**：當主開關（`isEnabled`）關閉時，無論自身開關狀態為何，模組都會停用。重新開啟時，模組會重新讀取 `dsHideThinking` 狀態。
- **已知限制**：DeepSeek 使用虛擬列表渲染，捲動時已卸載的 DOM 節點重新掛載視為「新增節點」，因此重新滾回該區塊時思考區塊仍可能再次被自動收合。

## 18. 回到頂部按鈕 (GoToTop)

- **目的**：在 DeepSeek 對話頁面提供一個「回到頂部」浮動按鈕，外觀與位置仿照原生的「回到底部」(Go Down) 按鈕，點擊後自動將對話捲動至最頂端。此功能**永久啟用**，無獨立開關，完全由擴充功能主開關控制。
- **外觀規範**：GoToTop 按鈕必須與原生 Go Down 按鈕在外觀上像素級一致（34×34 圓形、邊框、背景、陰影、hover 效果）。實作採用 clone 優先策略——原生按鈕存在時以 `cloneNode(true)` 複製後移除定位 hash class `_0706cde`；原生按鈕不存在時以硬編碼模板重建相同標記（含 `__background` / `__border` / `__icon` 三個子層與 inline CSS 變數）。箭頭以 `transform: scaleY(-1)` 翻轉原生向下箭頭，`fill="currentColor"` 繼承主題顏色。不攜帶網站 hash class `_0706cde` 以避免被網站自身 JS 誤抓。
- **注入閘控**：按鈕僅在「輸入區包裝容器 `.aaff8b8f` 或原生按鈕 `._0706cde` 已就緒」時才注入；`_tryConnectDom()` 每 500ms 重試一次，最多 120 次（約 60 秒）。逾時仍未就緒則放棄注入、**完全不顯示任何按鈕**（不再有 `position: fixed` 降級浮層）。此設計修復了「直接開啟既有對話時，輸入區尚在渲染、按鈕被錯誤掛載至首個 `.ds-theme` 通知浮層」的競態問題。
- **定位策略**：兩模式依原生按鈕與包裝容器的可用性自動切換，位置自動跟隨版面與視窗變化：
  - **堆疊模式**（原生按鈕存在）：絕對定位於 `.aaff8b8f` 容器內，位於原生按鈕上方 8px（margin-bottom = 原生 margin-bottom + 原生高度 + 8px；預設 62px）。
  - **獨佔模式**（原生按鈕不存在但容器存在）：佔據原生按鈕的標準位置（`position: absolute; bottom: 100%; right: 12px; margin-bottom: 20px`）。
  - 兩者皆不存在時，`_injectButton()` 不建立任何按鈕並回傳 `false`。
- **顯示/隱藏邏輯**：採用遲滯（hysteresis）設計避免邊界閃爍——首訊息底部離開視窗頂部（`getBoundingClientRect().bottom < 0`）時顯示；可驗證到達頂部（`scrollTop <= 1` 或 `[data-virtual-list-item-key="1"]` 完全可見）時隱藏；中間狀態維持當前顯示狀態。
- **原生按鈕偵測**：主選擇器 `._0706cde:not(.dsw-gotop)`；結構式降級鏈（scoped to `.aaff8b8f`）全部要求 `ds-button--floating`，並在回傳前對非 `_0706cde` 來源的匹配結果進行後驗證，排除 `ds-button--primary` / `ds-button--filled` / `ds-button--disabled` 按鈕，防止誤匹配同一容器內的其他圓形按鈕。
- **SPA 韌性**：wrapper observer 監控外層容器（`._871cbca`），偵測 React re-render 後自動重新注入或模式轉換。模式轉換（solo ↔ stacked）複用同一元素（不重新建立），避免閃爍。
- **路由變更**：切換對話時中止進行中的捲動、重設狀態、移除舊按鈕，待 DOM 穩定後經由 `_tryConnectDom()` 閘控重試迴圈重新注入——持續重試至輸入區包裝容器或原生按鈕就緒為止（每 500ms × 最多 120 次），取代舊有的一次性無重試注入，從根本上消除 SPA 路由切換時因 DOM 未就緒而按鈕不顯示的競爭問題。
- **捲動至頂部（可點擊中止）**：`scrollToTopAndWait()` 提供公開 API（供 Markdown 匯出整合），分段 `scrollBy(0, -0.9 * viewportHeight)` 搭配 MutationObserver 等待延遲載入，最長 30 秒逾時。捲動期間按鈕**全程維持可點**（`aria-disabled` 恆為 `"false"`，不再於捲動期間禁用）；若捲動進行中再次點擊，會以 `reason: 'stopped-by-user'` 中止目前捲動於當下位置、**不重新開始**（切換式），再次點擊才會重新捲動。
- **鍵盤與無障礙**：`<div role="button" tabindex="0">`，支援 Enter / Space 鍵盤觸發；`aria-label="回到頂部"`；`aria-disabled` 全程維持 `"false"`。
- **實作位置**：`content/go-top.js` + `content/go-top.css`；公開 API 掛載於 `window.DSStudio.GoToTop`。

## 19. 行動裝置側欄滑動手勢 (Mobile Sidebar Swipe)

- **目的**：在行動裝置上，讓使用者在畫面中央 80% 區域內向右滑動即可展開/收合側邊欄，解決行動版缺乏側邊欄快速切換機制的問題。
- **僅行動裝置**：透過 `_isMobileDevice()` 判斷——`navigator.maxTouchPoints > 0`（實體觸控裝置）或 User-Agent 符合 `/Mobi|Android|iPhone|iPad/i`（Chrome DevTools 行動模擬）。桌面環境完全零開銷，不綁定任何事件監聽器。
- **觸發區域幾何**：觸控起點必須落在畫面正中央 80% × 80% 區域內（水平與垂直各扣除 10% 邊界）。此設計避免與 Chrome Android 系統返回手勢（螢幕邊緣觸發）及頂部狀態列／底部導航列的誤觸衝突：
  - `minX = innerWidth * 0.10`, `maxX = innerWidth * 0.90`
  - `minY = innerHeight * 0.10`, `maxY = innerHeight * 0.90`
- **手勢辨識條件**（五項**全部**滿足才觸發點擊）：
  | 條件 | 閾值 | 說明 |
  |------|------|------|
  | a. 最小滑動距離 | `deltaX ≥ 50px`（`SWIPE_THRESHOLD_PX`） | 排除微小抖動 |
  | b. 水平主導 | `deltaX > |deltaY| × 1.5` | 排除垂直捲動類滑動 |
  | c. 持續時間 | `< 500ms`（`SWIPE_MAX_DURATION_MS`） | 排除慢速拖曳 |
  | d. 起點水平位置 | `clientX ∈ [10%, 90%] innerWidth` | 排除螢幕邊緣 |
  | e. 起點垂直位置 | `clientY ∈ [10%, 90%] innerHeight` | 排除頂部/底部邊緣 |
- **目標按鈕選擇器**：主選擇器 `div.ds-button--capsule.ds-button--iconLabelPrimary[role="button"]`；降級路徑包含 5 個備用 class 組合。
- **DOM 輪詢**：`_tryConnectDom()` 每 500ms 輪詢一次目標按鈕，最多 60 次（約 30 秒），逾時靜默放棄（不拋錯）。
- **主開關整合**：完全跟隨擴充功能主開關（`isEnabled`）。透過 `chrome.storage.onChanged` 監聽 `isEnabled` 變化即時啟用/停用，無各別功能切換。
- **生命週期方法**：
  - `start()`：檢查行動裝置、讀取主開關狀態、設定儲存監聽器、符合條件時啟用。
  - `enable()`：啟動 DOM 輪詢。
  - `disable()`：解除觸控事件監聽、清除輪詢計時器、重設手勢狀態。
  - `destroy()`：委派給 `disable()`。
- **實作位置**：`content/mobile-sidebar-swipe.js`；公開 API 掛載於 `window.DSStudio.MobileSidebarSwipe`。
