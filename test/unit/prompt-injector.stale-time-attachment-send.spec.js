// @vitest-environment jsdom
/**
 * 只含舊 `Current Time:` 行的輸入框送出時的行為（docs/FEATURES.md「Duplicate Prevention」、docs/spec/04-features.md §19、docs/spec/01-prompt-system.md §2；4.39.11 changelog：沒有附件、只有時間戳的輸入不送出且內容不變）。
 *
 * 文件規則：輸入框只有一行時間戳時不送出，除非有附件或圖片；有附件時舊行換成一行新時間，再接群組或全域提示詞的 `<system-reminder>` 區塊，不包 `<user-input>`；Enter 與點送出鈕兩條路徑皆適用。
 *
 * 實測事實（擴充功能已載入、系統時間開啟、已選群組）：輸入框只有舊時間行時，不論有無附件，送出鈕都是啟用狀態，按 Enter 會原封不動送出舊時間行；只有空輸入框且無附件時送出鈕才停用。所以送出鈕狀態分不出有無附件。
 * 附件在 DOM 上的樣子（tools/captures/composer-attach-*.html）：輸入框外框 div._77cefa5 內的包裝層 div._020ab5b 裝著 textarea[name="search"] 與動作列 .bf38813a；附上檔案或圖片時，外框多出附件卡片 div.b40079d7._2113217，是包裝層的兄弟元素、排在它前面；移除後卡片消失。隱藏的 input[type=file] 永遠在動作列裡，不是訊號。
 * 編輯視窗（test/fixtures/ds-snapshots/edit-window-chat-pane.html）：編輯框 textarea[name="user query"] 沒有自己的動作列，往上找第一個含 .bf38813a 的祖先是整個訊息虛擬列表，其父層還有頁首 div._2be88ba 這個兄弟，但那不是附件。
 *
 * 觀察點只有頁面看得到的結果：頁面替身（pageSends）在送出鈕的 click 或輸入框的 Enter 抵達頁面、未被 preventDefault、且送出鈕未停用時，記下當下的輸入框值；另外斷言原始事件是否被攔截，以及被擋下時輸入框值不變。不斷言任何內部呼叫順序。
 * 使用 jsdom，因為本檔斷言依 DOM 結構判斷附件（testing-pitfalls：DOM Fixture Completeness）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../content/ds-selectors.js';
import '../../content/prompt-injector.send-button.js';
import '../../content/prompt-injector.controller.js';
import { makeLiveComposerBox, makeEditSendButtonInContainer, mountInDocument, dispatchClick } from '../helpers/send-button-fixtures.js';

const { createPromptInjector } = globalThis.__DS_PromptInjector;

const EDIT_PANE_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/edit-window-chat-pane.html'), 'utf8');

// 新時間與舊時間刻意不同，斷言才分得出「換新」與「原封不動」。
const FRESH_TIME = '2026/11/12 10:00:00 (UTC+08:00)';
const STALE_LINE = 'Current Time: 2001/02/03 04:05:06 (UTC+00:00)';
const GROUP_CONTENT = 'G';
const FRESH_LINE = `Current Time: ${FRESH_TIME}`;
const GROUP_BLOCK = `<system-reminder>\n${GROUP_CONTENT}\n</system-reminder>`;
// 只有附件時的送出內容：一行新時間 + 群組區塊，沒有 <user-input>（docs/spec/01-prompt-system.md §2 附件送出）。
const EXPECTED_ATTACHMENT_SEND = `${FRESH_LINE}\n\n${GROUP_BLOCK}`;
// 一般文字送出的版面：時間行、群組區塊、<user-input> 包裝（docs/spec/01-prompt-system.md §2、docs/spec/04-features.md §19）。
const expectedTextSend = (text) => `${FRESH_LINE}\n\n${GROUP_BLOCK}\n\n<user-input>\n${text}\n</user-input>`;

// createPromptInjector() 在 document 註冊無法移除的監聽器，所以整個檔案只建一個，ctx 讀取每個測試前重設的 state。
const state = {};

function resetState(over) {
    Object.assign(state, {
        isEnabled: true,
        promptPrefix: GROUP_CONTENT,
        globalDefaultPrompt: '',
        isGlobalPromptEnabled: false,
        isShowSystemTime: true,
        isInjecting: false,
    }, over || {});
}

createPromptInjector({
    getIsEnabled:             () => state.isEnabled,
    getPromptPrefix:          () => state.promptPrefix,
    getGlobalDefaultPrompt:   () => state.globalDefaultPrompt,
    getIsGlobalPromptEnabled: () => state.isGlobalPromptEnabled,
    getIsShowSystemTime:      () => state.isShowSystemTime,
    getIsInjecting:           () => state.isInjecting,
    setIsInjecting:           (v) => { state.isInjecting = v; },
    markChatCreationAttempt:  () => {},
    formatSystemTime:         () => FRESH_TIME,
});

function isButtonDisabled(button) {
    return button.classList.contains('ds-button--disabled') || button.getAttribute('aria-disabled') === 'true';
}

/**
 * 頁面替身：比照 DeepSeek 自己的送出判斷，送出鈕的 click 或輸入框的 Enter 抵達頁面、未被 preventDefault、且送出鈕未停用時，記一次送出（當下的輸入框值）。
 */
function attachPageDouble(textarea, sendButton) {
    const pageSends = [];
    sendButton.addEventListener('click', (e) => {
        if (!e.defaultPrevented && !isButtonDisabled(sendButton)) pageSends.push(textarea.value);
    });
    textarea.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        if (!e.defaultPrevented && !isButtonDisabled(sendButton)) pageSends.push(textarea.value);
    });
    return pageSends;
}

/** 掛上實測結構的輸入框外框（可選附件卡片），裝上頁面替身並讓輸入框取得焦點。 */
function mountComposer(value, attachment) {
    const composer = makeLiveComposerBox({ value, attachment });
    cleanup = mountInDocument(composer.box);
    const pageSends = attachPageDouble(composer.textarea, composer.sendButton);
    composer.textarea.focus();
    return Object.assign(composer, { pageSends });
}

/** 掛上實測的編輯視窗聊天區快照，把舊時間行放進編輯框，裝上頁面替身並讓編輯框取得焦點。 */
function mountEditPane(value) {
    document.body.innerHTML = EDIT_PANE_HTML;
    const editTextarea = document.querySelector('textarea[name="user query"]');
    const editItem = editTextarea.closest('[data-virtual-list-item-key]');
    const editSendButton = Array.from(editItem.querySelectorAll('[role="button"]'))
        .find(b => b.classList.contains('ds-button--filled'));
    editTextarea.value = value;
    const pageSends = attachPageDouble(editTextarea, editSendButton);
    editTextarea.focus();
    return { editTextarea, editSendButton, pageSends };
}

function dispatchEnter(target) {
    const ev = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    });
    target.dispatchEvent(ev);
    return ev;
}

// requestAnimationFrame 改成手動佇列：攔截後的重新送出排在 rAF 裡，手動清空才能決定性地觀察「頁面最後送出了什麼」。
let rafQueue;
let originalRaf;
let cleanup = null;

function flushRaf() {
    while (rafQueue.length) rafQueue.splice(0, rafQueue.length).forEach(cb => cb(0));
}

beforeEach(() => {
    resetState();
    rafQueue = [];
    originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
});

afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.innerHTML = '';
});

describe('harness self-check: the page double records what the page sends', () => {
    // 替身自檢：一般文字送出時，頁面替身必須記到注入後的值；記不到代表替身本身壞了，下方紅燈就不可信。
    it('records the injected value once for a plain-text Enter send', () => {
        const { textarea, pageSends } = mountComposer('hello');

        dispatchEnter(textarea);
        flushRaf();

        expect(pageSends).toEqual([expectedTextSend('hello')]);
    });

    it('records the injected value once for a plain-text send-button click', () => {
        const { sendSvg, pageSends } = mountComposer('hello');

        dispatchClick(sendSvg);
        flushRaf();

        expect(pageSends).toEqual([expectedTextSend('hello')]);
    });

    it('records the injected value once for a plain-text edit Send click in the live edit-window snapshot', () => {
        const { editSendButton, pageSends } = mountEditPane('hello');

        dispatchClick(editSendButton.querySelector('.ds-button__content'));
        flushRaf();

        expect(pageSends).toEqual([expectedTextSend('hello')]);
    });

    // 夾具自檢：送出鈕狀態必須照實測規則走，否則「沒有附件也啟用」這個前提不成立。
    it('the live composer fixture enables the send button for any non-empty text, with or without a card, and disables it only when empty with no card', () => {
        const states = {
            staleNoCard: isButtonDisabled(makeLiveComposerBox({ value: STALE_LINE }).sendButton),
            staleWithCard: isButtonDisabled(makeLiveComposerBox({ value: STALE_LINE, attachment: 'file' }).sendButton),
            emptyWithCard: isButtonDisabled(makeLiveComposerBox({ value: '', attachment: 'image' }).sendButton),
            emptyNoCard: isButtonDisabled(makeLiveComposerBox({ value: '' }).sendButton),
        };
        expect(states).toEqual({ staleNoCard: false, staleWithCard: false, emptyWithCard: false, emptyNoCard: true });
    });
});

describe('stale time line only + attachment card, system time on, group active: one fresh time line + group block', () => {
    it('Enter (file card): the page sends one fresh time line followed by the group block, with the stale line gone and no <user-input>', () => {
        const { textarea, pageSends } = mountComposer(STALE_LINE, 'file');

        const ev = dispatchEnter(textarea);
        flushRaf();

        expect(pageSends, `the page must send exactly one value: a fresh time line then the group block, got:\n${pageSends.join('\n---\n')}`).toEqual([EXPECTED_ATTACHMENT_SEND]);
        expect(ev.defaultPrevented, 'the original Enter must be intercepted so the stale value is never sent').toBe(true);
    });

    it('send-button click (file card): the page sends one fresh time line followed by the group block, with the stale line gone and no <user-input>', () => {
        const { sendSvg, pageSends } = mountComposer(STALE_LINE, 'file');

        const ev = dispatchClick(sendSvg);
        flushRaf();

        expect(pageSends, `the page must send exactly one value: a fresh time line then the group block, got:\n${pageSends.join('\n---\n')}`).toEqual([EXPECTED_ATTACHMENT_SEND]);
        expect(ev.defaultPrevented, 'the original click must be intercepted so the stale value is never sent').toBe(true);
    });

    it('Enter (image card): the page sends one fresh time line followed by the group block', () => {
        const { textarea, pageSends } = mountComposer(STALE_LINE, 'image');

        const ev = dispatchEnter(textarea);
        flushRaf();

        expect(pageSends, `the page must send exactly one value: a fresh time line then the group block, got:\n${pageSends.join('\n---\n')}`).toEqual([EXPECTED_ATTACHMENT_SEND]);
        expect(ev.defaultPrevented, 'the original Enter must be intercepted so the stale value is never sent').toBe(true);
    });
});

describe('stale time line only + no attachment card (send button enabled, as on the live page): left unsent and unchanged', () => {
    it('Enter: the page sends nothing, the keydown is prevented and the textarea still holds the stale line', () => {
        const { textarea, sendButton, pageSends } = mountComposer(STALE_LINE);
        expect(isButtonDisabled(sendButton), 'precondition: the live send button is enabled for a stale-only composer').toBe(false);

        const ev = dispatchEnter(textarea);
        flushRaf();

        expect(pageSends, `the page must send nothing, got:\n${pageSends.join('\n---\n')}`).toEqual([]);
        expect(ev.defaultPrevented, 'the original Enter must be prevented, or the page sends the stale line').toBe(true);
        expect(textarea.value).toBe(STALE_LINE);
    });

    it('send-button click: the page sends nothing, the click is prevented and the textarea still holds the stale line', () => {
        const { textarea, sendButton, sendSvg, pageSends } = mountComposer(STALE_LINE);
        expect(isButtonDisabled(sendButton), 'precondition: the live send button is enabled for a stale-only composer').toBe(false);

        const ev = dispatchClick(sendSvg);
        flushRaf();

        expect(pageSends, `the page must send nothing, got:\n${pageSends.join('\n---\n')}`).toEqual([]);
        expect(ev.defaultPrevented, 'the original click must be prevented, or the page sends the stale line').toBe(true);
        expect(textarea.value).toBe(STALE_LINE);
    });
});

describe('stale time line followed by a whitespace-only last line with no final newline: still a timestamp-only input', () => {
    // 文件規則：只有開頭時間行「加上空白」也算只有時間戳（docs/spec/01-prompt-system.md §2「Timestamp-only input」）。時間行後面接一行只有空白、沒有結尾換行的文字（使用者按了空白鍵），剝除時間行後只剩空白，仍須照只有時間戳處理。
    const STALE_WITH_TRAILING_BLANKS = `${STALE_LINE}\n \t `;

    it('no card, Enter: the page sends nothing, the keydown is prevented and the textarea keeps its text', () => {
        const { textarea, pageSends } = mountComposer(STALE_WITH_TRAILING_BLANKS);

        const ev = dispatchEnter(textarea);
        flushRaf();

        expect(pageSends, `the page must send nothing, got:\n${pageSends.join('\n---\n')}`).toEqual([]);
        expect(ev.defaultPrevented, 'the original Enter must be prevented, or the page sends the stale line').toBe(true);
        expect(textarea.value).toBe(STALE_WITH_TRAILING_BLANKS);
    });

    it('file card, send-button click: the page sends one fresh time line followed by the group block', () => {
        const { sendSvg, pageSends } = mountComposer(STALE_WITH_TRAILING_BLANKS, 'file');

        const ev = dispatchClick(sendSvg);
        flushRaf();

        expect(pageSends, `the page must send exactly one value: a fresh time line then the group block, got:\n${pageSends.join('\n---\n')}`).toEqual([EXPECTED_ATTACHMENT_SEND]);
        expect(ev.defaultPrevented, 'the original click must be intercepted so the stale value is never sent').toBe(true);
    });
});

describe('empty composer with no card (send button disabled): not a timestamp-only input, so the extension leaves the event to the page', () => {
    // 文件規則：輸入框為空且送出鈕停用時照舊跳過注入（docs/spec/01-prompt-system.md §2 附件送出最後一條）；攔下事件只適用於「只剩時間戳」的輸入。空輸入框沒有時間行，所以原始事件要原樣交給頁面自己的處理器。
    it('Enter: not prevented, the page still receives the keydown, nothing is sent and the textarea stays empty', () => {
        const { textarea, sendButton, pageSends } = mountComposer('');
        expect(isButtonDisabled(sendButton), 'precondition: the live send button is disabled for an empty composer with no card').toBe(true);
        let pageKeydowns = 0;
        textarea.addEventListener('keydown', () => { pageKeydowns += 1; });

        const ev = dispatchEnter(textarea);
        flushRaf();

        expect(ev.defaultPrevented, 'the extension must not intercept an Enter it does not act on').toBe(false);
        expect(pageKeydowns, 'the page must still receive the Enter keydown').toBe(1);
        expect(pageSends).toEqual([]);
        expect(textarea.value).toBe('');
    });

    it('send-button click: not prevented, the page still receives the click, nothing is sent and the textarea stays empty', () => {
        const { textarea, sendButton, sendSvg, pageSends } = mountComposer('');
        let pageClicks = 0;
        sendButton.addEventListener('click', () => { pageClicks += 1; });

        const ev = dispatchClick(sendSvg);
        flushRaf();

        expect(ev.defaultPrevented, 'the extension must not intercept a click it does not act on').toBe(false);
        expect(pageClicks, 'the page must still receive the click').toBe(1);
        expect(pageSends).toEqual([]);
        expect(textarea.value).toBe('');
    });
});

describe('edit-window-like textarea (no composer wrapper of its own) holding only a stale time line: treated as no attachment', () => {
    // 實測快照：編輯框往上第一個含 .bf38813a 的祖先是訊息虛擬列表，其父層的頁首兄弟元素不是附件。
    it('live edit-window snapshot, edit Send click: the page sends nothing, the click is prevented and the edit box still holds the stale line', () => {
        const { editTextarea, editSendButton, pageSends } = mountEditPane(STALE_LINE);

        const ev = dispatchClick(editSendButton.querySelector('.ds-button__content'));
        flushRaf();

        expect(pageSends, `the page must send nothing, got:\n${pageSends.join('\n---\n')}`).toEqual([]);
        expect(ev.defaultPrevented, 'the original click must be prevented, or the page sends the stale line').toBe(true);
        expect(editTextarea.value).toBe(STALE_LINE);
    });

    it('live edit-window snapshot, Enter in the edit box: the page sends nothing, the keydown is prevented and the edit box still holds the stale line', () => {
        const { editTextarea, pageSends } = mountEditPane(STALE_LINE);

        const ev = dispatchEnter(editTextarea);
        flushRaf();

        expect(pageSends, `the page must send nothing, got:\n${pageSends.join('\n---\n')}`).toEqual([]);
        expect(ev.defaultPrevented, 'the original Enter must be prevented, or the page sends the stale line').toBe(true);
        expect(editTextarea.value).toBe(STALE_LINE);
    });

    // 沒有任何 .bf38813a 祖先的編輯容器。
    it('bare edit container, edit Send click: the page sends nothing, the click is prevented and the textarea still holds the stale line', () => {
        const { container, button, span, textarea } = makeEditSendButtonInContainer(STALE_LINE);
        cleanup = mountInDocument(container);
        const pageSends = attachPageDouble(textarea, button);
        textarea.focus();

        const ev = dispatchClick(span);
        flushRaf();

        expect(pageSends, `the page must send nothing, got:\n${pageSends.join('\n---\n')}`).toEqual([]);
        expect(ev.defaultPrevented, 'the original click must be prevented, or the page sends the stale line').toBe(true);
        expect(textarea.value).toBe(STALE_LINE);
    });
});

describe('pass-through controls (unchanged by the fix)', () => {
    it('extension disabled, stale-only composer, Enter: not intercepted and the page sends the raw value', () => {
        resetState({ isEnabled: false });
        const { textarea, pageSends } = mountComposer(STALE_LINE);

        const ev = dispatchEnter(textarea);
        flushRaf();

        expect(ev.defaultPrevented).toBe(false);
        expect(pageSends).toEqual([STALE_LINE]);
    });

    it('extension disabled, stale-only composer, send-button click: not intercepted and the page sends the raw value', () => {
        resetState({ isEnabled: false });
        const { sendSvg, pageSends } = mountComposer(STALE_LINE);

        const ev = dispatchClick(sendSvg);
        flushRaf();

        expect(ev.defaultPrevented).toBe(false);
        expect(pageSends).toEqual([STALE_LINE]);
    });

    it('system time off, stale-only composer, Enter: the line is ordinary user text and is sent wrapped in <user-input> after the group block, with no time line added', () => {
        resetState({ isShowSystemTime: false });
        const { textarea, pageSends } = mountComposer(STALE_LINE);

        dispatchEnter(textarea);
        flushRaf();

        expect(pageSends).toEqual([`${GROUP_BLOCK}\n\n<user-input>\n${STALE_LINE}\n</user-input>`]);
    });

    it('stale time line followed by real user text, Enter: one fresh time line, the group block, then the user text in <user-input>', () => {
        const { textarea, pageSends } = mountComposer(`${STALE_LINE}\n\nhello`);

        dispatchEnter(textarea);
        flushRaf();

        expect(pageSends).toEqual([expectedTextSend('hello')]);
    });

    it('stale time line followed by real user text, send-button click: one fresh time line, the group block, then the user text in <user-input>', () => {
        const { sendSvg, pageSends } = mountComposer(`${STALE_LINE}\n\nhello`);

        dispatchClick(sendSvg);
        flushRaf();

        expect(pageSends).toEqual([expectedTextSend('hello')]);
    });

    it('empty composer + attachment card, send-button click: attachment-only send carries one fresh time line and the group block', () => {
        const { sendSvg, pageSends } = mountComposer('', 'file');

        dispatchClick(sendSvg);
        flushRaf();

        expect(pageSends).toEqual([EXPECTED_ATTACHMENT_SEND]);
    });
});
