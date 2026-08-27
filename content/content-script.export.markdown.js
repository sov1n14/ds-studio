/**
 * DS Studio — ContentExport Markdown 解析方法群組
 * 負責 HTML 至 Markdown 的遞迴解析與標籤處理。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    var selectors = (globalThis).DSstudio && (globalThis).DSstudio.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    function _renderBold(n, ctx) {
        var inner = ctx.parseChildren(n, n.tagName).trim();
        return inner ? '**' + inner + '**' : '';
    }

    function _renderItalic(n, ctx) {
        var inner = ctx.parseChildren(n, n.tagName).trim();
        return inner ? '*' + inner + '*' : '';
    }

    /** <code>：位於 <pre> 內時輸出純文字，否則加上行內反引號。 */
    function _renderCode(n, ctx) {
        if (ctx.parentTagName === 'PRE') return n.textContent;
        return '`' + n.textContent + '`';
    }

    /** <a>：一般連結直接輸出；引用標記（.ds-markdown-cite）僅在啟用引用時輸出。 */
    function _renderAnchor(n, ctx) {
        var citeSpan = n.querySelector(selectors.MARKDOWN_CITE_SELECTOR);
        if (!citeSpan) {
            return '[' + ctx.parseChildren(n, n.tagName) + '](' + n.href + ')';
        }
        // Guard: 未啟用引用連結時，引用標記一律略過
        if (!ctx.options.forceReferences) return '';

        var citeNumber = citeSpan.textContent.replace(/[^0-9]/g, '');
        if (!citeNumber) {
            // 編號被 absolute 定位的 span 承載時，改由該 span 取值
            var numSpan = Array.from(citeSpan.querySelectorAll('span')).find(function (s) { return s.style.position === 'absolute'; });
            if (numSpan) citeNumber = numSpan.textContent.trim();
        }
        return citeNumber ? ' [[link-' + citeNumber + ']](' + n.href + ')' : '';
    }

    function _renderBlockquote(n, ctx) {
        var quoted = ctx.parseChildren(n, n.tagName).trim().split('\n').map(function (line) { return '> ' + line; }).join('\n');
        return '\n\n' + quoted + '\n\n';
    }

    function _collectListItems(n) {
        return Array.from(n.children).filter(function (child) { return child.tagName === 'LI'; });
    }

    function _renderUnorderedList(n, ctx) {
        var text = '\n';
        _collectListItems(n).forEach(function (li) {
            text += '- ' + ctx.parseChildren(li, n.tagName).trim() + '\n';
        });
        return text + '\n';
    }

    function _renderOrderedList(n, ctx) {
        var text = '\n';
        _collectListItems(n).forEach(function (li, idx) {
            text += (idx + 1) + '. ' + ctx.parseChildren(li, n.tagName).trim() + '\n';
        });
        return text + '\n';
    }

    function _readCodeLanguage(el) {
        return (el.getAttribute('class') || '').replace('language-', '') || '';
    }

    function _renderPre(n) {
        return '\n\n```' + _readCodeLanguage(n) + '\n' + n.textContent + '\n```\n\n';
    }

    function _renderHeading(n, ctx) {
        var prefix = '#'.repeat(parseInt(n.tagName[1]));
        var inner = ctx.parseChildren(n, n.tagName).trim();
        return inner ? '\n\n' + prefix + ' ' + inner + '\n\n' : '';
    }

    /** <table>：首列後補上分隔列，儲存格內換行壓成空格。 */
    function _renderTable(n, ctx) {
        var rows = Array.from(n.querySelectorAll('tr'));
        // Guard: 無列的表格不產生任何輸出
        if (rows.length === 0) return '';

        var text = '\n\n';
        rows.forEach(function (row, rowIdx) {
            var cells = Array.from(row.children).filter(function (c) { return c.tagName === 'TH' || c.tagName === 'TD'; });
            var cellContents = cells.map(function (c) { return ctx.parseChildren(c, 'TABLE').trim().replace(/\n/g, ' '); });
            text += '| ' + cellContents.join(' | ') + ' |\n';
            if (rowIdx === 0) {
                text += '|' + cells.map(function () { return '-'; }).join('|') + '|\n';
            }
        });
        return text + '\n';
    }

    function _isCodeBlockContainer(n) {
        return n.tagName === 'DIV' && n.classList && Array.from(n.classList).some(function (c) { return c.includes(selectors.CODE_BLOCK_CLASS); });
    }

    /** <p> / <div>：一般區塊；DeepSeek 程式碼區塊容器改以 span 拼接輸出圍欄式程式碼。 */
    function _renderBlock(n, ctx) {
        if (_isCodeBlockContainer(n)) {
            var pre = n.querySelector('pre');
            if (pre) {
                var codeContent = Array.from(pre.querySelectorAll('span')).map(function (s) { return s.textContent; }).join('');
                return '\n\n```' + _readCodeLanguage(pre) + '\n' + codeContent + '\n```\n\n';
            }
        }
        var inner = ctx.parseChildren(n, n.tagName).trim();
        return inner ? '\n' + inner + '\n' : '';
    }

    /**
     * 標籤 → 處理器對照表。未列出的標籤一律遞迴解析子節點。
     * @type {Object<string, function(Element, TagContext): string>}
     */
    var TAG_HANDLERS = {
        BR: function () { return '\n'; },
        STRONG: _renderBold,
        B: _renderBold,
        EM: _renderItalic,
        I: _renderItalic,
        CODE: _renderCode,
        A: _renderAnchor,
        BLOCKQUOTE: _renderBlockquote,
        UL: _renderUnorderedList,
        OL: _renderOrderedList,
        PRE: _renderPre,
        H1: _renderHeading,
        H2: _renderHeading,
        H3: _renderHeading,
        H4: _renderHeading,
        H5: _renderHeading,
        H6: _renderHeading,
        TABLE: _renderTable,
        P: _renderBlock,
        DIV: _renderBlock
    };

    /**
     * Parses an HTML element recursively into a formatted Markdown string.
     * @param {Element} node - The root element to parse
     * @param {Object} options - Parsing options
     * @param {boolean} options.forceReferences - Whether to extract citation reference links
     * @returns {string} - The resulting markdown string
     */
    function parseHtmlToMarkdown(node, options) {
        if (options === undefined) options = { forceReferences: true };

        function walk(n, parentTagName) {
            if (parentTagName === undefined) parentTagName = null;

            if (n.nodeType === Node.TEXT_NODE) {
                // 移除多餘空白，保留單一空格
                var content = n.textContent.replace(/\s+/g, ' ');
                return (content.trim() !== '' || content === ' ') ? content : '';
            }
            // Guard: 非元素節點（註解等）不產生輸出
            if (n.nodeType !== Node.ELEMENT_NODE) return '';

            var handler = TAG_HANDLERS[n.tagName];
            // 未列於對照表的標籤：遞迴解析子節點
            if (!handler) return parseChildren(n, n.tagName);

            return handler(n, { parentTagName: parentTagName, options: options, parseChildren: parseChildren });
        }

        function parseChildren(parentNode, parentTagName) {
            var childText = '';
            for (var i = 0; i < parentNode.childNodes.length; i++) {
                childText += walk(parentNode.childNodes[i], parentTagName);
            }
            return childText;
        }

        var result = parseChildren(node, null);

        // 清理多餘換行
        result = result.replace(/\n{3,}/g, '\n\n').trim();
        return result;
    }

    var bundle = {
        TAG_HANDLERS: TAG_HANDLERS,
        parseHtmlToMarkdown: parseHtmlToMarkdown,
    };

    root.__DS_ContentExport_markdown = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
