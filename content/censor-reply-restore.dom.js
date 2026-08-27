/**
 * DS studio — Censor Reply Restore :: DOM Bundle (Entry)
 * DOM 注入、fragment 萃取、messageId 解析等子系統。由 censor-reply-restore.js 以 Object.assign 合入。
 */
(function (root) {
    'use strict';

    // Session id 擷取共用工具（瀏覽器：chat-session-id.js 在前載入；Node.js 測試：直接 require）
    const chatSessionId = root.DSSChatSessionId ||
        (typeof require !== 'undefined' ? require('../utils/chat-session-id.js') : {});

    // 各分包（瀏覽器：由 manifest 於前載入；Node.js 測試：直接 require）
    var extract = root.__DS_CensorReplyRestore_dom_extract ||
        (typeof require !== 'undefined' ? require('./censor-reply-restore.dom.extract.js') : {});
    var resolve = root.__DS_CensorReplyRestore_dom_resolve ||
        (typeof require !== 'undefined' ? require('./censor-reply-restore.dom.resolve.js') : {});
    var inject = root.__DS_CensorReplyRestore_dom_inject ||
        (typeof require !== 'undefined' ? require('./censor-reply-restore.dom.inject.js') : {});
    var scan = root.__DS_CensorReplyRestore_dom_scan ||
        (typeof require !== 'undefined' ? require('./censor-reply-restore.dom.scan.js') : {});

    var bundle = {};
    Object.assign(bundle, extract, resolve, inject, scan);

    root.__DS_CensorReplyRestore_dom = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(globalThis);
