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
- **路由變更**：切換對話時中止進行中的捲動、重設狀態、移除舊按鈕，待 DOM 穩定後經由 `_tryConnectDom()` 閘控重試迴圈重新注入——持續重試至輸入區包裝容器或原生按鈕就緒為止（每 500ms × 最多 120 次），取代舊有的一次性無重試注入，從根本上消除 SPA 路由切換時因 DOM 未就緒而按鈕不顯示的競爭問題。等待 DOM 穩定的計時器 handle 保存於 `_routeChangeTimer`，可由 `disable()` 取消。
- **停用行為**：呼叫 `disable()` 時必須不留下任何仍會作用於頁面的殘留物——停止三個 observer（DOM、路由、wrapper）、移除 scroll 監聽器與按鈕、清除三個計時器（`_observerTimer`、`_enableRetryTimer`、`_routeChangeTimer`），並**呼叫** `_scrollReject` 以中止進行中的捲動（僅將其設為 null 不會停止捲動迴圈）。`_tryConnectDom()` 進入點的 `if (!this.enabled) return;` 為第二道防線，確保任何漏網的延遲回呼都不會在停用後重新注入按鈕或重啟 observer——停用後才建立的 wrapper observer 不會再被拆除，其自動補回邏輯會使按鈕在使用者重新整理前無法擺脫。
- **捲動至頂部（可點擊中止）**：`scrollToTopAndWait()` 提供公開 API（供 Markdown 匯出整合），每輪輪詢直接寫入 `scrollContainer.scrollTop = 0` 一次到頂，搭配 MutationObserver 等待延遲載入的舊訊息掛載——虛擬列表若因此長高，收斂計數重置並再跳一次，最長 30 秒逾時。抵達時間僅取決於延遲載入的輪數，與對話長度無關。
  - **向上一次到頂、向下逐步前進，是刻意的不對稱**：`harvest.js` 的向下擷取迴圈每步只前進 `0.9 * viewportHeight`，因為它必須讓沿途每則訊息都渲染出來並擷取，虛擬列表跳過的內容就是匯出漏掉的內容；`scrollToTopAndWait()` 沒有這個義務，它只需要抵達，路過的一概不要。請勿為了「一致性」把兩者統一。捲動期間按鈕**全程維持可點**（`aria-disabled` 恆為 `"false"`，不再於捲動期間禁用）；若捲動進行中再次點擊，會以 `reason: 'stopped-by-user'` 中止目前捲動於當下位置、**不重新開始**（切換式），再次點擊才會重新捲動。
- **鍵盤與無障礙**：`<div role="button" tabindex="0">`，支援 Enter / Space 鍵盤觸發；`aria-label="回到頂部"`；`aria-disabled` 全程維持 `"false"`。
- **實作位置**：`content/go-top.js`（入口）、`content/go-top.locate.js`（定位/可見性）、`content/go-top.render.js`（渲染/注入/模式切換）、`content/go-top.scroll.js`（捲動引擎）、`content/go-top.css`；公開 API 掛載於 `window.DSstudio.GoToTop`。

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

## 20. 行動版首頁清理 (Mobile Homepage Cleanup) — v4.1.0

- **目的**：在行動版 DeepSeek 首頁自動清理 DOM 元素，優化行動裝置的使用體驗。
- **實作位置**：`content/mobile-homepage-cleanup.js`。
- **功能**：自動移除/隱藏特定類別選擇器（`._9579690`）的 DOM 元素。
- **主開關連動**：完全跟隨擴充功能主開關（`isEnabled`），無獨立開關。
- **SPA 韌性**：透過 MutationObserver 監控 DOM 變化，在 SPA 導航後重新套用清理邏輯。

## 21. 防止自動回滾 (Prevent Auto-Scroll) — v4.12.0

- **目的**：讓原本僅在「回到頂部」與 Markdown 匯出期間短暫生效的防回滾保護，可由使用者設為**常駐**。此開關不新增任何攔截機制，只改變既有 `PreventAutoScroll` 補丁的生效期間。
- **開關位置**：彈出選單「UI 調整」卡片中的 `#preventAutoScrollToggle` 核取方塊。
- **儲存鍵**：`dsPreventAutoScroll`（布林值，預設 `false`）。
- **常駐狀態的存放位置**：與既有的 `enabled` 旗標並存於同一個隱藏 bridge 元素（`#dss-prevent-auto-scroll-bridge`）的 `dataset` 上，不使用模組層可變狀態。
- **`disable()` 在常駐模式下為 no-op**：此守衛是必要的，而非防禦性冗餘。該旗標**沒有引用計數**，且 `harvest.js` 在 `finally` 中**無條件**呼叫 `disable()`；若不加守衛，使用者開啟常駐後只要匯出一次 Markdown，保護就會在匯出結束時被靜默關掉。`setPersistent(false)` 則刻意繞過此守衛直接寫入 `dataset`，否則關閉常駐將永遠無法解除保護。
- **呼叫端零改動**：常駐邏輯完全收斂在共用節流點 `content/prevent-auto-scroll-bridge.js`。`harvest.js` 與 `go-top.scroll.js` 兩個既有呼叫端不需修改 —— go-top 既有的 `wasAlreadyEnabled` 保存還原邏輯在常駐模式下自然短路（`isEnabled()` 恆為真，故它不會 enable 也不會 disable）。
- **即時切換**：`chrome.storage.onChanged` 監聽器同時監控 `dsPreventAutoScroll` 與 `isEnabled`（僅 `local` 命名空間），可在不重新整理頁面的情況下即時生效。兩個鍵的任一變更都會重新自儲存空間讀取後重算，不快取部分狀態。
- **主開關感知**：僅當主開關（`isEnabled`）為真**且** `dsPreventAutoScroll` 為真時才常駐。主開關關閉時常駐一律解除，即使自身開關為開。主開關鍵不存在時視為關閉。
- **已知取捨（刻意接受，故預設關閉）**：既有 MAIN-world 補丁是 `Element.prototype` 層級的**全域**攔截，只擋**向下**捲動，且**無法區分**程式觸發與使用者觸發（無 `isTrusted`／呼叫堆疊判定）。因此常駐開啟時：
  - DeepSeek 串流回覆的「自動跟隨捲到最新」會一併被擋，需自行向下捲動。
  - 切換或開啟對話時若需向下定位才能落在正確位置，該定位也會被擋；向上定位不受影響。
  - 原生滾輪／觸控板／捲軸拖曳不經這些 JS API，不受影響；但頁面上任何以 JS 呼叫這些 API 實作的「捲到底部」按鈕會被擋。
- **實作位置**：`content/prevent-auto-scroll-bridge.js`（新增 `setPersistent()` / `isPersistent()` / `start()`，`disable()` 加入守衛）；公開 API 掛載於 `window.DSstudio.PreventAutoScroll`。`start()` 於模組載入時自動呼叫，沿用 `content/hide-thinking.js` 的啟動慣例。

## 22. 連網搜索 (Web Search) — v4.13.0（v4.17.0 改為一次性進場預設）

- **目的**：讓使用者指定每次進入頁面時 DeepSeek「智能搜索」切換按鈕的**起始狀態** —— `開啟`（起始為 `aria-pressed="true"`）、`關閉`（起始為 `"false"`）。此設定不新增任何頁面元素，只在進場時校正既有按鈕一次。
- **語意（v4.17.0 變更）**：此設定是**進場預設值，不是強制狀態**。每次頁面載入套用一次後即完全放手；使用者之後手動點擊該按鈕的結果會保留到本次頁面生命週期結束，擴充功能不再回點。重新整理或重新進入頁面時才回到設定的預設值。
- **開關位置**：彈出選單「UI 調整」卡片中的單選群組（`input[name="websearchToggle"]`，兩選項 `開啟` / `關閉`，沿用 `.locale-option` 樣式）。`開啟` 為標記中預先勾選者。
- **儲存鍵**：`dsWebSearchToggle`（字串，`'on'` | `'off'`，預設 `'on'`）。舊版三態的 `'default'` 值已移除；讀取到殘留的 `'default'` 一律當作 `'on'`，不寫回儲存區。
- **核心規則 —— 只在狀態不符時點擊**：`aria-pressed` 已等於目標狀態時絕不點擊，因為點擊是切換操作，相符時點擊反而把狀態切換走。狀態判定：`getAttribute('aria-pressed') === 'true'`。目標狀態由公開的 `mode` 屬性導出（`'on'` 對應 `true`）。
- **一次性機制**：內部 `_isSpent` 旗標標記該次頁面載入的套用是否已用掉。找到按鈕並比對（不論是否需要點擊）後即設為已用掉並中止觀察器。已用掉之後，任何來源都不再觸發點擊 —— 使用者手動翻轉、頁面重渲染掛上新按鈕、`chrome.storage.onChanged` 帶來新值、主開關關掉再打開，皆不回點。
- **元素辨識（實測後修正）**：實頁有**兩個外觀相同**的 `.ds-toggle-button[aria-pressed]` 元素（深度思考與智能搜索），`document.querySelector` 固定取到第一個（錯的）。`findButton()` 以 **label 文字含「搜索」** 者為準（`_pickByLabel()`），順序無關；**找不到含「搜索」的候選時回傳 `null`，不退回第一個匹配** —— 退回第一個會誤點「深度思考」，把使用者的推理模式翻掉。`.ds-toggle-button` 不存在時對通用 `[aria-pressed="true"], [aria-pressed="false"]` 執行相同的 label 篩選。不使用建置版雜湊類別（`f79352dc` / `_6dbc175` 每次部署會變）。
- **觀察器僅用於等待按鈕出現**：`MutationObserver` 只掛在 body 的 `childList + subtree`，用途是等按鈕首次出現在 DOM。按鈕本身的 `attributes` / `attributeFilter: ['aria-pressed']` 觀察已移除 —— 那是舊版回點使用者手動翻轉的來源，與一次性語意衝突。套用一次後觀察器即中止。
- **點擊節流已移除**：舊版的 `CLICK_COOLDOWN_MS`（500ms）是為了抑制連續強制點擊造成的 ping-pong。一次性模型下每次頁面載入最多點擊一次，該常數與其守衛皆為死碼，已刪除。
- **主開關感知**：僅當主開關（`isEnabled`）為真時才動作。`chrome.storage.onChanged`（僅 `local` 命名空間）同時監控 `isEnabled` 與 `dsWebSearchToggle`。套用**尚未**發生時（按鈕還沒出現，或主開關起始為關），這些變更仍然有效，該次唯一的套用會採用當下最新的值；套用已發生後，變更只更新記憶體狀態，不再觸發點擊。主開關在套用尚未發生時被關掉，會取消待處理的套用並中止觀察器。
- **`disable()` 不還原按鈕狀態**：與 `hide-thinking` 不同，本功能不擁有任何可還原的狀態 —— 停止動作即把按鈕留在現況，不做額外點擊。
- **實作位置**：`content/websearch-toggle.js`；公開 API 掛載於 `window.DSstudio.WebSearchToggle`（測試以 `module.exports` 取用）。`start()` 於模組載入時自動呼叫，沿用 `content/hide-thinking.js` 的啟動慣例。
