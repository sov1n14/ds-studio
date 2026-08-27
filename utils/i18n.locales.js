/* ===== DS studio i18n — Locale Data (Entry) =====
 * 組合 zh_TW 與 en 兩個語系分包，掛載至 __DS_I18N_Locales 全域。
 */
(function (root) {
  'use strict';

  // 語系分包（瀏覽器：由各 loader 於前載入；Node.js 測試：直接 require）
  var zh_TW = root.__DS_I18N_Locales_zhTW ||
      (typeof require !== 'undefined' ? require('./i18n.locales.zhTW.js') : {});
  var en = root.__DS_I18N_Locales_en ||
      (typeof require !== 'undefined' ? require('./i18n.locales.en.js') : {});

  var locales = { zh_TW: zh_TW, en: en };

  // 掛載至全域（瀏覽器 / vitest 側載）
  root.__DS_I18N_Locales = locales;

  // Node.js require() 支援（供單元測試）
  if (typeof module !== 'undefined' && module.exports) module.exports = locales;

})(globalThis);
