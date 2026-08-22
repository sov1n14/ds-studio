/**
 * DS studio — Shared DOM Selector Constants
 *
 * 集中管理跨模組重複的 DOM 選擇器字串，避免多處各自維護造成不同步。
 * DeepSeek 為 React 應用，class 名稱帶有雜湊值（如 _6f2c522），
 * 一旦頁面改版，只需修改此檔一處，所有消費端
 *（go-top.js、harvest.dom.js、censor-reply-restore.*.js、content-script.export.js 等）即同步生效。
 *
 * 單一職責：僅匯出常數字串，不含任何邏輯或副作用。
 */

(function () {
    'use strict';

    /** 虛擬列表容器（精確雜湊 class） */
    const VIRTUAL_LIST_SELECTOR = '.ds-virtual-list-items._6f2c522';

    /** 虛擬列表容器（class-substring 降級選擇器） */
    const VIRTUAL_LIST_FALLBACK = '[class*="ds-virtual-list-items"]';

    /** 訊息列表可滾動容器的穩定 class（無雜湊，故以 classList.contains 比對） */
    const SCROLL_AREA_CLASS = 'ds-scroll-area';

    // ─────────────────────────────────────────────────────────────────
    //  語意化 class（DeepSeek 自有的 ds-* 前綴，改版時相對穩定）
    // ─────────────────────────────────────────────────────────────────

    /** 單一訊息節點 */
    const MESSAGE_CLASS = 'ds-message';
    const MESSAGE_SELECTOR = '.ds-message';

    /** 虛擬列表項目包裝所攜帶的 key 屬性 */
    const VIRTUAL_ITEM_KEY_ATTR = 'data-virtual-list-item-key';
    const VIRTUAL_ITEM_KEY_SELECTOR = '[data-virtual-list-item-key]';

    /** 虛擬列表「目前可見項目」容器 */
    const VISIBLE_ITEMS_SELECTOR = '.ds-virtual-list-visible-items';

    /** Markdown 內容容器 */
    const MARKDOWN_CLASS = 'ds-markdown';
    const MARKDOWN_SELECTOR = '.ds-markdown';

    /** 思考過程（think block）內容容器 */
    const THINK_CONTENT_CLASS = 'ds-think-content';
    const THINK_CONTENT_SELECTOR = '.ds-think-content';

    // ─────────────────────────────────────────────────────────────────
    //  混淆雜湊 class（DeepSeek 每次改版都可能更換，故集中於此）
    // ─────────────────────────────────────────────────────────────────

    /** AI 回覆訊息節點（語意 class + 雜湊 class 精確組合） */
    const ASSISTANT_MESSAGE_SELECTOR = '.ds-message._63c77b1';

    /** 使用者訊息的文字內容包裝 */
    const USER_CONTENT_SELECTOR = '.fbb737a4';

    /** 訊息列表的可滾動根容器（與 SCROLL_AREA_CLASS 同一元素） */
    const SCROLL_ROOT_SELECTOR = '._765a5cd';

    /** 思考區塊（think block）的外層容器 */
    const THINK_BLOCK_SELECTOR = '._74c0879';

    /** 思考區塊內容中的分隔／標題列（位於 ds-think-content 內、markdown 之前） */
    const THINK_SEPARATOR_SELECTOR = '._9ecc93a';

    /** 聊天標題列容器（preset overlay 的定位母體） */
    const CHAT_HEADER_SELECTOR = '._2be88ba';

    /** 置中的內容欄外層包裝（對話區與輸入框共用） */
    const CONTENT_COLUMN_SELECTOR = '._871cbca';

    /** 浮動按鈕列容器（原生 go-bottom 按鈕的直接父層） */
    const FLOATING_BUTTON_BAR_SELECTOR = '.aaff8b8f';

    /** 送出按鈕所在的工具列容器 */
    const SEND_BUTTON_CONTAINER_SELECTOR = '.ba4f09d3';

    /** 送出按鈕的直接父層 class（以 classList.contains 比對） */
    const SEND_BUTTON_PARENT_CLASS = 'bf38813a';

    // ─────────────────────────────────────────────────────────────────
    //  送出按鈕結構（桌面版 ds-icon-button / 行動版 ds-button 共用）
    // ─────────────────────────────────────────────────────────────────

    /** 可能為送出按鈕的可點擊容器（桌面版圖示鈕與行動版按鈕兩種變體） */
    const SEND_BUTTON_ROLE_SELECTOR = 'div.ds-icon-button[role="button"], div.ds-button[role="button"]';

    /** 送出圖示的 SVG path 起始字串；以屬性前綴比對，不序列化整個子樹 */
    const SEND_BUTTON_ICON_PATH_PREFIX = 'M8.3125';
    const SEND_BUTTON_ICON_SELECTOR = `svg path[d^="${SEND_BUTTON_ICON_PATH_PREFIX}"]`;

    /** 編輯視窗「傳送」按鈕的變體 class（取消鈕為 outlined 變體，故不符） */
    const EDIT_SEND_BUTTON_VARIANT_CLASSES = ['ds-button--primary', 'ds-button--filled'];

    /** 按鈕的文字內容標籤（純圖示按鈕不具備此節點） */
    const BUTTON_CONTENT_SELECTOR = 'span.ds-button__content';

    /** 按鈕停用狀態的語意化 BEM class */
    const BUTTON_DISABLED_CLASS = 'ds-button--disabled';

    const DSSelectors = {
        VIRTUAL_LIST_SELECTOR, VIRTUAL_LIST_FALLBACK, SCROLL_AREA_CLASS,
        MESSAGE_CLASS, MESSAGE_SELECTOR,
        VIRTUAL_ITEM_KEY_ATTR, VIRTUAL_ITEM_KEY_SELECTOR,
        VISIBLE_ITEMS_SELECTOR,
        MARKDOWN_CLASS, MARKDOWN_SELECTOR,
        THINK_CONTENT_CLASS, THINK_CONTENT_SELECTOR,
        THINK_BLOCK_SELECTOR, THINK_SEPARATOR_SELECTOR,
        ASSISTANT_MESSAGE_SELECTOR, USER_CONTENT_SELECTOR,
        SCROLL_ROOT_SELECTOR, CHAT_HEADER_SELECTOR,
        CONTENT_COLUMN_SELECTOR, FLOATING_BUTTON_BAR_SELECTOR,
        SEND_BUTTON_CONTAINER_SELECTOR, SEND_BUTTON_PARENT_CLASS,
        SEND_BUTTON_ROLE_SELECTOR,
        SEND_BUTTON_ICON_PATH_PREFIX, SEND_BUTTON_ICON_SELECTOR,
        EDIT_SEND_BUTTON_VARIANT_CLASSES,
        BUTTON_CONTENT_SELECTOR, BUTTON_DISABLED_CLASS,
    };

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DSSelectors;
    }

    // 透過 window.DSstudio 供同層模組（go-top.js、harvest.js 等）呼叫
    if (typeof window !== 'undefined') {
        window.DSstudio = window.DSstudio || {};
        window.DSstudio.Selectors = DSSelectors;
    }
})();
