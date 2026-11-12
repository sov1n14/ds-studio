import { test, expect } from './fixtures.js';
import { evaluateInWorker, hasPermissions } from './helpers/extension.js';
import { armReplyStub, expectReplyStreaming, finishAndAwaitToolbar, focusAtCompletion, openHome, recordFocusAtCompletion, sendStubbedPrompt, sendWhileUnfocused } from './helpers/reply-stub.js';

// 回覆完成通知（docs/FEATURES.md 的 Reply-Complete Notification；docs/spec/04-features.md 第 27 節）：
// - 開關開啟時，新回覆完成當下 DeepSeek 分頁不在前景（視窗沒有焦點）就顯示一則瀏覽器通知，每則回覆一次；分頁在前景時不顯示。
// - 通知標題與內文依介面語言而定，不含任何對話內容；開關關閉時不顯示。
// 回覆由瀏覽器內替身提供（helpers/reply-stub.js），沒有任何訊息抵達 DeepSeek。通知以 service worker 的 chrome.notifications.getAll() 觀察（主要斷言），並以包住 chrome.notifications.create 的記錄佐證內容；測試結束時清除新建的通知並移除包裝，所有寫入的儲存鍵也一併還原。

const PROMPT = 'e2e reply-notification probe (answered by an in-browser stub, never sent)';
const NOTIFICATION_PERMISSIONS = ['notifications'];
// 文件記載的通知內容（英文與繁體中文介面）。
const DOCUMENTED_CONTENT = [
    { title: 'DeepSeek reply complete', message: 'The reply has finished generating' },
    { title: 'DeepSeek 回覆完成', message: '回覆已生成完畢' },
];
// 證明「沒有通知」或「沒有多出通知」的觀察窗長度；觀察窗本身就是斷言。
const NO_NOTIFICATION_WINDOW_MS = 3_000;
const POLL_INTERVAL_MS = 250;

/** 設定通知開關（僅存本機），一次寫一個鍵，總開關最後寫；臨時對話固定關閉，離開頁面時不會刪除 DeepSeek 預先建立的對話。 */
async function pinSettings(settings, isNotificationOn) {
    await settings.set({ isReplyNotificationEnabled: isNotificationOn });
    await settings.set({ 'dss-temporary-chat-enabled': false });
    await settings.set({ isEnabled: true });
}

/** 擴充功能目前顯示中的通知 id。 */
function shownNotificationIds(context) {
    return evaluateInWorker(context, () => new Promise((resolve) => chrome.notifications.getAll((all) => resolve(Object.keys(all || {})))));
}

/**
 * 記下目前已有的通知，並在 service worker 內包住 chrome.notifications.create 以記錄每次建立的標題與內文。
 * 回傳 `newIds()`（之後新出現的通知 id）、`created()`（記錄到的內容）與 `dispose()`（清除新通知、移除包裝）。
 */
async function watchNotifications(context) {
    const before = new Set(await shownNotificationIds(context));
    await evaluateInWorker(context, () => {
        if (!self.__dssE2eNotifications) {
            const original = chrome.notifications.create;
            self.__dssE2eNotifications = { original, created: [] };
            chrome.notifications.create = function recordCreate(...args) {
                const options = args.find((arg) => arg !== null && typeof arg === 'object');
                self.__dssE2eNotifications.created.push(options ? { title: options.title, message: options.message } : null);
                return original.apply(this, args);
            };
        }
        self.__dssE2eNotifications.created = [];
    });
    const newIds = async () => (await shownNotificationIds(context)).filter((id) => !before.has(id));
    return {
        newIds,
        created: () => evaluateInWorker(context, () => self.__dssE2eNotifications?.created ?? []),
        async dispose() {
            const ids = await newIds();
            await evaluateInWorker(context, async (list) => {
                for (const id of list) await new Promise((resolve) => chrome.notifications.clear(id, resolve));
                if (self.__dssE2eNotifications) {
                    chrome.notifications.create = self.__dssE2eNotifications.original;
                    delete self.__dssE2eNotifications;
                }
            }, ids);
        },
    };
}

/** 斷言觀察窗內沒有新通知出現，也沒有任何建立通知的呼叫。 */
async function expectNoNotificationWithin(watch, message) {
    const deadline = Date.now() + NO_NOTIFICATION_WINDOW_MS;
    while (Date.now() < deadline) {
        const ids = await watch.newIds();
        if (ids.length > 0) throw new Error(`${message}: ${ids.length} notification(s) appeared within ${NO_NOTIFICATION_WINDOW_MS} ms`);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    expect(await watch.created(), `${message}: chrome.notifications.create was not called`).toEqual([]);
}

/** 斷言恰好出現一則新通知（觀察窗內沒有再多），內容是文件記載的標題與內文。 */
async function expectExactlyOneNotification(watch, message) {
    await expect.poll(async () => (await watch.newIds()).length, { message }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, NO_NOTIFICATION_WINDOW_MS));
    expect((await watch.newIds()).length, `${message}: still exactly one after the observation window`).toBe(1);
    const created = await watch.created();
    expect(created, `${message}: chrome.notifications.create was called once`).toHaveLength(1);
    expect(DOCUMENTED_CONTENT, `${message}: the title and body are the documented text, with no conversation content`).toContainEqual(created[0]);
}

/** 在首頁送出並讓 DeepSeek 視窗失去焦點，等回覆以串流狀態出現後讓它完成；斷言完成當下分頁沒有焦點。 */
async function completeReplyWhileUnfocused(page, context, stub) {
    await openHome(page);
    let unfocused = null;
    try {
        unfocused = await sendWhileUnfocused(page, context, PROMPT);
        await expectReplyStreaming(page);
        await recordFocusAtCompletion(page);
        await finishAndAwaitToolbar(page, stub);
        expect(await focusAtCompletion(page), 'the DeepSeek page had no focus when the reply finished (precondition)').toEqual({ visibilityState: 'visible', hasFocus: false });
    } finally {
        await unfocused?.close();
    }
}

/** 在首頁送出，分頁留在前景，等回覆以串流狀態出現後讓它完成；斷言完成當下分頁可見且有焦點。 */
async function completeReplyInForeground(page, stub) {
    await openHome(page);
    await sendStubbedPrompt(page, PROMPT);
    await expectReplyStreaming(page);
    await recordFocusAtCompletion(page);
    await finishAndAwaitToolbar(page, stub);
    expect(await focusAtCompletion(page), 'the DeepSeek page was visible and focused when the reply finished (precondition)').toEqual({ visibilityState: 'visible', hasFocus: true });
}

test.describe('reply-complete notification', () => {
    test.beforeEach(async ({ context }) => {
        expect(await hasPermissions(context, NOTIFICATION_PERMISSIONS), 'optional permission notifications must already be granted in .browser-profile (a permission prompt cannot be driven)').toBe(true);
    });

    test('with the notification on, a reply that finishes while the DeepSeek window is unfocused shows exactly one notification with the documented text', async ({ page, context, settings }) => {
        await pinSettings(settings, true);
        const stub = await armReplyStub(page);
        const watch = await watchNotifications(context);
        try {
            await completeReplyWhileUnfocused(page, context, stub);
            await expectExactlyOneNotification(watch, 'one notification for the reply that finished while unfocused');
        } finally {
            await watch.dispose();
        }
    });

    test('with the notification on, a reply that finishes in the foreground shows no notification, while the next reply finishing unfocused does', async ({ page, context, settings }) => {
        test.setTimeout(120_000);
        await pinSettings(settings, true);
        const stub = await armReplyStub(page);
        const watch = await watchNotifications(context);
        try {
            await completeReplyInForeground(page, stub);
            await expectNoNotificationWithin(watch, 'no notification for a reply that finished in the foreground');

            await completeReplyWhileUnfocused(page, context, stub);
            await expectExactlyOneNotification(watch, 'the observer sees the notification for the next reply, which finished while unfocused');
        } finally {
            await watch.dispose();
        }
    });

    test('with the notification off, a reply that finishes while unfocused shows no notification, while the same reply after turning it on does', async ({ page, context, settings }) => {
        test.setTimeout(120_000);
        await pinSettings(settings, false);
        const stub = await armReplyStub(page);
        const watch = await watchNotifications(context);
        try {
            await completeReplyWhileUnfocused(page, context, stub);
            await expectNoNotificationWithin(watch, 'no notification while the notification toggle is off');

            await settings.set({ isReplyNotificationEnabled: true });
            await completeReplyWhileUnfocused(page, context, stub);
            await expectExactlyOneNotification(watch, 'the observer sees the notification once the toggle is on');
        } finally {
            await watch.dispose();
        }
    });
});
