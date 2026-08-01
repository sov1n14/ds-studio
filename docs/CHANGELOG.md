# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 版本摘要

### v4.x — 模組化架構重構

| 版本 | 摘要 |
|-|-|
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
