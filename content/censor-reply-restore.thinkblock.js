/**
 * DS studio — Censor Reply Restore :: Think Block Bundle
 * 思考區塊（think block）DOM widget 建構子。由 censor-reply-restore.js 以 Object.assign 合入。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const selectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {

        _buildThinkBlock(thinkFragment, elapsedSecs) {
            const container = document.createElement('div');
            container.className = '_74c0879';
            container.setAttribute('style',
                '--collapsible-area-title-height: 38px;' +
                '--group-title-sticky-base-top: 0px;' +
                '--group-title-sticky-top: calc(var(--group-title-sticky-base-top) - ' +
                'var(--ds-virtual-list-transform-y) + var(--ds-virtual-list-ios-compensation-y));'
            );

            const header = document.createElement('div');
            header.className = '_245c867 _34a54ec';
            header.style.cursor = 'pointer';
            header.addEventListener('click', function () {
                const isCollapsed = container.getAttribute('data-ht-collapsed') === '1';
                if (isCollapsed) {
                    container.setAttribute('data-ht-collapsed', '0');
                } else {
                    container.setAttribute('data-ht-collapsed', '1');
                }
                // 切換思考內容的顯示狀態
                const thinkContent = container.querySelector(selectors.THINK_CONTENT_SELECTOR);
                if (thinkContent) {
                    thinkContent.style.display = isCollapsed ? 'block' : 'none';
                }
                // 切換箭頭 SVG 路徑
                const arrowIcon = container.querySelector('._5ab5d64 > .ds-icon:not(._970ac5e) svg path');
                if (arrowIcon) {
                    arrowIcon.setAttribute('d', isCollapsed
                        ? 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'
                        : 'M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z'
                    );
                }
            });
            header.innerHTML = [
                '<div class="_5ab5d64">',
                '<div class="ds-icon _970ac5e" style="font-size: 16px; width: 16px; height: 16px;">',
                '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">',
                '<path d="M8.00192 6.64454C8.75026 6.64454 9.35732 7.25169 9.35739 8.00001C9.35739 8.74838 8.7503 9.35548 8.00192 9.35548C7.25367 9.35533 6.64743 8.74829 6.64743 8.00001C6.6475 7.25178 8.25371 6.64468 8.00192 6.64454Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M9.97165 1.29981C11.5853 0.718916 13.271 0.642197 14.3144 1.68555C15.3577 2.72902 15.2811 4.41466 14.7002 6.02833C14.4707 6.66561 14.1504 7.32937 13.75 8.00001C14.1504 8.67062 14.4707 9.33444 14.7002 9.97169C15.2811 11.5854 15.3578 13.271 14.3144 14.3145C13.271 15.3579 11.5854 15.2811 9.97165 14.7002C9.3344 14.4708 8.67059 14.1505 7.99997 13.75C7.32933 14.1505 6.66558 14.4708 6.02829 14.7002C4.41461 15.2811 2.72899 15.3578 1.68552 14.3145C0.642155 13.271 0.71887 11.5854 1.29977 9.97169C1.52915 9.33454 1.84865 8.67049 2.24899 8.00001C1.84866 7.32953 1.52915 6.66544 1.29977 6.02833C0.718852 4.41459 0.64207 2.729 1.68552 1.68555C2.72897 0.642112 4.41456 0.718887 6.02829 1.29981C6.66541 1.52918 7.32949 1.8487 7.99997 2.24903C8.67045 1.84869 9.33451 1.52919 9.97165 1.29981ZM12.9404 9.2129C12.4391 9.893 11.8616 10.5681 11.2148 11.2149C10.568 11.8616 9.89296 12.4391 9.21286 12.9404C9.62532 13.1579 10.0271 13.338 10.4121 13.4766C11.9146 14.0174 12.9172 13.8738 13.3955 13.3955C13.8737 12.9173 14.0174 11.9146 13.4765 10.4121C13.3379 10.0271 13.1578 9.62535 12.9404 9.2129ZM3.05856 9.2129C2.84121 9.62523 2.66197 10.0272 2.52341 10.4121C1.98252 11.9146 2.12627 12.9172 2.60446 13.3955C3.08278 13.8737 4.08544 14.0174 5.58786 13.4766C5.97264 13.338 6.37389 13.1577 6.7861 12.9404C6.10624 12.4393 5.43168 11.8614 4.78513 11.2149C4.13823 10.5679 3.55992 9.89313 3.05856 9.2129ZM7.99899 3.792C7.23179 4.31419 6.45306 4.95512 5.70407 5.70411C4.95509 6.45309 4.31415 7.23184 3.79196 7.99903C4.3143 8.76666 4.95471 9.54653 5.70407 10.2959C6.45309 11.0449 7.23271 11.6848 7.99997 12.207C8.76725 11.6848 9.54683 11.0449 10.2959 10.2959C11.0449 9.54686 11.6848 8.76729 12.207 8.00001C11.6848 7.23275 11.0449 6.45312 10.2959 5.70411C9.5465 4.95475 8.76662 4.31434 7.99899 3.792ZM5.58786 2.52344C4.08533 1.98255 3.08272 2.12625 2.60446 2.6045C2.12621 3.08275 1.98252 4.08536 2.52341 5.5879C2.66189 5.97253 2.8414 6.37409 3.05856 6.78614C3.55983 6.10611 4.1384 5.43189 4.78513 4.78516C5.43186 4.13843 6.10606 3.55987 6.7861 3.0586C6.37405 2.84144 5.97249 2.66192 5.58786 2.52344ZM13.3955 2.6045C12.9172 2.12631 11.9146 1.98257 10.4121 2.52344C10.0272 2.66201 9.62519 2.84125 9.21286 3.0586C9.8931 3.55996 10.5679 4.13827 11.2148 4.78516C11.8614 5.43172 12.4392 6.10627 12.9404 6.78614C13.1577 6.37393 13.338 5.97267 13.4765 5.5879C14.0174 4.08549 13.8736 3.08281 13.3955 2.6045Z" fill="currentColor"/>',
                '</svg></div>',
                '<span class="_5255ff8 _4d41763">' +
                dsI18n.t('thinkBlockHeader', { seconds: elapsedSecs ? Math.round(elapsedSecs) : '' }) +
                '</span>',
                '<div class="ds-icon" style="font-size: 14px; width: 14px; height: 14px;">',
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">',
                '<path d="M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z" fill="currentColor"/>',
                '</svg></div>',
                '</div>',
                '<div class="c99b79f8" style="opacity: 0;"></div>'
            ].join('');
            container.appendChild(header);

            const spacer = document.createElement('div');
            spacer.className = 'c2b72bb8';
            container.appendChild(spacer);

            const thinkContent = document.createElement('div');
            thinkContent.className = 'e1675d8b ds-think-content _767406f';

            const loadingDots = document.createElement('div');
            loadingDots.className = 'ddd26891 _9b52f6c';
            loadingDots.setAttribute('style', 'width: 16px; height: 16px;');
            loadingDots.innerHTML = '<div class="a510c7ce _0652043"></div>';
            thinkContent.appendChild(loadingDots);

            const sep = document.createElement('div');
            sep.className = '_9ecc93a';
            thinkContent.appendChild(sep);

            const md = document.createElement('div');
            md.className = selectors.MARKDOWN_CLASS;
            md.setAttribute('style', '--ds-md-zoom: 1.143;');
            md.innerHTML = this._renderMarkdown(thinkFragment.content);
            thinkContent.appendChild(md);

            container.appendChild(thinkContent);
            // 為 HideThinking 相容性添加容器點擊處理器
            container.addEventListener('click', function (e) {
                if (e.target !== container) return;
                var isCollapsed = this.getAttribute('data-ht-collapsed') === '1';
                var tc = this.querySelector(selectors.THINK_CONTENT_SELECTOR);
                if (tc) {
                    tc.style.display = isCollapsed ? 'none' : 'block';
                }
            });

            const footer = document.createElement('div');
            footer.className = '_8f7678d';
            container.appendChild(footer);

            return container;
        },
    };

    root.__DS_CensorReplyRestore_thinkblock = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
