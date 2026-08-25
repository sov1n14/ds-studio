/* ===== Popup 語言切換器 =====
 * 獨立檔案（非 inline script）以符合 MV3 CSP。
 * 匯出 bindLocaleSwitcher()，由 popup.js 的 DOMContentLoaded 流程呼叫；
 * 本檔不在載入時執行任何工作，dsI18n.init() 一次開啟只跑一次（在 popup.js）。
 */
(function (root) {
  'use strict';

  /** 綁定地球按鈕與語言面板；需在 dsI18n.init() 完成後呼叫。 */
  function bindLocaleSwitcher() {
    window.__DS_PopupI18nApply.apply();

    const localeBtn = document.getElementById('localeSwitcherBtn');
    const localePanel = document.getElementById('localePanel');
    if (!localeBtn || !localePanel) return;

    localeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const isHidden = localePanel.hasAttribute('hidden');
      localePanel.toggleAttribute('hidden');
      if (isHidden) {
        const currentLocale = dsI18n.getLocale();
        localePanel.querySelectorAll('input[type="radio"]').forEach(function (r) {
          r.checked = r.value === currentLocale;
        });
      }
    });

    document.addEventListener('click', function (e) {
      if (
        !localePanel.hidden &&
        !localePanel.contains(e.target) &&
        e.target !== localeBtn &&
        !localeBtn.contains(e.target)
      ) {
        localePanel.hidden = true;
      }
    });

    localePanel.addEventListener('change', async function (e) {
      if (e.target.matches('input[type="radio"]') && e.target.checked) {
        const value = e.target.value;
        if (value !== dsI18n.getLocale()) {
          await dsI18n.setLocale(value);
          window.location.reload();
        }
      }
    });
  }

  root.__DS_PopupLocale = { bindLocaleSwitcher };
})(typeof window !== 'undefined' ? window : globalThis);
