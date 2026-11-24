/**
 * 分頁卸載交接訊息（content → service worker）的共用讀取工具。
 *
 * 需求：分頁卸載（beforeunload）時，content script 不再自行刪除臨時對話，改送一則 runtime 訊息 { type: DSS_TEMP_CHAT.DSS_MSG_TAB_UNLOADING, uuid } 把追蹤中的 uuid 交給 service worker，由它等待寬限期後決定是否刪除。型別常數定義在 utils/temporary-chat-constants.js；測試一律經由常數取得型別字串，不寫死字面值。
 *
 * 常數尚未定義時（實作前），unloadType() 回傳 undefined，unloadHandOffs() 回傳空陣列，讓行為斷言以「沒有交接」失敗，而不是讓過濾條件誤配到 type 為 undefined 的訊息。
 */

/** 分頁卸載交接訊息型別；常數尚未定義時為 undefined。 */
export const unloadType = () => globalThis.DSS_TEMP_CHAT?.DSS_MSG_TAB_UNLOADING;

/** 傳給 runtime 的分頁卸載交接訊息（依送出順序，可依 uuid 過濾）。 */
export function unloadHandOffs(sendMessageMock, uuid) {
    const type = unloadType();
    if (typeof type !== 'string' || type.length === 0) return [];
    return sendMessageMock.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.type === type && (uuid === undefined || message.uuid === uuid));
}

/** 預期的交接訊息形狀，供 toEqual 比對。 */
export const unloadHandOff = (uuid) => ({ type: unloadType(), uuid });
