import { test, expect } from './fixtures.js';
import { blockSendRequests } from './helpers/composer.js';
import { CONVERSATIONS, DEEPSEEK_ORIGIN, openConversation } from './helpers/conversations.js';
import { expectNeverWithin } from './helpers/observation.js';
import { armReplyStub, openHome, REPLY_MESSAGE_ID, sendStubbedPrompt, sseEvent, USER_MESSAGE_ID } from './helpers/reply-stub.js';
import { DSSelectors } from './helpers/selectors.js';
import { readBothAreas } from './helpers/settings.js';

// 審查回覆還原（docs/FEATURES.md「Restoring Censored Replies」第 306-314 行；docs/spec/04-features.md 第 20 節第 71-95 行）：
// - DeepSeek 以內容審查換掉回覆時，擴充功能從串流資料還原原始回覆，全自動、不需設定；還原的回覆帶「⚠ Content Restored」標記（介面為繁體中文時文字較長，因此只比對 `.restored-badge` 與 ⚠）。
// - 原始回覆含思考過程時，重建為可收合、顯示思考秒數的思考區塊。
// - 記錄存在本機（最多 200 筆），鍵為「<對話 id>::<message_id>」；重新整理或之後回到對話時，依同一對話與同一則前置提問配對還原。
// 審查串流由瀏覽器內替身回覆 completion（helpers/reply-stub.js 的 completionBody），形狀照抄 DeepSeek 的審查串流：先送原始片段，最後一個 BATCH 把狀態設為 CONTENT_FILTER 並換上 TEMPLATE_RESPONSE，以 `event: close` 結束。
// 2026-11-12 實測：DeepSeek 對這段替身串流會自己把回覆工具列的第 2、5 個按鈕顯示為停用（審查特徵），所以即時還原的測試先斷言這個前提，不手動設定。
// 保留的對話沒有被審查的回覆，所以重新整理還原的測試手動加上停用特徵（只改 DOM）。
// 安全規則：非 GET 的 /api/v0/ 請求在瀏覽器內一律由替身接手或中止，只有 DeepSeek 開啟對話所需的 chat_session/create 與 chat/create_pow_challenge 放行，沒有任何訊息送出、沒有任何東西被刪除；保留的對話只開啟，送出請求一律中止，從不刪除；臨時對話開關固定關閉；restored_messages 由 settings fixture 在測試後還原。

const COMPLETION_PATH = '/api/v0/chat/completion';
// 只用小寫英文字與單一空白、頭尾沒有空白：不論 prompt_key 怎麼正規化，提問的字都會原樣保留。
const PROMPT = 'e2e censored reply probe answered by an in browser stub and never sent';
const TEMPLATE_TEXT = "Sorry, that's beyond my current scope. Let's talk about something else.";
const ORIGINAL_HEAD = 'The **original** reply';
const ORIGINAL_REPLY = `${ORIGINAL_HEAD} before moderation replaced it.`;
const ORIGINAL_PLAIN_TAIL = 'reply before moderation replaced it.';
const THINK_HEAD = 'Thinking about the question';
const THINK_TEXT = `${THINK_HEAD}, step by step.`;
// 整數秒，顯示時不涉及四捨五入。
const ELAPSED_SECS = 12;
const RECORD_CAP = 200;
// 證明「沒有發生」的觀察窗長度；觀察窗本身就是斷言。
const NEVER_WINDOW_MS = 3_000;
const STORE_POLL_MS = 250;

// 保留的對話：一則提問、一則回覆（只開啟，從不寫入）；提問文字在測試中以前提斷言核對。
const KEPT_UUID = CONVERSATIONS.thinkingWithSearch;
const KEPT_PROMPT = "What is today's top news headline? Cite sources.";
const SEEDED_REPLY = 'Seeded **restored** reply from the local records.';
const SEEDED_PLAIN_TAIL = 'reply from the local records.';
const FOREIGN_REPLY = 'Foreign record of another conversation with the same prompt.';
const FOREIGN_SESSION = 'e2e-censor-foreign-session';
const CAP_SESSION = 'e2e-censor-cap-session';

/** ready 事件加上回覆訊息的 WIP 快照。 */
function streamStart({ thinking, fragments }) {
    return [
        sseEvent({ request_message_id: USER_MESSAGE_ID, response_message_id: REPLY_MESSAGE_ID, model_type: 'default' }, 'ready'),
        sseEvent({ v: { response: { message_id: REPLY_MESSAGE_ID, parent_id: USER_MESSAGE_ID, model: '', role: 'ASSISTANT', thinking_enabled: thinking, ban_edit: false, ban_regenerate: false, status: 'WIP', incomplete_message: null, accumulated_token_usage: 0, files: [], feedback: null, inserted_at: Date.now() / 1000, search_enabled: false, fragments, conversation_mode: 'DEFAULT', has_pending_fragment: false, auto_continue: false } } }),
    ].join('');
}

/** 審查的結尾：BATCH 把狀態設為 CONTENT_FILTER、片段換成 TEMPLATE_RESPONSE，接著 close。 */
function moderationEnd() {
    return [
        sseEvent({ p: 'response', o: 'BATCH', v: [{ p: 'ban_regenerate', v: true }, { p: 'status', v: 'CONTENT_FILTER' }, { p: 'accumulated_token_usage', v: 78 }, { p: 'fragments', v: [{ id: 3, type: 'TEMPLATE_RESPONSE', content: TEMPLATE_TEXT }] }, { p: 'has_pending_fragment', v: false }, { p: 'quasi_status', v: 'CONTENT_FILTER' }] }),
        sseEvent({ click_behavior: 'none', auto_resume: false }, 'close'),
    ].join('');
}

/** 原始回覆片段：RESPONSE 片段以 APPEND 加入，內容再以 APPEND 接上。 */
function replyFragments() {
    return [
        sseEvent({ p: 'response/fragments', o: 'APPEND', v: [{ id: 2, type: 'RESPONSE', content: ORIGINAL_HEAD }] }),
        sseEvent({ p: 'response/fragments/-1/content', o: 'APPEND', v: ORIGINAL_REPLY.slice(ORIGINAL_HEAD.length) }),
    ].join('');
}

/** 回覆內文被審查的串流。 */
function censoredReplyBody() {
    return streamStart({ thinking: false, fragments: [] }) + replyFragments() + moderationEnd();
}

/** 對照組：同樣的原始片段，正常完成（FINISHED），沒有 CONTENT_FILTER。 */
function finishedReplyBody() {
    return streamStart({ thinking: false, fragments: [] }) + replyFragments() + sseEvent({ p: 'response/status', o: 'SET', v: 'FINISHED' }) + sseEvent({ click_behavior: 'none', auto_resume: false }, 'close');
}

/** 只有思考過程、在思考階段就被審查的串流。 */
function censoredThinkBody() {
    return [
        streamStart({ thinking: true, fragments: [{ id: 2, type: 'THINK', content: THINK_HEAD }] }),
        sseEvent({ p: 'response/fragments/-1/content', o: 'APPEND', v: THINK_TEXT.slice(THINK_HEAD.length) }),
        sseEvent({ p: 'response/fragments/-1/elapsed_secs', o: 'SET', v: ELAPSED_SECS }),
        moderationEnd(),
    ].join('');
}

/** 一筆還原記錄，形狀依 docs/spec/04-features.md:76。 */
function record(session, messageId, content, restoredAt, promptKey = KEPT_PROMPT) {
    return { message_id: messageId, fragments: [{ id: 1, type: 'RESPONSE', content }], thinking_elapsed_secs: 0, chat_session_id: session, prompt_key: promptKey, censored: true, restored_at: restoredAt };
}

/** 先寫入（並記錄還原）restored_messages，一次寫一個鍵；臨時對話固定關閉，總開關最後寫。記錄只在頁面載入時讀取，所以須在載入頁面之前呼叫。 */
async function pinSettings(settings, records = {}) {
    await settings.set({ restored_messages: records });
    await settings.set({ 'dss-temporary-chat-enabled': false });
    await settings.set({ isEnabled: true });
}

async function storedRecords(context) {
    return (await readBothAreas(context, ['restored_messages'])).local.restored_messages ?? {};
}

/** 觀察窗內 restored_messages 一直是空的；觀察窗本身就是斷言。 */
async function expectStoreStaysEmptyWithin(context, durationMs, message) {
    const deadline = Date.now() + durationMs;
    do {
        const keys = Object.keys(await storedRecords(context));
        if (keys.length > 0) throw new Error(`${message}: restored_messages gained ${JSON.stringify(keys)}`);
        await new Promise((resolve) => setTimeout(resolve, STORE_POLL_MS));
    } while (Date.now() < deadline);
}

/** 以 `body` 替身回覆 completion，從首頁送出 PROMPT；回傳網址中的對話 id。 */
async function sendWithStubbedStream(page, body) {
    await armReplyStub(page, { completionBody: body });
    const sent = [];
    page.on('request', (request) => {
        if (new URL(request.url()).pathname !== COMPLETION_PATH) return;
        try {
            sent.push(request.postDataJSON());
        } catch {
            sent.push(null);
        }
    });
    await openHome(page);
    await sendStubbedPrompt(page, PROMPT);
    await expect.poll(() => sent.length, { message: 'the send went out as a completion request (precondition)' }).toBeGreaterThan(0);
    const { chat_session_id: requestSessionId, prompt: sentPrompt } = sent[0] ?? {};
    expect(sentPrompt, 'the completion request carries the typed prompt (precondition)').toContain(PROMPT);
    await expect(page, 'DeepSeek moves to the conversation of the send (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/a/chat/s/${requestSessionId}`);
    const sessionId = new URL(page.url()).pathname.split('/').pop();
    return { sessionId };
}

/** 被審查的回覆所在的虛擬列表項目（DeepSeek 顯示審查範本文字的那一則）。 */
function censoredItem(page) {
    return page.locator(DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR).filter({ hasText: TEMPLATE_TEXT });
}

function toolbarButtons(item) {
    return item.locator(DSSelectors.MESSAGE_TOOLBAR_SELECTOR).locator(`:scope > ${DSSelectors.ICON_BUTTON_ROLE_SELECTOR}`);
}

/** 前提：DeepSeek 自己把審查回覆工具列的第 2、5 個按鈕顯示為停用（docs/spec/04-features.md:74 的審查特徵）。 */
async function expectCensoredToolbar(item) {
    for (const index of [1, 4]) {
        await expect(toolbarButtons(item).nth(index), `assumption: DeepSeek itself renders toolbar button ${index + 1} of a CONTENT_FILTER reply as ds-button--disabled; no live moderation capture confirms this (precondition)`).toHaveClass(/(^|\s)ds-button--disabled(\s|$)/, { timeout: 30_000 });
    }
}

/** 開啟保留的對話並中止任何送出；核對它只有一則提問 KEPT_PROMPT 與一則回覆。 */
async function openKeptChat(page) {
    await blockSendRequests(page);
    await openConversation(page, KEPT_UUID);
    await expect(page.locator(DSSelectors.USER_CONTENT_SELECTOR), 'the kept chat has its single prompt (precondition)').toHaveText([KEPT_PROMPT]);
    await expect(keptReplyItem(page), 'the kept chat has a single reply (precondition)').toHaveCount(1);
}

function keptReplyItem(page) {
    return page.locator(DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR).filter({ has: page.locator(DSSelectors.ASSISTANT_MAIN_CONTENT_SELECTOR) });
}

/**
 * 手動把保留對話回覆的工具列第 2、5 個按鈕標為停用（只改 DOM），再在項目內加入一個子節點，讓擴充功能的觀察器看到變化。
 * 子節點須留在頁面上：同一個工作內加入又移除的節點不會觸發還原（2026-11-12 實測）。
 */
async function markKeptReplyCensored(page) {
    await toolbarButtons(keptReplyItem(page)).nth(4).waitFor({ state: 'attached' });
    await keptReplyItem(page).evaluate((item, { toolbarSelector, buttonSelector, disabledClass }) => {
        const buttons = item.querySelector(toolbarSelector).querySelectorAll(`:scope > ${buttonSelector}`);
        buttons[1].classList.add(disabledClass);
        buttons[4].classList.add(disabledClass);
        item.appendChild(document.createElement('span'));
    }, { toolbarSelector: DSSelectors.MESSAGE_TOOLBAR_SELECTOR, buttonSelector: DSSelectors.ICON_BUTTON_ROLE_SELECTOR, disabledClass: DSSelectors.BUTTON_DISABLED_CLASS });
}

/** 斷言保留對話的回覆已還原為 SEEDED_REPLY：Markdown 已轉成 HTML、帶標記，原內容隱藏。 */
async function expectKeptReplyRestoredFromSeed(page) {
    const item = keptReplyItem(page);
    const restored = item.locator('.restored-content');
    await expect(restored, 'the stored record restores the censored reply').toContainText(SEEDED_PLAIN_TAIL);
    await expect(restored.locator('strong'), 'the stored Markdown is rendered (bold)').toHaveText('restored');
    await expect(restored.locator('.restored-badge'), 'the restored reply carries the Content Restored badge').toContainText('⚠');
    await expect(item.locator('.dss-censored-hidden'), 'the censored original content is hidden').toBeHidden();
}

test.describe('censored reply restoration', () => {
    test('a CONTENT_FILTER stream saves its original reply as a record keyed by the conversation id and the reply message id', async ({ page, settings, context }) => {
        await pinSettings(settings);
        const startedAt = Date.now();
        const { sessionId } = await sendWithStubbedStream(page, censoredReplyBody());

        const key = `${sessionId}::${REPLY_MESSAGE_ID}`;
        await expect.poll(async () => Object.keys(await storedRecords(context)), { message: 'exactly one record is saved, keyed "<conversation id>::<message id>"' }).toEqual([key]);
        const savedBy = Date.now();
        const saved = (await storedRecords(context))[key];
        expect(saved.censored, 'the record is marked censored').toBe(true);
        expect(saved.chat_session_id, 'the record belongs to the conversation in the URL').toBe(sessionId);
        expect(saved.message_id, 'the record holds the reply message id from the stream').toBe(REPLY_MESSAGE_ID);
        // docs/spec/04-features.md:76 只說 prompt_key 是「正規化後的使用者提問」，沒有定義正規化規則，所以只斷言它保留提問的字；它的配對作用由之後兩個從記錄還原的測試涵蓋。
        expect(saved.prompt_key, 'prompt_key, the normalized user prompt, keeps the words of the sent prompt').toEqual(expect.stringContaining(PROMPT));
        // docs/spec/05-data-storage.md:35：超過 200 筆時依 restored_at 保留最新的記錄，所以它是儲存當下的時間。
        expect(saved.restored_at, 'restored_at is not before the send started').toBeGreaterThanOrEqual(startedAt);
        expect(saved.restored_at, 'restored_at is not after the record was observed').toBeLessThanOrEqual(savedBy);
        expect(saved.fragments.filter((fragment) => fragment.type === 'RESPONSE').map((fragment) => fragment.content), 'the record holds the original reply text').toEqual([ORIGINAL_REPLY]);
        expect(saved.fragments.map((fragment) => fragment.type), 'the moderation template is not saved as content').not.toContain('TEMPLATE_RESPONSE');
    });

    test('the same stream finishing without CONTENT_FILTER saves no record and restores nothing', async ({ page, settings, context }) => {
        await pinSettings(settings);
        await sendWithStubbedStream(page, finishedReplyBody());

        const item = page.locator(DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR).filter({ hasText: ORIGINAL_PLAIN_TAIL });
        await expect(toolbarButtons(item).nth(4), 'DeepSeek renders the finished reply with its toolbar, so the whole stream was read (precondition)').toBeAttached({ timeout: 30_000 });
        await expectStoreStaysEmptyWithin(context, NEVER_WINDOW_MS, 'a reply that was not censored saves no record');
        await expect(page.locator('.restored-content'), 'a reply that was not censored is not restored').toHaveCount(0);
    });

    test('a censored reply is restored live: rendered Markdown with the Content Restored badge, the moderation text hidden', async ({ page, settings }) => {
        await pinSettings(settings);
        await sendWithStubbedStream(page, censoredReplyBody());
        const item = censoredItem(page);
        await expectCensoredToolbar(item);

        const restored = item.locator('.restored-content');
        await expect(restored, 'the original reply is shown in place of the moderation text').toBeVisible();
        await expect(restored, 'the restored reply holds the original text').toContainText(ORIGINAL_PLAIN_TAIL);
        await expect(restored.locator('strong'), 'the original Markdown is rendered (bold)').toHaveText('original');
        await expect(restored.locator('.restored-badge'), 'the restored reply carries the Content Restored badge').toContainText('⚠');
        await expect(item.locator('.dss-censored-hidden'), 'the hidden original content is the moderation text').toContainText(TEMPLATE_TEXT);
        await expect(item.getByText(TEMPLATE_TEXT), 'the moderation text is no longer visible').toBeHidden();
    });

    test('a reply censored while thinking gets a collapsible think block with its elapsed seconds and a badge, and no reply text', async ({ page, settings, context }) => {
        await pinSettings(settings);
        const { sessionId } = await sendWithStubbedStream(page, censoredThinkBody());
        const item = censoredItem(page);
        await expectCensoredToolbar(item);

        const thinkText = item.getByText(THINK_TEXT);
        await expect(thinkText, 'the thinking process is restored').toBeVisible();
        // DeepSeek 自己的思考區塊排在回覆內文之前；重建的區塊排在被隱藏的原內容之後，以此確認看到的不是頁面留下的思考。
        const followsHiddenOriginal = await thinkText.evaluate((node, itemSelector) => {
            const hidden = node.closest(itemSelector).querySelector('.dss-censored-hidden');
            return Boolean(hidden && hidden.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
        }, DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR);
        expect(followsHiddenOriginal, 'the think block is rebuilt after the hidden censored content, not left by DeepSeek').toBe(true);
        const elapsed = item.getByText(new RegExp(`(^|[^0-9])${ELAPSED_SECS}([^0-9]|$)`));
        await expect(elapsed, 'the think block shows the elapsed thinking seconds').toBeVisible();
        await elapsed.click();
        await expect(thinkText, 'clicking the think header collapses the thinking process').toBeHidden();
        await elapsed.click();
        await expect(thinkText, 'clicking it again expands the thinking process').toBeVisible();
        const badge = item.locator('.restored-content .restored-badge');
        await expect(badge, 'the restored reply carries the Content Restored badge').toContainText('⚠');
        await expect(item.locator('.restored-content'), 'nothing but the badge is restored as reply text').toHaveText(await badge.innerText());
        const key = `${sessionId}::${REPLY_MESSAGE_ID}`;
        await expect.poll(async () => (await storedRecords(context))[key]?.thinking_elapsed_secs, { message: 'the record keeps the elapsed thinking seconds the stream sent' }).toBe(ELAPSED_SECS);
    });

    test('a stored record restores the censored reply of a kept chat after page load, matched by chat id and preceding prompt', async ({ page, settings }) => {
        await pinSettings(settings, { [`${KEPT_UUID}::${REPLY_MESSAGE_ID}`]: record(KEPT_UUID, REPLY_MESSAGE_ID, SEEDED_REPLY, Date.now()) });
        await openKeptChat(page);

        await expectNeverWithin(page, () => document.querySelector('.restored-content') !== null, null, NEVER_WINDOW_MS, 'a matching record restores nothing while the reply has no censored toolbar');
        await markKeptReplyCensored(page);
        await expectKeptReplyRestoredFromSeed(page);
    });

    test('a record of another conversation with the same prompt is never used', async ({ page, settings }) => {
        // 另一個對話的記錄 message_id 較小：若配對不分對話，它會排在前面而被套用。
        await pinSettings(settings, {
            [`${FOREIGN_SESSION}::1`]: record(FOREIGN_SESSION, 1, FOREIGN_REPLY, Date.now() - 1),
            [`${KEPT_UUID}::${REPLY_MESSAGE_ID}`]: record(KEPT_UUID, REPLY_MESSAGE_ID, SEEDED_REPLY, Date.now()),
        });
        await openKeptChat(page);
        await markKeptReplyCensored(page);

        await expectKeptReplyRestoredFromSeed(page);
        await expect(page.locator('.restored-content'), 'exactly one reply is restored').toHaveCount(1);
        await expect(page.getByText(FOREIGN_REPLY), 'the record of another conversation is not shown').toHaveCount(0);
    });

    // 填入的記錄以 restored_at 由舊到新編號，但以反向順序寫入，最舊的一筆不是第一個鍵。
    for (const { seeded, evicted } of [{ seeded: RECORD_CAP, evicted: 1 }, { seeded: RECORD_CAP - 1, evicted: 0 }]) {
        test(`with ${seeded} stored records, saving a censored reply evicts ${evicted === 0 ? 'nothing' : 'the oldest record by restored_at'} and keeps at most ${RECORD_CAP}`, async ({ page, settings, context }) => {
            const base = Date.now() - 1_000_000;
            const records = {};
            for (let index = seeded; index >= 1; index -= 1) {
                records[`${CAP_SESSION}::${index}`] = record(CAP_SESSION, index, `e2e filler record ${index}`, base + index, 'e2e filler prompt');
            }
            await pinSettings(settings, records);
            const { sessionId } = await sendWithStubbedStream(page, censoredReplyBody());

            const newKey = `${sessionId}::${REPLY_MESSAGE_ID}`;
            await expect.poll(async () => newKey in await storedRecords(context), { message: 'the censored reply is saved' }).toBe(true);
            const oldestFirst = Object.keys(records).sort((a, b) => records[a].restored_at - records[b].restored_at);
            const expected = [...oldestFirst.slice(evicted), newKey].sort();
            expect(Object.keys(await storedRecords(context)).sort(), `the store holds ${expected.length} records: the ${evicted} oldest evicted, the new one added`).toEqual(expected);
        });
    }
});
