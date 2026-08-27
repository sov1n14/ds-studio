/**
 * DS studio — Censor Reply Restore :: DOM Extract
 * Fragment 萃取輔助函式。由 censor-reply-restore.dom.js 以 Object.assign 合入。
 */
(function (root) {
    'use strict';

    const bundle = {
        _extractRenderableFragments(fragments) {
            const thinkParts = [];
            let responseContent = '';
            let hasResponse = false;
            for (const f of fragments) {
                if (!f || !f.type) continue;
                if (f.type === 'THINK') {
                    if (typeof f.content === 'string' && f.content) thinkParts.push(f.content);
                } else if (f.type === 'RESPONSE') {
                    if (typeof f.content === 'string') {
                        responseContent += f.content;
                        hasResponse = true;
                    }
                }
            }
            return {
                thinkContent: thinkParts.join('\n\n'),
                hasThink: thinkParts.length > 0,
                responseContent,
                hasResponse,
            };
        },
    };

    root.__DS_CensorReplyRestore_dom_extract = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(globalThis);
