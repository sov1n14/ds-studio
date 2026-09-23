# UI 調整模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › [內容腳本模組](CONTENT_SCRIPTS.md) › UI 調整
>
> **相關規格**：[UI 調整規格](../spec/03-ui-adjustments.md)

## 側邊欄自動隱藏 (Sidebar Auto-Hide)

`content/sidebar-auto-hide.js` 中的 `SidebarAutoHide` 模組負責側邊欄的收合／展開行為：

- **收合**：啟用時，側邊欄（`div.dc04ec1d`）收合為 60px 寬。內層內容（`div.b8812f16.a2f3d50e`）以負值 `margin-left` 位移，藏到收合後的外層容器後方，只留下一條細長的可見區。
- **展開**：`mouseenter` 觸發後延遲 150ms，側邊欄展開回原本儲存的寬度，並清除內層的 margin。
- **懸停區擴展**：側邊欄有待執行的收合計時器（`leaveTimer`）時，`document` 上一個 capture 階段的 `mouseover` 監聽器會追蹤游標位置。若滑鼠進入浮動／下拉元素（以 `.ds-floating-position-wrapper` 偵測），收合計時器即被取消，側邊欄維持展開，直到滑鼠離開該浮動元素。如此可正確處理經 React portal 渲染（位於側邊欄 DOM 樹之外）的下拉選單。
- **收合觸發**：`mouseleave` 觸發後延遲 400ms，側邊欄收合回 60px（滑鼠進入下拉選單時除外）。視窗尺寸變動也會經由 debounce（200ms）的 resize 處理器重新收合。
- **CSS 過渡**：注入一個含 `transition: width 0.22s cubic-bezier(...)` 與 `transition: margin-left 0.22s cubic-bezier(...)` 的 `<style>` 元素，讓動畫平順。
- **溢出處理**：外層容器套用 `overflow: hidden`（DeepSeek 原生收合啟用時例外，此時細長條需保持可見）。
- **SPA 韌性**：`document.body` 上的 `MutationObserver` 偵測側邊欄 DOM 節點被替換（SPA 導航）時，重新綁定事件並重新收合。另有一個側邊欄專用的 `MutationObserver` 監看 DeepSeek 原生的收合／展開循環，必要時重新套用自訂收合狀態。
- **總開關感知**：`isEnabled`（總開關）變為 `false` 時，模組一律停用，不論自身開關為何。變為 `true` 時，模組重新讀取自身開關，為 true 則啟用。
- **功能開關整合**：使用 `content/feature-toggle.js` 的 `registerFeatureToggle`，以 `ownKey: STORAGE_KEY` 委派總開關與自身開關的閘控。設定經 `DSS_GET_SETTINGS` 自 background 取得，後續變更則透過 `DSS_SETTINGS_CHANGED` 廣播接收。
- **啟動**：`start()` 設定 resize 處理器後，呼叫 `registerFeatureToggle`，由其負責初始狀態讀取與變更訂閱。

## 對話區域寬度調整 (Chat Width Adjuster)

`content/chat-width.js` 中的 `ChatWidth` 模組控制對話區域寬度：

- **CSS 注入**：注入一個 `<style>` 元素，設定：
  - 在 `.ds-virtual-list-items._6f2c522`（訊息清單容器）上設定 `max-width: Xvw !important`
  - 在 `._871cbca`（輸入框／容器區，用於置中）上設定 `margin-left: auto !important; margin-right: auto !important; padding-left: 0 !important; padding-right: 0 !important`
  - 在訊息清單上使用 CSS 自訂屬性 `--message-list-max-width: ${vw}vw !important`。
- **範圍**：視窗寬度的 30% 至 100%，以 `Math.min(Math.max(...))` 限制。
- **SPA 韌性**：`._765a5cd`（後備為 `document.body`）上的 `MutationObserver` 在 DOM 變動後重新注入樣式，debounce 200ms。
- **總開關感知**：`isEnabled` 變為 `false` 時停用。變為 `true` 時，重新讀取自身開關，為 true 則啟用。
- **功能開關整合**：使用 `content/feature-toggle.js` 的 `registerFeatureToggle`（經 `content/width-feature.js` 工廠），以 `ownKey: ENABLED_KEY` 委派總開關與自身開關的閘控。百分比數值變更經 background 的 `DSS_GET_SETTINGS` 與 `DSS_SETTINGS_CHANGED` 廣播取得，即時套用／還原樣式。
- **啟動**：`start()` 呼叫 `registerFeatureToggle`，由其負責初始狀態讀取與變更訂閱。

## 輸入框寬度調整 (Input Width Adjuster)

`content/input-width.js` 中的 `InputWidth` 模組結構與 `ChatWidth` 相似，但只作用於編輯輸入區：

- **CSS 注入**：在 `._871cbca`、`._871cbca .aaff8b8f`、`.aaff8b8f`（新對話頁面的獨立情況）與 `._871cbca ._77cefa5._3d616d3`（輸入區容器與 textarea）上設定 `max-width: Xvw !important` 與 `width: min(100%, Xvw) !important`，與對話寬度設定彼此獨立。
- **範圍**：視窗寬度的 30% 至 100%。
- **對話寬度上限**：啟用對話寬度調整時，實際輸入框寬度以對話寬度為上限（`getEffectivePercent()`）。若對話寬度為 70%、輸入框寬度設為 100%，實際套用的寬度為 70%。此上限同時在 `enable()` 與 SPA 重新套用時經由 `getEffectivePercent()` 強制執行。模組也監聽 `dsChatWidth` 與 `dsChatWidthEnabled` 的變更以即時重新計算上限。
- **SPA 韌性**：相同的 `MutationObserver` 模式，debounce 200ms，監看 `._765a5cd` 的屬性變更（`class`）。
- **總開關感知**：與 ChatWidth 相同——`isEnabled` 關閉時停用，重新開啟時重新讀取自身開關。
- **功能開關整合**：經 `width-feature.js` 工廠，使用與 ChatWidth 相同的 `registerFeatureToggle` 機制。另訂閱 `dsChatWidth` 與 `dsChatWidthEnabled` 的變更以即時重新計算上限。
- **獨立性**：對話寬度與輸入框寬度可各自開關與設定。輸入框寬度只影響編輯區，對話寬度則同時影響訊息清單與輸入容器。

## 隱藏思考過程模組 (Hide Thinking)

`content/hide-thinking.js` 中的 `HideThinking` 模組在 DeepSeek 的「思考過程」區塊首次出現在 DOM 時自動收合，讓對話畫面保持簡潔。

### DOM 目標

- **容器選擇器**：`._74c0879`——每個思考區塊的外層元素。
- **標頭選擇器**：`THINK_HEADER_TOGGLE_CLASS`（目前為 `._245c867`，取自 `THINK_HEADER_CLASS` 的第一個 token）——容器內可點擊的切換標頭。`hide-thinking.js` 從共用的 `ds-selectors.js` 命名空間讀取此值。（註：`hide-thinking.js` 只使用此選擇器；`._5ab5d64` 僅用於無關的 `censor-reply-restore.thinkblock.js`。）
- **展開指標**：容器內存在 `.ds-think-content` 子元素。不含 `.ds-think-content` 的區塊已是收合狀態，會被略過。
- **收合標記**：點擊收合後，在容器元素寫入 `data-ht-collapsed="1"`，防止重複處理當前工作階段中已收合的區塊。

### 收合策略

模組模擬使用者對思考區塊標頭的原生點擊來收合，而非注入 CSS，讓 DeepSeek 內部 React 元件狀態與視覺狀態保持一致。直接操作 CSS 會使切換按鈕的內部狀態失去同步，導致使用者無法重新展開該區塊。

### Observer 設定

`MutationObserver` 以 `{ childList: true, subtree: true }` 啟動。關鍵在於**不觀察 `attributes`**。使用者手動展開思考區塊時，DeepSeek 的虛擬清單可能切換其 CSS class；若觀察屬性變動，這些手動操作會再次觸發收合邏輯。只觀察 `childList`，模組就只對新加入的 DOM 節點作出反應。

### 雙層節點搜尋 (`scanRoot`)

`MutationObserver` 回呼會對每個新增的 `Element` 呼叫 `scanRoot(node)`：

1. **直接比對**：若新增節點本身帶有容器 class（`._74c0879`），直接對其呼叫 `tryCollapseButton()`。
2. **子孫搜尋**：對新增節點執行 `querySelectorAll('._74c0879')`，捕捉嵌在較大插入子樹中的容器。

如此同時涵蓋兩種情況：DeepSeek 直接插入思考區塊，以及將其插入訊息外層容器內。

### 安全防護 (`tryCollapseButton`)

點擊前會檢查三個條件：
1. **`isConnected`**：略過在 mutation 回呼與處理之間已自 DOM 移除的過時節點參照。
2. **`data-ht-collapsed`**：略過當前工作階段已處理的區塊，避免重複點擊。
3. **`isExpanded()`**：略過不含 `.ds-think-content` 的區塊（已收合），避免多餘的重複收合。

### 啟用／停用

- **`enable()`**：呼叫 `applyToExisting()` 收合頁面上所有目前展開的區塊，再啟動 `MutationObserver` 處理後續新增。具冪等性——已啟用時提早返回。
- **`disable()`**：呼叫 `restoreAll()` 重新展開所有標記 `data-ht-collapsed` 的區塊（移除屬性並點擊標頭），再停止 observer。具冪等性——已停用時提早返回。

### 總開關感知

`start()` 將總開關與自身開關的閘控委派給 `content/feature-toggle.js` 的 `registerFeatureToggle`，傳入 `ownKey: STORAGE_KEY`，並以 `onEnable` → `enable()`、`onDisable` → `disable()` 對應。設定經 `DSS_GET_SETTINGS` 自 background 取得，後續變更則透過 `DSS_SETTINGS_CHANGED` 廣播接收。綜合效果如下：
- `isEnabled` 變為 `false` → 觸發 `onDisable`，呼叫 `disable()`，不論 `dsHideThinking` 為何。
- `isEnabled` 變為 `true` 且 `dsHideThinking` 為 true → 觸發 `onEnable`，呼叫 `enable()`。
- `dsHideThinking` 變更 → 依兩個開關的綜合狀態觸發 `onEnable` 或 `onDisable`。

### 已知限制

DeepSeek 使用虛擬清單渲染；使用者捲離再捲回時，先前卸載的節點會以新的 DOM 新增重新插入。因此，已自動收合後被捲出畫面的思考區塊，捲回可視範圍時可能再次被自動收合——即使使用者先前已手動重新展開。

## 回到頂部模組 (GoToTop)

`content/go-top.js` + `content/go-top.css` 實作一個浮動的「回到頂部」按鈕，與 DeepSeek 原生的 go-bottom 按鈕並列顯示。

### 注入策略

依錨點可用性選擇兩種注入模式（stacked／solo）。注入受閘控：`_tryConnectDom()` 只在輸入區外層容器 `.aaff8b8f`（`INJECT_PARENT_SELECTOR`）或原生按鈕（`_getNativeButton()`）存在時才注入，每 500ms 重試一次，最多 120 次（約 60 秒）。若在上限內兩個錨點都未出現，模組即放棄且**完全不注入**——按鈕只相對於這兩個錨點掛載，因為正確錨點仍在渲染時，頁面層級的 `position: fixed` 掛載會附著到第一個 `.ds-theme` 元素——一個通知浮層——位置錯誤。原生 go-bottom 按鈕是新版 ds-button 設計系統元素——`<div role="button" class="ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ds-button--m ds-button--icon-relative-m ds-button--floating _0706cde">`，帶有 inline CSS 變數（`--dsl-button-height: 34px`、`--dsl-button-icon-size: 14px`、浮動填色／hover 顏色）與三個子層（`.ds-button__background`、`.ds-button__border`、`.ds-button__icon`）。`_createButtonElement()` 以複製優先的方式建構 GoToTop 按鈕：原生按鈕存在時以 `cloneNode(true)` 複製（移除網站的定位雜湊 class `_0706cde`，讓網站自身的 `querySelector('._0706cde')` 呼叫永遠不會抓到我們的節點）；原生按鈕不存在時，以寫死的範本（`NATIVE_BTN_TAG`／`NATIVE_BTN_CLASSES`／`NATIVE_BTN_INLINE_STYLE` 常數，對應 `to-fix/gotop-fix/samples/go-bottom.html`）重現相同標記。兩條路徑都會加上 `dsw-gotop` 標記 class 與無障礙屬性，並以 `_iconSvg()` 替換圖示（原生 14×14 向下箭頭經 `transform: scaleY(-1)` 翻轉，`fill="currentColor"`）。外觀（34×34 圓形、背景、邊框、陰影、hover）完全由網站樣式表經複製的 class 與 inline 變數渲染。擴充功能的基底 `.dsw-gotop` CSS 規則刻意**不宣告任何外觀屬性**（border／background／color／display 皆不設），確保永遠不遮蔽網站的元件樣式；定位完全由擴充功能自身的修飾 class（`--stacked`／`--solo`）提供：

- **Stacked 模式（`_injectionMode = 'injected'`）**：原生 go-bottom 按鈕存在時，go-top 按鈕以 `insertBefore` 注入為其在 `aaff8b8f` 內的兄弟節點，並加上 `dsw-gotop--stacked` class（`position: absolute; bottom: 100%; right: 12px`）。`_applyStackedOffset()` 在執行期以原生 `margin-bottom` + 原生 `offsetHeight` + 8px 間距計算 inline `margin-bottom`（CSS 後備值：62px = 20 + 34 + 8），讓按鈕永遠位於原生按鈕上方 8px 且不重疊。原生按鈕偵測使用 `._0706cde:not(.dsw-gotop)`，並有限定於 `.aaff8b8f` 外層容器的結構化後備（`.ds-button--floating.ds-button--circle:not(.dsw-gotop)`、`[role="button"].ds-button--floating.ds-button--circle:not(.dsw-gotop)`、`[role="button"].ds-button--floating[class*="ds-button--circle"]:not(.dsw-gotop)`）。`_getNativeButton()` 中的事後驗證閘門會拒絕帶有 `ds-button--primary`、`ds-button--filled`、`ds-button--disabled` 或缺少 `ds-button--floating` 的非 `_0706cde` 比對結果——防止誤判同一外層容器內無關的圓形按鈕（例如送出／工具列按鈕）。
- **Solo 模式（`_injectionMode = 'wrapper-solo'`）**：原生按鈕不存在但外層容器 `aaff8b8f` 存在時（由 `_locateWrapperDirect()` 定位，結構化後備為 `._871cbca > div:nth-child(2)`），按鈕注入為外層容器的第一個子節點並加上 `dsw-gotop--solo` class，重現原生按鈕的定位（`position: absolute; bottom: 100%; right: 12px; margin-bottom: 20px`），使其恰好出現在原生按鈕應在的位置。

原生按鈕與外層容器都無法定位時，`_injectButton()` 不執行任何動作並回傳 `false`——不建立按鈕。

各模式下按鈕預設皆為 `display: none`，只在對話已向下捲動（第一則訊息位於可視範圍上方）時顯示。

### SPA 韌性

一個 `MutationObserver`（於 `_startWrapperObserver()` 設定）以 `childList + subtree` 監看外層容器（`_871cbca`）的變動。偵測到 go-top 按鈕被自 DOM 移除（React 重新渲染）時，重新注入按鈕。它也經由 `_transitionToStacked()`／`_transitionToSolo()` 執行雙向模式切換：solo 模式下原生按鈕出現時，按鈕升級為 stacked 模式（移除 solo class、加上 stacked class、重新計算 inline 偏移）；stacked 模式下原生按鈕消失時，按鈕降級回 solo 模式。切換**重用**同一個按鈕元素（以 `insertBefore` 移動、互換 class、保留 `display` 狀態）——元素從不移除再重建，否則程式化捲動期間會出現可見的閃爍。按鈕已處於正確模式時，no-op 防護會略過切換。以 80ms debounce 避免批次變動期間重複注入。

路由 observer 經由 body `MutationObserver` + `popstate` 事件監看 `window.location.pathname`。路由變更時，模組重置所有狀態（取消進行中的捲動、清除重試計時器、移除舊按鈕、停止所有 observer），並在 100ms 的 DOM 穩定延遲後驅動受閘控的重試迴圈 `_tryConnectDom()`。如此即使輸入區外層容器 `.aaff8b8f` 或原生按鈕尚未掛載，按鈕也能可靠出現——`_tryConnectDom()` 每 500ms 重試一次、最多 120 次直到就緒，之後才執行注入、捲動容器重新附著、監聽器重啟與可見性評估。100ms 穩定計時器的 handle 儲存在 `_routeChangeTimer`（每次重新設定前與 `disable()` 時清除），且 `_tryConnectDom()` 開頭有 `if (!this.enabled) return;` 防護。兩者皆為必要：若缺少它們，在 `disable()` 前 100ms 內發生的路由變更，仍會在拆除完成後觸發 `_tryConnectDom()`，重新注入按鈕並重啟外層容器 observer，而之後再也沒有任何機制能拆除它們——`_stopWrapperObserver()` 已執行過，且 `_startWrapperObserver()` 的 `if (this._wrapperObserver) return;` 重複防護看到的是 null 欄位。防護置於函式入口而非各呼叫點，因此涵蓋全部三個呼叫者（路由計時器、`_enableRetryTimer` 自我重試，以及 `enable()` 的同步呼叫）；這也是重試回呼本身不帶 `enabled` 檢查的原因。

### 可見性邏輯

- **顯示條件**：第一則可見訊息的 `getBoundingClientRect().bottom < 0`（已捲到可視範圍上方）。
- **隱藏條件**：`_isAtTop()`——只在有可驗證證據時為 true：`scrollContainer.scrollTop <= 1`，或**可驗證的第一則訊息錨點**（`[data-virtual-list-item-key="1"]`）完全位於可視範圍內。寬鬆的「第一則已掛載訊息」選擇器刻意**不**用於判定是否在頂部：DeepSeek 的虛擬清單中真正的第一則訊息常未掛載，任何接近可視範圍頂端的已掛載訊息都會誤判為「在頂部」（這會讓 `scrollToTopAndWait()` 捲動約一個可視高度就停止）。
- 以遲滯避免閃爍：兩個條件都不成立時，維持目前的顯示狀態。
- DOM observer（`_startObserver()`）對 body 變動以 50ms debounce 觸發重新評估。容器上的捲動監聽器（節流 100ms）也會觸發重新評估。

### `scrollToTopAndWait()`

這是程式化的捲動至頂端 API，回傳 `Promise<{success, reason?}>`：

1. 切換（點擊停止）：若已有捲動進行中（`_locked`），再次呼叫會經由 `_scrollReject({ success: false, reason: 'stopped-by-user' })` 讓目前捲動停在當下位置，並立即返回，**不**啟動新的捲動。整個捲動期間按鈕保持可點擊（`aria-disabled` 維持 `"false"`）——捲動中途從不停用。
2. 每次輪詢都寫入 `scrollContainer.scrollTop = 0`，直接跳到頂端。因此抵達時間只取決於虛擬清單需要多少次延遲掛載循環，與對話長度無關。
3. 每次輪詢後，經由捲動容器上的 `MutationObserver` 等待 DOM 穩定。若容器的 `scrollHeight` 改變（延遲載入），穩定計數器歸零，下一次輪詢再次跳到頂端。
4. 頂端判定需要連續 3 個穩定 tick，且 `scrollTop <= 0` 與 `scrollHeight` 相符。
5. 30 秒後逾時（可設定）。捲動期間路由變更時以原因 `'aborted'` 中止，`disable()` 於捲動中途執行時亦同。呼叫 `_scrollReject` 是**唯一**的外部取消介面：它會執行捲動閉包的 `cleanup()`，清除閉包內的錨點輪詢計時器。只丟棄 `_scrollReject` 參照並不會停止迴圈——它會持續寫入 `scrollTop = 0`，直到自身逾時或達到 `MAX_ANCHOR_RETRIES` 上限。
6. cleanup 時呼叫 `_evaluateVisibility()` 以恢復按鈕顯示狀態。

**為何向上用跳、向下用步進。** `harvest.js` 的向下擷取迴圈刻意每步只前進 `0.9 * viewportHeight`，因為它必須在經過時渲染並擷取每一則訊息——虛擬清單跳過的任何內容，都是匯出會遺失的內容。`scrollToTopAndWait()` 沒有這項義務：它只需抵達，並捨棄沿途經過的一切。因此這種不對稱是刻意設計，而非需要統一的不一致。請勿「統一」這兩個迴圈。

### 總開關

GoToTop **只**受 `isEnabled` 控制（沒有個別功能開關）。`init()` 將總開關閘控委派給 `content/feature-toggle.js` 的 `registerFeatureToggle`，由其經 `DSS_GET_SETTINGS` 自 background 取得設定並訂閱 `DSS_SETTINGS_CHANGED` 廣播。模組於載入時經由 `GoToTop.init()` 自動啟動。

**拆除契約。** `disable()` 執行後，頁面上不得殘留任何仍在作用的東西。它停止全部三個 observer（DOM、路由、外層容器），移除捲動監聽器與按鈕，清除全部三個計時器（`_observerTimer`、`_enableRetryTimer`、`_routeChangeTimer`），並在將 `_scrollReject` 設為 null 之前先**呼叫**它以中止進行中的捲動。因此模組中每個計時器都必須把 handle 保存在 `this._` 前綴的欄位上——只存在閉包中或直接丟棄的 handle，`disable()` 無法觸及；拆除後才觸發的回呼可能重新附著 observer，而之後再也沒有任何機制會移除它們。`_evaluateVisibility()` 雖有自身的 `if (!this.enabled || !this._masterEnabled) return;` 防護，仍不足以作為最後防線：它在 `_tryConnectDom()` 成功分支的最後才執行，所以只能擋下可見性更新，擋不下已發生的注入。回歸測試涵蓋：`test/unit/go-top.enable.spec.js`，describe 區塊 `disable — teardown correctness (regression)`。

### 匯出 API

掛載於 `window.DSstudio.GoToTop`：`enable()`、`disable()`、`init()`、`scrollToTopAndWait()`、`destroy()`。

## 行動裝置側欄滑動手勢 (Mobile Sidebar Swipe)

`content/mobile-sidebar-swipe.js` 中的 `MobileSidebarSwipe` 模組在行動裝置上偵測可視範圍中央 80% 區域內的雙向滑動手勢——右滑（左→右）開啟側邊欄，左滑（右→左）關閉側邊欄。

### 觸發區域

只有觸控起點位於可視範圍中央 80%（每側保留 10% 邊界）時才啟動手勢：

- **水平**：`minX = innerWidth * 0.10` 至 `maxX = innerWidth * 0.90`
- **垂直**：`minY = innerHeight * 0.10` 至 `maxY = innerHeight * 0.90`

此中央區域設計可避免與 Chrome Android 的系統返回滑動手勢（從螢幕邊緣觸發）衝突，也避免在頂部狀態列／底部導覽區誤觸。

### 手勢辨識

五個條件必須**全部**滿足才會觸發點擊：

| # | 條件 | 常數 | 理由 |
|-|-|-|-|
| a | `|deltaX| >= 50px` | `SWIPE_THRESHOLD_PX` | 過濾雜訊的最小移動距離（取絕對值，左右對稱） |
| b | `|deltaX| > |deltaY| * 1.5` | — | 水平方向為主（排除類似捲動的垂直滑動） |
| c | `duration < 500ms` | `SWIPE_MAX_DURATION_MS` | 排除非刻意快速滑動的緩慢拖曳 |
| d | startX 位於水平中央 80% | `TRIGGER_ZONE_MARGIN_RATIO = 0.10` | 排除螢幕邊緣滑動 |
| e | startY 位於垂直中央 80% | `TRIGGER_ZONE_MARGIN_RATIO = 0.10` | 排除上下邊緣滑動 |

五個條件全部通過後，`_onTouchEnd` 依 `deltaX` 的正負分支：正值（右滑）經 `_findButton()` 點擊開啟按鈕，負值（左滑）經 `_findCloseButton()` 點擊關閉按鈕。

### 行動裝置防護

`navigator.maxTouchPoints > 0`（實體觸控裝置）或 userAgent 符合 `/Mobi|Android|iPhone|iPad/i`（DevTools 行動裝置模擬）時，共用模組 `content/mobile-device.js` 的 `isMobileDevice()`（`globalThis.DSSMobileDevice`，經 `this._mobileDevice` 取用）回傳 `true`。`start()`、`enable()`、`_onTouchStart`、`_onTouchMove`、`_onTouchEnd` 都以此檢查為閘門——桌面裝置零額外負擔。

### DOM 探索

`_findButton()`（開啟）使用主要選擇器 `div.ds-button--capsule.ds-button--iconLabelPrimary[role="button"]`，並有 5 組後備 class 組合。`_findCloseButton()`（關閉）使用主要選擇器 `div.ds-button--capsule.ds-button--iconLabelTertiary[role="button"]:has(path[fill-rule])`（`:has` 篩選排除搜尋按鈕）；未命中時，取 `div.ds-button--capsule.ds-button--iconLabelTertiary[role="button"]` 多筆比對中的最後一個，再嘗試 `.ds-button--iconLabelTertiary.ds-button--icon:has(path[fill-rule])`。`_tryConnectDom()` 先立即判定一次，再經共用的 `content/retry-until.js` 每 500ms 輪詢一次、最多 60 次（約 30 秒），直到找到開啟按鈕，再呼叫 `_bindTouchEvents()`。關閉按鈕在滑動當下才按需查找，而非於綁定時快取。

### 總開關整合

`start()` 將總開關閘控委派給 `content/feature-toggle.js` 的 `registerFeatureToggle`，由其經 `DSS_GET_SETTINGS` 自 background 取得設定並訂閱 `DSS_SETTINGS_CHANGED` 廣播。總開關關閉時，`disable()` 解除觸控監聽器、取消 DOM 輪詢並重置滑動狀態。重新開啟時，`enable()` 重新啟動 DOM 輪詢。

### 生命週期

| 方法 | 行為 |
|-|-|
| `start()` | 檢查 `isMobileDevice()`，再呼叫 `registerFeatureToggle`，以 `onEnable` → `enable()`、`onDisable` → `disable()` 對應 |
| `enable()` | 以行動裝置與已啟用狀態為防護，啟動 `_tryConnectDom()` |
| `disable()` | 解除觸控事件綁定、取消 DOM 輪詢、重置滑動狀態 |
| `destroy()` | 呼叫 `disable()`，再解除功能開關註冊 |

### 匯出 API

掛載於 `window.DSstudio.MobileSidebarSwipe`：`start()`、`enable()`、`disable()`、`destroy()`。
