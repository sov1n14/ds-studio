/* ===== DS studio i18n System =====
 * Load this script BEFORE all other scripts that use dsI18n.t()
 * For content scripts, add to manifest.json content_scripts js list
 * For popup/editor, use <script src="../utils/i18n.js"></script>
 * 載入本檔完全無副作用：呼叫端必須明確 await dsI18n.init()。
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

  /** 單一語系資料查表：未知語系一律回退來源語言。 */
  function _dataFor(locale) {
    return locale === 'en' ? en : zh_TW;
  }

  function _isKnownLocale(locale) {
    return Boolean(locale) && Object.prototype.hasOwnProperty.call(LOCALE_NAMES, locale);
  }

  function _readCachedLocale() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null; // localStorage 不可用
    }
  }

  function _writeCachedLocale(locale) {
    try { localStorage.setItem(STORAGE_KEY, locale); } catch (_) { /* ignore */ }
  }

  // ============================================================
  //  i18n API
  // ============================================================
  const i18n = {
    _data: null,
    _locale: DEFAULT_LOCALE,
    _hasListener: false,
    _subscribers: [],

    /** 語系切換訂閱：切換完成（_locale 與 _data 都已更新）後才通知。 */
    onLocaleChanged(callback) {
      if (typeof callback !== 'function') return;
      this._subscribers.push(callback);
    },

    _notify(locale) {
      this._subscribers.slice().forEach(function (callback) {
        try {
          callback(locale);
        } catch (err) {
          // 訂閱者是無人可攔截的邊界，錯誤只能就地回報，且不得中斷其他訂閱者
          console.error('[DSS] i18n onLocaleChanged subscriber failed:', err);
        }
      });
    },

    /** chrome.storage 變更 → 即時語系切換；保持具名函式以便 _reset() 卸載。 */
    _handleStorageChanged(changes, area) {
      if (area !== 'sync' || !changes || !changes[STORAGE_KEY]) return;
      const newLocale = changes[STORAGE_KEY].newValue;
      if (!_isKnownLocale(newLocale) || newLocale === i18n._locale) return;
      i18n._locale = newLocale;
      i18n._data = _dataFor(newLocale);
      _writeCachedLocale(newLocale);
      i18n._notify(newLocale);
    },

    /** 明確初始化：解析語系並安裝即時切換監聽器。重複呼叫只會有一個監聽器。 */
    async init() {
      const cached = _readCachedLocale();
      if (_isKnownLocale(cached)) {
        this._locale = cached;
        this._data = _dataFor(cached);
      }

      try {
        const result = await chrome.storage.sync.get(STORAGE_KEY);
        const stored = result[STORAGE_KEY];
        if (_isKnownLocale(stored)) {
          this._locale = stored;
          this._data = _dataFor(stored);
          _writeCachedLocale(stored); // 雲端值回寫本地快取，下次載入可同步取得
        }
      } catch (_e) { /* storage unavailable */ }

      if (this._data === null) {
        this._data = _dataFor(this._locale);
      }

      if (!this._hasListener &&
          typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(this._handleStorageChanged);
        this._hasListener = true;
      }
    },

    /** Get current locale code (zh_TW | en) */
    getLocale() {
      return this._locale;
    },

    /** For testing only — reset internal state so init() re-runs from scratch */
    _reset() {
      this._locale = DEFAULT_LOCALE;
      this._data = null;
      this._subscribers = [];
      if (this._hasListener &&
          typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        try { chrome.storage.onChanged.removeListener(this._handleStorageChanged); } catch (_) { /* ignore */ }
      }
      this._hasListener = false;
    },

    /**
     * Switch locale, persist to localStorage (sync) and
     * chrome.storage.sync (async), then reload to refresh all strings.
     */
    async setLocale(locale) {
      if (!_isKnownLocale(locale)) return false;
      this._locale = locale;
      this._data = _dataFor(locale);
      _writeCachedLocale(locale);
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
          str = str.replace(new RegExp(`\{${k}\}`, 'g'), String(v));
        }
      }
      return str;
    },
  };

  // ============================================================
  //  Export to global scope
  // ============================================================
  // Export: try both globalThis (vitest/happy-dom) and window (browser)
  try { globalThis.dsI18n = i18n; } catch (_) {}
  try { window.dsI18n = i18n; } catch (_) {}
})();
