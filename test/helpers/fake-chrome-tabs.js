/**
 * 依分頁表誠實過濾的 chrome.tabs 替身，供需要區分「彈出視窗底下的分頁」與其他分頁的測試共用。
 *
 * query 依 active、currentWindow、lastFocusedWindow、windowId 與 url（Chrome 比對樣式，字串或陣列）過濾分頁表；目前視窗與最後聚焦視窗皆為 windowId 1。遇到替身不認得的查詢鍵時，記入 fakeErrors 並回傳空陣列，測試再以 fakeErrors 為空作為前提，避免替身默默忽略條件而讓斷言失真。
 *
 * sendMessage 以 structuredClone 記錄每次投遞（模擬跨程序訊息的複製語意），再交給 route(tabId, message) 決定回應：route 回傳值包成 promise，回傳 rejected promise 即模擬送出失敗，同步拋出即模擬同步例外；route 預設回傳 undefined（真實 Chrome 在接收端未回應時的 promise 結果）。
 */
export const CURRENT_WINDOW_ID = 1;

const KNOWN_QUERY_KEYS = new Set(['active', 'currentWindow', 'lastFocusedWindow', 'windowId', 'url']);

/** 以 '*' 為萬用字元比對整段文字（不使用正規表示式，避免跳脫字元出錯）。 */
function globMatch(glob, text) {
    const parts = glob.split('*');
    if (parts.length === 1) return text === glob;
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (!text.startsWith(first)) return false;
    let pos = first.length;
    for (const middle of parts.slice(1, -1)) {
        const idx = text.indexOf(middle, pos);
        if (idx < 0) return false;
        pos = idx + middle.length;
    }
    return text.length - pos >= last.length && text.endsWith(last);
}

/** 依 Chrome 比對樣式（如 '*://chat.deepseek.com/*'）判斷網址是否相符：scheme、host、path（含查詢字串）分段比對。 */
function urlMatchesPattern(url, pattern) {
    const sep = pattern.indexOf('://');
    const slash = pattern.indexOf('/', sep + 3);
    if (sep < 0 || slash < 0) throw new Error('fake chrome.tabs：不支援的比對樣式 ' + pattern);
    const scheme = pattern.slice(0, sep);
    const host = pattern.slice(sep + 3, slash);
    const path = pattern.slice(slash);
    const u = new URL(url);
    const urlScheme = u.protocol.slice(0, -1);
    const isSchemeOk = scheme === '*' ? (urlScheme === 'http' || urlScheme === 'https') : urlScheme === scheme;
    const isHostOk = host === '*' || (host.startsWith('*.') ? (u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1))) : u.hostname === host);
    return isSchemeOk && isHostOk && globMatch(path, u.pathname + u.search);
}

function tabMatches(tab, query) {
    if ('active' in query && tab.active !== query.active) return false;
    if ('windowId' in query && tab.windowId !== query.windowId) return false;
    for (const key of ['currentWindow', 'lastFocusedWindow']) {
        if (key in query && (tab.windowId === CURRENT_WINDOW_ID) !== query[key]) return false;
    }
    if ('url' in query) {
        const patterns = Array.isArray(query.url) ? query.url : [query.url];
        if (!patterns.some((p) => urlMatchesPattern(tab.url, p))) return false;
    }
    return true;
}

/**
 * 安裝替身到全域 chrome.tabs，回傳控制物件與還原函式。
 * @param {Array<{id:number, windowId:number, active:boolean, url:string}>} tabs 分頁表
 * @param {{ route?: (tabId:number, message:object) => any }} [options]
 */
export function installFakeTabs(tabs, { route = () => undefined } = {}) {
    const original = { query: chrome.tabs.query, sendMessage: chrome.tabs.sendMessage };
    const fake = {
        tabs: tabs.map((t) => ({ ...t })),
        deliveries: [],
        fakeErrors: [],
        route,
        restore() {
            chrome.tabs.query = original.query;
            chrome.tabs.sendMessage = original.sendMessage;
        },
    };
    chrome.tabs.query = async (query = {}) => {
        const unknown = Object.keys(query).filter((k) => !KNOWN_QUERY_KEYS.has(k));
        if (unknown.length > 0) {
            fake.fakeErrors.push(`替身不認得的查詢鍵：${unknown.join(', ')}`);
            return [];
        }
        return fake.tabs.filter((tab) => tabMatches(tab, query)).map((tab) => structuredClone(tab));
    };
    chrome.tabs.sendMessage = (tabId, message) => {
        fake.deliveries.push({ tabId, message: structuredClone(message) });
        // route 同步拋出時照樣同步拋出（模擬 context invalidated）；其餘結果一律包成 promise，如同真實的 promise 形式 API。
        return Promise.resolve(fake.route(tabId, structuredClone(message)));
    };
    return fake;
}
