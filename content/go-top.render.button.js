/**
 * DS studio — Go To Top Render :: Button
 * 按鈕建構與 SVG 圖示。透過 Object.assign 合併至 GoToTop 物件。
 */
(function (root) {
    'use strict';

    const __DSSelectorsButton = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
    const GO_TOP_NATIVE_BUTTON_CLASS = __DSSelectorsButton.GO_TOP_NATIVE_BUTTON_CLASS;

    const bundle = {
        _iconSvg() {
            return [
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"',
                ' xmlns="http://www.w3.org/2000/svg" style="transform:scaleY(-1);">',
                '<path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137',
                'C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785',
                'C7.79912 9.46883 7.55595 9.61756 7.25 9.66602',
                'C7.08435 9.69222 6.91565 9.69222 6.75 9.66602',
                'C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785',
                'C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137',
                'L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617',
                'L6.15137 7.80273',
                'C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623',
                'C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047',
                'C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047',
                'C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623',
                'C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273',
                'L10.5762 5.07617L11 4.65137L11.8486 5.5Z" fill="currentColor"/>',
                '</svg>',
            ].join('');
        },

        /**
         * 建立 GoTop 按鈕 DOM 元素（不附加到文件）。
         *
         * 主路徑：直接 clone 原生按鈕，移除雜湊 class _0706cde 後複用；
         * 降級路徑：依 NATIVE_BTN_TAG / NATIVE_BTN_CLASSES / NATIVE_BTN_INLINE_STYLE
         *           手工建構與原生按鈕結構相同的 div 元素。
         *
         * 兩條路徑均：
         *   1. 加上識別 class dsw-gotop
         *   2. 設定 role/tabindex/aria 屬性
         *   3. 將圖示子節點的 innerHTML 替換為翻轉的向上箭頭 SVG
         *
         * @param {Element|null} nativeBtn - 原生 go-bottom 按鈕（可為 null）
         * @returns {Element}
         */
        _createButtonElement(nativeBtn) {
            let btn;

            if (nativeBtn) {
                // 主路徑：clone 原生按鈕，移除定位雜湊 class，保留所有 ds-* class
                btn = nativeBtn.cloneNode(true);
                btn.classList.remove(GO_TOP_NATIVE_BUTTON_CLASS);
            } else {
                // 降級路徑：手工建構與原生相同結構的按鈕元素
                btn = document.createElement(this.NATIVE_BTN_TAG);
                btn.className = this.NATIVE_BTN_CLASSES;
                btn.setAttribute('style', this.NATIVE_BTN_INLINE_STYLE);

                // 建構三個子節點（與 go-bottom.html 原生結構一致）
                const bg = document.createElement('div');
                bg.className = 'ds-button__background';
                const border = document.createElement('div');
                border.className = 'ds-button__border';
                const icon = document.createElement('div');
                icon.className = 'ds-button__icon ds-button__icon--last-child';
                btn.appendChild(bg);
                btn.appendChild(border);
                btn.appendChild(icon);
            }

            // 兩條路徑共用：識別 class + 語意屬性
            btn.classList.add('dsw-gotop');
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');
            btn.setAttribute('aria-disabled', 'false');
            btn.setAttribute('aria-label', dsI18n.t('goTopAriaLabel'));

            // 替換圖示子節點的 innerHTML 為翻轉向上箭頭
            // 防禦性處理：若 clone 後圖示節點不存在，補建一個
            let iconEl = btn.querySelector('.ds-button__icon');
            if (!iconEl) {
                iconEl = document.createElement('div');
                iconEl.className = 'ds-button__icon ds-button__icon--last-child';
                btn.appendChild(iconEl);
            }
            iconEl.innerHTML = this._iconSvg();

            // 點擊：滾動到頂部（scrollToTopAndWait 由 go-top.scroll.js 合併進來）
            btn.addEventListener('click', () => {
                this.scrollToTopAndWait();
            });

            // 鍵盤支援：Enter / Space
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.scrollToTopAndWait();
                }
            });

            return btn;
        },
    };

    root.__DS_GoToTop_render_button = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
