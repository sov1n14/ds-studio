# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 版本摘要

### v4.x — 模組化架構重構

| 版本 | 摘要 |
|-|-|
| [4.11.0](changelog/v4.md#4110---2026-07-16) | 新增完整對話歷史面板：直接讀取頁面本機 IndexedDB（`deepseek-chat`／`history-message`）取出完整對話，繞過 DeepSeek 虛擬列表無法捲到頂的缺陷；支援跳到最舊、全文搜尋、匯出 Markdown；入口按鈕堆疊於回到頂部上方並新增 popup 開關（`historyPanelEnabled`，預設啟用） |
| [4.10.2](changelog/v4.md#4102---2026-07-12) | 修正墓碑合併演算法：`clearPresetTombstones()` 刪鍵無時間戳可仲裁，導致清除永遠輸給陳舊的刪除記錄；墓碑條目形狀改為 `{ ts, deleted }`，清除改為寫入 `deleted:false` 而非刪鍵 |
| [4.10.1](changelog/v4.md#4101---2026-07-12) | 修正刪除全部提示詞組後再匯入 JSON 備份，於下次跨裝置同步時被舊墓碑再次刪除的缺陷；`restoreSettings()` 匯入後新增 `clearPresetTombstones()` 精準清除對應 ID 墓碑 |
| [4.10.0](changelog/v4.md#4100---2026-07-12) | 提示詞組列新增鉛筆/刪除 hover 提示並修正鉛筆圖示方向；新增「(無提示詞組)」列一鍵刪除全部提示詞組按鈕與確認對話框；`custom-select.js` 拆出 `preset-item-renderer.js` |
| [4.9.1](changelog/v4.md#491---2026-07-11) | 修正臨時對話「導向同一對話」誤刪：判定改以目的地 `/a/chat/s/{uuid}` 的 UUID 比對追蹤中對話（取代完整 URL 字串相等），導向同一對話但 query／hash 不同時不再誤刪；刷新與離開他頁行為不變 |
| [4.9.0](changelog/v4.md#490---2026-07-11) | 臨時對話刪除機制兩層化：content script 直接 `fetch(keepalive)` 即時刪除（移除不可靠的 SW IPC 中繼）、SW `onStartup` 補刪；待刪佇列改為 `chrome.storage.sync` 單一事實來源，支援跨裝置補刪；新增 Sync-Change Safeguard 與本機開啟中對話清單防誤刪；authToken 僅存本機永不同步 |
| [4.8.4](changelog/v4.md#484---2026-07-11) | 移除純診斷用日誌轉發子系統（logger.js sync 機制、孤兒除錯檔 diagnostic-sidebar-log.js、temp-chat 系列除錯 log），保留告警類 console.warn/error；不影響任何使用者可見功能 |
| [4.8.5](changelog/v4.md#485---2026-07-11) | 移除彈出視窗手動同步按鈕，簡化為純自動同步 |
| [4.8.3](changelog/v4.md#483---2026-07-11) | 新增提示詞組刪除墓碑（Tombstone）機制，修復跨裝置同步時「已刪除提示詞組復活」的缺陷；同時修正 sync 勝出索引未落盤本機的缺口 |
| [4.6.2](changelog/v4.md#462---2026-06-28) | 修復跨裝置雲同步：提示詞組順序（dsPresetOrderMeta 時間戳）與內容（dsLocalAuth 精確 pinning）現可正確同步；初始化衝突偵測改為 auto/manual 分類；手動同步改為推+拉；chatmap 模組獨立拆分 |
| [4.6.3](changelog/v4.md#463---2026-06-28) | 新增統一診斷記錄輸出至 Service Worker console |
| [4.6.4](changelog/v4.md#464---2026-06-29) | 修復同步收斂時較新編輯遭較舊版本覆蓋 |
| [4.6.5](changelog/v4.md#465---2026-06-30) | 修復提示詞內容跨裝置同步失效並強化同步韌性 |
| [4.6.1](changelog/v4.md#461---2026-06-22) | 修復行動版編輯訊息發送按鈕 textarea 解析順序 |
| [4.6.0](changelog/v4.md#460---2026-06-20) | 整合 React Fiber 原生對話刪除機制 |
| [4.5.1](changelog/v4.md#451---2026-06-18) | 修正「臨時對話」：僅刪除（呼叫 create API）新建的對話、歷史對話永不刪除；離開首頁移除開關、回首頁重注入；網址列輸入目前網址／重整不刪除；關閉開關仍刪除已標記對話 |
| [4.5.0](changelog/v4.md#450---2026-06-18) | 新增「臨時對話」功能：首頁開關控制，開啟時離開對話自動呼叫刪除 API（重新整理／導向當前網址不刪除），狀態存於 sessionStorage |
| [4.3.0](changelog/v4.md#430---2026-06-14) | 系統時間注入新增時區偏移顯示 — 格式從 `yyyy/mm/dd hh:mm:ss` 改為 `yyyy/mm/dd hh:mm:ss (UTC±hh:mm)` |
| [4.2.1](changelog/v4.md#421---2026-06-14) | 修復下拉選單位置計算子像素抖動問題並強化冪等性（Math.round + 捨去尾數重複） |
| [4.2.0](changelog/v4.md#420---2026-06-14) | 重構預設集覆蓋層：拆分大型模組為職責單一的小型檔案（controller、resolvers、position、styles、component） |
| [4.1.0](changelog/v4.md#410---2026-06-14) | 新增行動版首頁清理模組 v4.1.0 |
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
