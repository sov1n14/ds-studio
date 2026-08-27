/**
 * DS studio — 對話區寬度（content/chat-width.js）
 *
 * 僅提供設定與 CSS：樣式注入、observer 生命週期與開關閘控皆由
 * content/width-feature.js 工廠負責。
 */
const CHAT_WIDTH_FACTORY = globalThis.DSSWidthFeature
    || (typeof require !== 'undefined' ? require('./width-feature.js') : null);
if (!CHAT_WIDTH_FACTORY) {
    throw new Error('content/chat-width.js 需要 content/width-feature.js 先行載入');
}

// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DS_ChatWidthSelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

const ChatWidth = CHAT_WIDTH_FACTORY.create({
    STYLE_ID: 'ds-chat-width-style',
    PERCENT_KEY: StorageManager.KEYS.CHAT_WIDTH,
    ENABLED_KEY: StorageManager.KEYS.CHAT_WIDTH_ENABLED,

    getCSS(percent) {
        const vw = this.clampPercent(percent);
        return `
${__DS_ChatWidthSelectors.VIRTUAL_LIST_SELECTOR} {
  --message-list-max-width: ${vw}vw !important;
}
${__DS_ChatWidthSelectors.CONTENT_COLUMN_SELECTOR} {
  margin-left: auto !important;
  margin-right: auto !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}`.trim();
    },
});

ChatWidth.start();

// === 測試匯出（瀏覽器情境為 no-op） ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatWidth;
}
