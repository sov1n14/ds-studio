# DS studio 需求規格書

## 專案概述

DS studio 是一個 Chrome 擴充功能，旨在優化 `chat.deepseek.com` 的使用體驗。使用者可以建立與管理**多組提示詞組**，針對不同場景自動將選取的提示詞注入訊息中，並提供一鍵將對話匯出為 Markdown 檔案的功能。此外還包含 UI 調整（側邊欄自動隱藏、對話區域寬度、輸入框寬度）、JSON 備份還原，以及跨裝置雲端同步與衝突解決機制。

## 功能模組索引

| 模組 | 涵蓋功能 | 規格文件 |
|-|-|-|
| **提示詞系統** | 提示詞組管理、注入邏輯、UUID 對話綁定、全域預設提示詞、空白選項模式 | [→ spec/01-prompt-system.md](spec/01-prompt-system.md) |
| **Popup UI 與 Overlay** | 擴充功能彈出選單版面、頁面內提示詞組切換選單 | [→ spec/02-popup-ui.md](spec/02-popup-ui.md) |
| **UI 調整** | 側邊欄自動隱藏、對話與輸入框寬度調整、隱藏思考過程、回到頂部按鈕、行動裝置側欄滑動手勢 | [→ spec/03-ui-adjustments.md](spec/03-ui-adjustments.md) |
| **匯出與互動功能** | Markdown 匯出、引用回覆、系統時間注入、恢復被審查的回覆 | [→ spec/04-features.md](spec/04-features.md) |
| **資料儲存與同步** | 資料遷移、Toast 通知、JSON 備份與還原、雲端同步與衝突處理、技術規格 | [→ spec/05-data-storage.md](spec/05-data-storage.md) |

## 相關文件

- 📐 技術架構：[ARCHITECTURE.md](ARCHITECTURE.md)
- 📝 版本記錄：[CHANGELOG.md](CHANGELOG.md)
- 🗂️ DOM 參考樣本：[../samples/](../samples/)
