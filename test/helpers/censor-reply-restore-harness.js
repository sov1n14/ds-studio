/**
 * Shared helpers for the CensorReplyRestore scenario specs that drive the real module over the copying in-memory `chrome.storage` double from test/setup/vitest.setup.js.
 * Used by test/unit/censor-reply-restore.stale-tab-save.scenario.spec.js, test/unit/censor-reply-restore.clear-generation.scenario.spec.js, test/unit/censor-reply-restore.clear-message-failure.scenario.spec.js, test/unit/censor-reply-restore.save-read-failure.scenario.spec.js, test/unit/censor-reply-restore.save-reread.scenario.spec.js, test/unit/censor-reply-restore.failed-read-record-clear.scenario.spec.js, test/unit/censor-reply-restore.save-write-failure.scenario.spec.js and test/unit/storage-manager.restored-messages.spec.js.
 */
import { vi } from 'vitest';
import '../../utils/storage-manager.js';

export const RESTORED_KEY = 'restored_messages';

// 等候所有未 await 的儲存鏈結束：記憶體 storage 替身每次讀寫都以 setTimeout(0) 結算，50 輪足以涵蓋「先讀再寫」的多段鏈
export async function settle() {
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

// 以真實 StorageManager 讀取目前持久化的記錄鍵（排序後比較，與寫入順序無關）
export async function persistedKeys() {
    const stored = await StorageManager.getRestoredMessages();
    return Object.keys(stored || {}).sort();
}

// 模擬頁面送來的 DSS_FRAGMENT_COMPLETE 內容（被審查的回覆）
export function fragmentPayload(sessionId, messageId, text = 'reply ' + sessionId + ' ' + messageId) {
    return {
        messageId,
        fragments: [{ type: 'RESPONSE', content: text }],
        censored: true,
        chatSessionId: sessionId,
        promptText: 'prompt for ' + sessionId + ' ' + messageId,
        thinkingElapsedSecs: 0
    };
}

// 匯出檔中的一筆還原記錄（與內容腳本存下的記錄同形）
export function exportedRecord(sessionId, messageId, extra = {}) {
    return {
        message_id: messageId,
        fragments: [{ type: 'RESPONSE', content: 'imported reply ' + messageId }],
        restored_at: Date.now(),
        thinking_elapsed_secs: 0,
        censored: true,
        chat_session_id: sessionId,
        prompt_key: 'imported prompt ' + messageId,
        ...extra
    };
}

export function requestsRestoredKey(keys) {
    if (keys == null) return true;
    if (typeof keys === 'string') return keys === RESTORED_KEY;
    if (Array.isArray(keys)) return keys.includes(RESTORED_KEY);
    if (typeof keys === 'object') return RESTORED_KEY in keys;
    return false;
}

// 讀取鍵是否含清除世代鍵（null 代表讀取全部，也算）
export function requestsGenerationKey(keys) {
    const generationKey = StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY;
    if (keys == null) return true;
    if (typeof keys === 'string') return keys === generationKey;
    if (Array.isArray(keys)) return keys.includes(generationKey);
    if (typeof keys === 'object') return generationKey in keys;
    return false;
}

// 讀取鍵是否含 restored_messages 或其清除世代鍵（null 代表讀取全部，也算）
export function requestsRestoredOrGenerationKey(keys) {
    return requestsRestoredKey(keys) || requestsGenerationKey(keys);
}

// 是否為存檔的快照讀取：同一次讀取以陣列同時要求 restored_messages 與清除世代鍵
export function requestsRestoredSnapshot(keys) {
    return Array.isArray(keys) && keys.includes(RESTORED_KEY) && keys.includes(StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY);
}

// 讓符合 matches 的 chrome.storage.local.get 失敗，最多 limit 次（預設不限）。lastError：promise 形式非同步 reject，callback 形式只在該 callback 執行期間設定 lastError（與真實 chrome.storage 相同）；throw：同步拋出。disarm() 後所有讀取恢復正常
export function failRestoredReads(mode, { limit = Infinity, matches = requestsRestoredKey } = {}) {
    const area = chrome.storage.local;
    const originalGet = area.get.bind(area);
    const failedForms = [];
    let isArmed = true;
    vi.spyOn(area, 'get').mockImplementation((keys, callback) => {
        if (typeof keys === 'function') { callback = keys; keys = null; }
        if (!isArmed || failedForms.length >= limit || !matches(keys)) return callback ? originalGet(keys, callback) : originalGet(keys);
        const message = 'IO error: restored_messages read failed';
        if (mode === 'throw') {
            failedForms.push('synchronous throw');
            throw new Error(message);
        }
        if (!callback) {
            failedForms.push('promise rejection');
            return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));
        }
        failedForms.push('callback lastError');
        setTimeout(() => {
            chrome.runtime.lastError = { message };
            try { callback(undefined); } finally { delete chrome.runtime.lastError; }
        }, 0);
        return undefined;
    });
    return {
        failedForms: () => failedForms.slice(),
        disarm: () => { isArmed = false; }
    };
}

// 攔截 chrome.storage.local.get：武裝期間，讀取 restored_messages 的呼叫立即取得快照，但結果延後到 release() 才交付。restore() 拆除這層攔截、讓 get 回到原本的 storage 替身（已攔住的結果仍可 release()），之後才能再以 failRestoredReads 武裝另一層攔截：同一方法上的第二個 vi.spyOn 會沿用同一個 spy，兩層互相呼叫
export function holdRestoredReads() {
    const area = chrome.storage.local;
    const originalGet = area.get.bind(area);
    const held = [];
    let isArmed = true;
    const getSpy = vi.spyOn(area, 'get').mockImplementation((keys, callback) => {
        if (typeof keys === 'function') { callback = keys; keys = null; }
        if (!isArmed || !requestsRestoredKey(keys)) return callback ? originalGet(keys, callback) : originalGet(keys);
        if (callback) {
            originalGet(keys, (result) => held.push(() => callback(result)));
            return undefined;
        }
        const snapshot = originalGet(keys);
        return new Promise((resolve, reject) => {
            snapshot.then((result) => held.push(() => resolve(result)), reject);
        });
    });
    return {
        heldCount: () => held.length,
        disarm: () => { isArmed = false; },
        restore: () => { isArmed = false; getSpy.mockRestore(); },
        release: () => { while (held.length) held.shift()(); }
    };
}

// 另一個分頁：重設模組登錄後重新載入真實的 CensorReplyRestore，得到獨立狀態的另一個實例（呼叫端負責在 afterEach 呼叫其 disable()）
export async function loadSecondTab() {
    vi.resetModules();
    const mod = await import('../../content/censor-reply-restore.js');
    return mod.default ?? mod;
}

// 攔截 chrome.storage.local.get：每次同時讀取 restored_messages 與清除世代的快照讀取，先由「另一情境」寫入一筆 sMID::<n>，讀到含該筆的快照後、交付結果前再以真實 StorageManager 完成一次清除；每次（重）讀之後清除世代都已再變動，讀到的記錄也全都成為清除前的記錄。clearReads 限定只有前幾次快照讀取後清除，之後的快照讀取只寫入 sMID::<n>、不再清除（讀到的快照即屬目前世代）。restoreAllMocks 解除
export function writeThenClearAroundEverySnapshotRead({ clearReads = Infinity } = {}) {
    const area = chrome.storage.local;
    const originalGet = area.get.bind(area);
    const generationKey = StorageManager.RESTORED_MESSAGES_CLEAR_GENERATION_KEY;
    let clearCount = 0;
    let snapshotReadCount = 0;
    const writeReadClear = async (keys) => {
        snapshotReadCount++;
        await StorageManager.mergeRestoredMessages({ ['sMID::' + snapshotReadCount]: exportedRecord('sMID', snapshotReadCount) });
        const result = await new Promise((resolve) => originalGet(keys, resolve));
        if (snapshotReadCount > clearReads) return result;
        await StorageManager.clearRestoredMessages();
        clearCount++;
        return result;
    };
    vi.spyOn(area, 'get').mockImplementation((keys, callback) => {
        if (typeof keys === 'function') { callback = keys; keys = null; }
        const isSnapshotRead = Array.isArray(keys) && keys.includes(RESTORED_KEY) && keys.includes(generationKey);
        if (!isSnapshotRead) return callback ? originalGet(keys, callback) : originalGet(keys);
        if (!callback) return writeReadClear(keys);
        writeReadClear(keys).then(callback);
        return undefined;
    });
    return { clearCount: () => clearCount };
}
