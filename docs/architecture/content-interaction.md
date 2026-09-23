# 使用者互動模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › [內容腳本模組](CONTENT_SCRIPTS.md) › 使用者互動
>
> **相關規格**：[功能規格](../spec/04-features.md)

## 引用回覆模組 (Quote Reply)

`content/quote-reply.js` 實作 `QuoteReply` 單例，在 AI 回覆區域選取文字時顯示浮動的「引用回覆」按鈕。

### 觸發與範圍

- **範圍防護**（`isSelectionInScope`）：只在選取範圍的 `anchorNode` 與 `focusNode` 都位於 `div.ds-virtual-list-visible-items` 內時啟動。跨出此容器的選取會被忽略。
- **觸發事件**：`document.selectionchange`，統一經由單一的 `handleSelectionEvent` 排程器，debounce 250 ms（`QUOTE_REPLY_DEBOUNCE_MS`）。單一事件來源已足夠——滑鼠拖曳、Shift／方向鍵鍵盤選取與 IME 組字輸入都會觸發 `selectionchange`，因此不需要 `mouseup` 或 `keyup` 監聽器。`document.mousedown` 另行綁定，只用於點擊外部時關閉按鈕。
- **快照策略**：`QuoteReply.selectedText` 在 debounce 結束時同步擷取。按鈕的 `click` 處理器使用此快照，而非重新讀取即時選取範圍——降低虛擬清單節點卸載造成的競態問題。

### 生命週期 (registerFeatureToggle)

`QuoteReply.init()` 以 `ownKey: null` 向 `content/feature-toggle.js` 註冊模組，因此此功能沒有自身開關，只跟隨擴充功能總開關。`registerFeatureToggle` 向 background service worker 查詢（`DSS_GET_SETTINGS`）以決定初始狀態，之後回應 `DSS_SETTINGS_CHANGED` 廣播——模組從不直接讀取 `chrome.storage`。

- `enable()` 建立按鈕元素，並附加 `selectionchange` 與 `mousedown` 的 document 監聽器。
- `disable()` 解除兩者、清除待執行的 debounce 計時器、呼叫 `hideButton()`（同時移除 scroll／resize 監聽器），並移除按鈕元素，將 `btnEl` 重設為 `null`。
- `dsI18n.onLocaleChanged` 訂閱是唯一的例外：`dsI18n` 未提供取消訂閱的方法，因此它在 `hasLocaleSubscription` 旗標後只註冊一次，並在停用循環中保留。功能關閉期間，因 `btnEl` 為 `null`，`handleLocaleChanged` 會立即返回。
- `init()` 本身只註冊開關；監聽器延遲到總開關首次解析為開啟時才附加。`window.__DSS_QR_INITIALIZED__` 防護避免重複注入的腳本註冊兩次。

### 按鈕定位 (`unionClientRects` + `computeButtonPosition`)

`handleSelectionChange` 收集 `range.getClientRects()` 的所有 client rect，經 `unionClientRects` 合併為單一邊界框（`top`/`left`/`bottom`/`right`/`width`）。面積為零的 rect 會被略過。

`computeButtonPosition` 是純函式，依據該聯集 rect、按鈕尺寸與可視範圍尺寸計算 `{top, left, hidden}`：

- 預設：按鈕置於整個選取區塊頂端上方 16px，水平方向以聯集寬度置中。
- 左右邊界限制：與可視範圍邊緣至少保留 10px。
- 頂端翻轉：若計算出的 `top < 10`，按鈕移到聯集底部（區塊最後一行）下方 8px。
- 隱藏：整個選取區塊已捲出可視範圍（`bottom < 0` 或 `top > vh`）時回傳。

### 捲動與尺寸變動處理

單一的 `handleViewportChange` 處理器同時服務 `scroll`（capture、passive）與 `resize`。它只在按鈕可見期間（`showButton`）附加到 `window`，於 `hideButton` 時解除，並以 `isScrollAttached` 旗標追蹤，確保這組監聽器永不重複綁定。處理器以 `requestAnimationFrame` 延後再重新執行 `handleSelectionChange`，因此不會阻塞捲動執行緒。

### Textarea 注入 (`injectQuote`)

將 `formatQuote(selectedText)` 附加到 textarea 的值：

- **`formatQuote`**：`text.split(/\r?\n/).map(l => '> ' + l).join('\n')`——每一行加上 Markdown 引用區塊前綴。
- **React 感知寫入**：使用 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set`（與 `content/prompt-injector.controller.js:84-85` 相同模式），接著派發 `input` 與 `change` 事件以觸發 React 狀態更新。
- **附加邏輯**：textarea 為空 → 只放入引用文字；非空 → 既有內容 + `\n`（若尚未以 `\n` 結尾）+ 引用文字。

### CSS 注入

在 `document.head` 注入 `<style id="dss-quote-reply-style">`，內含 `.dss-quote-btn` 樣式：

- `position: fixed; z-index: 2147483000`，確保疊在 DeepSeek UI 之上。
- 淺色／深色模式同時由 `@media (prefers-color-scheme: dark)` 與 `html[data-theme="dark"]` 選擇器處理（後者涵蓋 DeepSeek 執行期的主題切換）。
- **i18n 支援**（v4.3.3+）：按鈕標籤文字經由 `dsI18n.t('quoteReplyBtnLabel')` 取得而非寫死，並以 `dsI18n.onLocaleChanged(QuoteReply.handleLocaleChanged)` 訂閱，在使用者切換語言時即時更新按鈕文字，無需重新載入頁面。`handleLocaleChanged` 保留既有的 `<svg>` 節點，只重建標籤 `<span>`。

### 關閉條件

按鈕在以下情況隱藏：(1) 文字選取被清除或收合，(2) 選取節點離開範圍，(3) 選取範圍完全捲出可視範圍，(4) 視窗尺寸變動（重新計算位置，超出邊界則隱藏），(5) 使用者點擊按鈕以外的任何位置。

### 測試介面

經由 `module.exports` 匯出（Node 環境防護）：`handleSelectionChange`、`injectQuote`、`unionClientRects`、`computeButtonPosition`、`isSelectionInScope`、`formatQuote`、`showButton`、`hideButton`、`getButtonEl`、`enable`、`disable`、`__resetState`、`__setState`、`__getState`。

## 編輯訊息清理模組 (Edit Message Cleanup)

`content/edit-message-cleanup.js` 從 DeepSeek 的編輯 textarea 中移除注入的提示詞外層包裝，讓使用者只編輯自己的原始訊息。它與 `content/prompt-injector.controller.js` 的提示詞注入流程（`injectPrefix`，經 `content-script.js` 轉出）互補：注入時包裝送出的訊息，重新編輯時由本模組拆開包裝。

### 觸發與範圍

- **委派監聽器**：單一 document 層級的 `click` 處理器（`handleEditButtonClick`），經由 `window` 防護旗標冪等註冊。
- **編輯按鈕解析**：`e.target.closest('.d4910adc')`——混淆後的編輯按鈕 class（`EDIT_BUTTON_CLASS`）。不符合的點擊提早返回（guard clause）。

### 非同步 Textarea 偵測 (`waitForNewTextarea`)

編輯 textarea 在點擊**之後**才渲染，因此必須非同步偵測。天真的「往上找最近一個含 textarea 的祖先」做法是錯的：點擊當下頁面上唯一的 textarea 是底部主輸入框，而範圍廣的虛擬清單祖先正好包含它——該策略會同步解析到**錯誤**（空白）的 textarea，永遠不會等待真正的編輯框。因此偵測採用快照式且不依賴 class 的做法：

- `handleEditButtonClick` 對點擊當下已存在的 textarea 建立快照：`new Set(document.querySelectorAll('textarea'))`。
- **`waitForNewTextarea(preExisting, onFound)`**：經由 `MutationObserver`（`childList: true, subtree: true`）監看 `document.body`，取第一個**不在**快照中的 textarea——那必定是編輯 textarea。`onFound` 至多觸發一次，之後即中斷連線。硬性逾時 `DETECTION_TIMEOUT_MS`（2000ms）。若找到的 textarea 在發現時 `value` 仍為空（React 尚未填入），則對該 textarea 進行第二層監看，最多等待 `VALUE_WAIT_TIMEOUT_MS`（800ms）讓值填入。每次點擊的狀態（已解析旗標、逾時 id、observer）都是閉包區域變數——模組層級無可變狀態。

### max-height 調整 (`applyMaxHeightAdjustments` + `computeDynamicMaxHeight`)

在偵測當下（`onFound`）套用一次，此時編輯 UI 已掛載且目標元素存在：

- **`.cc852ac5`**（`REMOVE_MAX_HEIGHT_SELECTOR`）：對每個符合的元素設定 inline `style.maxHeight = 'none'`——一律執行。
- **`._646a522`**（`DYNAMIC_MAX_HEIGHT_SELECTOR`）：inline `style.maxHeight` 設為當下經純函式 `computeDynamicMaxHeight(windowHeight, sourceHeightA, sourceHeightB)` 計算出的動態值 = `windowHeight - sourceHeightA - sourceHeightB - MAX_HEIGHT_OFFSET_PX`（offset = 32px）。高度即時讀取：`window.innerHeight`，以及第一個 `._2be88ba`（`HEIGHT_SOURCE_SELECTOR_A`）與第一個 `._871cbca`（`HEIGHT_SOURCE_SELECTOR_B`）的 `getBoundingClientRect().height`。**來源缺失規則**：任一來源元素不在 DOM 中時，完全略過 `._646a522` 的調整（保持原樣）——`.cc852ac5` 的移除仍照常執行。只計算一次；不註冊 resize 監聽器。編輯結束時覆寫值不會還原。

### 捲動定位 (`applyEditScrollPosition` + `computeScrollDelta` + `findScrollableAncestor`)

max-height 調整與包裝清理完成後，捲動編輯框使其視覺上位於固定標頭 `._2be88ba` 下方 `EDIT_SCROLL_GAP_PX`（16px）處。由於 `.cc852ac5` 位於可捲動容器內，而 `._2be88ba` 是固定定位（不同的 z 層），對齊完全靠調整容器的 `scrollTop` 達成——而非重新定位元素。在 `requestAnimationFrame` 內執行一次（於 `applyMaxHeightAdjustments` + `applyTextareaCleanup` 之後），以量測清理後的版面。

- **`computeScrollDelta(editBoxTop, headerBottom, gap)`**（純函式）：回傳 `editBoxTop − (headerBottom + gap)`——要**加到**捲動容器 `scrollTop` 的帶正負號像素量（正值向下捲，負值向上捲）。
- **`findScrollableAncestor(el)`**：從 `el`（含自身）往上走，回傳最近一個 `scrollHeight > clientHeight` 的節點，否則回傳 `null`。
- **`applyEditScrollPosition(root)`**（root 預設為 `document`，為 null 時也退回 `document`）：找到 `.cc852ac5`（編輯框）與 `._2be88ba`（標頭），從 `.ds-virtual-list-items._6f2c522` 開始經 `findScrollableAncestor` 解析真正的捲動容器（後備為 `._6f2c522` 本身），即時讀取 `getBoundingClientRect()` 幾何資訊，再執行 `scrollContainer.scrollTop += computeScrollDelta(top, bottom, EDIT_SCROLL_GAP_PX)`。**防護規則**：編輯框、標頭或捲動容器缺失時不執行任何動作（不拋出例外）。一次性調整；不註冊 resize／scroll 監聽器。

### 包裝萃取 (`extractUserInput` + `applyTextareaCleanup`)

- **`extractUserInput(text)`**：若 `text` 符合 `/<user-input>\n([\s\S]*)\n<\/user-input>$/`（與 `content/prompt-injector.controller.js` 中 `injectPrefix` 相同的尾端錨定 regex 形式），回傳內層內容，否則回傳 `null`。非字串輸入 → `null`。`$` 錨點代表 `</user-input>` 之後若有尾隨內容則不符合。
- **`applyTextareaCleanup(textarea)`**：呼叫 `extractUserInput(textarea.value)`。符合時，以 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` 將值改寫為**僅**內層內容，接著派發 `input`／`change` 事件（與 `quote-reply.js`／`content/prompt-injector.controller.js` 相同的 React 感知寫入）。沒有 `<user-input>` 包裝時，textarea 完全保持原樣且不派發任何事件（明確需求——一般訊息永遠不會被清空）。

### 測試介面

經由 `module.exports` 匯出（Node 環境防護）：`extractUserInput`、`computeDynamicMaxHeight`、`applyMaxHeightAdjustments`、`computeScrollDelta`、`findScrollableAncestor`、`applyEditScrollPosition`、`applyTextareaCleanup`、`waitForNewTextarea`、`handleEditButtonClick`，以及常數 `EDIT_BUTTON_CLASS`、`REMOVE_MAX_HEIGHT_SELECTOR`、`DYNAMIC_MAX_HEIGHT_SELECTOR`、`HEIGHT_SOURCE_SELECTOR_A`、`HEIGHT_SOURCE_SELECTOR_B`、`MAX_HEIGHT_OFFSET_PX`、`EDIT_SCROLL_GAP_PX`、`USER_INPUT_REGEX`、`DETECTION_TIMEOUT_MS`、`VALUE_WAIT_TIMEOUT_MS`。

## 防止自動回滾模組 (PreventAutoScroll)

PreventAutoScroll 模組採用雙檔架構，抑制 DeepSeek 自動捲動到最新訊息的行為。它以兩種不同模式運作：**暫時模式**，在受控操作（例如 Markdown 匯出或 go-top）期間生效；以及**持續模式**（v4.12.0），只要使用者保持 `dsPreventAutoScroll` 設定開啟就持續生效。

### 架構

- **`content/prevent-auto-scroll.js`**（MAIN world）：在頁面的 JavaScript context 中執行。monkey-patch `Element.prototype.scrollTo`、`Element.prototype.scrollBy`、`window.scrollTo`、`window.scrollBy`、`Element.prototype` 上的 `scrollTop` setter，以及 **`Element.prototype.scrollIntoView`**（bridge 啟用時無條件封鎖）。每個被 patch 的方法在允許或封鎖捲動前都會檢查 `_isBridgeEnabled()`。bridge 啟用（攔截生效）時，捲動到對話底部的呼叫會被抑制。
- **`content/prevent-auto-scroll-bridge.js`**（ISOLATED world）：負責注入與控制的內容腳本。經由 `<script>` 元素以 `chrome.runtime.getURL('content/prevent-auto-scroll.js')` 注入 main-world 腳本。在文件中建立並管理一個隱藏的 `<div id="dss-prevent-auto-scroll-bridge" style="display:none">`，其 `dataset.enabled` 屬性供 main-world patch 讀取。

### 控制流程

- `enable()`：設定 `bridge.dataset.enabled = 'true'`。main-world patch 讀到後開始抑制自動捲動呼叫。從不觸碰持續狀態，因此在兩種模式下都保持冪等。
- `disable()`：設定 `bridge.dataset.enabled = 'false'`——**但持續模式開啟時不執行任何動作**（v4.12.0）。
- `isEnabled()`：讀取目前旗標。**沒有參照計數**——在持續模式以外，`disable()` 是無條件的全域關閉開關。任何可能巢狀執行於其他呼叫者啟用期間內的呼叫者，**必須**先以 `isEnabled()` 保存先前狀態再還原，而非盲目切換。
- `setPersistent(shouldPersist)`（v4.12.0）：為 true 時啟用保護，並標記 `bridge.dataset.persistent = 'true'`。為 false 時清除標記，並直接強制寫入 `dataset.enabled = 'false'`——刻意繞過 `disable()` 自身的持續模式防護，否則關閉持續模式將永遠無法解除保護。
- `isPersistent()`（v4.12.0）：讀取持續旗標。持續狀態與 `enabled` 存放在同一個隱藏 bridge 元素的 dataset 上，因此模組不保有模組範圍的可變狀態。
- `start()`（v4.12.0）：於模組載入時自動呼叫，比照 `content/hide-thinking.js` 的啟動慣例。將總開關與自身開關的閘控委派給 `content/feature-toggle.js` 的 `registerFeatureToggle`，傳入 `ownKey: StorageManager.KEYS.PREVENT_AUTO_SCROLL`，啟用時呼叫 `setPersistent(true)`、停用時呼叫 `setPersistent(false)`。設定經 `DSS_GET_SETTINGS` 自 background 取得，後續變更則透過 `DSS_SETTINGS_CHANGED` 廣播接收。只有總開關啟用**且**此設定為 true 時，持續模式才會開啟。

### 使用者

三個使用者與此 bridge 協調，前兩者為巢狀關係：

- **`harvest.js`** 在捲動至頂端階段前啟用它，並在整個由上而下的擷取完成後於 `finally` 中停用——因此整個匯出期間保持開啟。注意該 `finally` 區塊**無條件**呼叫 `disable()`；加上沒有參照計數，這正是 `disable()` 必須在持續模式下成為 no-op 的原因。若缺少該防護，一次 Markdown 匯出就會悄悄關掉使用者啟用的永久鎖定。
- **`go-top.js`**（`scrollToTopAndWait`，位於 `go-top.scroll.js`）在單次捲動至頂端期間啟用它，並於 `cleanup()` 中還原先前狀態。由於 `harvest.js` 在自己的啟用期間內呼叫 `scrollToTopAndWait`，GoToTop 採用保存並還原的做法：只有當它是啟用的那次呼叫時才停用。此處若盲目 `disable()`，會在匯出途中移除 harvest 的保護。持續模式下此邏輯自然短路——`isEnabled()` 已為 true，因此 GoToTop 既不啟用也不停用。
- **`dsPreventAutoScroll` popup 開關**（v4.12.0）經由 `start()` 的設定訂閱驅動 `setPersistent()`。兩個暫時性使用者不含任何持續模式邏輯：持續旗標位於共用的咽喉點，在呼叫者不做參照計數的前提下，這是唯一能讓與呼叫者無關的模式切換保持正確的位置。

**範圍注意事項。** main-world patch 是 `Element.prototype` 層級的全域攔截，只封鎖**向下**捲動，且無法區分頁面發起與使用者發起的呼叫。這代表在持續模式下，DeepSeek 串流輸出時的跟隨捲動也會被抑制，任何需要向下捲動才能正確定位的對話切換也會被封鎖。原生滾輪／觸控板捲動不經過這些 JS API，不受影響。這項取捨正是此設定預設為 `false` 的原因。

### 設計決策

- 內容腳本（isolated world）的所有捲動操作都使用其自身未被 patch 的 `Element.prototype` 參照，因此在頁面自動捲動被抑制時，`harvest.js` 與 `go-top.js` 仍可自由捲動。注意這描述的是不受 patch 影響，而非與其協調——啟用 patch 是每個使用者必須另外明確執行的步驟。
- bridge 元素避免從 main world 呼叫 `chrome.*` API（main world 中無法使用）。
- main-world 腳本包含冪等防護（`window.__dsvPreventAutoScrollInstalled`），防止重複注入。
- 兩個檔案都宣告於 `manifest.json`：`prevent-auto-scroll.js` 為 `web_accessible_resource`，`prevent-auto-scroll-bridge.js` 位於 `content_scripts` 陣列。

## 系統時間注入 (System Time Injection)

系統時間注入功能在使用者訊息前加上時間戳記，提供模型目前的日期與時間。

### Storage 鍵

- `dsShowSystemTime`（boolean，預設 `false`）——儲存於 `KEYS.SHOW_SYSTEM_TIME` 鍵。

### Popup 開關

Features 卡片中的核取方塊（`#showSystemTimeToggle`）控制此設定。它屬於感知總開關的子控制項：`isEnabled` 關閉時，此開關被停用。

### 內容腳本整合

- `isShowSystemTime: false`——`content/chat-binding-controller.js` 中的執行期狀態欄位，於 `initSettings()` 期間經由 `applyInitialSettings()` 從 storage 初始化。
- `formatSystemTime(date)`（預設為當下時間）——定義於 `content/content-script.export.time.js` 的純函式，回傳 24 小時制、補零並含本地時區偏移的 `yyyy/mm/dd hh:mm:ss (UTC±hh:mm)`。
- `formatTimezoneOffset(date)`——同檔案中的純輔助函式，回傳時區偏移字串 `UTC±hh:mm`（例如 `UTC+08:00`、`UTC-03:45`）。
- 在 `injectPrefix()`（`content/prompt-injector.controller.js`）中，系統時間加在注入前綴之前：
  ```
  Current Time: 2026/05/31 14:30:00 (UTC+08:00)\n\n
  ```
  此字串插入在注入前綴（若有）與 `<user-input>` 包裝之前。

### 重新注入防護

時間戳記在注入當下擷取一次（而非頁面載入時），因此每則訊息反映的是使用者按下送出的時間。若 `isShowSystemTime` 在兩則訊息之間變更（經由 popup 開關 + `DSS_SETTINGS_CHANGED` 廣播），新值於下一次送出時生效。

### 總開關感知

`isEnabled` 為 `false` 時，`injectPrefix()` 提早回傳 `false`——不論 `isShowSystemTime` 為何，都不會加上系統時間。popup 中的開關也會被 `applyMasterSwitchUI()` 停用。
