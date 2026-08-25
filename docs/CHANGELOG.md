# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 版本摘要

### v4.x — 模組化架構重構

| 版本 | 摘要 |
|-|-|
| [4.31.1](changelog/v4.md#4311---2026-08-25) | 跨裝置待刪佇列改為租約 + 心跳模型：佇列項目擴為 `{ chatUuid, attemptCount, lastActiveAt }`，新增常數 `LEASE_TTL_MS = 600000`、`HEARTBEAT_INTERVAL_MS = 60000`，存取層新增 `refreshLease`／`releaseLease`／純函式 `isLeaseExpired`，佇列的 read-modify-write 全數經 promise 鏈式互斥閘序列化。`remediatePendingDeletes()` 改為不帶參數且只刪除租約過期項目，`onStartup`、`dss-delete-retry` 排程與 sync `onChanged` 三條路徑套用同一道閘，使用中的對話因此在所有裝置上受保護；`onStartup` 先釋放本機開啟中項目的租約再掃描，關機前開著的對話重啟後即刻刪除；即時刪除完全失敗時 coordinator 送 `DSS_RELEASE_LEASE` 立即讓出。新增 `content/temporary-chat-heartbeat.js`（綁定分頁生命週期的續租心跳）與 `content/temporary-chat-sidebar-hide.js`（待刪對話於所有裝置的側邊欄隱藏，以日期群組為單位判定全隱或個別隱藏，套用 `ds-temp-chat-hidden` 且不移除節點），新增四種訊息型別與兩個側邊欄選擇器。新增 5 份 spec 與 `test/helpers/sidebar-fixtures.js` |
| [4.29.2](changelog/v4.md#4292---2026-08-22) | 償還兩筆可獨立排程的重構債：`performDeleteFetch` 擴為超集簽名（`keepalive` 選項 + guard）後 `deleteChatSession` 改為一行委派，重複的刪除 fetch 合而為一，端點 URL 私有於 `utils/deepseek-api.js`（`DSS_DELETE_ENDPOINT_URL` 自常數檔刪除）；`temporary-chat-constants.js` 自 `content/` 移正至 `utils/`，manifest 與 service worker 載入點、fail-fast 訊息、guidelines skill 範例路徑同步更新。測試端：`temporary-chat-delete-api.spec.js` 重寫（28 測試，含委派契約組），三份 T6 殘留慢測試轉虛擬時間（write-queue 9805ms → 22ms，合計省約 10.5 秒）。認證 10 份 spec 205/205 全綠 |
| [4.29.1](changelog/v4.md#4291---2026-08-22) | Theme B wave 2：單一站點的 DeepSeek 混淆選擇器收斂至 `content/ds-selectors.js`（新增 30 個具名條目，58 個匯出鍵），12 個消費檔改讀常數且字串值不變：`censor-reply-restore` 三檔、`content-script.export.js`、`edit-message-cleanup.js`、`websearch-toggle.js`、`sidebar-auto-hide.js`（一併刪除無讀取者的死常數 `div._70b689f`）、`mobile-homepage-cleanup.js`、`preset-overlay.resolvers.js`、go-top 三檔（跨檔重複的 `_0706cde` 收斂為單一常數）。thinkblock 寫入用的 `_74c0879`／`_9ecc93a`／`ds-think-content` 改組合自查詢常數消除隱性雙份字面值。24 份受影響 spec 全綠（496 測試） |
| [4.29.0](changelog/v4.md#4290---2026-08-22) | 編輯器視窗新增「頁面重新取得焦點即自動關閉」：`chat.deepseek.com` 分頁的 window `focus` 事件由新的 `content/editor-window-autoclose.js` 轉為 `DSS_CLOSE_EDITOR_WINDOWS` 訊息，新的 `background/editor-window-routes.js` 於 service worker 端讀取 `chrome.storage.session` 中的全域／提示詞組編輯器視窗 id，逐一 `chrome.windows.remove` 並移除對應的 key，回應 `{ ok: true }`（單一視窗已不存在的拒絕不影響另一個 id 與 key 的清除）。訊息型別與兩個 session 儲存鍵集中於新的 `utils/editor-window-constants.js`，`popup/popup.editor-window.js` 改由該常數檔取得儲存鍵並在缺載時 fail-fast 拋錯；`manifest.json` 的 `content_scripts`、`popup/popup.html`、`background/service-worker.js` 三個載入點同步接上。編輯器既有的自動儲存（500ms 防抖，`blur`／`visibilitychange`／`pagehide` 立即寫入）在自動關閉前先落盤，故不遺失內容。新增 `editor-window-routes.spec.js`（6）與 `editor-window-autoclose.spec.js`（4），`popup-editor-window.spec.js` 同步預載常數檔 |
| [4.28.1](changelog/v4.md#4281---2026-08-22) | Phase 8 wave 2：設定讀取範圍改以允許清單收斂、sync 讀取批次化並清除死碼，並拆出獨立的 `utils/storage-manager.settings-read.js` bundle part，四個載入點與 `manifest.json` 同步接上。`storage-manager.sync.js` 改動後為 362 行，落在 250 至 450 行容忍區間 —— 該檔聚焦單一內聚職責（同步衝突與重試：`retrySync`、`resolveSyncConflict`、`restoreSettings`），刻意不再切分。新增允許清單 spec，五份既有 storage-manager 與 editor-html spec 重新指向新 part |
| [4.28.0](changelog/v4.md#4280---2026-08-22) | i18n 生命週期重寫並抽出 MAIN world 注入模組。`utils/i18n.js` 移除 autoInit IIFE，語系解析改由 `init()` 統一處理並註冊單一受保護監聽器，新增 `onLocaleChanged(cb)` 訂閱 API 取代 `dsI18n-locale-changed` document 事件，新增 `_dataFor` 查詢並清除引擎內全部 DOM 依賴；DOM 套用邏輯外移至新的 `popup/popup.i18n-apply.js`。`censor-reply-restore.js` 內嵌的四段 MAIN world 注入改由新模組 `content/main-world-injector.js` 處理，該檔改為 `_startFragmentListener`。順帶償還三筆技術債：`censor-reply-restore.dom.js` 合併 `_injectThinkContent` 與 `_createRestoredContainer` 的重複邏輯（think block 選擇器移入 `ds-selectors.js`）、`storage-manager.chatmap.js` 抽出共用的 `_computeChatPresetMapDiff` 供 locked 與 unlocked 路徑共用、`content-script.export.js` 以 `TAG_HANDLERS` 查表精簡 `parseHtmlToMarkdown`。測試環境改為顯式呼叫 `dsI18n.init()` |
| [4.27.0](changelog/v4.md#4270---2026-08-22) | Phase 7 wave 2：抽離 popup 領域與檢視模組並修正設定正規化。新增 `popup.preset-domain.js`、`popup.settings-view.js`、`custom-select.drag.js` 三模組；`popup.js` 由 428 行降至 330 行（新增提示詞組處理、`bindCurrentChat`、分頁 UUID 解析移入 `popup.preset-manager.js`，141 → 242 行，locale 綁定改為 `bindLocaleSwitcher`），`custom-select.js` 由 411 行降至 247 行，`editor.js` 移除本地 `isDuplicateName` 改為委派 `createPreset` 與 `validatePresetName`。storage-manager 系列導入共用的 `normalizeWebsearchToggle`、`settings-routes.js` 於 GET 路由一併正規化 `dsWebSearchToggle`；初始化時以空索引防護執行 `pruneOrphanChatBindings` 以保全既有繫結。以正規表示式擷取原始碼的 `popup-add-preset.spec.js` 由行為測試取代 |
| [4.26.0](changelog/v4.md#4260---2026-08-22) | popup 層的 chrome API 呼叫全面抽離至共用 `utils/` 模組：新增 `tab-control.js`（`queryActiveDeepseekTab`／`queryDeepseekTabs`／`sendToTab`）、`window-control.js`（真正的單例視窗開啟）與 `debounce.js`（合併原本散落 popup 的三份重複實作），七支 popup 檔案不再直接呼叫 `chrome.tabs`／`chrome.windows`／`chrome.storage`。`storage-manager.local.js` 新增 `restored_messages` 系列 API 並由 content 端沿用，編輯視窗改以 session 保存視窗 id 達成單例，樣式與版面同步整併重複的 token 與選項命名 |
| [4.25.0](changelog/v4.md#4250---2026-08-22) | 待刪除佇列（pending store）改由 Service Worker 訊息路由持有與操作：新增 `background/pending-store-routes.js` 提供 `DSS_TRACK_FOR_DELETION`、`DSS_REMOVE_PENDING_DELETE`、`DSS_REMOVE_OPEN_UUID`、`DSS_SET_LAST_AUTH_TOKEN` 四條路由並委派給 `TemporaryChatPendingStore`，`content/temporary-chat-pending-store.js` 自 `content_scripts` 移除，`temporary-chat-delete` 三部件的直接呼叫全數改為訊息（常數 13 → 17 個）。preset overlay 一併清償三筆：P8（`onSelectChange` 不再就地變更 ctx map，持久化改走 `StorageManager` 交易路徑並攔截錯誤）、P7（移除已無作用的 `reason` 參數）、P11（`storageManager`／`i18n` 改由 ctx 注入並保留 bare-global 後備）。路由 spec 經先紅後綠 |
| [4.24.1](changelog/v4.md#4241---2026-08-22) | Phase 6 wave B：訊息路由遷移、模組拆分與 toast i18n 修正。新增 `chat-binding-controller.js`（對話與提示詞組綁定狀態機自 `content-script.js` 抽離，300 行，屬單一內聚狀態機故為 250 行容忍區間的邊界理由）、`prompt-injector.send-button.js`（P6）、`censor-reply-restore.keymap.js`（C13 反向索引，經 red-green 並由中立執行者認證）。`temporary-chat` 系列與 `content-script.js` 自 `chrome.storage` 遷移至 DSS settings 訊息路由；P4 —— `preset-overlay.controller.js` 移除自有 body observer，改以 `scheduleFindAndMount()` 搭配 150ms debounce 由 `content-script.js` 單一 body observer 分派；P14 —— 送出按鈕改以 SVG path 選擇器取代 `innerHTML` 掃描；C11 —— 刪除失敗 toast 改用 i18n key `tempChatDeleteFailedToast` 並套用 `ds-` 前綴 class |
| [4.24.0](changelog/v4.md#4240---2026-08-22) | 9 支 content 腳本切換至訊息式開關管線：`auto-retry`、`go-top`、`hide-thinking`、`mobile-homepage-cleanup`、`mobile-sidebar-swipe`、`prevent-auto-scroll-bridge`、`quote-reply`、`sidebar-auto-hide`、`websearch-toggle` 改以 `DSSFeatureToggle.registerFeatureToggle` 搭配 `DSS_SETTINGS_MSG` 的 GET 與 broadcast 取得設定，不再直接讀取 `chrome.storage`。`quote-reply` 另納入主開關的啟用與停用生命週期，並將 `selectionchange` 整併為單一排程器 |
| [4.23.3](changelog/v4.md#4233---2026-08-22) | Theme B 第一波：散落各功能模組的 DeepSeek 站點選擇器統一收斂至 `content/ds-selectors.js`，涵蓋 17 個消費端約 60 處站點，並補進兩處先前稽核遺漏的站點；`manifest.json` 調整載入順序讓 `ds-selectors.js` 先於所有消費端載入 |
| [4.23.2](changelog/v4.md#4232---2026-08-22) | C4：四處重複的 chat session id 正規表達式改為呼叫共用的 `DSSChatSessionId`（`censor-reply-restore.js`／`.dom.js`、`content-script.js`、`temporary-chat-delete.tracking.js`）；同時將 `censor-reply-restore` 的 resolver 更名以解除 collision spec 偵測到的全域名稱衝突 |
| [4.23.1](changelog/v4.md#4231---2026-08-22) | 抽出 `content/width-feature.js` 工廠統一封裝設定讀取、套用與 `MutationObserver` 監聽流程，並改由 Service Worker 訊息路由（`GET_SETTINGS`／`SETTINGS_CHANGED`）取得設定；`chat-width.js` 152 → 38 行、`input-width.js` 192 → 65 行，各自僅保留專屬設定，共移除 6 處直接使用 `chrome.storage` 的呼叫點 |
| [4.23.0](changelog/v4.md#4230---2026-08-22) | 建立 Theme C 的四支共用 content 基礎模組並各附單元測試：`feature-toggle.js`（以 messaging 為基礎的功能開關註冊機制）、`retry-until.js`（重試工具）、`mobile-device.js`（`isMobileDevice` 判斷）、`chat-session-id.js`（`extractChatSessionId` 解析）；消費端於後續版本逐步遷移 |
| [4.22.2](changelog/v4.md#4222---2026-08-22) | C10：`harvest.js` 收割主迴圈的底部判定改為呼叫 `harvest.dom.js` 的 `_isAtBottom()`，讓底部容差成為單一來源；移除 `harvest.js` 內重複定義的 `HARVEST_BOTTOM_TOLERANCE` 與冗餘的 `clientHeight` 讀取 |
| [4.22.1](changelog/v4.md#4221---2026-08-22) | 修正常數檔未掛載導致 `_getConst` 永遠落入 fallback 的問題：`temporary-chat-constants.js` 改以 `globalThis` 發布，待刪除佇列與刪除 API 的引用同步調整。另整理 Service Worker 結構 —— `performDeleteFetch` 移出至新的 `utils/deepseek-api.js` 集中管理、合併重複的 `onAlarm` 監聽器、補上 remediation guard 的終止條件說明 |
| [4.22.0](changelog/v4.md#4220---2026-08-22) | 新增 Service Worker 端的設定讀寫訊息路由與變更廣播機制，作為各消費端脫離 `chrome.storage` 直接存取的基礎：新增 `utils/settings-message-constants.js` 與 `background/settings-routes.js`（寫入成功後廣播至所有 DeepSeek 分頁），Service Worker 依 D8 規範改載入 `[DSS]` logger 並於頂層執行 `DSSSettingsRoutes.install()`，`manifest.json` 補上 `chat.deepseek.com` 的 `host_permissions` 並註冊設定訊息常數。測試端抽出 `popup-script-loader.js` 集中 eval 載入樣板，`popup-live-sync.spec.js` 改以虛擬時間推進取代真實等待，執行時間自約 5 秒降至約 1.5 秒（T3／T6） |
| [4.21.9](changelog/v4.md#4219---2026-08-22) | D7：logger 前綴由 `[DS-Sync]` 統一為 `[DSS]`，`chunk-lock`、`websearch-toggle`、`temporary-chat-pending-store` 中直接呼叫 `console` 的輸出改為統一走 logger，`ARCHITECTURE.md` 中仍引用舊前綴的說明同步更正。測試端：T1 —— 2,231 行的 `censor-reply-restore.spec.js` 依關注點拆為七個檔案並抽出共用 fixtures，內含 SseParser 區塊移入 `sse-parser.spec.js`，測試總數維持 137 個不變；另抽出 `load-classic-script.js`／`set-pathname.js`／`pending-store-mock.js` 取代九份 spec 的重複樣板，並移除 dead export 與兩份未被引用的失效 HTML fixture |
| [4.21.8](changelog/v4.md#4218---2026-08-22) | D2：`broadcastActivePreset()` 由僅送往作用中分頁改為查詢全部 `chat.deepseek.com` 分頁並以 `Promise.all` 併發送出 —— 無 `id` 的分頁跳過、個別分頁的 `sendMessage` 拒絕各自吞掉，單一分頁失敗不影響其餘分頁與呼叫端；全域掛載在無 `window` 的環境退回 `globalThis`。三份文件中仍描述「送達單一分頁」的說明同步更正，並補上多分頁契約測試 |
| [4.21.7](changelog/v4.md#4217---2026-08-22) | 拆分 `temporary-chat-delete`：追蹤、協調、事件處理三塊職責各自獨立成部件檔（`.tracking.js`／`.coordinator.js`／`.handlers.js`）並於 manifest 註冊，入口檔縮減為 219 行；`temporary-chat-toggle.js` 改用共用的 enabled flag 模組並修正過時的 `chrome.storage.session` 註解，enabled-flag 模組加入 `__setCache` 測試掛勾；測試改用共用 chrome mock、補上真實 `init` 測試並移除同義反覆與 split-brain 暫解 |
| [4.21.6](changelog/v4.md#4216---2026-08-22) | 抽出暫時對話啟用旗標的快取、讀取與 `onChanged` 監聽邏輯為共用模組 `content/temporary-chat-enabled-flag.js` 並於 `content_scripts` 註冊，以 22 個單元測試涵蓋其行為（紅綠驗證通過，含兩個後續消費端規格共 177 項測試全數通過） |
| [4.21.5](changelog/v4.md#4215---2026-08-22) | 修正三個功能模組的 `disable()` 未完整釋放資源：chat-width 與 input-width 於 `disable()` 中斷 `MutationObserver` 並清除 apply timer，移除只寫不讀的 `styleEl`、空的 `#STYLE_ID {}` CSS 規則與未使用的 `ChatWidth.applyWidth`，`destroy()` 改為 `disable()` 的別名；sidebar-auto-hide 改用每次 enable 週期一個 `AbortController` 綁定 hover 監聽並於 `disable()` 中止，避免反覆開關造成監聽堆疊，`disable()` 同時中斷兩個 observer 並清除 resize timer，body observer 改於 `enable()` 建立；auto-retry 修正註解中的常數名稱為 `RESIZE_DEBOUNCE_MS` |
| [4.21.4](changelog/v4.md#4214---2026-08-22) | 整併 go-top 觀察器並修正屬性變更風暴效能問題：移除 body `MutationObserver` 的 `attributes: true`，避免 React 頁面上每次屬性變更（含模組自身寫入的 `style.display`）都觸發回呼；刪除第二個 body subtree 路由觀察器，路由偵測併入既有 50ms debounce 觀察器並加上 `popstate` 監聽；移除只寫不讀的 `isInjected`。測試改以路由變更行為（`popstate` 重新注入、body mutation 重新注入、停用後不再注入）取代已失效的 `_routeObserver` 欄位斷言 |
| [4.21.3](changelog/v4.md#4213---2026-08-22) | 縮短提示詞組覆蓋層 settlement loop 的輪詢成本：收斂參數 `maxFrames` 7200、`stableK` 120 下調至 60 與 4，使掛載後的強制版面輪詢自「2 秒至 2 分鐘」縮短為 1 秒以內（典型約 83ms），收斂後交由 `ResizeObserver` 與 window resize 監聽器接手；新增 60 幀上限的斷言測試 |
| [4.21.2](changelog/v4.md#4212---2026-08-22) | 移除 `censor-xhr-hook.js` 中僅寫入而從未被讀取的 `pendingStates` Map —— 該死碼會持續累積 `XMLHttpRequest` 參照造成記憶體洩漏，移除後執行行為不變 |
| [4.21.1](changelog/v4.md#4211---2026-08-18) | 時間戳與提示詞組注入新增涵蓋純附件／圖片送出情境：此前輸入框為空即完全不注入，送純附件或圖片訊息時遺漏時間戳與提示詞組前綴。`injectPrefix(textarea, isSendableWithoutText)` 新增第二參數，輸入框空白但可送出時仍注入，輸出省略 `<user-input>` 包裹只保留時間戳與提示詞組前綴。「是否可送出」直接讀取 DeepSeek 送出按鈕本身狀態（`ds-button--disabled`／`aria-disabled`／`disabled` 屬性），新增 `isSendButtonEnabled()`／`findSendButtonForTextarea()` 等語言無關的結構判定，不採會輪替的雜湊 class。點擊路徑的 textarea 解析改為三層優先序：walk-up 找到的非空 textarea 優先，其次是原有的全域 `document.querySelector('textarea')` 備援（若非空），僅當兩者皆無非空 textarea 時才選取空 textarea（walk-up 找到者優先，否則用全域備援）；Enter 路徑接線同一組送出按鈕判定；`markChatCreationAttempt()` 同步涵蓋此情境。測試新增 7＋多案例，目標五份 spec 全綠 |
| [4.20.4](changelog/v4.md#4204---2026-08-17) | 連網搜索按鈕定位失敗的警告由「每次嘗試都吼」改為「單一放棄期限逾期才發一次」。使用者實測回報兩則 `failed to locate` 警告（一則來自 `start()`、一則來自 observer），但功能實際正常 —— `start()` 在 content script 注入時同步執行、React 工具列尚未掛載，而 observer 未過濾未 debounce，任何 `document.body` 變動都觸發一次嘗試，第三次觸發時工具列已在並成功套用。兩則皆為過期假警報，圖示前綴 `M7.9995999336` 與二層定位邏輯無誤、未改。改為 `LOCATE_GIVE_UP_MS`（15000）：`enable()` 未定位到時佈署期限，逾期而 `_isSpent` 仍 false 才發一次（訊息不變）；成功套用時於 `_isSpent` 轉 true 的同一同步分支 `clearTimeout`，`_armGiveUp()` 先取消再排程，`disable()` 與 `_rearm()` 無條件取消，三條路徑都不留懸掛計時器。假警報歸零，真故障仍有一次明確訊號。測試端四個直接 `findButton()` 案例改為「回傳 null 且不警告」，新增 7 案涵蓋三條路徑不即時警告、期限逾期恰好一次、以及重現使用者實際情境的零警告核心案例；該核心案例最初 flaky（三連跑第 3 次 `btn.click` 得 0 次），根因為 fake timer 下 `MutationObserver` microtask 回呼可能整個被丟棄，改為僅在等待送達那一步切回真實計時器，三條斷言全數保留未弱化，連續五次認證 42/42、全套件 2078 全綠 |
| [4.20.3](changelog/v4.md#4203---2026-08-17) | 修復診斷日誌靜默丟棄錯誤物件。`logWriteFailure` 以三個引數呼叫 `__DS_Logger.warn('pending-store:write-fail', context, error)`，但 `warn(event, data)` 只宣告兩個形參，第三個引數（真正的 `Error`）被 JavaScript 靜默丟棄，永遠到不了 `console.warn` —— 線上實測只吐出操作名稱、零錯誤內容，底層儲存失敗完全無法診斷。改為 `warn(event, ...rest)` 展開轉發，`rest` 為空時展開 `['']` 以維持原本不印字面 `undefined` 的行為；影響的 6 個呼叫點修在 logger 單一處即全數恢復。測試環境同步補洞：`vitest.setup.js` 原未預載 `utils/logger.js`，`logWriteFailure` 一律走變參的 fallback 分支，此缺陷結構上測不到；Group F 原僅斷言 `warnSpy` 被呼叫過，強化為斷言 `Error` 實例確實出現在引數中，並補上原本零覆蓋的 `removeOpenUuid` 失敗路徑。本次觸發成因為重載擴充後沿用舊分頁導致 content script 孤立（`chrome.storage` 全數拋錯），分頁重新整理後即消失，寫入邏輯本身未改 |
| [4.20.2](changelog/v4.md#4202---2026-08-17) | 修復編輯視窗點擊「送出」不再重新注入提示詞組（按 Enter 仍正常）。`isEditSendButton` 原以按鈕標籤文字是否等於字面字串 `发送` 辨識編輯視窗送出鈕，介面為繁體中文（實測標籤「傳送」）、英文等語言時必為 `false`，而 `isSendButton` 其餘條件（`M8.3125` 圖示前綴、`.ba4f09d3`、`.bf38813a`）皆屬主輸入框送出鈕的標記，於是處理器直接 `return`、點擊原樣通過；Enter 路徑只看 focus 中的 textarea、不檢視按鈕標記，故不受影響。改為具名判定式 `isEditWindowSendButton()`：同時帶 `ds-button--primary` 與 `ds-button--filled`（具名常數 `EDIT_SEND_BUTTON_VARIANT_CLASSES`）且含非空 `span.ds-button__content`。取消鈕為 outlined 變體，第一道守衛即排除；主輸入框送出鈕同為 primary／filled 但純圖示、無內容 span，落回既有主輸入框偵測分支。不採標籤文字、不採會輪替的雜湊類別、不採圖示幾何（此兩顆按鈕無 SVG）。此缺陷自該檔建檔（`42f6fcf`）起即存在，與 4.20.0／4.20.1 無關 —— 4.20.1 修的是同類病灶的另一處。測試端：TC-4／TC-5 原把 `发送` 字面比對當正確契約斷言，等於鎖住缺陷；TC-4 改為三語系 `it.each`，TC-5 的取消鈕 fixture 原只換標籤文字、結構與送出鈕相同（會過只因「取消 ≠ 发送」），改以真實 outlined 標記重建，13 tests 全綠 |
| [4.20.1](changelog/v4.md#4201---2026-08-17) | 修復連網搜索切換在非簡體中文介面靜默失效：按鈕定位不再依賴標籤文字，改為語言無關的二層定位器 —— 搜尋圖示 SVG `path[d]` 前綴（`SEARCH_ICON_PATH_PREFIX`）優先、切換群組位置回退，兩層失敗模式互斥；完全找不到時 `console.warn` 一次供診斷。泛用 `[aria-pressed]` 選擇器保留為圖示層候選來源。測試全面改為語言無關 fixture，35 tests 全綠 |
| [4.20.0](changelog/v4.md#4200---2026-08-16) | 全域提示詞開關由單一裝置設定改為每個提示詞組各自獨立的屬性：提示詞組 A 開啟、B 關閉時，切到 A 送出的訊息帶全域提示詞，切到 B 則不帶。旗標存於 `PromptPreset.globalPromptEnabled`，隨提示詞組跨裝置同步；欄位缺漏一律視為 `true`，故升級對既有使用者零行為變更。內容（`globalDefaultPrompt`）維持單一份共用字串 —— 逐組獨立的只有開關。裝置層級的同名鍵保留但降級為回退值，僅在無作用中提示詞組（空白選項、未綁定對話）時採用；解析規則集中於單一純函式 `resolveGlobalPromptEnabled()`，供彈出選單與 content script 共用。未新增 UI 元件，沿用既有 `#globalPromptToggle`。順帶修好兩個缺陷：SPA 導覽不觸發 `chrome.storage.onChanged`，故從綁定「開關關閉」提示詞組的對話切到未綁定對話後，全域提示詞會被靜默抑制到重開彈出選單為止 —— 改為 `handleChatChange()` 每條分支都重算，生效 id 交由既有 `resolveOverlayPresetId()` 解析而非另立平行實作；刪除提示詞組清空 `activePresetId` 後開關不重新渲染，改由零參數 ctx hook 補上。文案「全域預設提示詞」統一為「全域提示詞」，避免與 v4.18.0 的「預設提示詞組」（圖釘）混淆。測試端修掉一個真競態：`chrome-storage-mock` 的 `onChanged` 同步派送且不重播，而 `addListener` 位於未 `await` 的 bootstrap 末句，固定 tick 數 `flush()` 治不好，改以確定性完成訊號輪詢 |
| [4.19.1](changelog/v4.md#4191---2026-08-08) | 捲動步幅改為每一步實測後推導，取代固定視窗高 0.9 倍。實測兩場真實對話得知虛擬列表固定掛載 18 個節點（與訊息高度無關）、向上不延伸、向下延伸 3406～4244px —— 固定像素步幅因此是在賭訊息長度，短訊息區段會捲過從未掛載的內容且永久遺失。改為每輪量測「最低掛載節點底緣距容器可見頂的距離」、取 70% 為步幅（下限視窗高 25%，量不到退回 90%），訊息長的區段步幅自動放大到 3～4 個視窗、短的縮小；實測樣本上步幅由 889px 提升至 3620／3034px，約少 3.4～4.1 倍步數。已否決以 key 序列缺口作完整性證明（樣本一 distinctDiffs 為 [1,3]，洞自然存在）。`harvest.js` 拆出 `harvest.dom.js`（446 → 303 + 224 行），入口檔以原名重新導出每個移出的函式，58 個既有測試一行不改。測試覆蓋補上結構性盲點：既有 `scrollBy` mock 寫死 0.9 忽略實際引數，且 happy-dom 的 `getBoundingClientRect` 全回 0 導致所有測試只走退回路徑；現以實測幾何斷言精確步幅（3620／3034）並以紅燈銳度證明證實新斷言抓得住舊實作 |
| [4.19.0](changelog/v4.md#4190---2026-08-08) | 修好長對話 Markdown 匯出無故中斷、產出殘檔的缺陷，並新增匯出取消功能。刪除 `HARVEST_TOTAL_TIMEOUT`（120000 ms）硬性總時限 —— 該預算是被空等耗盡而非載入耗盡（每步的 DOM 穩定等待最短成本 3 × 150 ms = 450 ms，即使無新內容也照付），總可捲動距離因此被硬限制在約 240 個視窗高，與對話長度無關，故「匯出中斷」與「匯出過慢」是同一個病灶的兩面。改以連續 20 秒無進展（`HARVEST_STALL_TIMEOUT_MS`）為唯一時間型停止條件，只要仍在推進就永不中止；`scrollHeight` 任一方向的變動皆算進展，因虛擬列表會縮。純決策邏輯抽出為 `content/harvest.policy.js`（時鐘以 `nowMs` 注入、零 DOM），29 個測試不需 fixture 或 fake timer，同時解掉 `harvest.js` 逼近 450 行門檻的問題。頁尾警告改由 `describeIncompleteReason()` 據實回報成因（此前五種中斷原因全部寫死成 `timed out`）並附已擷取則數，另新增頁面上可見的警告 toast —— 此前警告僅存於檔尾，實測落在 12209 行檔案的第 12209 行，使用者體驗為「完全沒跡象」。新增以原生 `AbortController` 實作的取消按鈕，取消後仍匯出已擷取部分。`HARVEST_STABLE_INTERVAL` 150 → 100 ms（每步下限 450 → 300 ms），但 `HARVEST_STABLE_TICKS` 刻意維持 3：提早收斂會在內容渲染前捲過該段而永久漏訊息。順帶修掉一個既存缺陷：`manifest.json` 自 v4.18.1（`d288574`）起帶有 UTF-8 BOM，使 `content-script-global-collisions.spec.js` 的 `JSON.parse` 拋錯，該守門測試自此一直是紅的 |
| [4.18.2](changelog/v4.md#4182---2026-08-07) | 編輯視窗的提示詞組名稱輸入框改為只聚焦、不全選內容：移除 `popup/editor/editor.js` 中緊跟在 `focus()` 之後的 `nameInputEl.select()`，游標落在原名稱尾端，開窗後按鍵不再一次清掉整個舊名稱。`popup/popup.modal.js` 新增／命名 modal 的 `focus()` + `select()` 刻意保留（該處輸入框多為空值或需整體重填） |
| [4.18.1](changelog/v4.md#4181---2026-08-07) | 修好頁內提示詞選單三個缺陷。**進場展開跳動**：`mountTo()` 附加元素時尚未帶 inline `left`／`width`，首次 `reposition()` 落在下一個 animation frame，瀏覽器必然先畫一幀未定位幾何；這裡從來沒有 CSS transition，故抽出 `_applyPlacementSync()` 在 `appendChild` 同一個 task 內同步套用一次，settle 迴圈常數與幀數不動，刻意不用淡入遮蓋。**寬度卡在 200px**：量測只讀當前選中 label 的 `scrollWidth`、從不遍歷選項，一長就停在 `maxWidth` 上限；改以所有選項名稱加 placeholder 為候選集交給新純函式 `pickNaturalWidth()` 取最大值，該函式刻意不設上限（夾到可用空間仍屬 `computePlacement()`），並以實例快取避免 settle 迴圈逐幀 reflow。原生貼合是 `d560729` 換成自訂 combobox 時失去的。**頁面內切換到新對話不顯示釘選預設**：`findAndMount()` 的硬寫三元運算在無 chat id 時回傳字面 `''`，React 換掉標題列後確定性地蓋掉剛推入的值；決策抽成純函式 `resolveOverlayPresetId()`，pending id 改為三值（有效 id、`''` 代表明確選空白不回退、`null` 代表尚未選擇才套用預設），並把兩處 `id \|\| null` 改為 `??` —— `'' \|\| null` 為 `null` 正是明確選擇被預設蓋掉的原因。順帶依 §8 門檻拆出 `preset-viewport-sync.js` 與四個 `preset-dropdown.*` 模組 |
| [4.18.0](changelog/v4.md#4180---2026-08-07) | 下拉選單每列在 `✕` 左側新增圖釘按鈕，可把一組提示詞組釘為「預設」，開啟新對話時自動預選該組。預設以單一純量鍵 `pinnedPresetId` 儲存，故「同時只能有一組」是結構上的必然而非靠驗證；生效點設在 `handleChatChange()` 的無 UUID 分支，該分支只有網址不帶 chat id 時才進得去，因此「切換到既有對話一律不受影響」不需任何額外守衛。切換邏輯獨立為 `popup/popup.pin-manager.js`（`popup.js` 已超過 450 行門檻，只增加接線），刪除已釘選的組會一併清空預設，`pinnedPresetId` 亦納入設定備份的匯出與匯入。順帶修好列內按鈕以 `display` 切換造成圖釘在 hover 進出時位移、以及直接 hover 已亮起的圖釘會使高亮消失兩個缺陷 |
| [4.17.1](changelog/v4.md#4171---2026-08-06) | 修好在彈出選單改連網搜索設定時，已開啟的頁面毫無反應、必須重整才生效的缺陷：v4.17.0 的一次性模型只有「內容腳本啟動」一個套用時機，`_isSpent` 一旦用掉便永不重置，於是 `storage.onChanged` 更新了記憶體中的 `mode` 後，`_recompute()` 卻落進只停觀察器、不碰按鈕的 `disable()`。新增 `_rearm()`（依序 `disable()`、重置 `_isSpent`、`_recompute()`），`setupStorageListener` 兩個分支都改呼叫它，套用時機由一種擴為三種：進場、設定變更、主開關由關轉開。每種事件仍只套用一次後完全放手，一次性語意未被削弱；主開關由關轉開的路徑一併修好，行為與其他內容模組一致 |
| [4.17.0](changelog/v4.md#4170---2026-08-06) | 注入包裹標籤 `<system-prompt>` 改名為 `<system-reminder>`（`<user-input>` 內層標籤刻意不動，故編輯訊息的解除包裹 regex 無需修改）；連網搜索由三態強制改為二態一次性進場預設：`dsWebSearchToggle` 縮為 `'on'` \| `'off'`（預設 `'on'`，殘留的舊 `'default'` 於讀取時校正為 `'on'` 而不寫回），彈出選單移除「預設」選項與 `websearchDefaultLabel` i18n 鍵。`content/websearch-toggle.js` 以 `_isSpent` 旗標讓設定每次頁面載入只套用一次，套用後即中止觀察器；移除按鈕 `aria-pressed` 屬性觀察與 `CLICK_COOLDOWN_MS` 節流，使用者手動切換智能搜索的結果保留到離開或重整，不再被回點 |
| [4.16.4](changelog/v4.md#4164---2026-08-02) | 修復同步調和把非自有金鑰整包寫回，導致臨時對話開關重整後復活：`resolveSyncConflict()` 以 `{ ...localRaw, ...syncRaw }` 展開兩份完整未過濾快照後整包寫回，任何不屬於 `StorageManager.KEYS` 的金鑰都會搭便車，雲端殘留的舊 `true` 因而覆蓋使用者剛寫入本機的 `false` 並自我延續。改為以 `KEYS` 動態導出的 ownership 白名單（含 `dsPreset_` 前綴）重建 payload；刻意不刪除 sync 區既存的非自有金鑰，因為 `utils/i18n.js` 的語言設定同樣不屬於 `KEYS`，清除會誤刪使用者偏好 |
| [4.16.3](changelog/v4.md#4163---2026-08-02) | 修復臨時對話開關重整後自行變回開啟：現場探針證實關閉時確實寫入 `false`，重整後該鍵卻變成 `true`，即重整過程中發生了一次真實寫入；全倉唯一寫入路徑只有 checkbox 自身的 `change` 監聽器且無任何合成事件，判定為 Chromium 對動態注入表單控制項的狀態還原發出 `isTrusted` 的 `change` 事件被誤認為使用者操作，加上 `autocomplete="off"` 退出還原。同時修正 `writeEnabledFlag()` 的 `chrome.storage.local.set()` 為 fire-and-forget、外層同步 `try/catch` 抓不到 promise rejection 而靜默吞掉寫入失敗的缺陷 |
| [4.16.2](changelog/v4.md#4162---2026-08-02) | 連網搜索的標籤與三段式分段控制改為同排：以 `.input-group:has(> .websearch-options)` 結構選擇器將該群組覆寫為 flex row、右對齊垂直置中，同卡片其餘群組不受影響，未新增 class、`popup.html` 零改動 |
| [4.16.1](changelog/v4.md#4161---2026-08-02) | 彈出視窗視覺改版第二輪：核取方塊與單選鈕改為 `appearance: none` 自繪（方框／圓框、選取態為淡藍底配藍勾與藍點，皆補上 hover、焦點環與停用態），連網搜索三選項改為單一帶邊框的分段控制、內距與字級收緊，並還原第一輪誤刪的圖示按鈕細邊框。純 CSS，DOM 與 class 名稱未動 |
| [4.16.0](changelog/v4.md#4160---2026-08-02) | 彈出視窗視覺改版：新增 `popup/popup-theme.css` 作為唯一設計 token 來源（品牌藍 `#4d6bfe` 不變，另定義表面層、文字三階、邊框兩階、陰影三階、圓角與間距刻度），四支樣式表改為全 token 取色、零硬編碼色碼，並以 `@media (prefers-color-scheme: dark)` 覆寫同一組 token 首次支援深色模式（無手動切換、無 JS、無新 storage 鍵）。視覺上卡片改為 hairline 邊框加柔和陰影與較大圓角、標題層級收斂，控制項統一圓角與焦點環，下拉選中項改為淡藍底配藍字取代實心藍條。純樣式改版：未新增或重新命名任何選擇器，`popup.html` 僅多一行 `<link>` |
| [4.15.1](changelog/v4.md#4151---2026-08-01) | 修復臨時對話在另一分頁開啟新對話時被誤刪：開啟中對話護欄原以單一陣列鍵 `dss-open-temp-uuids` 儲存並在每次增刪時整份 read-modify-write，任一 context 讀到過期快照就會靜默算掉其他分頁的項目，該對話失去護欄後即被 Service Worker 補救掃描刪除（現場探針證實分頁 A 的項目已落地，數秒後被分頁 B 的寫回抹除）。改為每 UUID 一把獨立鍵（前綴 `dss-open-temp-uuid:`），新增只寫自己那把、移除只刪自己那把，此類遺失在結構上不再可能；舊陣列鍵轉為唯讀並於讀取時聯集去重，`clearOpenUuids()` 一併清除。連帶移除已無用途的 `withOpenUuidsLock` 及其 1000ms／5000ms 逾時不對稱造成的孤兒鎖隱患；`utils/storage-manager.chunk-lock.js` 的 TTL 鎖泛化為可指定鍵並保留原有薄包裝 |
| [4.15.0](changelog/v4.md#4150---2026-08-01) | 獨立編輯視窗新增 `Esc` 關閉快捷鍵：window 層級 `keydown` 監聽器偵測 `Escape` 呼叫 `window.close()`；關閉前既有 `pagehide` 自動儲存先寫入未存內容，快捷關閉不遺失資料 |
| [4.14.0](changelog/v4.md#4140---2026-08-01) | 提示詞組重新命名移至編輯視窗：移除下拉列內的鉛筆按鈕，改名改於獨立編輯視窗標題處自動聚焦的名稱輸入框進行，與內容共用同一條自動儲存管道（500ms 防抖 + blur/關窗 flush），重複名稱在儲存時被拒絕並於儲存狀態區顯示紅色錯誤。編輯視窗已開啟時再次點擊鉛筆會重新載入其分頁（`chrome.tabs.update`），使名稱輸入框每次都重新聚焦；`pagehide` 自動儲存保證無資料遺失。popup 下拉選單經由既有 live-sync 自動反映新名稱，popup 端零改動 |
| [4.13.0](changelog/v4.md#4130---2026-08-01) | 新增「連網搜索」三態設定：彈出選單「UI 調整」卡片新增單選群組（`預設` / `開啟` / `關閉`），儲存鍵 `dsWebSearchToggle`（字串，預設 `'default'`）。`開啟` 點擊頁面智能搜索按鈕使其保持 `aria-pressed="true"`，`關閉` 保持 `"false"`，`預設` 不干擾頁面；**只在狀態不符時點擊**（相符時點擊反而會切換掉狀態）。實作於 `content/websearch-toggle.js`（仿 `hide-thinking.js`：`chrome.storage.onChanged` + 單一 `MutationObserver` 雙目標，body childList/subtree 涵蓋 SPA 重渲染，按鈕 attributes 涵蓋原地翻轉；`CLICK_COOLDOWN_MS` 500ms 防點擊 ping-pong；受主開關連動）。元素辨識：實頁有兩個外觀相同的 `.ds-toggle-button[aria-pressed]`（深度思考與智能搜索），`querySelector` 會取到第一個，故以 label 文字含「搜索」者為準，不受順序影響，並保留通用 `[aria-pressed]` 備援 |
| [4.12.0](changelog/v4.md#4120---2026-08-01) | 新增「防止自動回滾」開關：原本僅在「回到頂部」與 Markdown 匯出期間短暫生效的防回滾保護，可由使用者設為常駐。常駐模式實作在共用節流點 `prevent-auto-scroll-bridge.js`（新增 `setPersistent()` / `isPersistent()` / `start()`，狀態存於既有隱藏 bridge 元素的 `dataset`），`harvest.js` 與 `go-top.scroll.js` 兩個呼叫端零改動；`disable()` 於常駐模式改為 no-op，否則該旗標無引用計數，`harvest.js` 在 `finally` 的無條件 `disable()` 會在每次匯出結束後靜默關掉使用者開啟的保護。受主開關連動，支援免重整即時切換。取捨：既有補丁為 `Element.prototype` 層級全域攔截且無法區分程式與使用者觸發，常駐時串流回覆的自動跟隨捲動一併被擋（原生滾輪不受影響），故預設關閉 |
| [4.11.19](changelog/v4.md#41119---2026-07-26) | 修復提示詞組排序在時間戳平手時被重排、拖曳結果下次開啟即消失：`mergePresets()` 原本僅在時間戳嚴格較新時採用對應側的 `order`，平手則退回合併 Map 的插入順序（本機已快取的組浮到最前面），使可見順序取決於哪些物件剛好快取在 local 而非已儲存的順序陣列；因 `_set()` 把同一物件鏡射進兩個儲存區，平手其實是常態。改為平手時採用雲端 `order`（唯一自我收斂的選擇）。同時修正 `STORAGE.md` 仍描述已於 v4.8.5 移除的 `#forceSyncBtn`、以及兩份文件仍稱 `dsLocalAuth` 影響讀取優先序（v4.7.2 已移除） |
| [4.11.18](changelog/v4.md#41118---2026-07-26) | 修復跨裝置同步的排序回滾與「已刪除提示詞組復活」：`retrySync()` 待推送迴圈對 `dsPresetOrderMeta` 與 `dsPresetTombstones` 無條件盲推（前者因 `startsWith('dsPreset_')` 的結尾底線而不匹配任何既有守衛），陳舊本機值蓋掉雲端較新值；排序中介資料補上與 `PRESET_INDEX` 一致的 `>=` 新舊比較，墓碑改為逐 id 聯集合併（重用既有 `_mergeTombstones()`），空的本機集合不再清空雲端 |
| 4.11.17 | 修復頂層識別字碰撞導致 go-top.js 整支失效、「回到頂部」按鈕消失：v4.11.13 引入共用選擇器模組後，`harvest.js` 與 `go-top.js` 各自在頂層宣告 `const __DSSelectors`，classic script 共用同一全域作用域使後載入者拋 `SyntaxError: Identifier '__DSSelectors' has already been declared`；改為各自唯一命名 `__DSSelectorsHarvest`／`__DSSelectorsGoTop`，並新增以 manifest content_scripts 清單為準的靜態守門測試（此類缺陷單元測試結構上抓不到——vitest 每檔獨立作用域） |
| 4.11.16 | 拆分 popup.js：編輯器視窗、寬度滑桿、Markdown 匯出各自獨立成方法包（popup.editor-window.js／popup.width-sliders.js／popup.markdown-export.js），popup.js 自 572 行降至 441 行清除 450 行門檻；以正則抽取原始碼的兩個 spec 僅改讀取路徑 |
| 4.11.15 | 拆分 content-script.js：提示詞注入獨立成 prompt-injector.controller.js，自 491 行降至 360 行；選擇抽注入側而非狀態側，是為不打斷 initSettings 的正則斷言 |
| 4.11.14 | 拆分 i18n.js：翻譯字典獨立成純資料檔 i18n.locales.js，引擎自 501 行降至 167 行；四個載入點（manifest、popup.html、editor.html、vitest.setup.js）皆須將資料檔排在引擎之前 |
| 4.11.13 | 集中重複的 DeepSeek 選擇器常數到 ds-selectors.js（掛載 `window.DSstudio.Selectors`），六處引用點改為共用常數、選擇器字串維持位元組相同；兩個 walk-up 函式邏輯原封不動 |
| 4.11.12 | 拆分 censor-reply-restore.dom.js：思考區塊 widget 獨立成 censor-reply-restore.thinkblock.js，自 489 行降至 396 行 |
| 4.11.11 | 消除 storage-manager.chatmap.js 的鍵差異套用重複邏輯：非鎖定快路徑與鎖定慢路徑重複的三步驟鍵差異套用抽成共用 helper `_applyChatPresetMapDiff`，自 456 行降至 425 行 |
| 4.11.10 | 拆分 popup.modal.js：Toast 元件獨立成 popup.toast.js（拆分理由是關注點分離而非行數門檻）；兩檔改以 Object.assign 各自掛載，不再相依於 script 標籤順序 |
| 4.11.9 | 拆分 harvest.js：進度提示 UI 獨立成 harvest.toast.js，harvest.js 自 502 行降至 426 行清除 450 行門檻；manifest 於 harvest.js 之前插入新檔確保載入順序 |
| [4.11.8](changelog/v4.md#4118---2026-07-26) | 「回到頂部」改為一次到頂：每輪輪詢由 `scrollBy(0, -0.9 * viewportHeight)` 逐格上捲改為直接寫入 `scrollTop = 0`，抵達時間不再與對話長度成正比（50 個視窗高的對話由約 5.9 秒降至瞬間）；收斂閘門與逾時、中止、`PreventAutoScroll` 協調全部保留，移除已無引用的 `SCROLL_STEP_FACTOR`，並首次明文記載「向上一次到頂、向下逐步前進」的刻意不對稱 |
| [4.11.7](changelog/v4.md#4117---2026-07-26) | 修復 Markdown 匯出靜默截斷：`_scrollToTopAndSettle()` 丟棄 `scrollToTopAndWait` 的回傳值，捲動到頂失敗（逾時或使用者中途按下「回到頂部」）時仍從當下位置開始擷取，輸出悄悄漏掉最舊訊息且無錯誤提示；改為傳回並檢查結果，失敗時原樣傳回 `reason` 並中止，teardown 沿用既有 `finally` |
| [4.11.6](changelog/v4.md#4116---2026-07-26) | 修復「回到頂部」上捲後彈回、始終到不了頂的缺陷：`scrollToTopAndWait()` 未與 `PreventAutoScroll` 協調，頁面自身的向下捲動不受抑制，導致收斂條件 `currentScrollTop <= 0` 恆偽、`_stableTopCount` 每輪歸零而空轉至 30 秒超時；改為在進入點保存啟用前狀態並於 `cleanup()` 還原，僅在本次呼叫為啟用者時才 `disable()`，以免踩掉 `harvest.js` 巢狀呼叫的保護 |
| [4.11.5](changelog/v4.md#4115---2026-07-26) | 修復 GoToTop 停用後的計時器殘留：`_onRouteChange()` 的 100 毫秒計時器未保存 handle，路由切換後 100 毫秒內停用會在停用後重新注入按鈕並重啟 observer 與 scroll 監聽器；新增 `_routeChangeTimer` 欄位、`_tryConnectDom()` 進入點守衛，並讓 `disable()` 真正呼叫 `_scrollReject` 以中止進行中的捲動 |
| [4.11.4](changelog/v4.md#4114---2026-07-26) | 稽核瘦身批次 D（原生 API 改寫）：quote-reply 樣式表改為靜態 CSS 檔、preset-dropdown 以原生 `scrollWidth` 取代手寫離屏量測探針；AbortController 與原生 `<dialog>` 兩案經審查否決（happy-dom 16.8.1 靜默忽略 `signal` 選項、`HTMLDialogElement` 為空殼） |
| [4.11.3](changelog/v4.md#4113---2026-07-26) | 稽核瘦身批次 C（結構合併）：utils/ 由 13 檔併為 10 檔；修復背景同步重試靜默失效（importScripts 從未載入 tombstones.js，`retrySync()` 路徑一律拋 `_mergeTombstones is not a function` 並被空 catch 吞掉）；新增 loader-contract 守門測試 |
| [4.11.2](changelog/v4.md#4112---2026-07-25) | 稽核瘦身批次 A2：移除兩條舊版遷移路徑（v1.2.x promptPrefix 遷移、OLD_PENDING_LOCAL_KEY，經使用者確認接受資料遺失）、清除全倉零呼叫者符號與 popup-utils.js 影子副本 |
| [4.11.1](changelog/v4.md#4111---2026-07-25) | 稽核瘦身批次 A1：全倉零引用死碼清除（export overlay、翻譯鍵、未用欄位與常數），行為零變更、1745 測試基準不變 |
| [4.11.0](changelog/v4.md#4110---2026-07-25) | 新增自動重試功能：DeepSeek 回應失敗顯示重試按鈕時，每 1000ms 自動代為點擊；僅受主開關控制，無獨立開關與 storage 鍵 |
| 4.10.5 | 修正臨時對話導向外部網址時未刪除的缺陷：beforeunload 抑制旗標被 same-URL SPA push 誤武裝且永不被消耗，跨來源導向時 keepalive 刪除遭抑制；改為僅由真正的整頁刷新（reload／鍵盤刷新）武裝旗標 |
| 4.10.4 | 臨時對話開關列改為跟隨總開關顯示與隱藏：新增 _masterEnabled 旗標與 __setMasterEnabled，storage.onChanged 監聽 IS_ENABLED 變更 |
| 4.10.3 | 修正編輯訊息後切換為「無提示詞組」仍注入舊提示詞組：`updatePromptPrefixFromBinding()` 在對話已有 currentChatUuid 時完全由 `chatPresetMap` 決定，不再退回殘留的 `pendingPresetId` |
| [4.10.2](changelog/v4.md#4102---2026-07-12) | 修正墓碑合併演算法：`clearPresetTombstones()` 刪鍵無時間戳可仲裁，導致清除永遠輸給陳舊的刪除記錄；墓碑條目形狀改為 `{ ts, deleted }`，清除改為寫入 `deleted:false` 而非刪鍵 |
| [4.10.1](changelog/v4.md#4101---2026-07-12) | 修正刪除全部提示詞組後再匯入 JSON 備份，於下次跨裝置同步時被舊墓碑再次刪除的缺陷；`restoreSettings()` 匯入後新增 `clearPresetTombstones()` 精準清除對應 ID 墓碑 |
| [4.10.0](changelog/v4.md#4100---2026-07-12) | 提示詞組列新增鉛筆/刪除 hover 提示並修正鉛筆圖示方向；新增「(無提示詞組)」列一鍵刪除全部提示詞組按鈕與確認對話框；`custom-select.js` 拆出 `preset-item-renderer.js` |
| [4.9.1](changelog/v4.md#491---2026-07-11) | 修正臨時對話「導向同一對話」誤刪：判定改以目的地 `/a/chat/s/{uuid}` 的 UUID 比對追蹤中對話（取代完整 URL 字串相等），導向同一對話但 query／hash 不同時不再誤刪；刷新與離開他頁行為不變 |
| [4.9.0](changelog/v4.md#490---2026-07-11) | 臨時對話刪除機制兩層化：content script 直接 `fetch(keepalive)` 即時刪除（移除不可靠的 SW IPC 中繼）、SW `onStartup` 補刪；待刪佇列改為 `chrome.storage.sync` 單一事實來源，支援跨裝置補刪；新增 Sync-Change Safeguard 與本機開啟中對話清單防誤刪；authToken 僅存本機永不同步 |
| [4.8.5](changelog/v4.md#485---2026-07-11) | **此版號出貨兩次**：`d75bb132`（2026-06-22）新增 MAIN world history 攔截機制（content/temporary-chat-history-hook.js，Navigation API 的備援導航偵測）並修正 init 競態條件；`60068776`（2026-07-11）移除彈出視窗手動同步按鈕簡化為純自動同步。v4.md 條目僅記錄第二次；第一次的內容於此列補記（細節見 git d75bb132） |
| [4.8.4](changelog/v4.md#484---2026-07-11) | 移除純診斷用日誌轉發子系統（logger.js sync 機制、孤兒除錯檔 diagnostic-sidebar-log.js、temp-chat 系列除錯 log），保留告警類 console.warn/error；不影響任何使用者可見功能 |
| [4.8.3](changelog/v4.md#483---2026-07-11) | 新增提示詞組刪除墓碑（Tombstone）機制，修復跨裝置同步時「已刪除提示詞組復活」的缺陷；同時修正 sync 勝出索引未落盤本機的缺口 |
| [4.8.2](changelog/v4.md#482---2026-07-11) | 8KB 負載守衛：`_set()` 逐鍵依 UTF-8 位元組大小拆分，超限鍵在 sync 呼叫前改寫 local 並登錄新鍵 `dsOversizedKeys`（自癒），不再進入 `dsLocalAuth` 無止境重試；`_byteLen()` 改以 TextEncoder 精確計數；`refreshSyncStatus()` 新增「內容過大，僅存本機」狀態 |
| [4.8.1](changelog/v4.md#481---2026-07-11) | debounce 對齊 500ms：編輯器自動儲存 600→500ms，chatWidth/inputWidth 滑桿 change 寫入改經 debounced 包裝，降低 chrome.storage 寫入壓力 |
| [4.8.0](changelog/v4.md#480---2026-07-11) | 新增 popup 即時同步（popup.live-sync.js）：popup 開啟期間監聽 chrome.storage.onChanged，跨裝置／跨分頁變更即時反映到 UI，不再需要關閉重開 |
| [4.7.4](changelog/v4.md#474---2026-07-11) | 修復 `_installChunkCacheInvalidator()` 拆分後閉包回歸：監聽器以裸 StorageManager 參照取代 this，多分頁情境下兩端監聽器共同改到同一共用實例的快取，輸家永遠讀到陳舊分塊；改為安裝時捕捉 `const self = this` |
| [4.7.2](changelog/v4.md#472---2026-07-11) | 移除 `_get()` 的 pin-on-read 覆寫：停駐在 dsLocalAuth 的鍵不再讓陳舊本機值永久遮蔽較新的雲端編輯；dsLocalAuth 語意收斂為純待重推佇列 |
| [4.7.1](changelog/v4.md#471---2026-07-11) | 新增 `StorageManager.syncNow()` 統一同步入口（popup 開啟與 content script 載入皆改呼叫）；修復 sync 較新值勝出後未寫回 local 的缺口 |
| [4.6.5](changelog/v4.md#465---2026-07-10) | 修復提示詞內容跨裝置同步失效並強化同步韌性 |
| [4.6.4](changelog/v4.md#464---2026-07-10) | 修復同步收斂時較新編輯遭較舊版本覆蓋 |
| [4.6.3](changelog/v4.md#463---2026-07-06) | 新增統一診斷記錄輸出至 Service Worker console |
| [4.6.2](changelog/v4.md#462---2026-06-28) | 修復跨裝置雲同步：提示詞組順序（dsPresetOrderMeta 時間戳）與內容（dsLocalAuth 精確 pinning）現可正確同步；初始化衝突偵測改為 auto/manual 分類；手動同步改為推+拉；chatmap 模組獨立拆分 |
| [4.6.1](changelog/v4.md#461---2026-06-21) | 修復行動版編輯訊息發送按鈕 textarea 解析順序 |
| [4.6.0](changelog/v4.md#460---2026-06-21) | 整合 React Fiber 原生對話刪除機制 |
| 4.5.5 | 修復臨時對話因導航時序造成的刪除競態：co-occurrence 達成時若已在對話頁面則立即追蹤 UUID，避免 SPA 導航事件先於 co-occurrence 完成而錯失追蹤 |
| 4.5.4 | 修復臨時對話三項缺陷：改用 chrome.storage.local（content script 無法存取 session storage）、補上 handleToggleChanged 同步 _enabledFlagCache、移除 navigate 事件的過早 tryInject 呼叫 |
| 4.5.3 | 加入除錯 log 追蹤臨時對話開關回首頁後變 OFF 的問題（追蹤 _enabledFlagCache 變化路徑，僅診斷無行為變更） |
| 4.5.2 | 修補臨時對話五項需求缺口：SW keepalive 刪除請求與 alarms 重試（最多 3 次、每 30 秒）、§3 跨分頁同步、§6 1000ms 雙 API 共現視窗、§9 導航刪除重試與 toast、§10 beforeunload 路由至 Service Worker |
| [4.5.1](changelog/v4.md#451---2026-06-18) | 修正「臨時對話」：僅刪除（呼叫 create API）新建的對話、歷史對話永不刪除；離開首頁移除開關、回首頁重注入；網址列輸入目前網址／重整不刪除；關閉開關仍刪除已標記對話 |
| [4.5.0](changelog/v4.md#450---2026-06-18) | 新增「臨時對話」功能：首頁開關控制，開啟時離開對話自動呼叫刪除 API（重新整理／導向當前網址不刪除），狀態存於 sessionStorage |
| 4.4.2 | 修復重新整理偵測：改用語意正確的 `navigationType === 'reload'`（取代 URL 相等比對）並移除 else，使鍵盤快捷鍵監聽（F5/Ctrl+R/Cmd+R）與 Navigation API 並行生效 |
| 4.4.1 | POC：補上離開網站時的刪除觸發（beforeunload + fetch keepalive），並以 Navigation API 偵測重新整理（同 URL 導航）避免誤刪 |
| 4.4.0 | POC：擷取授權 Token（XHR hook 攔截 authorization header，postMessage 傳遞）並於離開聊天時呼叫刪除 API |
| 4.3.8 | 修復 originalWidth 被錯誤捕捉為收合寬度導致側欄展開時無法推開同層元素：storeOriginalWidth() 雙重防護（收合狀態跳過、寬度 ≤60px 不覆寫），expand() 無效 originalWidth 安全網 |
| 4.3.7 | 修復 sidebar-auto-hide 在 Edge 瀏覽器上的溢位裁切：applyOverflow() 僅在側欄收合狀態才套用 overflow:hidden，避免展開過渡期間重新裁切 |
| 4.3.6 | 修復三個回歸錯誤：editor.html 缺 i18n.js script 標籤（dsI18n ReferenceError）、broadcastActivePreset 視窗查詢範圍、pendingPresetId 條件過嚴、編輯發送按鈕 textarea 遍歷 fallback（React portal） |
| 4.3.5 | 修正語系切換時下拉選單「無」選項未即時更新（updateLocale() 使用錯誤的 DOM selector） |
| 4.3.4 | 補上 4.3.3 遺漏的版本升版（覆蓋 7b3c245 的 optionData 同步修復：下拉選單「無」即時切換時同步更新 optionData 陣列） |
| 4.3.3 | 實現即時語系切換：i18n 核心加入 chrome.storage.onChanged 監聽、preset 下拉選單新增 updateLocale() 公開方法、quote-reply 按鈕與 overlay controller 即時反應語系變更 |
| 4.3.2 | 實作完整 i18n 國際化系統：中英文翻譯資料（_locales/messages.json）、語言切換機制、popup 與 content script 全面導入 `dsI18n.t()` 查詢、manifest 加入 default_locale 與 __MSG_*。**註記**：此版號曾於 commit `0d357e8` 意外倒退回 4.3.1（該 commit 訊息未提及版號變更），下一 commit `34c68fd` 補回 i18n 註冊並恢復 4.3.2 |
| 4.3.1 | 重構文件結構：精簡 README、新增 FEATURES.md、校正 ARCHITECTURE.md 檔案樹與跨文件參照（ARIA 章節移至 content-navigation.md 等）。**註記**：此版號出貨兩次——`16f2e80c`（文件重構）與 `0d357e8`（manifest 自 4.3.2 意外倒回） |
| [4.3.0](changelog/v4.md#430---2026-06-14) | 系統時間注入新增時區偏移顯示 — 格式從 `yyyy/mm/dd hh:mm:ss` 改為 `yyyy/mm/dd hh:mm:ss (UTC±hh:mm)` |
| 4.2.4 | 移除 Overlay settle 收斂除錯日誌（settle loop onDone 回呼中的 console.log） |
| [4.2.3](changelog/v4.md#423---2026-06-14) | 清除全部 [DSS-DIAG] 診斷 log；修復 preset-settle.scheduler.js onLog→onDone API 不匹配（導致 runSettle() 在守衛子句拋錯、下拉選單空白）並補 API 契約回歸測試 |
| [4.2.2](changelog/v4.md#422---2026-06-14) | 修復行動版 overlay 位置競態：新增有界 settle 重試迴圈（preset-settle.scheduler.js）逐幀量測新對話按鈕 left 直到連續 K 幀穩定，解決頁面載入時按鈕位置位移不被 ResizeObserver 偵測的問題 |
| [4.2.1](changelog/v4.md#421---2026-06-14) | 修復下拉選單位置計算子像素抖動問題並強化冪等性（Math.round + 捨去尾數重複） |
| [4.2.0](changelog/v4.md#420---2026-06-14) | 重構預設集覆蓋層：拆分大型模組為職責單一的小型檔案（controller、resolvers、position、styles、component） |
| [4.1.0](changelog/v4.md#410---2026-06-13) | 新增行動版首頁清理模組 v4.1.0 |
| [4.0.0](changelog/v4.md#400---2026-06-13) | 大型檔案模組化重構：storage-manager、go-top、censor-reply-restore、content-script、popup 拆分為單一職責模組；行為不變、985 測試全綠 |

### v3.x — 編輯器與架構精煉

| 版本 | 摘要 |
|-|-|
| [3.4.0](changelog/v3.md#340---2026-06-13) | 點擊編輯後自動捲動，使編輯框視覺對齊固定 header 下方 16px |
| [3.3.0](changelog/v3.md#330---2026-06-13) | 編輯區 max-height 改為 `.cc852ac5` 移除、`._646a522` 動態計算；移除診斷日誌 |
| [3.2.3](changelog/v3.md#323---2026-06-13) | 修正編輯清理誤抓主輸入框；改為偵測點擊後新出現的編輯框 |
| [3.2.2](changelog/v3.md#322---2026-06-13) | 編輯清理診斷版（新增 `[DV:EditCleanup]` 日誌） |
| [3.2.1](changelog/v3.md#321---2026-06-13) | 編輯訊息時自動移除注入包裹、只保留 `<user-input>` 原文並展開編輯區 |
| [3.2.0](changelog/v3.md#320---2026-06-09) | 新增行動裝置側邊欄向右滑動手勢（中央 80% 觸發區域） |
| [3.1.3](changelog/v3.md#313---2026-06-08) | 清空全擴充功能除錯日誌與死碼 |
| [3.1.2](changelog/v3.md#312---2026-06-08) | GoToTop SPA 路由切換後立即重試注入修正 |
| [3.1.1](changelog/v3.md#311---2026-06-08) | 內部診斷版 — 新增路由切換除錯日誌 |
| [3.1.0](changelog/v3.md#310---2026-06-08) | GoToTop 初始注入競爭條件修正；捲動現為可點擊切換 |
| [3.0.0](changelog/v3.md#300---2026-06-07) | 獨立提示詞編輯視窗、全域提示詞開關、Popup 重構 |

### v2.x — 穩定性強化與功能擴充

| 版本 | 摘要 |
|-|-|
| [2.9.0](changelog/v2.md#290---2026-06-07) | CensorRestore 擴展至攔截 edit_message API |
| [2.8.12](changelog/v2.md#2812---2026-06-07) | 修正 CensorRestore 同對話 pending-queue 錯位 |
| [2.8.11](changelog/v2.md#2811---2026-06-07) | 修正 CensorRestore SPA 跨對話狀態污染 |
| [2.8.10](changelog/v2.md#2810---2026-06-07) | 修正頁面重整後 CensorRestore 不觸發 |
| [2.8.9](changelog/v2.md#289---2026-06-07) | 修正 ds-button 重設計後 CensorRestore 失效 |
| [2.8.8](changelog/v2.md#288---2026-06-06) | 修正 GoToTop `_getNativeButton` 誤選按鈕 |
| [2.8.7](changelog/v2.md#287---2026-06-06) | GoToTop 適配 DeepSeek ds-button 新設計系統 |
| [2.8.6](changelog/v2.md#286---2026-06-06) | GoToTop 邊框遺失與模式切換閃爍修正 |
| [2.8.5](changelog/v2.md#285---2026-06-06) | GoToTop 新增 solo 模式、修正形狀與重疊問題 |
| [2.8.2](changelog/v2.md#282---2026-06-02) | 移除所有 Playwright 整合測試 |
| [2.7.3](changelog/v2.md#273---2026-06-02) | 修正行動版發送按鈕注入 |
| [2.7.2](changelog/v2.md#272---2026-06-01) | 修正側邊欄下拉選單偵測（`el.closest`） |
| [2.7.1](changelog/v2.md#271---2026-06-01) | 修正隱藏思考過程折疊邏輯 |
| [2.7.0](changelog/v2.md#270---2026-05-31) | 新增系統時間注入功能 |
| [2.6.2](changelog/v2.md#262---2026-05-29) | 匯出 Toast 兩階段文字；修正捲動中斷偵測 |
| [2.6.1](changelog/v2.md#261---2026-05-29) | 防自動捲動補丁；scroll_interrupted 安全網 |
| [2.6.0](changelog/v2.md#260---2026-05-29) | 捲動擷取完整 Markdown 匯出 |
| [2.5.23](changelog/v2.md#2523---2026-05-29) | GoToTop 按鈕初版 |
| [2.5.15](changelog/v2.md#2515---2026-05-28) | 修正 resolveSyncConflict 意外包含 restored_messages |
| [2.5.14](changelog/v2.md#2514---2026-05-28) | 修正初始化推送時同步配額崩潰 |
| [2.5.13](changelog/v2.md#2513---2026-05-28) | 修正 visibilitychange 未處理 promise 異常 |
| [2.5.12](changelog/v2.md#2512---2026-05-28) | 修正 getSettings 取回 restored_messages 導致崩潰 |
| [2.5.11](changelog/v2.md#2511---2026-05-28) | 修正頁面重整後審查回覆比對 |
| [2.5.0](changelog/v2.md#250---2026-05-27) | 跨 context 並發控制（Method C 鎖 + Method D CAS） |
| [2.4.1](changelog/v2.md#241---2026-05-27) | 修正 version 未遞增；bind insert 讀取最佳化 |
| [2.4.0](changelog/v2.md#240---2026-05-27) | ChatPresetMap 分塊儲存（突破 8KB 同步配額） |
| [2.3.0](changelog/v2.md#230---2026-05-26) | ChatPresetMap 寫入佇列（消除同 context 競爭） |
| [2.1.1](changelog/v2.md#211---2026-05-24) | 修正滑桿容器間距 |
| [2.1.0](changelog/v2.md#210---2026-05-24) | 新增隱藏思考過程功能 |
| [2.0.0](changelog/v2.md#200---2026-05-23) | 同步寫入配額修正；雲端同步狀態指示器 |

### v1.x — 初版功能建立

| 版本 | 摘要 |
|-|-|
| [1.10.1](changelog/v1.md#1101---2026-05-23) | 修正引用回覆多行選取定位 |
| [1.10.0](changelog/v1.md#1100---2026-05-22) | 新增引用回覆功能 |
| [1.9.0](changelog/v1.md#190---2026-05-20) | 自訂下拉選單（搜尋、inline 按鈕、指標事件拖曳排序） |
| [1.8.2](changelog/v1.md#182---2026-05-15) | 優雅處理 extension context 失效 |
| [1.8.1](changelog/v1.md#181---2026-05-15) | 修正 Overlay 對話綁定顯示 |
| [1.8.0](changelog/v1.md#180---2026-05-14) | 新增頁面內 Overlay 提示詞組切換 |
| [1.7.2](changelog/v1.md#172---2026-05-14) | 修正對話切換後 UUID 綁定遺失 |
| [1.7.1](changelog/v1.md#171---2026-05-14) | 修正過期提示詞前綴；修正側邊欄下拉收合邏輯 |
| [1.7.0](changelog/v1.md#170---2026-05-13) | 提示詞個別儲存鍵；Plan A 本地端權威追蹤 |
| [1.6.6](changelog/v1.md#166---2026-05-12) | 修正新分頁跨對話提示詞繼承；修正非預期自動綁定 |
| [1.6.4](changelog/v1.md#164---2026-05-12) | Popup 雙欄版面 |
| [1.6.3](changelog/v1.md#163---2026-05-12) | 允許刪除全部自訂提示詞組 |
| [1.6.2](changelog/v1.md#162---2026-05-12) | 修正 Modal 訊息換行 |
| [1.6.1](changelog/v1.md#161---2026-05-11) | 同步衝突偵測與解決 |
| [1.6.0](changelog/v1.md#160---2026-05-11) | chrome.storage.sync；JSON 匯出與匯入 |
| [1.5.5](changelog/v1.md#155---2026-05-11) | 修正新對話過期選取 |
| [1.5.4](changelog/v1.md#154---2026-05-10) | 修正重新開啟後選取清除 |
| [1.5.3](changelog/v1.md#153---2026-05-10) | 修正新對話首次發送注入 |
| [1.5.2](changelog/v1.md#152---2026-05-07) | 修正側邊欄下拉懸停偵測 |
| [1.5.1](changelog/v1.md#151---2026-05-07) | Popup 多項 UI 修正；修正跨分頁污染 |
| [1.5.0](changelog/v1.md#150---2026-05-07) | 側邊欄自動隱藏；對話與輸入框寬度調整 |
| [1.4.6](changelog/v1.md#146---2026-05-06) | 匯出失敗 Toast 通知 |
| [1.4.5](changelog/v1.md#145---2026-05-06) | 空白選項永久可見 |
| [1.4.4](changelog/v1.md#144---2026-05-06) | 程式碼區塊匯出修正 |
| [1.4.3](changelog/v1.md#143---2026-05-06) | 刪除後退回空白選項狀態 |
| [1.4.2](changelog/v1.md#142---2026-05-06) | 修正新增提示詞組後下拉選單未更新 |
| [1.4.1](changelog/v1.md#141---2026-05-06) | 修正新對話過期提示詞洩漏 |
| [1.4.0](changelog/v1.md#140---2026-05-05) | 全域預設提示詞；UUID 對話綁定；SPA 導航偵測 |
| [1.3.0](changelog/v1.md#130---2026-05-05) | 多組提示詞管理；自訂 Modal 系統 |
| [1.2.0](changelog/v1.md#120---2026-05-04) | 移除注入自動分隔線 |
| [1.1.1](changelog/v1.md#111---2026-05-03) | 標題（H1–H6）與表格 Markdown 匯出支援 |
| [1.1.0](changelog/v1.md#110---2026-05-03) | Markdown 匯出引擎重構 |
| [1.0.0](changelog/v1.md#100) | 初版：Markdown 匯出、基礎架構 |

### 詳細變更記錄

| 版本系列 | 文件 |
|-|-|
| v4.x 詳細變更 | [→ changelog/v4.md](changelog/v4.md) |
| v3.x 詳細變更 | [→ changelog/v3.md](changelog/v3.md) |
| v2.x 詳細變更 | [→ changelog/v2.md](changelog/v2.md) |
| v1.x 詳細變更 | [→ changelog/v1.md](changelog/v1.md) |
