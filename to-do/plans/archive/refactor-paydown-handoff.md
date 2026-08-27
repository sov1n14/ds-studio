# 技術債償還交接文件（refactor/debt-registry-paydown）

> **狀態：已歸檔。** 本分支全部工作已完成，manifest 版本 `4.31.29`。詳細結案摘要見 [refactor-debt-remaining.md](refactor-debt-remaining.md)。

| 項目 | 值 |
|-|-|
| 建立日期 | 2026-08-25（來源：`Get-Date -Format 'yyyy-MM-dd'`） |
| Repo | `C:\Users\K\VScode\ds-studio` |
| 分支 | `refactor/debt-registry-paydown`（自 `main` 切出，保持本機狀態） |
| `manifest.json` 版本 | `4.31.29` |
| 測試基準 | `npm test`（於 `C:\Users\K\VScode\ds-studio\test` 執行）：149 檔 / 2503 tests，全綠，exit 0 |

**任務起源**：使用者要求依 `to-do/refactor-debt-registry.md` 逐項償還，並加上新一輪稽核找到的額外技術債；在分支上進行，每段完成即提交，保持本機。

新的工作階段請依專案 `CLAUDE.md` 的 orchestrator 規則進行：所有技術工作委派 subagent，logic layer 走 red-green 流程，認證一律交給 `test-executor`。

---

## 一、當前工作樹狀態

全部工作已完成。`manifest.json` 版本 `4.31.29`，工作區乾淨。段 L 檔案拆分（18 完成 / 7 跳過 / 1 提前完成）、文件同步（10 處過時引用修正 + changelog 補寫至 v4.31.29）、登記簿更新（6 結案 + 2 查證為假 + 3 新增 when-touched 已解決 + 7 原有 when-touched 已處置）皆已結案。

---

## 二、剩餘工作

全部剩餘工作已完成，無待辦項目。各項結案詳情見 [refactor-debt-remaining.md](refactor-debt-remaining.md)。

---

## 三、作業守則（本輪實地取得的教訓）

- `manifest.json` 的版本號是所有 code 段的序列化瓶頸，同時只能有一個 agent 碰它。實際做法：實作 agent 一律不碰版本號，提交前另派一個 agent 單獨遞增。
- 有 in-flight production 編輯時不跑認證。本輪曾因段 C 的 `git mv` 進行到一半，導致段 E 的認證整支 spec 收集失敗。
- 每次認證都用 `test-executor`；實作 agent 或 `test-engineer` 自行執行的結果不採信。
- 移除任何「fallback 字面值」前先預期它可能正在遮蓋 spec 的缺失安排。本輪有兩次移除後 spec 才轉紅，暴露出 spec 從未提供該常數全域。
- 改寫斷言時要求 agent 以 arrangement 層的刻意破壞證明新斷言確實會紅，避免寫出恆真斷言。

---

## 四、已完成歷史（20 個提交，由舊至新）

```
9452aea # 移除 prompt-injector 重複的行動裝置判定實作（v4.31.2）
db30f1b # chat-session-id 上移 utils/ 並消除 popup 的重複 regex（v4.31.3）
f276f6b # 臨時對話啟用旗標寫入被拒時回滾快取（v4.31.4）
a7fe633 # 測試改讀 production 常數與正常載入，移除手抄值與 regex 抽取
e7a4ddd # popup.markdown-export 補上載入順序 fail-fast 守衛（v4.31.5）
34cb3bd # DeepSeek 選擇器全數歸位 ds-selectors.js 並清除死 export（v4.31.6）
6227e78 # alarm 名稱抽為 background 常數檔，測試改讀 production 常數（v4.31.7）
089817a # 移除六份 _getConst 複製與其不可達的硬編碼 fallback（v4.31.8）
421b09f # 移除最後兩份 _getConst 並補齊測試側常數載入（v4.31.9）
25e1ab6 # 三個 message type 改用具名常數，MAIN world 生產端加註釘住值（v4.31.10）
1053be2 # DSS_SETTINGS_MSG 讀取統一為單一 accessor 並抽出 clampPercent（v4.31.11）
dd0997f # pending-store 移出 content 層並清除死 fallback（v4.31.12）
04a64f3 # popup.live-sync 改由 StorageManager 訂閱設定變更（v4.31.13）
8a9349d # editor window URL 解析改由 utils/window-control 提供（v4.31.14）
06b9337 # censor-reply-restore.markdown 移除檔內重複的 HTML 轉義實作（v4.31.15）
e9b5301 # 刪除 utils/messaging.js 並將 broadcastActivePreset 併入 tab-control（v4.31.16）
daada4f # 移除只為測試存在的 export 別名（v4.31.17）
58bde3a # go-top 測試改以可觀察 DOM 狀態取代自窺斷言
b548c0b # 清除 61 個檔案中共 85 處不可達的 globalThis 相容守衛（v4.31.18）
560796a # 布林識別字補上 is／has／can 前綴
```

### 段 M — 布林命名合規（`560796a`）

中立認證結果為 149 檔 / 2503 tests 全綠、exit 0。此段屬純改名，依 `version-bump` skill 為免 bump 項目，故提交不帶版本號，`manifest.json` 維持 `4.31.18`。

十個布林識別字加上 `is`／`has`／`can` 前綴，散落於以下檔案：

- `background/service-worker.js`
- `content/censor-reply-restore.dom.js`
- `content/censor-reply-restore.storage.js`
- `content/go-top.scroll.js`
- `content/preset-overlay.controller.js`
- `content/preset-viewport-sync.js`
- `content/temporary-chat-delete.coordinator.js`
- `popup/popup.modal.js`
- `utils/storage-manager.chatmap.js`
- `utils/storage-manager.sync.js`

| 原名 | 新名 |
|-|-|
| `matchedAny` | `hasMatchedAny` |
| `didMigrate` | `hasMigrated` |
| `aborted` | `isAborted` |
| `rafPending` | `isRafPending` |
| `fallbackTriggered` | `hasFallbackTriggered` |
| `placed` | `isPlaced` |
| `shouldPush` | `canPush` |
| `settled` | `isSettled` |
| `_remediationInFlight` | `isRemediationInFlight` |
| `_localeListenerAttached` | `_isLocaleListenerAttached` |

另有四個布林刻意維持原名：`_storedRecordsApplied`、`_locked`、`state.completionDetected` 由 spec 直接讀取，`showSystemTime` 對應 `StorageManager.KEYS.SHOW_SYSTEM_TIME` 與設定同步 payload；四者列於 [refactor-debt-remaining.md](refactor-debt-remaining.md#新增-when-touched-債3-項-全部已完成) 的 when-touched 債（已完成）。
