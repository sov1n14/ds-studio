# 功能規格：匯出、互動與 AI 回覆

> 📂 [DS studio 文件](../) › [功能規格](../SPEC.md) › 匯出與互動功能
>
> **相關架構**：[匯出架構](../architecture/EXPORT.md) · [內容腳本](../architecture/CONTENT_SCRIPTS.md)

## 3. Markdown 匯出

- **觸發**：使用者點擊擴充功能彈出選單中的「匯出當前頁面對話為 Markdown」按鈕。
- **範圍**：匯出 `chat.deepseek.com` 目前聊天工作階段中**完整**的所有訊息輪次，包含因虛擬列表（virtualized list）而未在視口中渲染的訊息。
- **滾動擷取（Scroll-and-Harvest）流程**（v2.6.0，擴充於 v2.6.1，進一步更新於 v2.6.2）：
  1. **防自動捲動抑制**（v2.6.1）：擷取開始前，透過 `window.DSstudio.PreventAutoScroll.enable()` 啟動 MAIN-world 捲動攔截補丁，將 DeepSeek 原生的「自動捲至最新訊息」行為靜默抑制。啟用後，使用者可在擷取期間繼續正常對話（輸入並發送訊息）而不會干擾採集過程；採集完成後呼叫 `.disable()` 恢復原生行為。
  2. **進度提示**（v2.6.2 二階段更新）：Toast 採用 `pointer-events: none`，**不阻擋**滑鼠事件，使用者在擷取期間保有完整頁面互動能力（取代 v2.6.0 的全螢幕阻擋遮罩）。文字依階段分為兩個階段：
     - **捲頂階段**：Toast 顯示 `正在捲動至對話頂端…`，不顯示擷取計數，避免誤導使用者。
     - **擷取階段**：Toast 顯示 `正在擷取完整對話… 已擷取 N 則`（N 隨擷取進度動態更新），同時在下方持續顯示警告行 `⚠ 請勿捲動對話記錄，以免擷取失敗`，提醒使用者在擷取期間的手動捲動**不會**被抑制，並可能導致擷取失敗。
  3. **滾頂**：呼叫 `GoToTop.scrollToTopAndWait()` 將虛擬列表錨定至位置 0，確保擷取從第一則訊息開始。
  4. **增量滾動擷取**：由上至下逐步捲動頁面，每次捲動後等待虛擬列表渲染新節點，持續收集出現在 DOM 中的訊息節點。使用以「輪次索引 + 角色」組成的複合鍵進行去重（`Map<key, node>`），每個鍵僅保留最後一次觀察到的節點副本，防止虛擬列表重渲染造成重複。
  5. **外力捲動中斷安全網**（v2.6.1 引入，v2.6.2 修正）：擷取迴圈持續監測捲動位置。若偵測到非採集迴圈本身發起的大幅跳躍（例如抑制補丁被繞過，或使用者以滾輪強制捲動），立即以 `scroll_interrupted` 原因中止採集，並將已收集的部分內容匯出；Markdown 檔案末尾附加不完整警告頁尾（`> ⚠️ Export may be incomplete: scroll-harvest timed out before reaching the end.`）。註：目前中斷與逾時使用同一英文警告文字。確保使用者明確知悉結果不完整。v2.6.2 修正：先前在每次 DOM 穩定等待結束後，`_expectedScrollTop` 會被誤重設為當前捲動位置，導致等待期間發生的外部捲動跳躍被遮蔽，安全網無法正確觸發；移除該重設後，安全網現可可靠地偵測並回應外部捲動中斷。
  6. **排序與組裝**：擷取完成後，依鍵排序建立最終有序訊息陣列，確保輸出順序與對話順序一致。
  7. **還原捲動位置**：無論擷取成功、逾時或中斷，均無條件還原使用者的原始捲動位置。
  8. **逾時部分匯出**：若擷取未在逾時時限內完成，停止迴圈並將已收集的部分內容匯出，在 Markdown 檔案末尾附加警告頁尾（同上——中斷與逾時使用同一英文警告文字）。確保使用者一定能取得檔案而非靜默失敗。
- **輸出格式**：一份有效的 Markdown (`.md`) 檔案，包含：
  - 標題列（`# DeepSeek Chat Export`）。
  - 匯出時間戳記。
  - 每輪對話以分隔線（`---`）隔開。
  - 使用者訊息置於 `## User` 標題下。
  - AI 回應置於 `## DeepSeek` 標題下。
- **思考過程處理**：若存在，AI 的思考過程以區塊引用（`> `）形式呈現，置於 `> **Thinking Process:**` 標題下。思考過程中的內部連結永遠保留。
- **參考連結處理**：引用連結（如 `[link-1]`）從 `.ds-markdown-cite` 元素中提取，啟用時以 `[[link-N]](url)` 格式呈現。
- **HTML 轉 Markdown 轉換**：匯出器必須正確轉換標題、表格、區塊引用、有序/無序清單、程式碼區塊（包含 `<div class="md-code-block">` → `<pre><span>` 提取）、內聯格式與連結。
- **檔案名稱**：`deepseek-chat-YYYYMMDD-HHmmss.md`（時間戳為匯出當下）。

## 16. 引用回覆 (Quote Reply)

- **觸發範圍**：僅在使用者於 `div.ds-virtual-list-visible-items`（AI 回覆虛擬列表）內選取文字時觸發。`anchorNode` 與 `focusNode` 皆須位於此容器內；跨容器選取一律忽略。空選取或純空白選取不觸發。
- **浮動按鈕**：選取完成後（`mouseup` / `selectionchange` / Shift-Arrow，250ms debounce），在選取範圍第一行上方顯示 `.dss-quote-btn` 浮動按鈕，包含引號 SVG 圖示與「引用回覆」文字標籤。
- **定位規則**：按鈕預設置於選取首行上方 16px、水平置中；左右邊界限制最小 10px；若 `top < 10` 則翻轉至選取下方 8px；選取完全滾出視口時自動隱藏。
- **注入格式**：點擊按鈕後，將選取文字以 Markdown blockquote 格式（每行加 `> ` 前綴）追加至 `<textarea>`：
  - textarea 為空 → 直接填入 `> 選取內容`（無多餘空行）。
  - textarea 有內容 → 原內容 + `\n`（若末端無換行）+ `> 選取內容`。
  - 多行選取 → 每行各自加上 `> ` 前綴，以 `\n` 連接。
- **React 相容寫入**：使用 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` 寫入值，並依序 dispatch `input`（`bubbles: true`）與 `change`（`bubbles: true`）事件。
- **消失條件**：以下任一情況按鈕自動隱藏：(1) 選取清除或折疊、(2) 選取節點離開容器、(3) 選取完全滾出視口、(4) 視窗縮放（重新計算定位，超出邊界時隱藏）、(5) 點擊按鈕以外區域。
- **IME 防護**：`keyup` 事件在 `e.isComposing === true` 時直接跳過，避免中文組字期間誤觸。
- **Virtual List 快照**：`_selectedText` 在 debounce 結束時立即快照，按鈕 `click` 使用快照值而非即時 selection，防止 DeepSeek 虛擬列表重渲染導致 selection 失效。

## 19. 系統時間注入 (System Time Injection)

- **開關位置**：彈出選單「功能與匯出」卡片中的 `#showSystemTimeToggle` 核取方塊，位於參考連結開關下方。
- **儲存鍵**：`dsShowSystemTime`（布林值，預設 `false`）。
- **注入格式**：啟用後，在每則訊息前端以 `Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)`（24 小時制、零補位，含當地時區偏移）格式插入目前系統時間，位於 `<system-prompt>` 區塊（若存在）或 `<user-input>` 區塊之前。範例：`Current Time: 2026/06/14 20:19:32 (UTC+08:00)`。
- **重複注入處理**：注入邏輯每次皆重新產生時間戳並前置於訊息開頭（無重複防護檢查）。若文字輸入區已含有舊時間戳，將被新時間戳取代。
- **主開關感知**：當主開關（`isEnabled`）關閉時，此切換會停用（透過 `disabled` 屬性）。

## 20. 恢復被審查的回覆 (Censor Reply Restore)

- **目的**：DeepSeek 官方可能以「我暫時無法回答這個問題」等訊息取代原本的模型回覆（內容審查/屏蔽）。此功能從 SSE 串流資料中還原原始 assistant 回覆並顯示於 UI。
- **串流攔截**：透過 `censor-xhr-hook.js`（注入頁面主 world）monkey-patch `XMLHttpRequest.prototype.send`，以 `INTERCEPTED_ENDPOINTS` 清單（`getMatchedEndpoint()` 純函式比對）攔截 `/api/v0/chat/completion` 與 `/api/v0/chat/edit_message` 兩個端點的 SSE 回應——編輯既有 user 訊息後的重新生成走 `edit_message`，其 SSE 格式與請求欄位名稱（`chat_session_id`、`prompt`）與 `completion` 完全相同；請求中額外的 `message_id` 為被編輯 user 訊息的 ID，刻意忽略，回覆 ID 一律取自 SSE 串流的 `response.message_id`。請求傳送時一併解析 `chat_session_id` 與 `prompt`，攔截 log 會標明命中的端點。回應完成時透過 `window.postMessage` 將 `DSS_FRAGMENT_COMPLETE` 事件傳遞給 extension 的 content script。
- **審查偵測**：`_parseSseEvent()` 解析 SSE data 行中的 `CONTENT_FILTER` 狀態。同時 DOM 層偵測：`_isCensored()` 檢查 assistant 訊息工具列的第 2 與第 5 個按鈕是否同時為 disabled 狀態（審查特徵）。按鈕選取相容新舊設計系統：先以 `.ds-icon-button`（舊版）查詢，無結果時改用 `[role="button"].ds-button.ds-button--icon`（新版）；disabled 判定為「`ds-icon-button--disabled` class 且 `aria-disabled="true"`（舊版）」或「`ds-button--disabled` class（新版，部分 disabled 按鈕無 `aria-disabled` 屬性）」。`_getToolbarGroup()` 主選擇器為 `.ds-flex._965abe9`，後備方案以相同合併選擇器尋找含 5 顆以上按鈕的 `.ds-flex`。
- **儲存記錄**：`_saveFragment()` 將被審查的訊息儲存至 `chrome.storage.local`（`restored_messages` 鍵），包含 `message_id`、`fragments`、`thinking_elapsed_secs`、`chat_session_id`、`prompt_key`（正規化後的 user prompt）。記錄鍵為 session 作用域：`_recordKey(sessionId, messageId)` 產生 `"<session>::<message_id>"`（session 為空值時以 `nosession` 前綴），因為 `message_id` 是每個對話各自的序號，跨對話必然碰撞——所有讀寫（儲存、注入查找、storage 比對）一律使用此複合鍵。最多保留 200 筆記錄（`_evictOldest()`）。
- **即時恢復**：SSE 事件完成後，`_onFragmentComplete()` 將 `message_id` 推入 `_pendingQueue`，`_tryRestoreMessage()` 在 DOM 出現對應元素時查詢並注入原始內容。
- **message_id 解析順序**：`_getMessageIdFromElement()` 依序查找 `_keyToMessageId`（執行期快取）→ `_resolveMessageIdFromStorage()`（以 URL session id + 正規化 prompt_key 比對儲存記錄，命中時回寫 `_keyToMessageId`，已被認領的 message_id 會跳過）→ `_pendingQueue.shift()`（僅作最後手段），避免即時 XHR 的佇列 ID 被錯誤指派給較舊的未恢復訊息。每次成功解析會以 `[DV:CensorRestore]` log 標明來源路徑（`map` / `storage` / `queue`）。
- **佇列同步清理**：經 map 或 storage 路徑解析成功時，會同步從 `_pendingQueue` 移除相同 messageId 的所有條目（含 log）。佇列條目原本只會被 queue 後備路徑的 `.shift()` 消費，若元素改走其他路徑解析，殘留條目會在下一個「元素先於 fragment 出現」的被審查訊息上被盲目套用，造成同對話內容錯位。
- **queue 後備驗證**：消費 `_pendingQueue` 前先窺視佇列首項：若元素可透過 `_getPrecedingUserPromptKey()` 取得 prompt key，且候選 messageId 的儲存記錄存在並帶有不相符的 `prompt_key`，則拒絕消費（含 log）並回傳 null，待該元素自己的 fragment 抵達後由重掃描正確注入；僅在元素無法取得 prompt key（DOM 變體）或候選尚無儲存記錄時保留原有的盲目消費行為。
- **session 嚴格比對**：記錄的 `chat_session_id` 或當前 URL 的 session id 任一為空值時，storage 比對一律不成立（`_resolveMessageIdFromStorage()` 回傳 null、`_tryRestoreFromStoredRecords()` 直接返回），防止兩個尚未取得 session id 的對話以 `null === null` 互相誤配。
- **SPA 對話切換清理**：`_checkSessionChange()` 於 `_tryRestoreMessage()`、`_onFragmentComplete()`、`_tryRestoreFromStoredRecords()` 進入點檢查 URL session 是否變化。`data-virtual-list-item-key` 是每個對話重複使用的索引，因此切換對話（非空 → 不同非空，或非空 → 空）時必須清空 `_keyToMessageId` 與 `_pendingQueue` 並重設 `_storedRecordsApplied`，避免殘留映射把前一對話的內容注入新對話；空 → 非空（新對話剛取得 session id）僅更新 `_currentSessionId`、保留佇列，因為第一則訊息的 fragment 可能早於 URL 更新就已入列。
- **重整恢復**：聊天記錄通常在 content script 啟動後才由 React 渲染完成，因此重整恢復由兩條路徑保障：
  - 啟動路徑：`enable()` → `applyToExisting()` 呼叫一次 `_tryRestoreFromStoredRecords()`（若當下 DOM 尚未渲染則無作用）。
  - Observer 後備路徑：MutationObserver 偵測到被審查訊息且 `_getMessageIdFromElement()` 查無 ID 時，`_tryRestoreMessage()` 觸發 `_tryRestoreFromStoredRecords()` 全量比對；以 `_storedRecordsApplied` 旗標防止重複掃描，旗標於每次 `_onFragmentComplete()` 重設。
- **儲存記錄比對流程**（`_tryRestoreFromStoredRecords()`，各決策點均有 `[DV:CensorRestore]` 診斷 log）：
  1. 從 URL 解析 `chat_session_id`。
  2. 收集 DOM 中未被恢復、且被審查的 assistant 訊息。
  3. 透過 `_getPrecedingUserPromptKey()` 取得每個 assistant 訊息的前一個 user prompt 作為錨點。
  4. 將記錄同樣以 `chat_session_id` + `prompt_key` 分組，同組內以 `message_id` 排序配對。
  5. 僅在相同 prompt 群組內進行位置配對，避免跨對話內容錯位。
- **內容注入**：`_injectRestoredContent()` 隱藏原始的審查內容（`.dss-censored-hidden`），插入還原的 HTML，包含：
  - **RESPONSE** 片段：透過 `_renderMarkdown()` 將原始 Markdown 渲染為 HTML，附加「⚠ 已復原內容」徽章。
  - **THINK** 片段：若存在思考過程，使用 `_buildThinkBlock()` 重建可折疊的思考區塊，顯示思考時間。
- **舊鍵 migration**：`_loadRestoredMessages()` 載入時偵測不含 `::` 的舊式裸 message_id 鍵，依記錄內嵌的 `chat_session_id` 重新編鍵（null → `nosession::`，依嚴格比對規則永不匹配，透過 LRU 自然淘汰），並一次性寫回 storage。

## 21. 臨時對話 (Temporary Conversation)

- **目的**：開啟後，使用者**在首頁新建**的對話會被標記為臨時對話；離開該臨時對話時自動呼叫 `POST https://chat.deepseek.com/api/v0/chat_session/delete`（body `{ "chat_session_id": "<uuid>" }`）將其刪除，達成「不留紀錄」的臨時提問。
- **臨時對話判定（僅刪除新建的對話）**：是否為臨時對話，以「是否觀察到新建對話 API（`/api/v0/chat_session/create`）請求」為權威依據。從清單點開歷史對話會呼叫 `/api/v0/chat/history_messages`，**永不標記、永不刪除**。最小風險原則：未觀察到 create 請求即視為歷史對話。
- **整體閘控（預設關閉）**：標記新對話的行為由首頁開關控制，預設關閉。但若已存在「追蹤中的臨時對話」，即使關閉開關，離開該對話時仍會刪除（標記跟隨對話生命週期）；僅在無追蹤對話且開關關閉時才完全卸除監聽。
- **共用契約**（`content/temporary-chat-constants.js`，載入順序最先以確保全域常數先就緒）：
  - `DSS_TEMP_CHAT_STORAGE_KEY = 'dss-temporary-chat-enabled'`：`chrome.storage.local` 鍵（v4.9.0 從 sessionStorage 遷移至 chrome.storage.local），值 `true`/`false`。
  - `DSS_TEMP_CHAT_CHANGED_EVENT = 'dss-temporary-chat-changed'`
  - `DSS_TEMP_CHAT_UUID_KEY = 'dss-temporary-chat-uuid'`：sessionStorage 鍵。
  - `DSS_CHAT_CREATE_MESSAGE_TYPE = 'DSS_CHAT_CREATE_DETECTED'`
  - `DSS_CHAT_CREATE_ENDPOINT = '/api/v0/chat_session/create'`
  - `DSS_CHAT_COMPLETION_MESSAGE_TYPE`：completion API 端點用於比對
  - `DSS_FIBER_DELETE_MESSAGE_TYPE` / `DSS_FIBER_DELETE_RESULT_TYPE`：Fiber 刪除相關
  - `DSS_PENDING_DELETES_SYNC_KEY`：跨裝置待刪佇列 sync 鍵
  - `DSS_LAST_AUTH_TOKEN_KEY`：本機 auth token 儲存鍵（僅 `chrome.storage.local`）
  - `DSS_OPEN_TEMP_UUIDS_KEY`：本機開啟中對話 UUID 集合
  - `DSS_DELETE_ENDPOINT_URL`：刪除 API 完整 URL
  - `DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE`：Service Worker 排程重試訊息
- **開關 UI**（`content/temporary-chat-toggle.js` + `.css`）：僅在 `pathname === '/'` 首頁顯示。文字 14px / weight 500，關閉時 `#f9fafb`、開啟時 `#679efe`；開關軌道開啟時 `#4d6bfe`。樣式選擇器一律以 `.dss-temp-chat-*` 前綴隔離。
  - **SPA 注入／移除**：以 Navigation API `navigate` 事件（並輔以 `popstate` 與 `MutationObserver`）在每次導航重新評估：`pathname === '/'` 時等待 `div.aaff8b8f` 出現後於其下方 38px 注入（以 id 去重），`pathname !== '/'` 時移除開關列。移除僅刪除 DOM 元素，**不更動 sessionStorage 狀態**；重新注入時依持久化旗標還原視覺。
  - **診斷日誌**：於 init／navigation／anchor 查詢／注入／移除／observer 偵測斷線等決策點輸出 `[DV:TempChatToggle]` 前綴日誌，供在真實瀏覽器調查「開關偶爾未出現、重整後才出現」之用。
- **新建偵測與授權擷取**（`content/censor-xhr-hook.js`，主 world）：
  - 沿用攔截 `setRequestHeader('authorization', ...)`，以 `window.postMessage({ type: 'DSS_AUTH_CAPTURED', authorization })` 廣播；`temporary-chat-delete.js` 僅在需要時消費並暫存 token。
  - 另偵測 URL 含 `/api/v0/chat_session/create` 的請求（同時攔截 `XMLHttpRequest.prototype.open` 與包裝 `window.fetch`），命中時廣播 `DSS_CHAT_CREATE_DETECTED`。
- **標記與刪除邏輯**（`content/temporary-chat-delete.js`）：
  - `deleteChatSession(chatUuid, { keepalive })`：guard clause 缺 token 或缺 chatUuid 即不送出；以 `fetch` POST 帶 authorization 與 x-client-* 標頭。
  - **標記**：收到 `DSS_CHAT_CREATE_DETECTED` 且開關開啟時設 pending；當 Navigation API `navigate` 落在 `/a/chat/s/<uuid>` 時，將該 UUID 寫入 `DSS_TEMP_CHAT_UUID_KEY` 作為追蹤對象並清除 pending。
  - **離開即刪除**：`navigate` 事件計算離開前的 `fromUuid` 與目的地 URL；當「非刷新」、「非導向同一對話」、`fromUuid` 等於追蹤的臨時 UUID、且已擷取 token 時，刪除並清除追蹤 UUID。
  - **同網址／重整不刪除（Bug 修正）**：`navigationType === 'reload'` 或目的地 URL 等於目前 URL（含於網址列重按目前對話網址）時不刪除，並設定抑制旗標阻擋後續 `beforeunload` 刪除；另以 F5 / Ctrl+R / Cmd+R 鍵盤偵測為第二層保險。
  - **導向同一對話不刪除（Bug 修正，v4.9.1）**：`handleNavigationEvent` 從目的地 URL 擷取 `/a/chat/s/{uuid}` 的 `destUuid`，以 `isSameConversation = destUuid === _trackedTemporaryUuid` 作為守衛。只要導向的是同一追蹤中對話（即使僅 query string 或 hash 不同，如 `?model=v3`、`#msg-42`）即不刪除，取代先前僅比對完整 URL 字串相等的脆弱判定；`extractUuidFromUrl` 相應擴充為可接受選用的完整 URL 參數。此守衛不影響「導向其他頁面仍刪除」與「關閉分頁仍刪除」的既有行為。
  - `beforeunload`：涵蓋關閉分頁／瀏覽器與整頁導航；當目前 UUID 等於追蹤 UUID、未被抑制、且有 token 時，以 `keepalive: true` 刪除。
- **生命週期**：監聽於「開關開啟」或「存在追蹤中的臨時 UUID」任一成立時保持掛載；標記新對話僅在開關開啟時進行；刪除已追蹤對話不受開關關閉影響；追蹤對象清空且開關關閉後才卸除監聽。
- **獨立性**：此功能不受彈出選單右上角主開關連動，僅由首頁開關獨立控制。
- **兩層式刪除架構（v4.9.0）**：
  - **Layer 1（即時路徑，content script）**：SPA 導航沿用 Fiber/API 刪除；`beforeunload`（關閉分頁／瀏覽器）改為直接 `fetch(keepalive: true)`，不再經過 Service Worker 中繼，消除 IPC 競態。刪除成功（API 明確回傳成功）才移除待刪項目。
  - **Layer 2（補救路徑，Service Worker，僅 `onStartup` 觸發）**：擴充既有的 `chrome.runtime.onStartup` 監聽器（原用於雲端預設集同步），讀取共用待刪佇列並以本機 `dss-last-auth-token` 逐筆補刪，僅確認成功後才移除項目，失敗則累加 `attemptCount` 並保留供下次補救。
  - **跨裝置單一事實來源**：待刪佇列（`dss-pending-deletes-sync`）僅存在於 `chrome.storage.sync`，不設本機獨立副本；任一登入同一 Chrome 帳戶的裝置皆可用自身的 `dss-last-auth-token` 補刪佇列中的任何項目，無論該項目是否由自己標記。
  - **Sync-Change Safeguard**：`chrome.storage.onChanged`（sync 區域）觸發補救掃描，以緩解 `onStartup` 冷啟動時 `chrome.storage.sync` 尚未完成雲端 hydration 的競態；掃描時排除本機裝置目前開啟中的臨時對話 UUID（`dss-open-temp-uuids`，僅本機儲存），避免誤刪使用者正在使用的對話。
  - **隱私邊界**：`authToken` 僅存於 `chrome.storage.local`（`dss-last-auth-token`），永不透過 `chrome.storage.sync` 同步；共用佇列僅含非敏感性的 `chatUuid` 與 `attemptCount`。
