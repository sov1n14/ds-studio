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
 *   preset-viewport-sync.js        → __DS_PresetViewportSync
 *   preset-overlay.controller.js  ← 本檔（最後）
 *
 * 此檔案以 classic script 載入，無 ES import/export。
 */

(function (root) {
    'use strict';

    var __stylesModule = (globalThis).__DS_PresetOverlayStyles ||
        (typeof require !== 'undefined' ? require('./preset-overlay.styles.js') : {});

    var __positionModule = (globalThis).__DS_PresetPosition ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.position.js') : {});

    var __dropdownModule = (globalThis).__DS_PresetDropdown ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.component.js') : {});

    var __resolversModule = (globalThis).__DS_PresetOverlayResolvers ||
        (typeof require !== 'undefined' ? require('./preset-overlay.resolvers.js') : {});

    var __viewportSyncModule = (globalThis).__DS_PresetViewportSync ||
        (typeof require !== 'undefined' ? require('./preset-viewport-sync.js') : {});

    var __presetIdResolverModule = (globalThis).__DS_PresetIdResolver ||
        (typeof require !== 'undefined' ? require('./preset-id.resolver.js') : {});

    var injectOverlayStyles  = __stylesModule.injectOverlayStyles;
    var removeOverlayStyles  = __stylesModule.removeOverlayStyles;
    var computePlacement     = __positionModule.computePlacement;
    var createPresetDropdown = __dropdownModule.createPresetDropdown;
    var resolveTitleEl         = __resolversModule.resolveTitleEl;
    var resolveNewChatButtonEl = __resolversModule.resolveNewChatButtonEl;
    var setupResizeObserverSync       = __viewportSyncModule.setupResizeObserver;
    var setupWindowResizeListenerSync = __viewportSyncModule.setupWindowResizeListener;
    var startSettleSync               = __viewportSyncModule.startSettle;
    var resolveOverlayPresetId        = __presetIdResolverModule.resolveOverlayPresetId;

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const __selectorsModule = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    var TARGET_SELECTOR = __selectorsModule.CHAT_HEADER_SELECTOR;

    // DOM 變動後重掛浮動選單的去抖動間隔（毫秒）
    const FIND_AND_MOUNT_DEBOUNCE_MS = 150;

    function scheduleFrame(fn) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(fn);
        } else {
            fn();
        }
    }

    function createPresetOverlay(ctx) {
        // 依賴注入（P11）：優先取 ctx 提供的實作，未提供時退回 manifest 載入順序建立的全域物件。
        const resolveStorage = () => (ctx && ctx.storageManager) || StorageManager;
        const resolveI18n    = () => (ctx && ctx.i18n) || dsI18n;

        const PresetOverlay = {
            TARGET_SELECTOR: TARGET_SELECTOR,

            dropdown:           null,
            wrapperEl:          null,
            targetEl:           null,
            resizeObserver:     null,
            _findAndMountTimer: null,
            _windowResizeHandler: null,
            _settle:            null,

            buildDOM() {
                const i18n = resolveI18n();
                this.dropdown = createPresetDropdown({
                    onChange: (id) => this.onSelectChange(id),
                    i18n: i18n,
                    placeholderText: i18n.t('dropdownPlaceholder'),
                    emptyOptionText: i18n.t('dropdownEmptyOption')
                });
                this.wrapperEl = this.dropdown.el;
            },

            mountTo(targetEl) {
                this.unmount();
                this.buildDOM();
                this.targetEl = targetEl;
                targetEl.appendChild(this.wrapperEl);
                this._applyPlacementSync();
                this.setupResizeObserver();
                this.setupWindowResizeListener();
                this.startSettle();
            },

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
                if (this._windowResizeHandler && typeof window !== 'undefined') {
                    window.removeEventListener('resize', this._windowResizeHandler);
                    this._windowResizeHandler = null;
                }
                if (this._settle) { this._settle.cancel(); this._settle = null; }
                clearTimeout(this._findAndMountTimer);
                this._findAndMountTimer = null;
                this.targetEl = null;
            },

            render(presets, activeId) {
                if (!this.dropdown) return;
                this.dropdown.setOptions(presets);
                this.dropdown.setValue(activeId || '');
                this.reposition();
            },

            updateActiveId(id) {
                if (!this.dropdown) return;
                this.dropdown.setValue(id || '');
                this.reposition();
            },

            setVisible(enabled) {
                if (!this.wrapperEl) return;
                this.wrapperEl.style.display = enabled ? '' : 'none';
                if (enabled) this.reposition();
            },

            reposition() {
                if (!this.wrapperEl || !this.targetEl) return;
                if (this.wrapperEl.style.display === 'none') return;
                scheduleFrame(() => this._applyPlacementSync());
            },

            _applyPlacementSync() {
                if (!this.wrapperEl || !this.targetEl) return;

                var containerRect = this.targetEl.getBoundingClientRect();
                var currentWindowWidth = (typeof window !== 'undefined') ? window.innerWidth : 1024;

                var titleResult  = resolveTitleEl(this.targetEl);
                var buttonResult = resolveNewChatButtonEl(this.targetEl);
                var titleEl      = titleResult.el;
                var buttonEl     = buttonResult.el;

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

                if (placement.hidden) {
                    this.wrapperEl.style.visibility = 'hidden';
                    return;
                }

                this.wrapperEl.style.visibility = '';
                this.wrapperEl.style.left        = placement.left + 'px';
                this.wrapperEl.style.width       = placement.width + 'px';
                this.wrapperEl.style.transform   = 'translateY(-50%)';
            },

            startSettle: function startSettle() {
                if (!startSettleSync) return;
                if (this._settle) return;
                var self = this;
                this._settle = startSettleSync(
                    function () {
                        var result = resolveNewChatButtonEl(self.targetEl);
                        return result && result.el ? result.el.getBoundingClientRect().left : null;
                    },
                    function () { self.reposition(); },
                    scheduleFrame
                );
            },

            onSelectChange(newId) {
                const currentChatUuid = ctx.getCurrentChatUuid();
                const storage         = resolveStorage();

                if (currentChatUuid) {
                    const isBinding = newId !== '';

                    // 記憶體狀態改以「發布新實例」更新，不就地改動 ctx 持有的物件；
                    // 同步發布確保緊接其後的 updatePromptPrefixFromBinding 讀得到新綁定。
                    const nextMap = { ...ctx.getChatPresetMap() };
                    if (isBinding) {
                        nextMap[currentChatUuid] = newId;
                    } else {
                        delete nextMap[currentChatUuid];
                    }
                    ctx.setChatPresetMap(nextMap);

                    // 實際寫入一律走 StorageManager 的交易式路徑，完成後以儲存結果覆寫記憶體狀態。
                    const persisted = isBinding
                        ? storage.bindChatToPreset(currentChatUuid, newId)
                        : storage.unbindChat(currentChatUuid);
                    Promise.resolve(persisted)
                        .then(() => storage.getChatPresetMap())
                        .then(map => { ctx.setChatPresetMap(map); })
                        .catch(err => console.error('[DSS] preset-overlay onSelectChange: chatPresetMap 持久化失敗:', err));
                } else {
                    ctx.setPendingPresetId(newId ?? null);
                }

                Promise.resolve(storage.saveActivePresetId(newId))
                    .catch(err => console.error('[DSS] preset-overlay onSelectChange: saveActivePresetId 失敗:', err));
                ctx.updatePromptPrefixFromBinding();
                this.reposition();
            },

            findAndMount() {
                const found = document.querySelector(this.TARGET_SELECTOR);
                if (!found) return;
                if (this.targetEl === found) return;
                this.mountTo(found);
                this.setVisible(ctx.getIsEnabled());
                resolveStorage().getSettings().then(s => {
                    const currentChatUuid = ctx.getCurrentChatUuid();
                    const chatPresetMap   = ctx.getChatPresetMap();
                    const pendingPresetId = ctx.getPendingPresetId ? ctx.getPendingPresetId() : undefined;
                    const activeId = resolveOverlayPresetId({
                        chatUuid: currentChatUuid,
                        chatPresetMap: chatPresetMap,
                        pendingPresetId: pendingPresetId,
                        pinnedPresetId: s.pinnedPresetId,
                        presets: s.promptPresets
                    });
                    this.render(s.promptPresets, activeId);
                });
            },

            /**
             * 去抖動地重掛浮動選單。本檔不自建 body 觀察器：DOM 變動由
             * content-script.js 的單一 body 觀察器扇出呼叫本方法。
             */
            scheduleFindAndMount() {
                clearTimeout(this._findAndMountTimer);
                this._findAndMountTimer = setTimeout(() => this.findAndMount(), FIND_AND_MOUNT_DEBOUNCE_MS);
            },

            setupWindowResizeListener() {
                if (typeof window === 'undefined') return;
                if (this._windowResizeHandler) {
                    window.removeEventListener('resize', this._windowResizeHandler);
                    this._windowResizeHandler = null;
                }
                this._windowResizeHandler = setupWindowResizeListenerSync(
                    () => this.reposition(),
                    scheduleFrame
                );
            },

            setupResizeObserver() {
                if (!this.targetEl) return;
                this.resizeObserver = setupResizeObserverSync(
                    this.targetEl,
                    () => this.reposition(),
                    scheduleFrame,
                    ctx.isExtensionContextValid
                );
            },

            start(presets, activeId, enable) {
                injectOverlayStyles();
                this.findAndMount();
                this.render(presets, activeId);
                if (enable !== undefined) this.setVisible(enable);

                if (!this._isLocaleListenerAttached) {
                    this._isLocaleListenerAttached = true;
                    var self = this;
                    dsI18n.onLocaleChanged(function () {
                        if (self.dropdown && self.dropdown.updateLocale) {
                            self.dropdown.updateLocale();
                        }
                    });
                }
            }
        };

        return PresetOverlay;
    }

    root.__DS_PresetOverlay = { createPresetOverlay, injectOverlayStyles, removeOverlayStyles };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPresetOverlay, injectOverlayStyles, removeOverlayStyles };
    }

})(globalThis);
