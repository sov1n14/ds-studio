// 以瀏覽器內替身回覆驅動 DeepSeek 首頁的一次送出，讓「新回覆完成」在不送出任何真實訊息的情況下發生。
// 替身的形狀照抄 2026-11-12 在真實頁面觀察到的串流：completion 先回一段未完成（WIP）、沒有 `event: close` 的串流，頁面隨即呼叫 `chat/resume_stream` 續接；第一次續接回傳已完成（FINISHED）的串流，之後的續接全部中止。
// 只有這個「先串流、後完成」的順序會讓回覆工具列晚於訊息項目掛載，也就是文件所說的新回覆完成；一次就回傳 FINISHED 的串流會讓工具列與項目在同一批掛載，如同頁面載入時已存在的訊息。
// chat_session/create 與 chat/create_pow_challenge 照常放行（DeepSeek 本來就會自行預先建立空白對話）；其餘非 GET 的 API 請求（遙測、裝置檢查、regenerate、continue、edit_message 等）一律在瀏覽器內中止。

import { expect } from '@playwright/test';
import { composer } from './composer.js';
import { DEEPSEEK_ORIGIN } from './conversations.js';
import { DSSelectors } from './selectors.js';

const HOME = DEEPSEEK_ORIGIN + '/';
const API_PREFIX = '/api/v0/';
const COMPLETION_PATH = '/api/v0/chat/completion';
const RESUME_PATH = '/api/v0/chat/resume_stream';
const PASS_THROUGH_PATHS = new Set(['/api/v0/chat_session/create', '/api/v0/chat/create_pow_challenge']);
// 觀察到的可行節奏：第一次續接請求約 1.5 秒後才回覆完成的串流。
const RESUME_DELAY_MS = 1_500;

/** 替身回覆的第一句話。 */
export const STUB_SENTENCE = 'Hello from the stub.';
/** 替身回覆唯一程式碼區塊的內容（不含圍欄）。 */
export const STUB_CODE = 'const stub = 1;\nconsole.log(stub);';
/** 替身回覆的完整 Markdown：一句話加一個 js 程式碼區塊。 */
export const STUB_REPLY = `${STUB_SENTENCE}\n\n\`\`\`js\n${STUB_CODE}\n\`\`\``;

// 頁面以 ready 事件的 request_message_id 作為使用者訊息 id；回覆的 parent_id 必須等於它，回覆才會顯示。
export const USER_MESSAGE_ID = 1;
export const REPLY_MESSAGE_ID = 2;

/** 一個 SSE 事件的文字：有 `event` 時先寫 `event:` 行，再寫 JSON 的 `data:` 行。 */
export function sseEvent(data, event) {
    return `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

/** 回覆訊息的快照（`{ v: { response } }`），`content` 為回覆片段目前的內容。 */
function responseSnapshot(content, status) {
    return sseEvent({
        v: {
            response: {
                message_id: REPLY_MESSAGE_ID,
                parent_id: USER_MESSAGE_ID,
                model: '',
                role: 'ASSISTANT',
                thinking_enabled: false,
                ban_edit: false,
                ban_regenerate: false,
                status,
                accumulated_token_usage: 0,
                files: [],
                feedback: null,
                inserted_at: Date.now() / 1000,
                search_enabled: false,
                fragments: [{ id: 1, type: 'RESPONSE', content }],
                has_pending_fragment: false,
                auto_continue: false,
            },
        },
    });
}

/** completion 的未完成串流：句子先到，程式碼區塊以 APPEND 接上，串流就此結束，沒有 FINISHED 也沒有 `event: close`（帶 close 時頁面不會續接）。 */
function streamingBody() {
    return [
        sseEvent({ request_message_id: USER_MESSAGE_ID, response_message_id: REPLY_MESSAGE_ID }, 'ready'),
        responseSnapshot(STUB_SENTENCE, 'WIP'),
        sseEvent({ p: 'response/fragments/-1/content', o: 'APPEND', v: STUB_REPLY.slice(STUB_SENTENCE.length) }),
    ].join('');
}

/** resume_stream 的完成串流：完整內容的快照，接著把狀態設為 FINISHED。 */
function finishedBody() {
    return [
        sseEvent({ request_message_id: USER_MESSAGE_ID, response_message_id: REPLY_MESSAGE_ID }, 'ready'),
        responseSnapshot(STUB_REPLY, 'WIP'),
        sseEvent({ p: 'response/status', o: 'SET', v: 'FINISHED' }),
        sseEvent({ click_behavior: 'none' }, 'close'),
    ].join('');
}

function eventStream(body) {
    return { status: 200, contentType: 'text/event-stream; charset=utf-8', body };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 在 `page` 上裝好替身回覆與中止規則；須在載入首頁之前呼叫。
 * 每次 completion 請求開始新的一輪：續接請求先保留，等測試呼叫 `finishReply()`（且距第一次續接至少 RESUME_DELAY_MS）才把完成的串流回覆給最早仍在等待的那一個，其餘續接一律中止；保留的請求全被頁面放棄時，回覆下一次續接。
 * 傳入 `completionBody`（完整的 SSE 本文，須以 `event: close` 結束）時，completion 改以這段本文一次回覆完畢，不開新的一輪，之後的續接請求一律中止，`finishReply()` 不起作用。
 * @param {{ completionBody?: string }} [options]
 * @returns {Promise<{ finishReply: () => void }>}
 */
export async function armReplyStub(page, { completionBody } = {}) {
    let round = null;

    async function answerResume(current) {
        await Promise.all([current.released, delay(Math.max(0, current.firstResumeAt + RESUME_DELAY_MS - Date.now()))]);
        while (current.held.length > 0 && !current.answered) {
            const route = current.held.shift();
            try {
                await route.fulfill(eventStream(finishedBody()));
                current.answered = true;
            } catch {
                // 頁面已放棄這個續接請求；改回覆下一個仍在等待的。
            }
        }
        for (const route of current.held.splice(0)) await route.abort().catch(() => {});
        // 保留的請求全被頁面放棄時，下一次續接重新走一遍。
        current.answering = false;
    }

    await page.route((url) => url.pathname.startsWith(API_PREFIX), async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        if (pathname === COMPLETION_PATH) {
            if (completionBody !== undefined) {
                round = null;
                return route.fulfill(eventStream(completionBody));
            }
            let release;
            const released = new Promise((resolve) => { release = resolve; });
            round = { released, release, held: [], answered: false, answering: false, firstResumeAt: 0 };
            return route.fulfill(eventStream(streamingBody()));
        }
        if (pathname === RESUME_PATH) {
            const current = round;
            if (!current || current.answered) return route.abort();
            current.held.push(route);
            if (current.answering) return undefined;
            current.answering = true;
            current.firstResumeAt = Date.now();
            return answerResume(current);
        }
        if (request.method() === 'GET' || PASS_THROUGH_PATHS.has(pathname)) return route.continue();
        return route.abort();
    });

    return { finishReply: () => round?.release() };
}

/**
 * 記錄頁面每一次 `navigator.clipboard.writeText` 的文字與結果，並照常交給原本的實作；須在載入頁面之前呼叫。
 * 包在 `Clipboard.prototype` 上，不論其他包裝先後安裝，網站的寫入都會經過這裡。
 */
export async function recordClipboardWrites(page) {
    await page.addInitScript(() => {
        if (typeof Clipboard === 'undefined' || window.__dssE2eClipboardWrites) return;
        const writes = [];
        window.__dssE2eClipboardWrites = writes;
        const original = Clipboard.prototype.writeText;
        Clipboard.prototype.writeText = function recordWriteText(text) {
            const entry = { text: String(text), outcome: 'pending' };
            writes.push(entry);
            const result = original.call(this, text);
            result.then(() => { entry.outcome = 'resolved'; }, (error) => { entry.outcome = `rejected: ${error?.name}`; });
            return result;
        };
    });
}

/** 目前為止記錄到的剪貼簿寫入文字，依寫入順序。 */
export function clipboardWrites(page) {
    return page.evaluate(() => (window.__dssE2eClipboardWrites || []).map((entry) => entry.text));
}

/** 載入首頁並等待輸入框出現（不等待預設浮層：總開關關閉時浮層不會出現）。 */
export async function openHome(page) {
    await page.goto(HOME);
    await expect(composer(page), 'the composer is shown (precondition)').toBeVisible();
}

/** 在首頁輸入框輸入 `text` 並按 Enter；completion 由替身回覆。 */
export async function sendStubbedPrompt(page, text) {
    await composer(page).fill(text);
    await composer(page).press('Enter');
}

/** 替身回覆所在的虛擬列表項目。 */
export function stubReplyItem(page) {
    return page.locator(DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR).filter({ has: page.locator(DSSelectors.MESSAGE_SELECTOR, { hasText: STUB_SENTENCE }) });
}

/** 替身回覆的訊息工具列。 */
export function stubReplyToolbar(page) {
    return stubReplyItem(page).locator(DSSelectors.MESSAGE_TOOLBAR_SELECTOR);
}

/** 等待替身回覆以串流狀態顯示：內容已出現、工具列尚未掛載。 */
export async function expectReplyStreaming(page) {
    await expect(stubReplyItem(page), 'the stubbed reply is rendered while streaming (precondition)').toHaveCount(1, { timeout: 30_000 });
    await expect(stubReplyToolbar(page), 'the streaming reply has no toolbar yet, so it completes later (precondition)').toHaveCount(0);
}

/** 讓替身回覆完成，並等待它的工具列掛載（新回覆完成的時刻）。 */
export async function finishAndAwaitToolbar(page, stub) {
    stub.finishReply();
    await expect(stubReplyToolbar(page), 'the finished reply mounts its toolbar').toHaveCount(1, { timeout: 30_000 });
}

/**
 * 在頁面內記錄替身回覆工具列第一次出現當下的 `{ visibilityState, hasFocus }`，供斷言回覆完成時分頁是否在前景。
 * 須在 `finishReply()` 之前呼叫；以 `focusAtCompletion(page)` 讀取。
 */
export async function recordFocusAtCompletion(page) {
    await page.evaluate(({ itemSelector, toolbarSelector, sentence }) => {
        window.__dssE2eFocusAtCompletion = null;
        const observer = new MutationObserver(() => {
            const item = [...document.querySelectorAll(itemSelector)].find((node) => node.textContent.includes(sentence));
            if (!item || !item.querySelector(toolbarSelector)) return;
            window.__dssE2eFocusAtCompletion = { visibilityState: document.visibilityState, hasFocus: document.hasFocus() };
            observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }, { itemSelector: DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR, toolbarSelector: DSSelectors.MESSAGE_TOOLBAR_SELECTOR, sentence: STUB_SENTENCE });
}

/** `recordFocusAtCompletion` 記錄到的狀態；工具列尚未出現時為 null。 */
export function focusAtCompletion(page) {
    return page.evaluate(() => window.__dssE2eFocusAtCompletion);
}

/**
 * 送出 `text` 並讓 `page` 失去焦點：先關閉 Playwright 對該頁的焦點模擬（否則 `document.hasFocus()` 一律為 true），開另一個頁面，送出後依序把兩頁帶到前景（送出的按鍵會讓 DeepSeek 頁重新取得焦點）。
 * 確認 `document.hasFocus() === false` 後才回傳；回傳物件的 `close()` 關閉另一個頁面並中斷 CDP 工作階段。
 * 途中任一步失敗時，先做同一份收尾再拋出原錯誤：持久 context 由整個 worker 共用，留下的頁面會影響之後的規格。
 */
export async function sendWhileUnfocused(page, context, text) {
    const cdp = await context.newCDPSession(page);
    let other = null;
    async function close() {
        try {
            await other?.close();
        } finally {
            await cdp.detach().catch(() => {});
        }
    }
    try {
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        other = await context.newPage();
        await sendStubbedPrompt(page, text);
        await page.bringToFront();
        await other.bringToFront();
        await expect.poll(() => page.evaluate(() => document.hasFocus()), { message: 'the DeepSeek page has lost focus to the other window (precondition)' }).toBe(false);
    } catch (error) {
        // 收尾本身的錯誤不得蓋過原錯誤。
        await close().catch(() => {});
        throw error;
    }
    return { close };
}
