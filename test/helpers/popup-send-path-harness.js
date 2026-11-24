/**
 * 執行 popup/popup.js 真實的 sendActivePresetToContentScript，供跨分頁情境測試從彈出視窗端送出群組。
 *
 * 該函式位於 popup.js 的 DOMContentLoaded 閉包內，讀取閉包變數 presets 與 activePresetId，並經由 window.DSSTabControl 送出。本 harness 取出函式原始碼，以 with 範圍提供這兩個閉包變數（由測試控制，等同彈出視窗選取或開啟後的狀態），window 指向本 realm 的全域物件，因此送出經過真實載入的 utils/tab-control.js 與 chrome.tabs 信任邊界。
 *
 * 原始碼一律讀自本 harness 所在樹中的 popup/popup.js：在 Stryker 沙箱內讀到的是插樁後的檔案，因此變異體會在本情境中被啟用並可被殺死。函式範圍與檔案最外層的 stryMutAct_* 等輔助函式都由 popup-closure-source.js 以可編譯判斷取出，不依賴縮排；最外層宣告放在同一範圍，與瀏覽器中閉包看得到的最外層宣告一致。
 *
 * 找不到函式或其結尾時直接拋錯；函式若引用 presets、activePresetId、window 與檔案最外層函式以外的閉包變數，執行時會丟出 ReferenceError，不會被默默替換。
 */
import { readProjectFile } from './popup-script-loader.js';
import { findFunctionDeclaration, topLevelFunctionDeclarations } from './popup-closure-source.js';

const FUNCTION_NAME = 'sendActivePresetToContentScript';

/**
 * @param {{ presets: Array<{id:string, content:string}>, activePresetId?: string|null }} initial 彈出視窗閉包的初始狀態
 * @returns {{ state: { presets: Array, activePresetId: string|null }, send: () => void }}
 */
export function createPopupSendPath({ presets, activePresetId = null }) {
    const popupSource = readProjectFile('popup/popup.js');
    const fnSource = findFunctionDeclaration(popupSource, FUNCTION_NAME);
    if (typeof globalThis.DSSTabControl !== 'object' || globalThis.DSSTabControl === null) {
        throw new Error('globalThis.DSSTabControl 未載入：請先 import utils/tab-control.js，如同 popup.html 在 popup.js 之前載入它');
    }

    const state = { presets, activePresetId };
    const scope = {
        get presets() { return state.presets; },
        get activePresetId() { return state.activePresetId; },
        window: globalThis,
    };
    // new Function 的函式本體為非嚴格模式，可使用 with 把閉包變數接到 state；最外層宣告放在 with 之外，作用同檔案最外層。
    const factory = new Function('scope', `${topLevelFunctionDeclarations(popupSource).join('\n')}\nwith (scope) {\n${fnSource}\nreturn ${FUNCTION_NAME};\n}`);
    return { state, send: factory(scope) };
}
