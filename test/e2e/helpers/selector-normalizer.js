// 把 content/ds-selectors.js 匯出的值轉成 querySelectorAll 的參數，供檢查計算每個選擇器在頁面上命中幾個元素。
// 登錄表混有完整選擇器、裸 class 名稱、裸屬性名稱、SVG path 資料與 class 陣列；只有前兩種會轉成選擇器。

const BARE_TAG_NAMES = ['textarea', 'div', 'span', 'a', 'svg', 'input', 'button', 'select', 'form'];

/** 一個登錄值對應的選擇器：完整選擇器與裸標籤名稱原樣回傳，以空白分隔的裸 class 名稱轉成複合 class 選擇器；陣列、SVG path 資料與裸 `data-` 屬性名稱不是選擇器，回傳 null。 */
export function normalizeToSelector(value) {
    if (typeof value !== 'string') return null;
    // SVG path 資料以大寫指令字母開頭（`M7.99…`）。
    if (/^[A-Z]/.test(value)) return null;
    if (/^data-/.test(value)) return null;
    if (/[.#[\]*:>,=]/.test(value)) return value;
    if (BARE_TAG_NAMES.includes(value)) return value;
    if (value.includes(' ')) return value.split(/\s+/).map((name) => `.${name}`).join('');
    return `.${value}`;
}
