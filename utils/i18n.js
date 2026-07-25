/* ===== DS studio i18n System =====
 * Load this script BEFORE all other scripts that use dsI18n.t()
 * For content scripts, add to manifest.json content_scripts js list
 * For popup/editor, use <script src="../utils/i18n.js"></script>
 */

(function () {
  'use strict';

  const DEFAULT_LOCALE = 'zh_TW';
  const STORAGE_KEY = 'ds_studio_locale';

  // ============================================================
  //  LOCALE DISPLAY NAMES
  // ============================================================
  const LOCALE_NAMES = { zh_TW: '中文', en: 'English' };

  // 綁定 Locale 資料模組（瀏覽器：由 i18n.locales.js 在前載入；Node.js 測試：直接 require）
  var __DSI18NLocales = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_I18N_Locales ||
      (typeof require !== 'undefined' ? require('./i18n.locales.js') : {});
  var zh_TW = __DSI18NLocales.zh_TW;
  var en = __DSI18NLocales.en;

  // ============================================================
  //  i18n API
  // ============================================================
  const i18n = {
    _data: null,
    _locale: DEFAULT_LOCALE,

    /** Initialize — read saved locale from chrome.storage.sync.
     *  Safe to call multiple times; re-reads from storage each time. */
    async init() {
      try {
        const result = await chrome.storage.sync.get(STORAGE_KEY);
        if (result[STORAGE_KEY] && LOCALE_NAMES[result[STORAGE_KEY]]) {
          this._locale = result[STORAGE_KEY];
          this._data = result[STORAGE_KEY] === 'en' ? en : zh_TW;
          try { localStorage.setItem(STORAGE_KEY, this._locale); } catch (_) { /* ignore */ }
        }
      } catch (_e) { /* storage unavailable */ }
      // Ensure _data is populated even when storage is empty/unavailable
      if (this._data === null) {
        this._data = this._locale === 'en' ? en : zh_TW;
      }
    },

    /** Get current locale code (zh_TW | en) */
    getLocale() {
      return this._locale;
    },

    /** For testing only — reset internal state so init() re-reads storage */
    _reset() {
      this._locale = DEFAULT_LOCALE;
      this._data = null;
    },

    /**
     * Switch locale, persist to localStorage (sync) and
     * chrome.storage.sync (async), then reload to refresh all strings.
     */
    async setLocale(locale) {
      if (!LOCALE_NAMES[locale]) return false;
      this._locale = locale;
      this._data = locale === 'en' ? en : zh_TW;
      try { localStorage.setItem(STORAGE_KEY, locale); } catch (_) { /* ignore */ }
      try { await chrome.storage.sync.set({ [STORAGE_KEY]: locale }); } catch (_) { /* ignore */ }
      return true;
    },

    /**
     * Translate a key with optional {placeholder} substitution.
     * @param {string} key — Message key
     * @param {Object} [replacements] — e.g. { name: 'Foo' }
     * @returns {string}
     */
    t(key, replacements) {
      let str =
        this._data?.[key] ??
        zh_TW[key]; // always fall back to source language
      if (str === undefined) return key;
      if (replacements) {
        for (const [k, v] of Object.entries(replacements)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    },

    /**
     * Apply i18n to all DOM elements with [data-i18n] attributes.
     * @param {HTMLElement} [root=document] — Scope to scan
     */
    apply(root) {
      root = root || document;
      const elements = root.querySelectorAll('[data-i18n]');
      for (const el of elements) {
        const key = el.getAttribute('data-i18n');
        const attr = el.getAttribute('data-i18n-attr') || 'textContent';
        if (!key) continue;
        const translation = this.t(key);
        if (attr === 'textContent') {
          el.textContent = translation;
        } else {
          el.setAttribute(attr, translation);
        }
      }
    },
  };

  // ============================================================
  //  Auto-Init (runs once when the script loads)
  // ============================================================
  (function autoInit() {
    // 1. Synchronous init from localStorage (instant — no await)
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached && LOCALE_NAMES[cached]) {
        i18n._locale = cached;
        i18n._data = cached === 'en' ? en : zh_TW;
      }
    } catch (_) { /* localStorage unavailable */ }

    // 2. Async init from chrome.storage.sync (may update cached value)
    i18n.init().then(function () {
      // 3. Auto-apply when DOM is ready (only in browser context)
      if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function onReady() {
            document.removeEventListener('DOMContentLoaded', onReady);
            i18n.apply();
          });
        } else {
          i18n.apply();
        }
      }
    });

    // 4. Live locale switch — listen for storage changes from popup
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'sync' && changes[STORAGE_KEY]) {
          var newVal = changes[STORAGE_KEY].newValue;
          if (newVal && LOCALE_NAMES[newVal] && newVal !== i18n._locale) {
            i18n._locale = newVal;
            i18n._data = newVal === 'en' ? en : zh_TW;
            try { localStorage.setItem(STORAGE_KEY, newVal); } catch (_) { /* ignore */ }
            // Re-apply i18n to DOM elements (static data-i18n attributes)
            i18n.apply();
            // Dispatch custom event so content-script modules can react
            if (typeof document !== 'undefined') {
              try { document.dispatchEvent(new CustomEvent('dsI18n-locale-changed', { detail: { locale: newVal } })); } catch (_) { /* ignore */ }
            }
          }
        }
      });
    }
  })();

  // ============================================================
  //  Export to global scope
  // ============================================================
  // Export: try both globalThis (vitest/happy-dom) and window (browser)
  try { globalThis.dsI18n = i18n; } catch (_) {}
  try { window.dsI18n = i18n; } catch (_) {}
})();
