/**
 * DS Studio — chatPresetMap 宣告式操作（utils/storage-manager.chatmap.ops.js）
 *
 * 純函式模組：驗證 chat-map 訊息並將其套用至 map，回傳新 map，不存取 chrome.*、不修改輸入。供 service worker 單一寫入者使用。
 * 訊息型別於呼叫時讀取 globalThis.DSS_CHAT_MAP_MSG（message-constants.js 在 storage manager 之後載入）。
 */
(function (root) {
    'use strict';

    const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
    const isNonEmptyStringArray = (value) => Array.isArray(value) && value.every(isNonEmptyString);

    // 僅接受純物件（排除 Map、陣列與類別實例）
    function isPlainObject(value) {
        if (value === null || typeof value !== 'object') return false;
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }

    function getMessageTypes() {
        const types = root.DSS_CHAT_MAP_MSG;
        if (!types) throw new Error('DSSChatMapOps: globalThis.DSS_CHAT_MAP_MSG 未定義，請先載入 utils/message-constants.js');
        return types;
    }

    // 各訊息型別的酬載檢查；回傳錯誤字串，合法則回傳 null
    function buildPayloadCheckers(T) {
        return {
            [T.BIND]: (msg) => (!isNonEmptyString(msg.uuid) ? 'uuid 必須為非空字串'
                : !isNonEmptyString(msg.presetId) ? 'presetId 必須為非空字串' : null),
            [T.UNBIND]: (msg) => (isNonEmptyString(msg.uuid) ? null : 'uuid 必須為非空字串'),
            [T.UNBIND_PRESETS]: (msg) => (isNonEmptyStringArray(msg.presetIds) ? null : 'presetIds 必須為非空字串陣列'),
            [T.PRUNE_ORPHANS]: () => null,
            [T.MERGE]: (msg) => (isPlainObject(msg.entries) && Object.values(msg.entries).every((v) => typeof v === 'string')
                ? null : 'entries 必須為值皆為字串的純物件'),
            [T.MIGRATE_LEGACY]: () => null,
            [T.REPUBLISH_PARKED]: (msg) => (isNonEmptyStringArray(msg.keys) ? null : 'keys 必須為非空字串陣列'),
        };
    }

    // 各訊息型別對 map 的轉換；皆回傳新物件
    function buildMapOps(T) {
        return {
            [T.BIND]: (map, msg) => ({ ...map, [msg.uuid]: msg.presetId }),
            [T.UNBIND]: (map, msg) => {
                const next = { ...map };
                delete next[msg.uuid];
                return next;
            },
            [T.UNBIND_PRESETS]: (map, msg) => {
                const removed = new Set(msg.presetIds);
                return Object.fromEntries(Object.entries(map).filter(([, presetId]) => !removed.has(presetId)));
            },
            [T.MERGE]: (map, msg) => ({ ...map, ...msg.entries }),
            [T.PRUNE_ORPHANS]: (map, _msg, ctx) => {
                const presetIds = ctx?.presetIds;
                // 索引未知或為空時不修剪，避免誤清整份 map
                if (!Array.isArray(presetIds) || presetIds.length === 0) return { ...map };
                const known = new Set(presetIds);
                return Object.fromEntries(Object.entries(map).filter(([, presetId]) => !presetId || known.has(presetId)));
            },
        };
    }

    /**
     * 驗證 chat-map 訊息。
     * @returns {{ ok: true } | { ok: false, error: string }}
     */
    function validate(msg) {
        if (!msg || typeof msg !== 'object') return { ok: false, error: 'msg 必須為物件' };
        const checkers = buildPayloadCheckers(getMessageTypes());
        if (!Object.hasOwn(checkers, msg.type)) return { ok: false, error: `未知的 chat-map 訊息型別：${String(msg.type)}` };
        const error = checkers[msg.type](msg);
        return error ? { ok: false, error } : { ok: true };
    }

    /**
     * 將已驗證的訊息套用至 map，回傳新 map，不修改輸入。
     * @param {Object} map - 目前的 chatPresetMap
     * @param {Object} msg - 已通過 validate 的訊息
     * @param {{ presetIds?: string[] }} [ctx] - PRUNE_ORPHANS 所需的已知 preset id
     */
    function apply(map, msg, ctx) {
        const mapOps = buildMapOps(getMessageTypes());
        if (!Object.hasOwn(mapOps, msg?.type)) throw new Error(`DSSChatMapOps.apply: 型別 ${String(msg?.type)} 無對應的 map 操作`);
        return mapOps[msg.type](map, msg, ctx);
    }

    const api = { validate, apply };
    root.DSSChatMapOps = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
