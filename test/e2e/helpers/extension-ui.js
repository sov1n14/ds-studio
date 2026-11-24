// Locators for elements the extension injects into the DeepSeek page; specs assert what these elements do, not their attributes.

/** The go-to-top button injected beside DeepSeek's native go-to-bottom button. */
export const GO_TOP_SELECTOR = '.dsw-gotop';

/** The in-page preset dropdown (combobox) mounted in the chat header. */
export const PRESET_OVERLAY_SELECTOR = '#dss-preset-overlay';

/** The floating "quote reply" button shown over a reply selection. */
export const QUOTE_BUTTON_SELECTOR = '.dss-quote-btn';

/** The temporary-chat row (switch plus label) injected below the home-page floating button bar. */
export const TEMP_CHAT_ROW_SELECTOR = '#dss-temp-chat-toggle-row';

/** 匯出進度浮動提示；匯出不完整時切換成警告狀態（`HARVEST_TOAST_INCOMPLETE_SELECTOR`）。 */
export const HARVEST_TOAST_SELECTOR = '.dss-harvest-toast';

/** 顯示「匯出可能不完整」警告狀態的匯出提示。 */
export const HARVEST_TOAST_INCOMPLETE_SELECTOR = '.dss-harvest-toast--incomplete';

/** 匯出提示的狀態文字行（先顯示捲動至頂端，之後顯示已擷取則數）。 */
export const HARVEST_TOAST_TEXT_SELECTOR = '.dss-harvest-toast__text';

/** 匯出進度提示上的取消按鈕。 */
export const HARVEST_TOAST_CANCEL_SELECTOR = '.dss-harvest-toast__cancel-btn';

/** 匯出不完整警告提示上的關閉按鈕。 */
export const HARVEST_TOAST_DISMISS_SELECTOR = '.dss-harvest-toast__dismiss-btn';
