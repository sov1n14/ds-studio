/**
 * DS studio — Full Conversation History Panel: Markdown Export
 * 將完整對話紀錄（threadResult）轉換為 Markdown 文件並提供下載功能。
 * toMarkdown / buildFilename 為純函式（無 DOM 依賴，可於 Node/Vitest 單元測試）；
 * downloadMarkdown 為唯一含副作用（DOM/Blob）的函式。
 */
(function (root) {
    'use strict';

    const FILENAME_ILLEGAL_CHARS_PATTERN = /[\\/:*?"<>|\x00-\x1F]/g;
    const WHITESPACE_PATTERN = /\s+/g;
    const TITLE_MAX_LENGTH = 50;
    const FALLBACK_TITLE = 'DeepSeek 對話';
    const FALLBACK_FILENAME_TITLE = 'conversation';

    /**
     * 判斷 fragment 是否應排除於匯出內容之外（AI 推理過程）。
     * @param {{type: string}} fragment
     * @returns {boolean}
     */
    function isThinkFragment(fragment) {
        return fragment && fragment.type === 'THINK';
    }

    /**
     * 將單一訊息的非 THINK fragment 內容以空行組合為訊息主體文字。
     * @param {{fragments: Array<{type: string, content: string}>}} message
     * @returns {string}
     */
    function buildMessageBody(message) {
        if (!message || !Array.isArray(message.fragments)) return '';

        return message.fragments
            .filter((fragment) => !isThinkFragment(fragment))
            .map((fragment) => fragment.content)
            .filter((content) => typeof content === 'string' && content.length > 0)
            .join('\n\n');
    }

    /**
     * 將 epoch 秒數轉換為本地日期時間字串。
     * @param {number} insertedAt - epoch 秒數
     * @returns {string}
     */
    function formatLocalDateTime(insertedAt) {
        if (typeof insertedAt !== 'number' || !isFinite(insertedAt)) return '';
        return new Date(insertedAt * 1000).toLocaleString();
    }

    /**
     * 依角色回傳講者標題（含表情符號）。
     * @param {string} role - 'USER' 或 'ASSISTANT'
     * @returns {string}
     */
    function getSpeakerHeading(role) {
        if (role === 'USER') return '## 🧑 使用者';
        if (role === 'ASSISTANT') return '## 🤖 助理';
        return `## ${role}`;
    }

    /**
     * 將單一訊息轉換為 Markdown 區塊（標題 + 時間 + 內容）。
     * @param {object} message
     * @returns {string}
     */
    function renderMessageBlock(message) {
        if (!message) return '';

        const heading = getSpeakerHeading(message.role);
        const dateTime = formatLocalDateTime(message.insertedAt);
        const body = buildMessageBody(message);

        return [heading, `*${dateTime}*`, '', body].join('\n');
    }

    /**
     * PURE：將完整對話紀錄（threadResult）轉換為 Markdown 文件字串。
     * @param {{ok: boolean, title: string, messages: Array}} threadResult
     * @returns {string} Markdown 文件內容；輸入無效時回傳空字串
     */
    function toMarkdown(threadResult) {
        if (!threadResult || !threadResult.ok || !threadResult.messages?.length) return '';

        const title = threadResult.title || FALLBACK_TITLE;
        const messageBlocks = threadResult.messages.map(renderMessageBlock);

        return [`# ${title}`, '', messageBlocks.join('\n\n---\n\n')].join('\n');
    }

    /**
     * PURE：清理字串使其可安全作為檔名的一部分。
     * 移除非法字元、將連續空白折疊為單一連字號，並截斷長度。
     * @param {string} rawTitle
     * @returns {string}
     */
    function sanitizeForFilename(rawTitle) {
        if (!rawTitle) return FALLBACK_FILENAME_TITLE;

        const sanitized = rawTitle
            .replace(FILENAME_ILLEGAL_CHARS_PATTERN, '')
            .trim()
            .replace(WHITESPACE_PATTERN, '-')
            .slice(0, TITLE_MAX_LENGTH);

        return sanitized || FALLBACK_FILENAME_TITLE;
    }

    /**
     * PURE：依對話標題與 sessionId 建構安全的匯出檔名。
     * @param {{title: string, sessionId: string}} threadResult
     * @returns {string} 例如 "deepseek-my-chat-abc123.md"
     */
    function buildFilename(threadResult) {
        if (!threadResult) return `deepseek-${FALLBACK_FILENAME_TITLE}.md`;

        const safeTitle = sanitizeForFilename(threadResult.title);
        const sessionSuffix = threadResult.sessionId ? `-${threadResult.sessionId}` : '';

        return `deepseek-${safeTitle}${sessionSuffix}.md`;
    }

    /**
     * 觸發瀏覽器下載 Markdown 檔案（Blob + 暫時 anchor 元素）。
     * 唯一含 DOM/Blob 副作用的函式；toMarkdown/buildFilename 均為純函式。
     * @param {object} threadResult
     * @returns {boolean} 是否成功觸發下載
     */
    function downloadMarkdown(threadResult) {
        const markdown = toMarkdown(threadResult);
        if (!markdown) return false;

        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);

        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = buildFilename(threadResult);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        URL.revokeObjectURL(objectUrl);

        return true;
    }

    const api = {
        toMarkdown,
        buildFilename,
        downloadMarkdown,
    };

    root.__DS_HistoryPanel_export = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
