/**
 * DS studio — Content Script Export 模組
 * 負責 Markdown 匯出管線：解析 HTML、組裝標頭、觸發下載、格式化時間。
 * 以 IIFE 掛載於 globalThis.__DS_ContentExport，並相容 Node.js require()（供單元測試）。
 */
(function (root) {
    'use strict';

    /**
     * 格式化系統時間為 yyyy/mm/dd hh:mm:ss（24小時制、零補位），並附加當地時區偏移 (UTC±hh:mm)。
     * @param {Date} [date]
     * @returns {string}
     */
    function formatSystemTime(date) {
        // 預設使用當下時間
        var d = date || new Date();
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        var hours = String(d.getHours()).padStart(2, '0');
        var minutes = String(d.getMinutes()).padStart(2, '0');
        var seconds = String(d.getSeconds()).padStart(2, '0');
        return year + '/' + month + '/' + day + ' ' + hours + ':' + minutes + ':' + seconds + ' (' + formatTimezoneOffset(d) + ')';
    }

    /**
     * 計算 Date 物件的當地時區偏移，回傳 (UTC±hh:mm) 格式字串。
     * 使用 Date.getTimezoneOffset() 並取其相反數：
     *   UTC-03:45  → getTimezoneOffset() 回傳 +225 → 格式化為 UTC-03:45
     *   UTC+08:00  → getTimezoneOffset() 回傳 -480 → 格式化為 UTC+08:00
     * @param {Date} [date]
     * @returns {string}
     */
    function formatTimezoneOffset(date) {
        var d = date || new Date();
        var offsetMinutes = -d.getTimezoneOffset();
        var sign = offsetMinutes >= 0 ? '+' : '-';
        var absMinutes = Math.abs(offsetMinutes);
        var hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
        var minutes = String(absMinutes % 60).padStart(2, '0');
        return 'UTC' + sign + hours + ':' + minutes;
    }

    /**
     * 建立 Markdown 匯出的標頭字串。
     * @returns {string}
     */
    function _buildMarkdownHeader() {
        var exportedAt = new Date().toLocaleString();
        return '# DeepSeek Chat Export\n\n> Exported at: ' + exportedAt + '\n\n---\n\n';
    }

    /**
     * Parses an HTML element recursively into a formatted Markdown string.
     * @param {Element} node - The root element to parse
     * @param {Object} options - Parsing options
     * @param {boolean} options.forceReferences - Whether to extract citation reference links
     * @returns {string} - The resulting markdown string
     */
    function parseHtmlToMarkdown(node, options) {
        if (options === undefined) options = { forceReferences: true };
        var result = '';

        var blockElements = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'TR']);
        var isBlock = function (el) { return el && el.tagName && blockElements.has(el.tagName); };

        function walk(n, parentTagName) {
            if (parentTagName === undefined) parentTagName = null;
            var text = '';
            if (n.nodeType === Node.TEXT_NODE) {
                // 移除多餘空白，保留單一空格
                var content = n.textContent.replace(/\s+/g, ' ');
                if (content.trim() !== '' || content === ' ') {
                    text += content;
                }
            } else if (n.nodeType === Node.ELEMENT_NODE) {
                var tagName = n.tagName;

                if (tagName === 'BR') {
                    text += '\n';
                } else if (tagName === 'STRONG' || tagName === 'B') {
                    var inner = parseChildren(n, tagName).trim();
                    if (inner) text += '**' + inner + '**';
                } else if (tagName === 'EM' || tagName === 'I') {
                    var inner = parseChildren(n, tagName).trim();
                    if (inner) text += '*' + inner + '*';
                } else if (tagName === 'CODE') {
                    if (parentTagName !== 'PRE') {
                        text += '`' + n.textContent + '`';
                    } else {
                        text += n.textContent;
                    }
                } else if (tagName === 'A') {
                    var citeSpan = n.querySelector('.ds-markdown-cite');
                    if (citeSpan) {
                        if (options.forceReferences) {
                            var citeNumber = citeSpan.textContent.replace(/[^0-9]/g, '');
                            if (!citeNumber) {
                                var numSpan = Array.from(citeSpan.querySelectorAll('span')).find(function (s) { return s.style.position === 'absolute'; });
                                if (numSpan) citeNumber = numSpan.textContent.trim();
                            }
                            if (citeNumber) {
                                text += ' [[link-' + citeNumber + ']](' + n.href + ')';
                            }
                        }
                    } else {
                        var inner = parseChildren(n, tagName);
                        text += '[' + inner + '](' + n.href + ')';
                    }
                } else if (tagName === 'BLOCKQUOTE') {
                    var inner = parseChildren(n, tagName);
                    var quoted = inner.trim().split('\n').map(function (line) { return '> ' + line; }).join('\n');
                    text += '\n\n' + quoted + '\n\n';
                } else if (tagName === 'UL') {
                    var items = Array.from(n.children).filter(function (child) { return child.tagName === 'LI'; });
                    var ulText = '\n';
                    items.forEach(function (li) {
                        ulText += '- ' + parseChildren(li, tagName).trim() + '\n';
                    });
                    text += ulText + '\n';
                } else if (tagName === 'OL') {
                    var items = Array.from(n.children).filter(function (child) { return child.tagName === 'LI'; });
                    var olText = '\n';
                    items.forEach(function (li, idx) {
                        olText += (idx + 1) + '. ' + parseChildren(li, tagName).trim() + '\n';
                    });
                    text += olText + '\n';
                } else if (tagName === 'PRE') {
                    var codeLang = (n.getAttribute('class') || '').replace('language-', '') || '';
                    text += '\n\n```' + codeLang + '\n' + n.textContent + '\n```\n\n';
                } else if (/^H[1-6]$/.test(tagName)) {
                    var level = parseInt(tagName[1]);
                    var prefix = '#'.repeat(level);
                    var inner = parseChildren(n, tagName).trim();
                    if (inner) {
                        text += '\n\n' + prefix + ' ' + inner + '\n\n';
                    }
                } else if (tagName === 'TABLE') {
                    var rows = Array.from(n.querySelectorAll('tr'));
                    if (rows.length > 0) {
                        var tableText = '\n\n';
                        rows.forEach(function (row, rowIdx) {
                            var cells = Array.from(row.children).filter(function (c) { return c.tagName === 'TH' || c.tagName === 'TD'; });
                            var cellContents = cells.map(function (c) { return parseChildren(c, 'TABLE').trim().replace(/\n/g, ' '); });
                            tableText += '| ' + cellContents.join(' | ') + ' |\n';
                            if (rowIdx === 0) {
                                tableText += '|' + cells.map(function () { return '-'; }).join('|') + '|\n';
                            }
                        });
                        tableText += '\n';
                        text += tableText;
                    }
                } else if (tagName === 'P' || tagName === 'DIV') {
                    // 處理程式碼區塊：從 <pre> 中提取 span 內容
                    if (tagName === 'DIV' && n.classList && Array.from(n.classList).some(function (c) { return c.includes('md-code-block'); })) {
                        var pre = n.querySelector('pre');
                        if (pre) {
                            var codeLang = (pre.getAttribute('class') || '').replace('language-', '') || '';
                            var spans = pre.querySelectorAll('span');
                            var codeContent = Array.from(spans).map(function (s) { return s.textContent; }).join('');
                            text += '\n\n```' + codeLang + '\n' + codeContent + '\n```\n\n';
                        } else {
                            var inner = parseChildren(n, tagName).trim();
                            if (inner) text += '\n' + inner + '\n';
                        }
                    } else {
                        var inner = parseChildren(n, tagName).trim();
                        if (inner) {
                            text += '\n' + inner + '\n';
                        }
                    }
                } else {
                    // 其餘標籤：遞迴解析子節點
                    text += parseChildren(n, tagName);
                }
            }
            return text;
        }

        function parseChildren(parentNode, parentTagName) {
            var childText = '';
            for (var i = 0; i < parentNode.childNodes.length; i++) {
                childText += walk(parentNode.childNodes[i], parentTagName);
            }
            return childText;
        }

        result = parseChildren(node, null);

        // 清理多餘換行
        result = result.replace(/\n{3,}/g, '\n\n').trim();
        return result;
    }

    /**
     * 將單一訊息節點（.ds-message）轉換為 Markdown 字串。
     * 此函式為純查詢，不修改 DOM，不持有模組層級狀態。
     * @param {Element} msg - .ds-message 節點（可為克隆節點）
     * @param {boolean} includeThinking - 是否包含思考過程
     * @param {boolean} includeReferences - 是否包含引用連結
     * @returns {string} 該訊息的 Markdown 字串（含尾端分隔線）
     */
    function convertMessageNodeToMarkdown(msg, includeThinking, includeReferences) {
        // Guard: 空節點直接略過
        if (!msg) return '';

        var result = '';

        // AI 回覆：含 .ds-markdown 容器
        var markdownContainer = msg.querySelector('.ds-markdown');

        if (markdownContainer) {
            result += '## DeepSeek\n\n';

            // 思考過程區塊
            var firstThinkBlock = msg.querySelector('.ds-think-content');
            var thinkContainer = firstThinkBlock ? firstThinkBlock.parentNode : null;

            if (thinkContainer && includeThinking) {
                result += '> **Thinking Process:**\n';
                for (var i = 0; i < thinkContainer.children.length; i++) {
                    var child = thinkContainer.children[i];
                    if (child.classList.contains('ds-think-content')) {
                        var mdBlock = child.querySelector('.ds-markdown');
                        if (mdBlock) {
                            var text = parseHtmlToMarkdown(mdBlock, { forceReferences: true });
                            var quoted = text.split('\n').map(function (line) { return '> ' + line; }).join('\n');
                            result += quoted + '\n';
                        }
                    } else if (child.querySelector('._08cbf39')) {
                        var span = child.querySelector('._08cbf39');
                        result += '> ' + span.textContent.trim() + '\n';
                    } else if (child.querySelector('._442c8e7')) {
                        var labelDiv = child.querySelector('._442c8e7');
                        var links = child.querySelectorAll('a._04ab7b1');
                        var line = '> ' + labelDiv.textContent.trim();
                        links.forEach(function (link) {
                            line += ' [' + link.textContent.trim() + '](' + link.href + ')';
                        });
                        result += line + '\n';
                    }
                }
                result += '\n';
            }

            // 主回覆：最後一個位於思考容器之外的 .ds-markdown
            var allMarkdownBlocks = Array.from(msg.querySelectorAll('.ds-markdown'));
            var mainResponseItems = thinkContainer
                ? allMarkdownBlocks.filter(function (block) { return !thinkContainer.contains(block); })
                : allMarkdownBlocks;
            var mainResponse = mainResponseItems[mainResponseItems.length - 1];

            if (mainResponse) {
                result += parseHtmlToMarkdown(mainResponse, { forceReferences: includeReferences }) + '\n\n';
            }
        } else {
            // 使用者訊息
            var userContentWrapper = msg.querySelector('.fbb737a4') || msg.firstElementChild;
            var text = userContentWrapper ? userContentWrapper.innerText : msg.innerText;
            text = (text || '').trim();
            if (text) {
                result += '## User\n\n';
                result += text + '\n\n';
            }
        }

        result += '---\n\n';
        return result;
    }

    /**
     * 利用 Harvest 模組擷取完整對話，並匯出為 Markdown 檔案。
     * 若擷取未完整（超時），仍匯出已取得部分，並附加警告頁尾。
     * @param {boolean} includeThinking - 是否包含思考過程
     * @param {boolean} includeReferences - 是否包含引用連結
     * @returns {Promise<void>}
     */
    async function exportConversationToMarkdown(includeThinking, includeReferences) {
        if (includeThinking === undefined) includeThinking = true;
        if (includeReferences === undefined) includeReferences = true;

        // 取得 Harvest 模組（由 harvest.js 掛載在 window.DSstudio.Harvest）
        var Harvest = root.DSstudio && root.DSstudio.Harvest;
        if (!Harvest) {
            // Harvest 模組不存在（舊版相容回退：直接擷取目前可見訊息）
            var messages = document.querySelectorAll('.ds-virtual-list-visible-items .ds-message');
            if (!messages || messages.length === 0) {
                alert(dsI18n.t('exportNoConversationAlert'));
                return;
            }
            var markdownContent = _buildMarkdownHeader();
            messages.forEach(function (msg) {
                markdownContent += convertMessageNodeToMarkdown(msg, includeThinking, includeReferences);
            });
            downloadMarkdown(markdownContent);
            return;
        }

        // 執行完整擷取（遮罩由 Harvest 內部管理）
        var harvestResult = await Harvest.harvestAllMessages();

        // Guard: 完全沒有訊息
        if (!harvestResult.items || harvestResult.items.length === 0) {
            alert(dsI18n.t('exportNoConversationAlert'));
            return;
        }

        // 組裝 Markdown
        var markdownContent = _buildMarkdownHeader();

        harvestResult.items.forEach(function (msg) {
            markdownContent += convertMessageNodeToMarkdown(msg, includeThinking, includeReferences);
        });

        // 若擷取不完整，附加警告頁尾
        if (!harvestResult.isComplete) {
            markdownContent += '\n> ⚠️ Export may be incomplete: scroll-harvest timed out before reaching the end.\n';
        }

        downloadMarkdown(markdownContent);
    }

    /**
     * 觸發 Markdown 內容的下載。
     * @param {string} content
     */
    function downloadMarkdown(content) {
        var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;

        // 產生含時間戳記的檔名
        var d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var timestamp = d.getFullYear() + '' + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());

        a.download = 'deepseek-chat-' + timestamp + '.md';
        document.body.appendChild(a);
        a.click();

        // 清理資源
        setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    var api = {
        formatSystemTime: formatSystemTime,
        formatTimezoneOffset: formatTimezoneOffset,
        _buildMarkdownHeader: _buildMarkdownHeader,
        parseHtmlToMarkdown: parseHtmlToMarkdown,
        convertMessageNodeToMarkdown: convertMessageNodeToMarkdown,
        exportConversationToMarkdown: exportConversationToMarkdown,
        downloadMarkdown: downloadMarkdown
    };

    // 掛載至全域（瀏覽器）
    root.__DS_ContentExport = api;

    // Node.js require() 支援（供單元測試）
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
