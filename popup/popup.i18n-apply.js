/* ===== Popup i18n DOM 套用器 =====
 * utils/i18n.js 維持與層無關（不觸碰 DOM），DOM 套用由 UI 層負責。
 * 匯出 __DS_PopupI18nApply.apply(root)，由 popup.js / editor.js 在 dsI18n.init() 後呼叫。
 */
(function (root) {
  'use strict';

  /**
   * 將翻譯套用到 [data-i18n] 元素。
   * @param {HTMLElement|Document} [scope=document] — 掃描範圍
   */
  function apply(scope) {
    scope = scope || document;
    const elements = scope.querySelectorAll('[data-i18n]');
    for (const el of elements) {
      const key = el.getAttribute('data-i18n');
      if (!key) continue;
      const attr = el.getAttribute('data-i18n-attr') || 'textContent';
      const translation = dsI18n.t(key);
      if (attr === 'textContent') {
        el.textContent = translation;
      } else {
        el.setAttribute(attr, translation);
      }
    }
  }

  root.__DS_PopupI18nApply = { apply };
})(typeof window !== 'undefined' ? window : globalThis);
