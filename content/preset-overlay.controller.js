/**
 * DS Studio — PresetOverlay Controller
 * 取代 content-script.overlay.js，整合自訂 dropdown 元件、定位計算、ResizeObserver。
 * 維持與舊檔完全相同的公開 API 表面，確保 content-script.js 與現有 Vitest 測試零改動。
 *
 * 依賴載入順序（manifest 負責確保）：
 *   preset-dropdown.position.js    → __DS_PresetPosition
 *   preset-dropdown.component.js   → __DS_PresetDropdown
 *   preset-overlay.styles.js       → __DS_PresetOverlayStyles
 *   preset-overlay.resolvers.js    → __DS_PresetOverlayResolvers
 *   preset-overlay.controller.js  ← 本檔（最後）
 *
 * 此檔案以 classic script 載入，無 ES import/export。
 */

(function (root) {
    'use strict';

    // ── 依賴解析（瀏覽器：全域命名空間；Node.js/Vitest：require） ────────────

    var __stylesModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetOverlayStyles ||
        (typeof require !== 'undefined' ? require('./preset-overlay.styles.js') : {});

    var __positionModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetPosition ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.position.js') : {});

    var __dropdownModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetDropdown ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.component.js') : {});

    var __resolversModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetOverlayResolvers ||
        (typeof require !== 'undefined' ? require('./preset-overlay.resolvers.js') : {});

    var injectOverlayStyles  = __stylesModule.injectOverlayStyles;
    var removeOverlayStyles  = __stylesModule.removeOverlayStyles;
    var computePlacement     = __positionModule.computePlacement;
    var createPresetDropdown = __dropdownModule.createPresetDropdown;
    var resolveTitleEl         = __resolversModule.resolveTitleEl;
    var resolveNewChatButtonEl = __resolversModule.resolveNewChatButtonEl;
    var runSettle = root.__DS_PresetSettle ? root.__DS_PresetSettle.runSettle : null;

    // ── Selector 常數（TARGET_SELECTOR 保留於 controller，供 findAndMount 使用） ──

    var TARGET_SELECTOR = '._2be88ba';

    // ── rAF 包裝（jsdom 無 requestAnimationFrame，需 feature-detect） ─────────

    /**
     * 若 requestAnimationFrame 存在則以 rAF 包裝執行，否則同步執行。
     * 確保 Vitest (jsdom) 環境中不崩潰。
     * @param {Function} fn
     */
    function scheduleFrame(fn) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(fn);
        } else {
            fn();
        }
    }

    // ── Factory ──────────────────────────────────────────────────────────────

    /**
     * 建立 PresetOverlay 實例。
     * @param {Object}   ctx
     * @param {Function} ctx.getIsEnabled
     * @param {Function} ctx.getCurrentChatUuid
     * @param {Function} ctx.setCurrentChatUuid
     * @param {Function} ctx.getChatPresetMap
     * @param {Function} ctx.setChatPresetMap
     * @param {Function} ctx.setPendingPresetId
     * @param {Function} ctx.updatePromptPrefixFromBinding
     * @param {Function} ctx.isExtensionContextValid
     * @returns {Object} PresetOverlay 實例（API 表面與舊版完全相同）
     */
    function createPresetOverlay(ctx) {
        const PresetOverlay = {
            TARGET_SELECTOR: TARGET_SELECTOR,

            // 內部狀態參照
            dropdown:           null,   // createPresetDropdown 回傳的元件物件
            wrapperEl:          null,   // dropdown.el（#dss-preset-overlay）
            targetEl:           null,   // 目前掛載的 ._2be88ba 元素
            domObserver:        null,   // MutationObserver（SPA 重掛載用）
            resizeObserver:     null,   // ResizeObserver（容器尺寸變動 → reposition）
            _debounceTimer:     null,   // MutationObserver 防抖計時器
            _rafPending:        false,  // rAF 節流旗標（ResizeObserver 用）
            _windowResizeHandler: null, // window resize 監聽器參照（teardown 用）
            _resizeRafPending:  false,  // window resize rAF 節流旗標
            _settle:            null,   // settlement loop controller { cancel }

            // ── DOM 建構 ─────────────────────────────────────────────────────

            /**
             * 以 createPresetDropdown 建立自訂 dropdown，取代舊版原生 <select>。
             * 儲存 dropdown 實例與 wrapperEl（即 #dss-preset-overlay div）參照。
             */
            buildDOM() {
                this.dropdown = createPresetDropdown({
                    onChange: (id) => this.onSelectChange(id),
                    placeholderText: dsI18n.t('dropdownPlaceholder'),
                    emptyOptionText: dsI18n.t('dropdownEmptyOption')
                });
                this.wrapperEl = this.dropdown.el;
            },

            // ── 掛載 / 卸載 ──────────────────────────────────────────────────

            /**
             * 掛載 overlay 至指定 ._2be88ba 元素。
             * 先 unmount 清除舊狀態，再 appendChild（脫離 flow，插入點不影響視覺定位）。
             * @param {Element} targetEl
             */
            mountTo(targetEl) {
                this.unmount();
                this.buildDOM();
                this.targetEl = targetEl;
                targetEl.appendChild(this.wrapperEl);
                this.setupResizeObserver();
                this.setupWindowResizeListener();
                this.startSettle('initial-settle');
            },

            /**
             * 卸載 overlay：銷毀 dropdown（移除 el + menu + 監聽器）、
             * disconnect ResizeObserver、移除 window resize 監聽器、清空所有參照。
             */
            unmount() {
                if (this.dropdown) {
                    this.dropdown.destroy();
                    this.dropdown  = null;
                    this.wrapperEl = null;
                }
                if (this.resizeObserver) {
                    this.resizeObserver.disconnect();
                    this.resizeObserver = null;
                }
                // 移除 window resize 監聽器，避免記憶體洩漏
                if (this._windowResizeHandler && typeof window !== 'undefined') {
                    window.removeEventListener('resize', this._windowResizeHandler);
                    this._windowResizeHandler = null;
                }
                this._resizeRafPending = false;
                if (this._settle) { this._settle.cancel(); this._settle = null; }
                this.targetEl = null;
            },

            // ── 渲染 / 更新 ──────────────────────────────────────────────────

            /**
             * 重建選項清單並設定選中值，最後重算定位。
             * 對應舊版 render()。
             * @param {Array<{id:string,name:string}>} presets
             * @param {string} activeId
             */
            render(presets, activeId) {
                if (!this.dropdown) return;
                this.dropdown.setOptions(presets);
                this.dropdown.setValue(activeId || '');
                this.reposition('render');
            },

            /**
             * 僅更新選中值，不重建選項清單，最後重算定位。
             * 對應舊版 updateActiveId()。
             * @param {string} id
             */
            updateActiveId(id) {
                if (!this.dropdown) return;
                this.dropdown.setValue(id || '');
                this.reposition();
            },

            /**
             * 切換 overlay 顯示 / 隱藏。
             * 顯示時重算定位以確保位置正確。
             * @param {boolean} enabled
             */
            setVisible(enabled) {
                if (!this.wrapperEl) return;
                this.wrapperEl.style.display = enabled ? '' : 'none';
                if (enabled) this.reposition();
            },

            // ── 定位計算 ─────────────────────────────────────────────────────

            /**
             * 量測容器與子元素 rect，呼叫 computePlacement，將結果套用至 wrapperEl inline style。
             *
             * 定位策略（兩種模式皆以 box-left + explicit-width + translateY(-50%)）：
             *   center 模式：left = (containerWidth - width) / 2（容器置中）
             *   gap 模式：   left = gapCenter - width/2（間隙置中）
             *   兩種模式 computePlacement 皆已計算 box 左緣（相對容器），直接套用。
             *   translateX 一律不使用，以避免 computed-left + translateX 混用造成偏差。
             *   width 在兩種模式下皆以 inline style 明確設定，確保收縮/擴張行為確定。
             */
            reposition(reason) {
                if (!this.wrapperEl || !this.targetEl) return;
                // display:none（setVisible 隱藏）時不量測，避免得到零值
                if (this.wrapperEl.style.display === 'none') return;

                // 以 rAF 包裹量測，避免 layout thrash
                scheduleFrame(() => {
                    // rAF 執行前 overlay 可能已被 unmount
                    if (!this.wrapperEl || !this.targetEl) return;

                    var containerRect = this.targetEl.getBoundingClientRect();
                    var currentWindowWidth = (typeof window !== 'undefined') ? window.innerWidth : 1024;

                    // 使用語意解析器取得正確的標題與 new-chat 按鈕元素
                    var titleResult  = resolveTitleEl(this.targetEl);
                    var buttonResult = resolveNewChatButtonEl(this.targetEl);
                    var titleEl      = titleResult.el;
                    var buttonEl     = buttonResult.el;

                    // 量測子元素 rect（若元素不存在則傳 null，computePlacement 會退回 center 模式）
                    var titleRect  = titleEl  ? titleEl.getBoundingClientRect()  : null;
                    var buttonRect = buttonEl ? buttonEl.getBoundingClientRect() : null;

                    var naturalWidth = this.dropdown ? this.dropdown.getNaturalWidth() : 80;

                    var placement = computePlacement({
                        containerRect: containerRect,
                        titleRect:     titleRect,
                        buttonRect:    buttonRect,
                        naturalWidth:  naturalWidth,
                        maxWidth:      200,
                        gapSafety:     8,
                        windowWidth:   currentWindowWidth
                    });

                    // hidden 訊號：間隙不足，隱藏 overlay（用 visibility 保留 layout 空間不影響 flow）
                    if (placement.hidden) {
                        this.wrapperEl.style.visibility = 'hidden';
                        return;
                    }

                    // 恢復可見性並套用定位：box-left（相對容器）+ explicit width + translateY(-50%)
                    this.wrapperEl.style.visibility = '';
                    this.wrapperEl.style.left        = placement.left + 'px';
                    this.wrapperEl.style.width       = placement.width + 'px';
                    this.wrapperEl.style.transform   = 'translateY(-50%)';
                });
            },

            // ── Settlement 自動穩定 ──────────────────────────────────────────

            /**
             * 啟動 settlement loop：持續量測 new-chat 按鈕位置直到穩定，
             * 最後一次 apply reposition 確保 dropdown 定位精準。
             * @param {string} reason 觸發原因，僅供日誌識別
             */
            startSettle: function startSettle(reason) {
                if (!runSettle) return;                      // scheduler not available
                if (this._settle) return;                    // already running — early return
                var self = this;
                var opts = {
                    measure: function () {
                        var result = resolveNewChatButtonEl(self.targetEl);
                        return result && result.el ? result.el.getBoundingClientRect().left : null;
                    },
                    apply: function (r) { self.reposition(r); },
                    schedule: scheduleFrame,
                    maxFrames: 7200,
                    stableK: 120,
                    epsilon: 1,
                    onDone: undefined
                };
                this._settle = runSettle(opts);
            },

            // ── 選項變更處理 ─────────────────────────────────────────────────

            /**
             * 處理 dropdown onChange 回呼：綁定 / 解綁 / 暫存 preset。
             * 三分支邏輯與舊版完全相同，僅值來源由 select.value 改為 newId 參數。
             * 測試直接呼叫 instance.onSelectChange('preset-B') 驗證此邏輯。
             * @param {string} newId
             */
            onSelectChange(newId) {
                const currentChatUuid = ctx.getCurrentChatUuid();
                const chatPresetMap   = ctx.getChatPresetMap();

                if (currentChatUuid && newId !== '') {
                    // 綁定：直接寫入現有 map 物件（保持參照一致）並持久化
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
                // 選項變更後標籤文字寬度可能改變，重算定位以修正 inline width/left 過時問題
                this.reposition('onSelectChange');
            },

            // ── 掛載搜尋 ─────────────────────────────────────────────────────

            /**
             * 搜尋 TARGET_SELECTOR 元素並掛載；同目標則略過（same-target 跳過）。
             * 掛載後設定可見性，並非同步取得設定後 render。
             */
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

            // ── Observer 設定 ─────────────────────────────────────────────────

            /**
             * 啟動 MutationObserver 監聽 document.body 的 DOM 變化（SPA 重掛載用）。
             * 以 150ms 防抖避免密集觸發；context 失效時自動 disconnect。
             */
            setupDomObserver() {
                if (this.domObserver) return;
                this.domObserver = new MutationObserver(() => {
                    if (!ctx.isExtensionContextValid()) {
                        this.domObserver.disconnect();
                        this.domObserver = null;
                        return;
                    }
                    clearTimeout(this._debounceTimer);
                    this._debounceTimer = setTimeout(() => this.findAndMount(), 150);
                });
                this.domObserver.observe(document.body, { childList: true, subtree: true });
            },

            /**
             * 建立 window 'resize' 監聽器，以 rAF 節流重算定位。
             * 跨越 768px 邊界時即時切換 center / gap / hidden 模式。
             * 須在 mountTo 後呼叫；teardown 由 unmount 負責移除。
             */
            setupWindowResizeListener() {
                if (typeof window === 'undefined') return;
                // 若已有監聽器，先移除舊的再重建
                if (this._windowResizeHandler) {
                    window.removeEventListener('resize', this._windowResizeHandler);
                    this._windowResizeHandler = null;
                }
                this._resizeRafPending = false;
                this._windowResizeHandler = () => {
                    if (this._resizeRafPending) return;
                    this._resizeRafPending = true;
                    scheduleFrame(() => {
                        this._resizeRafPending = false;
                        this.reposition('window-resize');
                    });
                };
                window.addEventListener('resize', this._windowResizeHandler);
            },

            /**
             * 建立 ResizeObserver 觀察 targetEl（._2be88ba），容器尺寸變動時重算定位。
             * 以 rAF 合併多次 callback，避免頻繁 layout 計算。
             * Feature-detect ResizeObserver：jsdom 可能未實作，無則 no-op。
             */
            setupResizeObserver() {
                // Feature-detect：jsdom 等測試環境可能無 ResizeObserver
                if (typeof ResizeObserver === 'undefined') return;
                if (!this.targetEl) return;

                this.resizeObserver = new ResizeObserver(() => {
                    // context 失效 → 停止觀察
                    if (!ctx.isExtensionContextValid()) {
                        this.resizeObserver.disconnect();
                        this.resizeObserver = null;
                        return;
                    }
                    // rAF 節流：多次 callback 合併為單次 reposition
                    if (this._rafPending) return;
                    this._rafPending = true;
                    scheduleFrame(() => {
                        this._rafPending = false;
                        this.reposition();
                    });
                });

                this.resizeObserver.observe(this.targetEl);
            },

            // ── 啟動 ─────────────────────────────────────────────────────────

            /**
             * 啟動整個 overlay：注入樣式 → 設定 DOM 觀察者 → 掛載 → 渲染 → 設定可見性。
             * 順序與舊版完全相同；reposition 由 render/setVisible 內部觸發。
             * @param {Array}   presets
             * @param {string}  activeId
             * @param {boolean} [enable]
             */
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

    // ── 匯出 ─────────────────────────────────────────────────────────────────
    // 維持與 content-script.overlay.js 完全相同的匯出名稱，確保 content-script.js
    // 與 Vitest 測試（PresetOverlay.onSelectChange）零改動。

    // 瀏覽器 classic script 環境：掛至全域命名空間
    root.__DS_PresetOverlay = { createPresetOverlay, injectOverlayStyles, removeOverlayStyles };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPresetOverlay, injectOverlayStyles, removeOverlayStyles };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
