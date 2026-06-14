/* ===== Popup i18n Initialization & Language Switcher =====
 * Separate file (not inline script) to comply with MV3 CSP
 * that blocks inline <script> blocks.
 */

(async function () {
  await dsI18n.init();
  // dsI18n.apply() is called automatically by i18n.js auto-init on DOMContentLoaded,
  // but we call it here again in case the auto-init already fired before the DOM was ready.
  dsI18n.apply();

  // ── 語言切換：地球按鈕 → 面板切換 ──
  const localeBtn = document.getElementById('localeSwitcherBtn');
  const localePanel = document.getElementById('localePanel');
  if (localeBtn && localePanel) {
    localeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const hidden = localePanel.hasAttribute('hidden');
      localePanel.toggleAttribute('hidden');
      if (hidden) {
        const cur = dsI18n.getLocale();
        localePanel.querySelectorAll('input[type="radio"]').forEach(function (r) {
          r.checked = r.value === cur;
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
        var val = e.target.value;
        if (val !== dsI18n.getLocale()) {
          await dsI18n.setLocale(val);
          window.location.reload();
        }
      }
    });
  }
})();
