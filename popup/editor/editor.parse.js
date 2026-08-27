/**
 * DS studio — Editor Parse Bundle
 * 解析 query string 取得編輯目標。
 */
(function (root) {
    'use strict';

    /**
     * 解析 location.search 取得編輯目標。
     * 合法結果：{ type: 'global' } 或 { type: 'preset', id: string }
     * 非法結果：null（呼叫端應轉為停用狀態）
     * @returns {{ type: 'global' } | { type: 'preset', id: string } | null}
     */
    function parseTarget() {
        const params = new URLSearchParams(location.search);
        const type = params.get('target');

        if (type === 'global') {
            return { type: 'global' };
        }

        if (type === 'preset') {
            const id = params.get('id');
            // id 必須為非空字串
            if (!id || !id.trim()) return null;
            return { type: 'preset', id: id.trim() };
        }

        // 未知或缺少 target 參數
        return null;
    }

    const bundle = { parseTarget };

    root.__DS_Editor_parse = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
