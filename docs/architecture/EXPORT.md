# 匯出架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › 匯出架構
>
> **相關規格**：[功能規格](../spec/04-features.md) · [資料儲存規格](../spec/05-data-storage.md)

## 匯出策略 (Markdown Export Strategy)

自 v2.6.0 起，匯出引擎以「捲動擷取」（scroll-and-harvest）迴圈從 DeepSeek 的虛擬列表擷取完整對話；虛擬列表只會把可見訊息渲染進 DOM。

**整體流程：**

1. popup 透過 `chrome.tabs.sendMessage` 將 `{ action: "EXPORT_MARKDOWN", includeThinking, includeReferences }` 送至目前分頁。
2. 內容腳本（`content-script.js`）收到訊息後交由 `Harvest.harvestAllMessages()` 處理。
3. harvest 模組與另外兩個模組協作：
   - **PreventAutoScroll** —— 停用 DeepSeek「自動捲至最新訊息」的行為，避免虛擬列表跳離受控的捲動位置。（v4.12.0）若使用者已開啟 `dsPreventAutoScroll` 設定，此保護已常駐生效，匯出本身的 enable／disable 呼叫即成為 no-op。
   - **GoToTop** —— 呼叫 `GoToTop.scrollToTopAndWait()` 將虛擬列表錨定至位置 0。
4. 畫面上顯示非阻塞的浮動進度提示（樣式來自 `go-top.css`，`pointer-events: none`，不妨礙操作）。自 v4.19.0 起進度提示附帶取消按鈕；由於容器刻意讓點擊穿透至頁面，該按鈕單獨設為 `pointer-events: auto`。
5. 擷取迴圈由上而下逐步捲動，每一步之後以 `MutationObserver` 等待 DOM 穩定（細節見下方「捲動擷取模組 (Harvest Module)」一節）。
6. 每個訊息節點進入視口時即被複製，依數值型 DOM 屬性 `data-virtual-list-item-key` 去重後收集。
7. 到底偵測需連續 3 次確認 `scrollTop + clientHeight >= scrollHeight`，確保列表已完整載入。
8. 安全網會偵測外部造成的捲動跳躍（例如 React 重新渲染），並中止擷取、匯出部分內容。
9. 完成後還原原本的捲動位置。提前停止時仍會匯出部分內容，並附上標明實際原因的警告頁尾，同時在頁面上顯示警告提示（v4.19.0）。

**節點處理：**

複製下來的節點交由 `convertMessageNodeToMarkdown()` 處理：
- **AI 回覆**（含 `.ds-markdown`）：
  - 啟用 `includeThinking` 時，從 `.ds-think-content` 區塊擷取思考過程，包含搜尋狀態列（例如「搜尋到 X 個網頁」）、瀏覽過的網頁與連結，以及所有推理段落。
  - 從思考容器以外的 `.ds-markdown` 區塊擷取主要回覆。
- **使用者訊息**：從使用者內容容器（`.fbb737a4`）擷取純文字。

HTML 轉 Markdown（`parseHtmlToMarkdown`）處理項目：
- **標題**：`<h1>`–`<h6>` → `#`–`######`
- **表格**：`<table>` → 含標題列與分隔線的 Markdown 表格
- **區塊引用**：`<blockquote>` → 以 `>` 開頭的行
- **清單**：`<ul>` → `- ` 項目；`<ol>` → 編號項目
- **程式碼**：`<div class="md-code-block">` → 擷取 `<pre><span>` 內容，轉為標註語言的圍欄程式碼區塊；獨立的 `<pre>` → 圍欄程式碼區塊；行內 `<code>` → 反引號包覆
- **行內格式**：`<strong>`/`<b>` → `**bold**`；`<em>`/`<i>` → `*italic*`
- **連結**：含 `.ds-markdown-cite` 子元素的 `<a>` → `[[link-N]](url)`（受 `includeReferences` 控制）；一般連結 → `[text]` 緊接 `(url)`
- **文字節點**：連續空白正規化為單一空白

**檔案輸出：**

透過動態建立的 `<a>` 元素觸發 Blob 下載，檔名格式為 `deepseek-chat-YYYYMMDD-HHmmss.md`。

**後備方案：** Harvest 模組無法使用時，退回舊版單次 DOM 查詢（`.ds-virtual-list-visible-items .ds-message`）。

**不完整匯出回報（v4.19.0）：**

`harvestAllMessages()` 回傳 `isComplete: false` 時，匯出照常進行，使用者保有部分內容的檔案，並同時發出兩個訊號：

1. 在 Markdown 內文末尾附加一行頁尾：`> ⚠️ Export may be incomplete (<N> messages captured): <clause>.` —— 其中 `<N>` 為實際擷取的項目數，`<clause>` 來自 `HarvestPolicy.describeIncompleteReason(reason)`。
2. 透過 `showHarvestToastIncomplete(capturedCount, clause)` 在頁面上顯示警告提示，樣式與中性的進度提示明顯區隔，並於 `HARVEST_INCOMPLETE_TOAST_AUTO_DISMISS_MS`（10000 ms）後自動關閉。

clause 依實際原因產生，因此停滯、取消、捲動被干擾的匯出各自回報自己的原因；無法辨識的原因則原樣嵌入原始字串，保持可診斷。

設置頁面提示是因為實務上單靠頁尾完全看不見：在回報的截斷案例中，頁尾落在 12209 行檔案的第 12209 行，使用者完全沒察覺匯出被截斷。

注意兩層在 `HarvestPolicy` 缺席時的處理刻意不對稱：`harvest.js` 直接拋錯，因為少了它就無法做迴圈決策；`content-script.export.js` 則降級為通用 clause 並照常下載，因為它仍能交付使用者的資料。兩者請勿統一。

## 備份與還原 (JSON Backup & Restore)

popup 的「Backup & Restore」卡片有四顆按鈕：

**JSON 匯出**：透過 `StorageManager.getSettings()` 讀取所有設定，序列化為 JSON，並以 Blob 下載，檔名為 `ds-studio-backup-YYYYMMDD.json`。

**JSON 匯入**：開啟檔案選擇器（`<input type="file" accept=".json">`）。解析 JSON 後呼叫 `StorageManager.restoreSettings(importedSettings)`，其行為為：
- 以 `mergePresets()` 合併 `promptPresets`（依 `updatedAt` 保留較新者，新 ID 附加於後）。
- 合併 `chatPresetMap`（展開合併：以本機為基底，加入匯入的項目）。
- 覆寫其餘 UI 設定（全域提示詞內容、includeThinking/References、側邊欄自動隱藏、對話寬度、輸入框寬度、系統時間開關、activePresetId、pinnedPresetId、chatWidthEnabled、inputWidthEnabled）。**isEnabled** 與裝置層級的 **globalPromptEnabled** 鍵屬於裝置本機開關（v4.7.3），匯入時**不會**被覆寫 —— 每台裝置保有各自的啟用狀態。（v4.20.0）逐提示詞組的 `globalPromptEnabled` 欄位是另一回事：它位於每個 `PromptPreset` 內，因此會像 `name`、`content` 一樣隨提示詞組經 `mergePresets()` 合併，並**會**隨匯出／匯入一起帶走。
- `pinnedPresetId`（v4.18.0）與 `activePresetId` 一同隨備份檔攜帶：匯出端自動涵蓋，因為 `getSettings()` 以反射方式從 `StorageManager.KEYS` 推導鍵集合；匯入端則需在 `restoreSettings()` 的逐鍵白名單中明列。`!== undefined` 防護讓尚未包含此鍵的舊備份檔不會動到目前裝置的預設釘選，而 `mergePresetsOnly` 模式會像其他 UI 設定一樣略過它。
- 還原成功後顯示提示，並於 3 秒後重新載入 popup。

**被審查回覆還原記錄的備份／還原／清除**：`restored_messages` 資料集（僅存於 `chrome.storage.local`）在「Backup & Restore」卡片中有專屬按鈕，可獨立於一般設定之外匯出、匯入與清除被審查回覆的還原資料。

## 捲動擷取模組 (Harvest Module)

`content/harvest.js` 是完整對話 Markdown 匯出的捲動擷取引擎。它純粹運作於內容層（不存取 `chrome.storage`），透過 `window.DSstudio.Harvest` 對外溝通。

### `harvestAllMessages()`

匯出的主要進入點。回傳 `{ items: Element[], isComplete: boolean, reason?: string }` —— 包含擷取到的 DOM 節點、完成旗標與原因字串的物件。僅當 `reason === 'complete'` 時 `isComplete` 為 true。

可能的原因：`'complete'`、`'stalled'`、`'cancelled'`、`'scroll_interrupted'`、`'no_container'`、`'no_messages'`，以及由 `GoToTop.scrollToTopAndWait()` 向上傳遞的任何原因。

**擷取前準備：**
1. 啟用 PreventAutoScroll 以抑制 DeepSeek 的即時捲動行為。這個呼叫是無條件的，teardown `finally` 中對應的 `disable()` 也一樣 —— 這正是常駐模式開啟時 `disable()` 為 no-op 的原因（v4.12.0）：該旗標沒有參考計數，否則一次匯出就會關掉使用者開啟的常駐鎖定。
2. 呼叫 `GoToTop.scrollToTopAndWait()` 將虛擬列表錨定至位置 0。
3. 顯示非阻塞的浮動進度提示（`pointer-events: none`，樣式來自 `go-top.css`）。

**捲動迴圈：**
- 逐步捲動對話容器。自 v4.19.1 起步幅採**實測而非假設**：每次迭代量測目前的掛載窗口，並詢問 `HarvestPolicy.computeScrollStep()` 可安全捲動多遠。詳見下方自適應捲動步幅一節。
- 每一步捲動後，由 `MutationObserver` 監看容器的 DOM 變化（延遲載入的訊息）。連續 `HARVEST_STABLE_TICKS`（3）次、每次間隔 `HARVEST_STABLE_INTERVAL`（100ms）的檢查都沒有變動，該步即視為「已穩定」。
- 版面度量（`scrollTop`、`clientHeight`、`scrollHeight`）每次迭代只讀取一次存入區域變數並在該次迭代內重用，而非在每個決策點重讀 —— 重複讀取會強制觸發版面重排。刻意不跨迭代快取，因為捲動本來就會改變這些值。
- 兩處 `_waitForDomStability()` 呼叫位於互斥分支（到底確認 vs. 捲動），因此單次迭代只會等待其中之一。這點經過驗證而非推測 —— 看起來像每步成本加倍，實際並非如此。請勿「合併」它們。
- 每個 `.ds-message` 節點進入視口時即複製。
- 以 `Map<number, Element>` 去重，鍵為數值型 `data-virtual-list-item-key` 屬性值 —— 由 DeepSeek 虛擬列表渲染器指派的穩定鍵。

**到底偵測：**
- 檢查 `scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - HARVEST_BOTTOM_TOLERANCE`（4px）是否成立。
- 需連續 `HARVEST_BOTTOM_CONFIRM_COUNT`（3）次確認才判定到底。

**安全網：**
- 每一步後記錄預期的捲動位置。若實際 `scrollTop` 與預期位置偏差超過 `1.5 * viewportHeight`，即判定發生外部捲動跳躍（React 重新渲染、使用者介入）。擷取隨即中止，回傳部分內容並附上警告。

**終止判定（v4.19.0 重寫）：**

停止決策由 `HarvestPolicy` 負責，而非迴圈本身。每次迭代蒐集一份觀測值並呼叫 `HarvestPolicy.decideNextStep()`，再依其判定行事。`nowMs` 由 `harvest.js` 以 `Date.now()` 提供 —— policy 模組自身從不讀取時鐘，因此不需假計時器即可測試。

刻意**不設總時長上限**。持續有進展的擷取需要跑多久就跑多久；唯一以時間為準的停止條件是*連續*無進展達 `HARVEST_STALL_TIMEOUT_MS`（20000 ms），取消按鈕則是使用者的逃生出口。詳見下方「為什麼終止判定以進展為準」。

**取消（v4.19.0）：**

原生 `AbortController` 在 `harvestAllMessages()` 內建立，生命週期恰好為一次執行，不引入任何模組層級的可變狀態。`() => abortController.abort()` 作為取消回呼交給進度提示，`abortController.signal.aborted` 則供應觀測值的 `isAborted` 欄位。被取消的執行會回傳**截至當下**已擷取的訊息，而非空陣列 —— 部分資料仍是使用者的資料。

**清理：**
- 成功時：還原捲動位置、停用 PreventAutoScroll（使用者開啟常駐模式時為 no-op，v4.12.0）、隱藏進度提示。
- 任何提前停止（`'stalled'`、`'cancelled'`、`'scroll_interrupted'`）：匯出部分內容，附上與原因相符的警告頁尾並顯示頁面警告提示，接著以相同方式清理。

**為什麼終止判定以進展為準：**

固定的總時長上限會無聲截斷長對話：匯出在某則訊息邊界乾淨地結束，最新的訊息全數遺失，只剩一行埋在檔尾的頁尾可供察覺。

這類上限是被閒置耗盡，而非被載入耗盡。每一步都要等待穩定檢查，其最低成本為 `HARVEST_STABLE_TICKS`（3）× `HARVEST_STABLE_INTERVAL`（100 ms）= 300 ms，即使該步無須載入任何內容也照樣支付，因此任何總上限都會對可達的捲動距離設下硬天花板，與對話長度無關。中斷與緩慢因此是同一個缺陷，而非兩個。

所以終止判定以進展為準：只有連續 20 秒毫無變化才停止。tick 數刻意維持 3 —— 提早結束穩定等待會捲過尚未渲染的內容，而掃描從不回頭，那些訊息將永久遺失。在這裡完整性優先於速度。

**後備方案：** 若 `GoToTop` 或 `PreventAutoScroll` 無法使用，Harvest 退回對 `.ds-virtual-list-visible-items .ds-message` 的單次 DOM 查詢（只擷取目前可見的訊息）。

### 常數

定義於 `content/harvest.js`：

| 常數 | 值 | 說明 |
|-|-|-|
| `HARVEST_STEP_TIMEOUT` | 8000 ms | 每一步捲動等待 DOM 穩定的最長時間 |
| `HARVEST_BOTTOM_CONFIRM_COUNT` | 3 | 判定到底所需的連續確認次數 |
| `HARVEST_SCROLL_JUMP_THRESHOLD_FACTOR` | 1.5 | 安全網：中止前允許的最大偏差 |

定義於 `content/harvest.dom.js`：

| 常數 | 值 | 說明 |
|-|-|-|
| `HARVEST_STABLE_TICKS` | 3 | 繼續前所需的連續穩定檢查次數。請勿調低 —— 見上方「為什麼終止判定以進展為準」 |
| `HARVEST_STABLE_INTERVAL` | 100 ms | 穩定檢查的間隔 |
| `HARVEST_BOTTOM_TOLERANCE` | 4 px | 到底偵測的容許誤差 |

終止判定維持以進展為準：請勿以任何形式加入總時長上限。

v4.19.1 起步幅由即時量測推導，後備比例（0.9）定義於 `harvest.policy.js` 的 `SCROLL_STEP_FALLBACK_FACTOR`，作為此值的唯一來源；`harvest.js` 不另存副本，以免同一個值出現兩個來源。

定義於 `content/harvest.policy.js`：

| 常數 | 值 | 說明 |
|-|-|-|
| `HARVEST_STALL_TIMEOUT_MS` | 20000 ms | 連續無進展達此時間即以 `'stalled'` 停止。邊界值包含在內 |
| `SCROLL_STEP_SAFETY_FRACTION` | 0.7 | 實際採用為步幅的實測安全上限比例 |
| `SCROLL_STEP_FALLBACK_FACTOR` | 0.9 | 無法量測時採用的視窗高比例 |
| `SCROLL_STEP_MIN_FACTOR` | 0.25 | 步幅下限，以視窗高比例表示 |

定義於 `content/harvest.toast.js`：

| 常數 | 值 | 說明 |
|-|-|-|
| `HARVEST_INCOMPLETE_TOAST_AUTO_DISMISS_MS` | 10000 ms | 不完整匯出警告提示的自動關閉延遲 —— 刻意比一般提示長 |

### 對外 API

- `harvestAllMessages()` —— 主要擷取進入點（無參數）
- 掛載於 `window.DSstudio.Harvest`

## 擷取決策模組 (Harvest Policy Module)

`content/harvest.policy.js`（v4.19.0）存放從擷取迴圈中抽出的純決策邏輯。它**完全沒有** DOM 參照，也沒有 `chrome.*` 呼叫、計時器與時鐘讀取 —— 這份純粹性正是重點所在，為了方便而妥協，這段邏輯就會重新變得無法單元測試。它在 `manifest.json` 中緊接於使用它的 `content/harvest.js` 之前註冊，並掛載於 `window.DSstudio.HarvestPolicy`。

抽出它同時履行了 `coding-guidelines` §8 的拆分義務：`harvest.js` 已達 430 行，逼近 450 行的主動拆分門檻，因此最需要測試的邏輯，恰好也是最需要移出該檔的邏輯。

### `createInitialState(observation)`

回傳一次執行的不透明初始狀態，記錄基準時鐘讀數、已擷取數量與捲動高度。

### `decideNextStep(observation, state)`

純函式。回傳 `{ action: 'continue' | 'stop', reason, state }`，不修改任何引數。

`observation` 欄位：`nowMs`、`capturedCount`、`scrollHeight`、`isAtBottomConfirmed`、`isAborted`、`isScrollJumpDetected`。

決策規則依嚴格優先順序排列 —— 多個條件同時成立時，排在前面的規則勝出：

| # | 條件 | 結果 |
|-|-|-|
| 1 | `isAtBottomConfirmed` | stop，`'complete'` |
| 2 | `isAborted` | stop，`'cancelled'` |
| 3 | `isScrollJumpDetected` | stop，`'scroll_interrupted'` |
| 4 | 有進展 | continue；最後進展時鐘重設為 `nowMs` |
| 5 | 無進展達 `>= HARVEST_STALL_TIMEOUT_MS` | stop，`'stalled'` |
| 6 | 其他情況 | continue；最後進展時鐘維持不變，讓無進展的呼叫持續累積 |

「進展」指 `capturedCount` 增加，**或** `scrollHeight` 在*任一*方向上改變 —— 虛擬列表可能縮短，若把縮短當成停滯，會中止一次健康的執行。

到底確認刻意優先於取消：若執行已抵達終點就是完整的，回報為已取消會低估使用者實際拿到的內容。

### `describeIncompleteReason(reason)`

純函式。將停止原因對應為 Markdown 頁尾與警告提示共用的英文 clause。每個 clause 皆以小寫開頭且不含句尾標點，由呼叫端自行補上。

| 原因 | Clause |
|-|-|
| `'stalled'` | the conversation stopped loading new messages before the end was reached |
| `'scroll_interrupted'` | the page was scrolled by something else during the export |
| `'cancelled'` | the export was cancelled |
| `'no_container'` | the conversation scroll container could not be found |
| `'no_messages'` | no messages were found in the conversation |

無法辨識的非空原因會產生包含原始原因字串的後備 clause，讓未對應的代碼保持可診斷，而非消失無蹤。`null`、`undefined` 與 `''` 則產生通用 clause，絕不會把「null」或「undefined」字樣洩漏到使用者可見的文字中。

### `computeScrollStep(observation)`

純函式。回傳下一步要捲動的整數像素距離，由即時量測推導，而非取視窗高的固定比例。

`observation` 欄位：`mountedBottomOffset`（從捲動容器可見頂端往下到最低掛載項目節點底緣的 px 距離；量測失敗時為不可用的值）與 `viewportHeight`（`window.innerHeight`）。

| 情況 | 結果 |
|-|-|
| `viewportHeight` 不是大於 0 的有限數 | 拋錯 —— 呼叫端必定取得到 `window.innerHeight`，此情況代表呼叫端程式碼有誤 |
| `mountedBottomOffset` 非有限數或 `<= 0` | `round(viewportHeight × 0.9)` —— 即 v4.19.1 之前的固定步幅行為 |
| 其他情況 | `round(mountedBottomOffset × 0.7)`，下限為 `round(viewportHeight × 0.25)` |

不設上限：此值由實測安全上限推導，因此量測值大時產生大步幅是正當的。

前兩列的不對稱是刻意的。無效的 `viewportHeight` 只可能代表呼叫端程式碼有誤，所以拋錯；不可用的 `mountedBottomOffset` 則在 DeepSeek 改版標記、選擇器什麼都沒匹配到時會正當發生，所以安靜降級。兩者請勿統一。

0.25 下限是刻意標記的取捨：低於此值時，量測有誤的可能性遠高於真實情況 —— 18 個掛載節點跨距不到四分之一視窗高，意味著每則訊息約 11 px —— 而有界的前進勝過在數萬像素間緩慢爬行。若日後真實頁面確實產生如此小的跨距，要重新檢視的就是這個下限。

## 自適應捲動步幅（Adaptive Scroll Step）

**為什麼步幅採實測而非假設（v4.19.1）。**

對兩場真實對話在不同捲動位置進行即時量測，確立了此設計所依據的事實：

| 量測項目 | 樣本 1 | 樣本 2 |
|-|-|-|
| 視窗高度 | 988 px | 988 px |
| 容器 `clientHeight` | 928 px | 928 px |
| 掛載的項目節點 | 18 | 18 |
| 與視窗相交的節點 | 5 | 6 |
| 可見頂端以上的掛載範圍 | 0 px | 0 px |
| 可見底端以下的掛載範圍 | 4244 px | 3406 px |
| 從可見頂端起算的掛載跨距 | 5172 px（5.2 個視窗高） | 4334 px（4.4 個視窗高） |

由此得出三項結論：

1. **掛載窗口以項目數為準，而非高度。** 儘管對話、捲動位置與訊息長度都不同，兩個樣本都恰好掛載 18 個節點。固定像素步幅因此等於押注訊息長度：遇到一連串短訊息時，18 個節點的高度遠小於預期，為長訊息調校的步幅就會捲過從未掛載的內容。由於掃描是單向且從不回頭，那些內容會永久且無聲地遺失。
2. **覆蓋來自向下的 overscan，而非向上的重疊。** 掛載窗口完全不延伸到可見頂端以上，所以舊的 0.9 步幅從未真正受到其 10%「重疊」的保護。實際確保覆蓋的是每次擷取都延伸到目前位置*以下* 4-5 個視窗高，使相鄰兩次擷取大幅重疊。
3. **因此安全上限可以量測。** 目前為止擷取到的所有內容向下延伸至最低掛載節點的底緣。只要下一步讓新視窗頂落在該點或其上方，新的掛載窗口必然與前一個重疊，不可能遺漏任何內容。這段距離正是 `mountedBottomOffset`。

所以 `harvest.dom.js` 每次迭代量測此值，再由 `HarvestPolicy.computeScrollStep()` 取上限的 70% 作為步幅。訊息長時步幅增長至 3-4 個視窗高；訊息短時自動縮小。步幅係數從「對頁面的假設」轉為「頁面實況的結果」。

以兩個樣本計算，步幅從 889 px（舊的固定 0.9）分別變為 3620 px 與 3034 px —— 捲動步數約減少為 1/3.4 至 1/4.1。實際耗時的改善小於步數的改善，因為步幅越大，每一步掛載的新內容越多，穩定等待也隨之拉長。

**已否決的替代方案 —— key 缺口偵測。** 曾考慮以擷取到的 `data-virtual-list-item-key` 序列中是否有缺口作為完整性證明，量測後放棄：樣本 1 回傳 `distinctDiffs: [1, 3]`，即自然出現的缺口，而樣本 2 是連續的。既然沒有遺漏時也會出現缺口，缺口就無法證明遺漏。除非有新證據顯示編號是緊密連續的，請勿重提此構想。

**殘留風險，坦白說明。** 只取了兩個樣本，且都來自同一個瀏覽器與視窗大小。自適應步幅若要跳過內容，量測值必須高估掛載窗口，而 0.7 的比例正是用來吸收這種誤差。量測在前一步穩定之後執行，因此反映的是靜止狀態下的掛載窗口 —— 與擷取時看到的狀態相同。
