/**
 * DS studio — 輸入框寬度（content/input-width.js）
 *
 * 僅提供設定與 CSS：樣式注入、observer 生命週期與開關閘控皆由
 * content/width-feature.js 工廠負責。
 * 跨功能相依：輸入框不得寬於對話區，故追蹤對話區寬度的兩個鍵做夾限。
 */
const INPUT_WIDTH_FACTORY = globalThis.DSSWidthFeature
    || (typeof require !== 'undefined' ? require('./width-feature.js') : null);
if (!INPUT_WIDTH_FACTORY) {
    throw new Error('content/input-width.js 需要 content/width-feature.js 先行載入');
}

const InputWidth = INPUT_WIDTH_FACTORY.create({
    STYLE_ID: 'ds-input-width-style',
    PERCENT_KEY: StorageManager.KEYS.INPUT_WIDTH,
    ENABLED_KEY: StorageManager.KEYS.INPUT_WIDTH_ENABLED,
    WATCH_KEYS: [StorageManager.KEYS.CHAT_WIDTH, StorageManager.KEYS.CHAT_WIDTH_ENABLED],
    // 輸入框額外監看 class 變動：DeepSeek 會在編輯狀態切換時換掉容器 class
    OBSERVER_OPTIONS: { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] },

    _chatWidthPercent: 70,
    _chatWidthEnabled: false,

    onValues(values) {
        const percentKey = StorageManager.KEYS.CHAT_WIDTH;
        const enabledKey = StorageManager.KEYS.CHAT_WIDTH_ENABLED;
        if (Object.prototype.hasOwnProperty.call(values, percentKey)) {
            this._chatWidthPercent = values[percentKey];
        }
        if (Object.prototype.hasOwnProperty.call(values, enabledKey)) {
            this._chatWidthEnabled = values[enabledKey];
        }
    },

    getEffectivePercent() {
        if (this._chatWidthEnabled && this._chatWidthPercent < this.percent) {
            return this._chatWidthPercent;
        }
        return this.percent;
    },

    getCSS(percent) {
        const vw = Math.min(Math.max(percent, this.MIN), this.MAX);
        return `
._871cbca,
._871cbca .aaff8b8f,
.aaff8b8f,
._871cbca ._77cefa5._3d616d3 {
  max-width: ${vw}vw !important;
  width: min(100%, ${vw}vw) !important;
  margin-left: auto !important;
  margin-right: auto !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}`.trim();
    },
});

InputWidth.start();

// === 測試匯出（瀏覽器情境為 no-op） ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InputWidth;
}
