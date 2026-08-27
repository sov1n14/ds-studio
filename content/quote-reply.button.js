/**
 * DS studio — QuoteReply Button Bundle
 * 引用回覆按鈕的建立、顯示與隱藏邏輯。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數
    var __DS_QRBtnSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {
        getButtonEl() {
            if (!QuoteReply.btnEl) {
                const btn = document.createElement('div');
                btn.className = 'dss-quote-btn';
                btn.style.display = 'none';
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"></path></svg><span>${dsI18n.t('quoteReplyBtnLabel')}</span>`;

                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                });

                btn.addEventListener('click', () => {
                    const textarea = document.querySelector(__DS_QRBtnSelectors.INPUT_TEXTAREA_SELECTOR);
                    if (textarea) {
                        QuoteReply.injectQuote(textarea, QuoteReply.selectedText);
                    }
                    QuoteReply.hideButton();
                });

                QuoteReply.btnEl = btn;
                document.body.appendChild(btn);
            }

            return QuoteReply.btnEl;
        },

        showButton(top, left) {
            QuoteReply.btnEl.style.top = top + 'px';
            QuoteReply.btnEl.style.left = left + 'px';
            QuoteReply.btnEl.style.display = 'flex';

            if (!QuoteReply.isScrollAttached) {
                window.addEventListener('scroll', QuoteReply.handleViewportChange, { capture: true, passive: true });
                window.addEventListener('resize', QuoteReply.handleViewportChange);
                QuoteReply.isScrollAttached = true;
            }
        },

        hideButton() {
            if (QuoteReply.btnEl) {
                QuoteReply.btnEl.style.display = 'none';
            }

            if (QuoteReply.isScrollAttached) {
                window.removeEventListener('scroll', QuoteReply.handleViewportChange, { capture: true });
                window.removeEventListener('resize', QuoteReply.handleViewportChange);
                QuoteReply.isScrollAttached = false;
            }

            QuoteReply.selectedText = '';
        },
    };

    root.__DS_QuoteReply_button = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
