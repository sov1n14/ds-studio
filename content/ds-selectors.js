// 402 lines: pure constant mapping table — every selector targets DeepSeek's DOM and rotates together on upstream UI updates; splitting would scatter co-dependent selectors across files and multiply the cost of each DeepSeek class-name rotation
/**
 * DS studio — Shared DOM Selector Constants
 *
 * 集中管理跨模組重複的 DOM 選擇器字串，避免多處各自維護造成不同步。
 * DeepSeek 為 React 應用，混淆 class 名稱帶有雜湊值且改版即輪換，
 * 故定位優先採用 ds-* 語意 class、屬性與 DOM 結構組成的選擇器；
 * 一旦頁面改版，只需修改此檔一處，所有消費端
 *（go-top.js、harvest.dom.js、censor-reply-restore.*.js、content-script.export.js 等）即同步生效。
 *
 * 單一職責：僅匯出常數字串，不含任何邏輯或副作用。
 */

// Stryker disable StringLiteral: 純常數模組，選擇器字串的變異只能用逐字比對來殺，屬反模式（tautological assertion）
// NOTE: SVG path data in go-top.render.combined.js is a distinct case from selectors here — selectors rotate as DeepSeek updates its UI, while SVG paths are stable author-controlled values (the go-top path data is copied verbatim from DeepSeek's native chevron icon and flipped upward at render time via transform:scaleY(-1)). The Stryker disable on selectors does not extend a blanket exemption to SVG paths; those are tested by coordinate assertions in the mutant-killer spec.
(function () {
    'use strict';

    // ---------------------------------------------------------------
    //  結構選擇器的共用組件（僅供本檔組合，不匯出）
    // ---------------------------------------------------------------

    /** 訊息列表的可滾動根節點（ds-virtual-list 與 ds-scroll-area 並存的元素） */
    const MESSAGE_LIST_ROOT_SELECTOR = '.ds-virtual-list.ds-scroll-area';

    /** 主輸入框 textarea（以 name 屬性區分編輯框等其他 textarea） */
    const MAIN_TEXTAREA_SELECTOR = 'textarea[name="search"]';

    /** 虛擬列表項目容器：訊息列表根節點的直接子層 */
    const VIRTUAL_LIST_SELECTOR = MESSAGE_LIST_ROOT_SELECTOR + ' > .ds-virtual-list-items';

    /** 虛擬列表容器（class-substring 降級選擇器） */
    const VIRTUAL_LIST_FALLBACK = '[class*="ds-virtual-list-items"]';

    /** 訊息列表可滾動容器的穩定 class（無雜湊，故以 classList.contains 比對） */
    const SCROLL_AREA_CLASS = 'ds-scroll-area';

    // ---------------------------------------------------------------
    //  語意化 class（DeepSeek 自有的 ds-* 前綴，改版時相對穩定）
    // ---------------------------------------------------------------

    /** 單一訊息節點 */
    const MESSAGE_CLASS = 'ds-message';
    const MESSAGE_SELECTOR = '.ds-message';

    /** 虛擬列表項目包裝所攜帶的 key 屬性 */
    const VIRTUAL_ITEM_KEY_ATTR = 'data-virtual-list-item-key';
    const VIRTUAL_ITEM_KEY_SELECTOR = '[data-virtual-list-item-key]';

    /** 虛擬列表「目前可見項目」容器 */
    const VISIBLE_ITEMS_SELECTOR = '.ds-virtual-list-visible-items';

    /** 可見的虛擬列表項目包裝（共用組件，不匯出） */
    const VISIBLE_ITEM_SELECTOR = VIRTUAL_LIST_SELECTOR + ' > ' + VISIBLE_ITEMS_SELECTOR + ' > ' + VIRTUAL_ITEM_KEY_SELECTOR;

    /** 使用者訊息的虛擬列表項目包裝：含可摺疊文字的項目（共用組件，不匯出） */
    const USER_MESSAGE_ITEM_SELECTOR = VISIBLE_ITEM_SELECTOR + ':has(.ds-collapsible-text)';

    /** Markdown 內容容器 */
    const MARKDOWN_CLASS = 'ds-markdown';
    const MARKDOWN_SELECTOR = '.ds-markdown';

    /** 思考過程（think block）內容容器 */
    const THINK_CONTENT_CLASS = 'ds-think-content';
    const THINK_CONTENT_SELECTOR = '.ds-think-content';

    /** AI 訊息主內容包裝 */
    const ASSISTANT_MAIN_CONTENT_SELECTOR = '.ds-assistant-message-main-content';

    /** 匯出 markdown 中的引用標記 */
    const MARKDOWN_CITE_SELECTOR = '.ds-markdown-cite';

    /** 新版設計的工具列圖示按鈕 */
    const ICON_BUTTON_ROLE_SELECTOR = '[role="button"].ds-button.ds-button--icon';

    /** DeepSeek 通用 flex 列（工具列降級掃描） */
    const FLEX_ROW_SELECTOR = '.ds-flex';

    /** 輸入列切換按鈕 */
    const TOGGLE_BUTTON_SELECTOR = '.ds-toggle-button[aria-pressed]';

    /** 切換按鈕的成對降級候選集合 */
    const TOGGLE_BUTTON_FALLBACK_SELECTOR = '[aria-pressed="true"], [aria-pressed="false"]';

    /** 浮動／下拉的定位根容器 */
    const FLOATING_POSITION_WRAPPER_SELECTOR = '.ds-floating-position-wrapper';

    /** 重試按鈕主要選擇器（語意 ds-* class） */
    const RETRY_BUTTON_SELECTOR = '.ds-button--warning.ds-button--circle.ds-button--xs';

    /** 繼續生成按鈕主要選擇器（hash 容器下的 ds-button） */
    const CONTINUE_BUTTON_SELECTOR = '._8e85838 > .ds-button[role="button"]';

    /** 繼續生成按鈕備援選擇器（hash class） */
    const CONTINUE_BUTTON_FALLBACK_SELECTOR = '._6eef0b0';

    /** 程式碼區塊容器 class（以 includes 比對） */
    const CODE_BLOCK_CLASS = 'md-code-block';

    /** 主輸入框 textarea（僅匹配主輸入框；訊息編輯框開啟時頁面另有 textarea，故不可用通用標籤選擇器） */
    const INPUT_TEXTAREA_SELECTOR = MAIN_TEXTAREA_SELECTOR;

    /** 頁面上所有 textarea（含訊息編輯框，供編輯視窗路徑在多個 textarea 中定位編輯框） */
    const ANY_TEXTAREA_SELECTOR = 'textarea';

    /** 以 role="button" 標記的 div 按鈕（新版設計的可點擊容器） */
    const ROLE_BUTTON_DIV_SELECTOR = 'div[role="button"]';

    // ---------------------------------------------------------------
    //  雜湊 class 與結構選擇器（雜湊 class 每次改版都可能更換，故集中於此）
    // ---------------------------------------------------------------

    // ── 使用者訊息 ──

    /** 使用者訊息的文字內容包裝：.ds-message 底下直接包住可摺疊文字的子層 */
    const USER_CONTENT_SELECTOR = MESSAGE_SELECTOR + ' > div:has(> .ds-collapsible-text)';

    // ── 滾動區域 ──

    /** 包住訊息列表（.ds-virtual-list.ds-scroll-area）的主窗格外層容器（本身不可滾動），作為 MutationObserver 觀察根節點 */
    const SCROLL_ROOT_SELECTOR = '._765a5cd';

    // ── Think block ──

    /** 思考區塊（think block）外層容器的裸 class */
    const THINK_BLOCK_CLASS = '_74c0879';

    /** 思考區塊外層容器：.ds-message 的直接子層，其標題列依序排列圖示、狀態文字、箭頭圖示 */
    const THINK_BLOCK_SELECTOR = MESSAGE_SELECTOR + ' > div:has(> div > div > .ds-icon:first-child + span + .ds-icon)';

    /** 思考區塊分隔／標題列的裸 class */
    const THINK_SEPARATOR_CLASS = '_9ecc93a';

    /** 思考區塊內容中的分隔／標題列：ds-think-content 內緊接在 markdown 之前的子層 */
    const THINK_SEPARATOR_SELECTOR = '.ds-think-content > :has(+ .ds-markdown)';

    /** think block 標題列的雜湊 class */
    const THINK_HEADER_CLASS = '_245c867 _34a54ec';
    /** 可點擊的思考區塊標題列：思考區塊外層容器的第一個子層 */
    const THINK_HEADER_TOGGLE_SELECTOR = THINK_BLOCK_SELECTOR + ' > div:first-child';

    /** think block 間距層的雜湊 class */
    const THINK_SPACER_CLASS = 'c2b72bb8';

    /** think block 內容外層的雜湊 class */
    const THINK_CONTENT_OUTER_CLASS = 'e1675d8b';

    /** think block 內容修飾器的雜湊 class */
    const THINK_CONTENT_MODIFIER_CLASS = '_767406f';

    /** think block 載入動畫的雜湊 class */
    const THINK_LOADING_DOTS_CLASS = 'ddd26891 _9b52f6c';

    /** think block 尾部的雜湊 class */
    const THINK_FOOTER_CLASS = '_8f7678d';

    /** think block 火花／原子圖示的雜湊 class */
    const THINK_ICON_CLASS = '_970ac5e';

    /** think block 標題列圖示行的雜湊 class */
    const THINK_HEADER_ICON_ROW_CLASS = '_5ab5d64';

    /** think block 狀態時間 span 的雜湊 class */
    const THINK_TIME_CLASS = '_4d41763';

    /** think block 分隔線的雜湊 class */
    const THINK_DIVIDER_CLASS = 'c99b79f8';

    /** think block 內容包裝層的雜湊 class */
    const THINK_CONTENT_WRAPPER_CLASS = 'a510c7ce';

    /** think block 內層內容的雜湊 class */
    const THINK_INNER_CONTENT_CLASS = '_0652043';

    // ── 標題列與內容欄 ──

    /** 聊天標題列容器：直接包住 .the-header 的 div（preset overlay 的定位母體） */
    const CHAT_HEADER_SELECTOR = 'div:has(> .the-header)';

    /** 新對話頁的標題列容器：其後沒有訊息列表兄弟節點 */
    const NEW_CHAT_HEADER_MODIFIER_SELECTOR = CHAT_HEADER_SELECTOR + ':not(:has(~ .ds-virtual-list))';

    /** 置中的內容欄外層包裝：訊息列表根節點底下含主輸入框的直接子層（對話區與輸入框共用） */
    const CONTENT_COLUMN_SELECTOR = MESSAGE_LIST_ROOT_SELECTOR + ' > div:has(' + MAIN_TEXTAREA_SELECTOR + ')';

    /** 輸入區編輯器外層包裝：訊息列表根節點下第三層、包住主輸入框的卡片（獨立使用，不接在內容欄之後） */
    const INPUT_COMPOSER_WRAPPER_SELECTOR = MESSAGE_LIST_ROOT_SELECTOR + ' > div > div > div:has(> div > div > ' + MAIN_TEXTAREA_SELECTOR + ')';

    // ── 浮動按鈕列 ──

    /** 浮動按鈕列容器：主輸入框往上第四層的 div（原生 go-bottom 按鈕的直接父層） */
    const FLOATING_BUTTON_BAR_SELECTOR = 'div:has(> div > div > div > ' + MAIN_TEXTAREA_SELECTOR + ')';

    /** 浮動按鈕列容器（與 FLOATING_BUTTON_BAR_SELECTOR 相同，選擇器本身已限定 div 標籤） */
    const FLOATING_BUTTON_BAR_DIV_SELECTOR = FLOATING_BUTTON_BAR_SELECTOR;

    // ── 訊息工具列 ──

    /** 訊息工具列群組容器：至少有五個直接子按鈕的 ds-flex 列 */
    const MESSAGE_TOOLBAR_SELECTOR = '.ds-flex:has(> [role="button"]:nth-child(5))';

    /** think 區塊狀態文字 span 的雜湊 class（重建 think block 時寫入） */
    const THINK_STATUS_CLASS = '_5255ff8';

    /** think 區塊狀態文字：標題列內的狀態 span */
    const THINK_STATUS_SELECTOR = THINK_HEADER_TOGGLE_SELECTOR + ' > div > span';

    /** think 區塊參考標籤：思考區塊內不含連結、且下一個兄弟 div 直接含連結的 div */
    const THINK_REFERENCE_LABEL_SELECTOR = THINK_BLOCK_SELECTOR + ' div:not(:has(a)):has(+ div > a[href])';

    /** think 區塊參考連結：思考區塊內帶 href 的連結 */
    const THINK_REFERENCE_LINK_SELECTOR = THINK_BLOCK_SELECTOR + ' a[href]';

    // ── 編輯區域 ──

    /** 編輯訊息按鈕：使用者訊息項目工具列中帶 aria-disabled 的圖示按鈕 */
    const EDIT_MESSAGE_BUTTON_SELECTOR = USER_MESSAGE_ITEM_SELECTOR + ' .ds-flex > .ds-button--icon[aria-disabled]';

    /** 編輯框容器（清除 max-height） */
    const EDIT_BOX_SELECTOR = '.cc852ac5';

    /** 被賦予計算後 max-height 的容器 */
    const EDIT_BOX_HEIGHT_CONTAINER_SELECTOR = '._646a522';

    // ── Mobile Homepage Cleanup ──

    /** 行動裝置首頁「下载应用」元素的雜湊 class */
    const HOMEPAGE_MOBILE_CLEANUP_SELECTOR = '._9579690';

    // ── 虛擬列表 ──

    /** 編輯清理模組使用的虛擬列表項目容器（與 VIRTUAL_LIST_SELECTOR 指向同一元素） */
    const VIRTUAL_LIST_CONTAINER_SELECTOR = VIRTUAL_LIST_SELECTOR;

    // ── Sidebar ──

    /** 側邊欄外層包裝：其子層內含兩層巢狀 ds-scroll-area 的 div */
    const SIDEBAR_WRAPPER_SELECTOR = 'div:has(> div > .ds-scroll-area > .ds-scroll-area)';

    /** 側欄 wrapper 原生收合狀態：收合時 wrapper 底下多出收合軌道，直屬子層變成兩個 div；展開時軌道移除只剩內層 */
    const SIDEBAR_WRAPPER_COLLAPSED_SELECTOR = SIDEBAR_WRAPPER_SELECTOR + ':has(> div:nth-child(2))';

    /** 側邊欄內層內容：直接包住兩層巢狀 ds-scroll-area 的 div */
    const SIDEBAR_INNER_SELECTOR = 'div:has(> .ds-scroll-area > .ds-scroll-area)';

    /** DeepSeek 自有的收合軌道：側邊欄外層包裝底下不含 ds-scroll-area 的子層 */
    const SIDEBAR_NATIVE_COLLAPSED_SELECTOR = SIDEBAR_WRAPPER_SELECTOR + ' > div:not(:has(.ds-scroll-area))';

    /** 側邊欄對話列連結（以 href 定位，class 改版時仍可存活） */
    const SIDEBAR_CHAT_LINK_SELECTOR = 'a[href*="/a/chat/s/"]';

    /** 側邊欄日期分組容器：直接包住對話列連結的 div（同組共用一個日期標籤） */
    const SIDEBAR_DATE_GROUP_SELECTOR = 'div:has(> ' + SIDEBAR_CHAT_LINK_SELECTOR + ')';

    /** 側邊欄日期標籤的雜湊 class */
    const SIDEBAR_DATE_LABEL_CLASS = 'f3d18f6a';

    /** 側邊欄對話標題的雜湊 class */
    const SIDEBAR_TITLE_CLASS = 'c08e6e93';

    /** 側邊欄對話動作按鈕的雜湊 class */
    const SIDEBAR_ACTIONS_CLASS = '_254829d';

    /** 收合軌道上的「展開側邊欄」按鈕（語意 class 加側欄圖示 path 前綴；排除展開態 tertiary 與行動版 xl 變體） */
    const SIDEBAR_OPEN_BUTTON_SELECTOR = 'div.ds-button--iconLabelPrimary.ds-button--m[role="button"]:has(path[d^="M9.67272"])';

    /** 窄版型 header 的漢堡按鈕；可見時代表行動版型，自動開啟側欄不點擊 */
    const SIDEBAR_HAMBURGER_BUTTON_SELECTOR = 'div.ds-button--xl[role="button"]:has(path[d^="M17.2027"])';

    /** 標題列（title row）包裝：直接含按鈕子層的 .the-header */
    const CHAT_HEADER_TITLE_ROW_SELECTOR = '.the-header:has(> [role="button"])';

    /** 聊天標題節點降級：.the-header 內緊接在第一個按鈕之後的 div */
    const CHAT_TITLE_FALLBACK_SELECTOR = '.the-header > [role="button"] + div';

    // ── Go-top ──

    /** DeepSeek 原生回到頂端按鈕的定位 class */
    const GO_TOP_NATIVE_BUTTON_CLASS = '_0706cde';

    /** 回到頂部錨點選擇器（精確雜湊 class 組合） */
    const GO_TOP_ANCHOR_SELECTOR = '._9663006._2c189bc';

    /** 回到頂部錨點降級：使用者訊息項目，或含編輯框的項目（編輯中的使用者訊息） */
    const GO_TOP_ANCHOR_FALLBACK1_SELECTOR = USER_MESSAGE_ITEM_SELECTOR + ', ' + VISIBLE_ITEM_SELECTOR + ':has(.ds-textarea)';

    // ---------------------------------------------------------------
    //  送出按鈕結構（ds-button 變體）
    // ---------------------------------------------------------------

    /** 可能為送出按鈕的可點擊容器 */
    const SEND_BUTTON_ROLE_SELECTOR = 'div.ds-button[role="button"]';

    /** 送出按鈕列容器的雜湊 class */
    const SEND_BUTTON_ROW_CLASS = 'bf38813a';
    /** 送出圖示的 SVG path 起始字串；以屬性前綴比對，不序列化整個子樹 */
    const SEND_BUTTON_ICON_SELECTOR = 'svg path[d^="M8.3125"]';

    /** 搜尋圖示的 SVG path 起始字串（語言無關的定位基準） */
    const SEARCH_ICON_PATH_PREFIX = 'M7.9995999336';

    /** 浮動按鈕 */
    const DS_BUTTON_FLOATING_CLASS = 'ds-button--floating';
    /** 圓形按鈕 */
    const DS_BUTTON_CIRCLE_CLASS = 'ds-button--circle';
    /** 主要按鈕 */
    const DS_BUTTON_PRIMARY_CLASS = 'ds-button--primary';
    /** 實心按鈕 */
    const DS_BUTTON_FILLED_CLASS = 'ds-button--filled';

    /** 編輯視窗「傳送」按鈕的變體 class（取消鈕為 outlined 變體，故不符） */
    const EDIT_SEND_BUTTON_VARIANT_CLASSES = [DS_BUTTON_PRIMARY_CLASS, DS_BUTTON_FILLED_CLASS];

    /** 按鈕的文字內容標籤（純圖示按鈕不具備此節點） */
    const BUTTON_CONTENT_SELECTOR = 'span.ds-button__content';

    /** 按鈕停用狀態的語意化 BEM class */
    const BUTTON_DISABLED_CLASS = 'ds-button--disabled';

    /** 展開按鈕外層容器：可摺疊文字切換鈕底下直接含圖示的子層 */
    const EXPAND_BUTTON_CONTAINER_SELECTOR = '.ds-collapsible-text-toggle-button > div:has(> .ds-icon)';

    /** 展開按鈕圖示：可摺疊文字切換鈕內的 ds-icon */
    const EXPAND_BUTTON_ICON_SELECTOR = '.ds-collapsible-text-toggle-button .ds-icon';

    /** 已確認排除的雜湊 class（位於 preset-overlay wrapper 外部） */
    const STRAY_BUTTON_CLASS = '_57370c5';

    // ---------------------------------------------------------------
    //  按鈕變體 class（mobile-sidebar-swipe、go-top 等模組共用）
    // ---------------------------------------------------------------

    /** 膠囊型按鈕 */
    const DS_BUTTON_CAPSULE_CLASS = 'ds-button--capsule';
    /** 主要圖文按鈕 */
    const DS_BUTTON_ICON_LABEL_PRIMARY_CLASS = 'ds-button--iconLabelPrimary';
    /** 第三層圖文按鈕 */
    const DS_BUTTON_ICON_LABEL_TERTIARY_CLASS = 'ds-button--iconLabelTertiary';
    /** 加大按鈕 */
    const DS_BUTTON_XL_CLASS = 'ds-button--xl';

    const DSSelectors = {
        VIRTUAL_LIST_SELECTOR, VIRTUAL_LIST_FALLBACK, SCROLL_AREA_CLASS,
        MESSAGE_CLASS, MESSAGE_SELECTOR,
        VIRTUAL_ITEM_KEY_ATTR, VIRTUAL_ITEM_KEY_SELECTOR,
        VISIBLE_ITEMS_SELECTOR,
        MARKDOWN_CLASS, MARKDOWN_SELECTOR,
        THINK_CONTENT_CLASS, THINK_CONTENT_SELECTOR,
        ASSISTANT_MAIN_CONTENT_SELECTOR, MARKDOWN_CITE_SELECTOR,
        ICON_BUTTON_ROLE_SELECTOR,
        FLEX_ROW_SELECTOR,
        INPUT_TEXTAREA_SELECTOR, ANY_TEXTAREA_SELECTOR, ROLE_BUTTON_DIV_SELECTOR,
        TOGGLE_BUTTON_SELECTOR, TOGGLE_BUTTON_FALLBACK_SELECTOR,
        RETRY_BUTTON_SELECTOR, CONTINUE_BUTTON_SELECTOR, CONTINUE_BUTTON_FALLBACK_SELECTOR,
        FLOATING_POSITION_WRAPPER_SELECTOR, CODE_BLOCK_CLASS,
        THINK_BLOCK_CLASS, THINK_BLOCK_SELECTOR,
        THINK_SEPARATOR_CLASS, THINK_SEPARATOR_SELECTOR,
        THINK_HEADER_CLASS, THINK_HEADER_TOGGLE_SELECTOR, THINK_SPACER_CLASS,
        THINK_CONTENT_OUTER_CLASS, THINK_CONTENT_MODIFIER_CLASS,
        THINK_LOADING_DOTS_CLASS, THINK_FOOTER_CLASS,
        THINK_ICON_CLASS, THINK_HEADER_ICON_ROW_CLASS, THINK_TIME_CLASS, THINK_DIVIDER_CLASS,
        THINK_CONTENT_WRAPPER_CLASS, THINK_INNER_CONTENT_CLASS,
        USER_CONTENT_SELECTOR,
        SCROLL_ROOT_SELECTOR, CHAT_HEADER_SELECTOR, NEW_CHAT_HEADER_MODIFIER_SELECTOR,
        CONTENT_COLUMN_SELECTOR, INPUT_COMPOSER_WRAPPER_SELECTOR, FLOATING_BUTTON_BAR_SELECTOR, FLOATING_BUTTON_BAR_DIV_SELECTOR,
        MESSAGE_TOOLBAR_SELECTOR, THINK_STATUS_CLASS, THINK_STATUS_SELECTOR,
        THINK_REFERENCE_LABEL_SELECTOR, THINK_REFERENCE_LINK_SELECTOR,
        EDIT_MESSAGE_BUTTON_SELECTOR,
        EDIT_BOX_SELECTOR, EDIT_BOX_HEIGHT_CONTAINER_SELECTOR, HOMEPAGE_MOBILE_CLEANUP_SELECTOR,
        VIRTUAL_LIST_CONTAINER_SELECTOR,
        SIDEBAR_WRAPPER_SELECTOR, SIDEBAR_INNER_SELECTOR, SIDEBAR_NATIVE_COLLAPSED_SELECTOR,
        SIDEBAR_DATE_GROUP_SELECTOR, SIDEBAR_DATE_LABEL_CLASS, SIDEBAR_CHAT_LINK_SELECTOR,
        SIDEBAR_TITLE_CLASS, SIDEBAR_ACTIONS_CLASS, SIDEBAR_OPEN_BUTTON_SELECTOR,
        SIDEBAR_HAMBURGER_BUTTON_SELECTOR, SIDEBAR_WRAPPER_COLLAPSED_SELECTOR,
        CHAT_HEADER_TITLE_ROW_SELECTOR, CHAT_TITLE_FALLBACK_SELECTOR,
        GO_TOP_NATIVE_BUTTON_CLASS,
        GO_TOP_ANCHOR_SELECTOR, GO_TOP_ANCHOR_FALLBACK1_SELECTOR,
        SEND_BUTTON_ROW_CLASS,
        SEND_BUTTON_ROLE_SELECTOR,
        SEND_BUTTON_ICON_SELECTOR,
        SEARCH_ICON_PATH_PREFIX,
        EDIT_SEND_BUTTON_VARIANT_CLASSES,
        BUTTON_CONTENT_SELECTOR, BUTTON_DISABLED_CLASS,
        EXPAND_BUTTON_CONTAINER_SELECTOR, EXPAND_BUTTON_ICON_SELECTOR, STRAY_BUTTON_CLASS,
        DS_BUTTON_CAPSULE_CLASS, DS_BUTTON_ICON_LABEL_PRIMARY_CLASS,
        DS_BUTTON_ICON_LABEL_TERTIARY_CLASS, DS_BUTTON_XL_CLASS,
        DS_BUTTON_FLOATING_CLASS, DS_BUTTON_CIRCLE_CLASS, DS_BUTTON_PRIMARY_CLASS, DS_BUTTON_FILLED_CLASS,
    };

    // Stryker disable all: equivalent mutants — module/window type checks are environment-dependent, untestable in Node
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
// Stryker restore all
