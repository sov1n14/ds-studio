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

    var __stylesModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetOverlayStyles ||
        (typeof require !== 'undefined' ? require('./preset-overlay.styles.js') : {});

    var __positionModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetPosition ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.position.js') : {});

    var __dropdownModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetDropdown ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.component.js') : {});

    var __resolversModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetOverlayResolvers ||
        (typeof require !== 'undefined' ? require('./preset-overlay.resolvers.js') : {});

    var __viewportSyncModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetViewportSync ||
        (typeof require !== 'undefined' ? require('./preset-viewport-sync.js') : {});

    var __presetIdResolverModule = (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : root)).__DS_PresetIdResolver ||
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
    const __selectorsModule = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    var TARGET_SELECTOR = __selectorsModule.CHAT_HEADER_SELECTOR;

    function scheduleFrame(fn) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(fn);
        } else {
            fn();
        }
    }

    function createPresetOverlay(ctx) {
        const PresetOverlay = {
            TARGET_SELECTOR: TARGET_SELECTOR,

            dropdown:           null,
            wrapperEl:          null,
            targetEl:           null,
            domObserver:        null,
            resizeObserver:     null,
            _debounceTimer:     null,
            _windowResizeHandler: null,
            _settle:            null,

            buildDOM() {
                this.dropdown = createPresetDropdown({
                    onChange: (id) => this.onSelectChange(id),
                    placeholderText: dsI18n.t('dropdownPlaceholder'),
                    emptyOptionText: dsI18n.t('dropdownEmptyOption')
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
                this.startSettle('initial-settle');
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
                this.targetEl = null;
            },

            render(presets, activeId) {
                if (!this.dropdown) return;
                this.dropdown.setOptions(presets);
                this.dropdown.setValue(activeId || '');
                this.reposition('render');
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

            reposition(reason) {
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

            startSettle: function startSettle(reason) {
                if (!startSettleSync) return;
                if (this._settle) return;
                var self = this;
                this._settle = startSettleSync(
                    function () {
                        var result = resolveNewChatButtonEl(self.targetEl);
                        return result && result.el ? result.el.getBoundingClientRect().left : null;
                    },
                    function (r) { self.reposition(r); },
                    scheduleFrame
                );
            },

            onSelectChange(newId) {
                const currentChatUuid = ctx.getCurrentChatUuid();
                const chatPresetMap   = ctx.getChatPresetMap();

                if (currentChatUuid && newId !== '') {
                    chatPresetMap[currentChatUuid] = newId;
                    StorageManager.bindChatToPreset(currentChatUuid, newId).then(() =>
                        StorageManager.getChatPresetMap().then(m => { ctx.setChatPresetMap(m); })
                    );
                } else if (currentChatUuid && newId === '') {
                    delete chatPresetMap[currentChatUuid];
                    StorageManager.unbindChat(currentChatUuid).then(() =>
                        StorageManager.getChatPresetMap().then(m => { ctx.setChatPresetMap(m); })
                    );
                } else {
                    ctx.setPendingPresetId(newId ?? null);
                }
                StorageManager.saveActivePresetId(newId);
                ctx.updatePromptPrefixFromBinding();
                this.reposition('onSelectChange');
            },

            findAndMount() {
                const found = document.querySelector(this.TARGET_SELECTOR);
                if (!found) return;
                if (this.targetEl === found) return;
                this.mountTo(found);
                this.setVisible(ctx.getIsEnabled());
                StorageManager.getSettings().then(s => {
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

            setupWindowResizeListener() {
                if (typeof window === 'undefined') return;
                if (this._windowResizeHandler) {
                    window.removeEventListener('resize', this._windowResizeHandler);
                    this._windowResizeHandler = null;
                }
                this._windowResizeHandler = setupWindowResizeListenerSync(
                    () => this.reposition('window-resize'),
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
                this.setupDomObserver();
                this.findAndMount();
                this.render(presets, activeId);
                if (enable !== undefined) this.setVisible(enable);

                if (!this._localeListenerAttached) {
                    this._localeListenerAttached = true;
                    var self = this;
                    document.addEventListener('dsI18n-locale-changed', function () {
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

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
