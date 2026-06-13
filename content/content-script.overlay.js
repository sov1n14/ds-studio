/**
 * DS studio — PresetOverlay 模組
 * 封裝 preset 覆蓋層的建立、掛載、渲染與事件處理。
 * 使用 factory 模式接收 ctx 上下文物件，保持與 content-script.js 的共享狀態同步。
 * 此檔案以 classic script 載入，無 ES import/export，必須在 content-script.js 之前載入。
 */

(function (root) {
    'use strict';

    // ── Overlay 樣式工具函式（模組私有） ────────────────────────────────────────
    // 注入 overlay 定位與 select 外觀樣式至 document.head
    function injectOverlayStyles() {
        if (document.getElementById('dss-overlay-style')) return;
        const style = document.createElement('style');
        style.id = 'dss-overlay-style';
        style.textContent = `
        ._2be88ba:not(._1551317) { position: relative !important; }
        #dss-preset-overlay {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000; pointer-events: auto;
        }
        #dss-preset-select {
            height: 30px; padding: 5px 6px;
            border: 1px solid rgba(255,255,255,0.25); border-radius: 6px;
            font-size: 13px; font-family: inherit;
            background-color: rgba(0,0,0,0.45); color: #fff;
            cursor: pointer; max-width: 200px; min-width: 80px;
        }
        #dss-preset-select:focus {
            outline: none; border-color: #4d6bfe;
            box-shadow: 0 0 0 2px rgba(77,107,254,0.3);
        }
    `;
        document.head.appendChild(style);
    }

    // 移除先前注入的 overlay 樣式
    function removeOverlayStyles() {
        const style = document.getElementById('dss-overlay-style');
        style?.remove();
    }

    /**
     * 建立 PresetOverlay 實例。
     * @param {Object} ctx - 上下文物件，提供對 content-script.js 模組層級狀態的存取
     * @param {Function} ctx.getIsEnabled             - 取得 isEnabled 狀態
     * @param {Function} ctx.getCurrentChatUuid       - 取得 currentChatUuid
     * @param {Function} ctx.setCurrentChatUuid       - 設定 currentChatUuid（保留供未來使用）
     * @param {Function} ctx.getChatPresetMap         - 取得 chatPresetMap 物件
     * @param {Function} ctx.setChatPresetMap         - 以新物件取代整個 chatPresetMap
     * @param {Function} ctx.setPendingPresetId       - 設定 pendingPresetId
     * @param {Function} ctx.updatePromptPrefixFromBinding - 根據當前綁定重新計算 promptPrefix
     * @param {Function} ctx.isExtensionContextValid  - 檢查 Extension context 是否仍有效
     * @returns {Object} PresetOverlay 實例
     */
    function createPresetOverlay(ctx) {
        const PresetOverlay = {
            TARGET_SELECTOR: '._2be88ba',
            selectEl: null, wrapperEl: null, targetEl: null,
            domObserver: null, _debounceTimer: null,

            // DOM 建構：建立 overlay 外框與 select 元素
            buildDOM() {
                const wrapper = document.createElement('div');
                wrapper.id = 'dss-preset-overlay';
                const sel = document.createElement('select');
                sel.id = 'dss-preset-select';
                wrapper.appendChild(sel);
                sel.addEventListener('change', (e) => {
                    e.stopPropagation();
                    this.onSelectChange(sel.value);
                });
                return wrapper;
            },

            // 掛載 overlay 至指定目標元素
            mountTo(targetEl) {
                this.unmount();
                this.wrapperEl = this.buildDOM();
                this.selectEl = this.wrapperEl.querySelector('select');
                this.targetEl = targetEl;
                targetEl.appendChild(this.wrapperEl);
            },

            // 卸載 overlay（移除 DOM 並清除參照）
            unmount() {
                this.wrapperEl?.remove();
                this.selectEl = null; this.wrapperEl = null; this.targetEl = null;
            },

            // 渲染 select 選項清單，以 activeId 設定當前選中值
            render(presets, activeId) {
                if (!this.selectEl) return;
                this.selectEl.innerHTML = '';
                const empty = document.createElement('option');
                empty.value = ''; empty.textContent = '';
                this.selectEl.appendChild(empty);
                (presets || []).forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id; opt.textContent = p.name;
                    this.selectEl.appendChild(opt);
                });
                this.selectEl.value = activeId || '';
            },

            // 搜尋目標元素並掛載；若目標未改變則略過
            findAndMount() {
                const found = document.querySelector(this.TARGET_SELECTOR);
                if (!found) return;
                if (this.targetEl === found) return;
                this.mountTo(found);
                this.setVisible(ctx.getIsEnabled());
                StorageManager.getSettings().then(s => {
                    const currentChatUuid = ctx.getCurrentChatUuid();
                    const chatPresetMap   = ctx.getChatPresetMap();
                    const activeId = currentChatUuid ? (chatPresetMap[currentChatUuid] || '') : '';
                    this.render(s.promptPresets, activeId);
                });
            },

            // 啟動 MutationObserver 監聽 DOM 變化，防抖後嘗試掛載
            setupDomObserver() {
                if (this.domObserver) return;
                this.domObserver = new MutationObserver(() => {
                    if (!ctx.isExtensionContextValid()) {
                        this.domObserver.disconnect(); this.domObserver = null; return;
                    }
                    clearTimeout(this._debounceTimer);
                    this._debounceTimer = setTimeout(() => this.findAndMount(), 150);
                });
                this.domObserver.observe(document.body, { childList: true, subtree: true });
            },

            // 處理 select 選項變更事件：綁定、解綁或暫存 preset
            onSelectChange(newId) {
                const currentChatUuid = ctx.getCurrentChatUuid();
                const chatPresetMap   = ctx.getChatPresetMap();

                if (currentChatUuid && newId !== '') {
                    // 直接寫入現有 map 物件（保持參照一致）並持久化
                    chatPresetMap[currentChatUuid] = newId;
                    StorageManager.bindChatToPreset(currentChatUuid, newId).then(() =>
                        StorageManager.getChatPresetMap().then(m => { ctx.setChatPresetMap(m); })
                    );
                } else if (currentChatUuid && newId === '') {
                    // 解除綁定
                    delete chatPresetMap[currentChatUuid];
                    StorageManager.unbindChat(currentChatUuid).then(() =>
                        StorageManager.getChatPresetMap().then(m => { ctx.setChatPresetMap(m); })
                    );
                } else {
                    // 無 UUID（新對話）：暫存待後續自動綁定
                    ctx.setPendingPresetId(newId || null);
                }
                StorageManager.saveActivePresetId(newId);
                ctx.updatePromptPrefixFromBinding();
            },

            // 切換 overlay 顯示 / 隱藏
            setVisible(enabled) {
                if (this.wrapperEl) {
                    this.wrapperEl.style.display = enabled ? '' : 'none';
                }
            },

            // 更新 select 的選中值（不重建選項清單）
            updateActiveId(id) {
                if (this.selectEl) this.selectEl.value = id || '';
            },

            // 啟動整個 overlay：注入樣式、設定觀察者、掛載、渲染、設定可見性
            start(presets, activeId, enable) {
                injectOverlayStyles();
                this.setupDomObserver();
                this.findAndMount();
                this.render(presets, activeId);
                if (enable !== undefined) this.setVisible(enable);
            }
        };

        return PresetOverlay;
    }

    // 將 factory 與樣式工具函式掛載至全域命名空間（瀏覽器 classic script 環境）
    root.__DS_PresetOverlay = { createPresetOverlay, injectOverlayStyles, removeOverlayStyles };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPresetOverlay, injectOverlayStyles, removeOverlayStyles };
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
