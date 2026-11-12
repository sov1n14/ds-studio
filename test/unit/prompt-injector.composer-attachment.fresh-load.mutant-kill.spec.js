// @vitest-environment jsdom
/**
 * hasComposerAttachment（content/prompt-injector.send-button.js）的附件判定規則，模組於每個測試內重新載入。
 *
 * 規則來源（docs/spec/01-prompt-system.md §2「Attachment signal」）：只有主輸入框 textarea[name="search"] 可能為 true；其「專屬包裝層」是最近一個含動作列（實測 class bf38813a）且只含一個 textarea 的祖先；包裝層的父層若另有不含此 textarea、且非本擴充功能注入（id 或任一 class 以 dss- 開頭）的子元素，即為有附件。其他 textarea（例如編輯框）一律視為沒有附件。
 *
 * 為何每個測試重新載入：擴充功能前綴與動作列選擇器是檔案載入時就算好的值，test/stryker.config.json 設定 "ignoreStatic": true，這類值的變異只會對「在測試內載入檔案」的測試執行；在檔案頂層 import 的 spec 擋不到它們。
 *
 * 夾具全部取自實測 DOM：makeLiveComposerBox（tools/captures/composer-attach-*.html）與 test/fixtures/ds-snapshots/edit-window-chat-pane.html；需要特殊狀態時只對實測結構做最小改動（換掉一個 class 或 name），保留真實的巢狀與兄弟順序。
 * 使用 jsdom，因為本檔斷言依 DOM 結構判斷（testing-pitfalls：DOM Fixture Completeness）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { makeLiveComposerBox, mountInDocument } from '../helpers/send-button-fixtures.js';

const SELECTORS_PATH = require.resolve('../../content/ds-selectors.js');
const SEND_BUTTON_PATH = require.resolve('../../content/prompt-injector.send-button.js');
const EDIT_PANE_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/edit-window-chat-pane.html'), 'utf8');

/** 從頭載入 ds-selectors.js 與 prompt-injector.send-button.js，不留先前發布的 Selectors 全域物件。 */
function loadFreshSendButton() {
    delete require.cache[SELECTORS_PATH];
    delete require.cache[SEND_BUTTON_PATH];
    if (globalThis.DSstudio) delete globalThis.DSstudio.Selectors;
    require(SELECTORS_PATH);
    return require(SEND_BUTTON_PATH);
}

/** 由 HTML 字串建出單一元素，模擬擴充功能掛進輸入框外框的節點。 */
function htmlToElement(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.firstElementChild;
}

/** 掛上實測輸入框外框（可選附件卡片），並把 extraSibling（若有）放在包裝層前面，也就是附件卡片所在的位置。 */
function mountComposer({ attachment = null, extraSibling = null } = {}) {
    const composer = makeLiveComposerBox({ value: '', attachment });
    if (extraSibling) composer.box.insertBefore(htmlToElement(extraSibling), composer.wrapper);
    cleanup = mountInDocument(composer.box);
    return composer;
}

let SB;
let cleanup = null;

beforeEach(() => { SB = loadFreshSendButton(); });
afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.innerHTML = '';
});

describe('hasComposerAttachment on the live composer box (fresh module load)', () => {
    it('returns true when the live file card sits beside the composer wrapper', () => {
        const { textarea } = mountComposer({ attachment: 'file' });
        expect(SB.hasComposerAttachment(textarea)).toBe(true);
    });

    it('returns false for the live composer box with no card', () => {
        const { textarea } = mountComposer();
        expect(SB.hasComposerAttachment(textarea)).toBe(false);
    });
});

describe('hasComposerAttachment ignores extension-injected siblings (id or any class starting with dss-)', () => {
    // 擴充功能實際使用的 id（content/preset-dropdown.component.js）；根元素本身只有 id、沒有 dss- class。
    it('returns false when the only sibling carries the extension id prefix and no class', () => {
        const { textarea } = mountComposer({ extraSibling: '<div id="dss-preset-overlay" role="combobox"></div>' });
        expect(SB.hasComposerAttachment(textarea)).toBe(false);
    });

    // 擴充功能實際使用的 class（content/temporary-chat-toggle.ui.js）；沒有 id。
    it('returns false when the only sibling carries a single dss- class and no id', () => {
        const { textarea } = mountComposer({ extraSibling: '<div class="dss-temp-chat-row"></div>' });
        expect(SB.hasComposerAttachment(textarea)).toBe(false);
    });

    // 規則是「任一 class 以 dss- 開頭」：擴充功能會在頁面元素上加 dss- class（content/censor-reply-restore.dom.inject.js），所以同一元素可能同時帶頁面 class 與 dss- class。
    it('returns false when the only sibling mixes a page class with one dss- class', () => {
        const { textarea } = mountComposer({ extraSibling: '<div class="_9ebd84c dss-censored-hidden"></div>' });
        expect(SB.hasComposerAttachment(textarea)).toBe(false);
    });
});

describe('hasComposerAttachment without an own composer wrapper returns false', () => {
    // 動作列 class 是雜湊 class，DeepSeek 改版會換掉；換掉後頁面上沒有任何動作列，主輸入框就沒有專屬包裝層。附件卡片仍在，但規則要求先有專屬包裝層。
    it('returns false (and does not throw) when the actions row class is rotated, although the live file card is present', () => {
        const { wrapper, textarea } = mountComposer({ attachment: 'file' });
        wrapper.querySelector('.bf38813a').className = 'c0ffee00';

        expect(SB.hasComposerAttachment(textarea)).toBe(false);
    });

    // 專屬包裝層只在 document.body 以下找：動作列不在主輸入框的任何祖先裡時（例如改版後動作列改由頁面另外掛在 body 下的容器渲染），body 雖然含動作列、也只含這一個 textarea，仍不是輸入框包裝層；否則 body 的父層 <html> 底下的 <head> 會被當成附件卡片。夾具是實測輸入框外框（無卡片），只把動作列 .bf38813a 從包裝層搬到 body 下另一個容器，頁面上沒有任何附件卡片。
    it('returns false when no card exists and the actions row sits outside the main input ancestors, elsewhere under document.body', () => {
        const { wrapper, textarea } = mountComposer();
        const row = wrapper.querySelector('.bf38813a');
        const detachedRowHost = document.createElement('div');
        detachedRowHost.appendChild(row);
        document.body.appendChild(detachedRowHost);

        expect(document.head, 'precondition: the document has a <head> beside <body> under <html>').not.toBeNull();
        expect(document.querySelectorAll('.bf38813a').length, 'precondition: exactly one actions row in the page').toBe(1);
        expect(wrapper.contains(row), 'precondition: the row is no longer inside the composer wrapper').toBe(false);
        expect(document.querySelectorAll('textarea').length, 'precondition: the main input is the only textarea').toBe(1);
        expect(document.querySelector('.b40079d7'), 'precondition: no attachment card anywhere in the page').toBeNull();

        expect(SB.hasComposerAttachment(textarea), 'no file or image is attached, so the attachment signal must be false').toBe(false);
    });

    // 實測編輯視窗快照：編輯框往上第一個含動作列的祖先是整個訊息虛擬列表（同時裝著主輸入框），其父層還有頁首兄弟 div._2be88ba。把編輯框的 name 改成主輸入框的 name，只剩「包裝層只含一個 textarea」這條規則能擋下頁首被誤認成附件。
    it('returns false for an edit box renamed to the main-input name in the live edit-window snapshot, whose nearest row-holding ancestor holds two textareas', () => {
        document.body.innerHTML = EDIT_PANE_HTML.replace('name="user query"', 'name="search"');
        const textareas = document.querySelectorAll('textarea[name="search"]');
        expect(textareas.length, 'precondition: the edit box and the main input both carry name="search"').toBe(2);
        const editBox = textareas[0];
        expect(editBox.classList.contains('ds-textarea__textarea'), 'precondition: the first one is the edit box').toBe(true);

        expect(SB.hasComposerAttachment(editBox)).toBe(false);
    });
});

describe('hasComposerAttachment for a textarea that is not the main input returns false', () => {
    // 實測輸入框外框帶檔案卡片，只把 textarea 的 name 換成編輯框的 name：結構上看得到卡片，但規則只認主輸入框。
    it('returns false for a textarea named like the edit box inside the live composer box with a file card', () => {
        const { textarea } = mountComposer({ attachment: 'file' });
        textarea.setAttribute('name', 'user query');

        expect(SB.hasComposerAttachment(textarea)).toBe(false);
    });
});
