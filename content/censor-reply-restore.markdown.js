/**
 * DS studio — Censor Reply Restore :: Markdown Bundle
 * Markdown → HTML 渲染子系統。由 censor-reply-restore.js 以 Object.assign 合入。
 */
(function (root) {
    'use strict';

    const bundle = {

        // ────────────────────────────────────────────
        // Subsystem F: Markdown → HTML renderer
        // ────────────────────────────────────────────

        _renderInline(text) {
            let result = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            result = result
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer"><span>$1</span></a>')
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong><span>$1</span></strong>')
                .replace(/\*([^*]+)\*/g, '<em><span>$1</span></em>');
            return result;
        },

        _renderMarkdown(text) {
            if (!text) return '';
            const lines = text.split('\n');
            const tokens = [];
            let i = 0;

            while (i < lines.length) {
                const line = lines[i];
                const trimmed = line.trim();

                if (trimmed.startsWith('```')) {
                    const lang = trimmed.slice(3).trim();
                    const codeLines = [];
                    i++;
                    while (i < lines.length && !lines[i].trim().startsWith('```')) {
                        codeLines.push(lines[i]);
                        i++;
                    }
                    i++;
                    const code = codeLines.join('\n');
                    tokens.push({ type: 'code', lang, code });
                    continue;
                }

                if (trimmed.startsWith('#')) {
                    const level = trimmed.match(/^#{1,6}/)[0].length;
                    const content = this._renderInline(trimmed.slice(level).trim());
                    tokens.push({ type: 'heading', level, content });
                    i++;
                    continue;
                }

                if (/^-{3,}$/.test(trimmed)) {
                    tokens.push({ type: 'hr' });
                    i++;
                    continue;
                }

                if (trimmed.startsWith('> ')) {
                    const quoteLines = [];
                    while (i < lines.length && lines[i].trim().startsWith('> ')) {
                        quoteLines.push(lines[i].trim().slice(2));
                        i++;
                    }
                    tokens.push({ type: 'blockquote', content: this._renderInline(quoteLines.join('\n')) });
                    continue;
                }

                if (/^- /.test(trimmed) || /^\* /.test(trimmed)) {
                    const items = [];
                    while (i < lines.length && (/^- /.test(lines[i].trim()) || /^\* /.test(lines[i].trim()))) {
                        items.push(this._renderInline(lines[i].trim().slice(2).trim()));
                        i++;
                    }
                    tokens.push({ type: 'ul', items });
                    continue;
                }

                if (/^\d+\.\s/.test(trimmed)) {
                    const items = [];
                    while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
                        items.push(this._renderInline(lines[i].trim().replace(/^\d+\.\s/, '')));
                        i++;
                    }
                    tokens.push({ type: 'ol', items });
                    continue;
                }

                if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                    const rows = [];
                    while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
                        rows.push(lines[i]);
                        i++;
                    }
                    tokens.push({ type: 'table', rows });
                    continue;
                }

                if (trimmed === '') {
                    i++;
                    continue;
                }

                const paraLines = [];
                while (i < lines.length && lines[i].trim() !== '') {
                    paraLines.push(lines[i].trim());
                    i++;
                }
                tokens.push({ type: 'paragraph', content: this._renderInline(paraLines.join(' ')) });
            }

            return this._renderTokens(tokens);
        },

        _renderTokens(tokens) {
            let html = '';
            for (const t of tokens) {
                switch (t.type) {
                    case 'paragraph':
                        html += `<p class="ds-markdown-paragraph"><span>${t.content}</span></p>\n`;
                        break;
                    case 'heading':
                        html += `<h${t.level}><span>${t.content}</span></h${t.level}>\n`;
                        break;
                    case 'hr':
                        html += '<hr>\n';
                        break;
                    case 'blockquote':
                        html += `<blockquote><p class="ds-markdown-paragraph"><span>${t.content}</span></p></blockquote>\n`;
                        break;
                    case 'ul':
                        html += '<ul>\n';
                        for (const item of t.items) {
                            html += `  <li><p><span>${item}</span></p></li>\n`;
                        }
                        html += '</ul>\n';
                        break;
                    case 'ol':
                        html += '<ol start="1">\n';
                        for (const item of t.items) {
                            html += `  <li><p><span>${item}</span></p></li>\n`;
                        }
                        html += '</ol>\n';
                        break;
                    case 'code':
                        html += '<div class="md-code-block md-code-block-dark">';
                        if (t.lang) {
                            html += `<div class="md-code-block-header"><span class="md-code-lang">${t.lang}</span></div>`;
                        }
                        html += `<pre><span>${this._escapeHtml(t.code)}</span></pre></div>\n`;
                        break;
                    case 'table':
                        html += this._renderTable(t.rows);
                        break;
                }
            }
            return html;
        },

        _renderTable(rows) {
            if (rows.length < 2) return '';
            const headerCells = rows[0].split('|').filter(c => c.trim() !== '');
            const bodyRows = rows.slice(2);
            let html = '<div class="ds-scroll-area"><table><thead><tr>';
            for (const cell of headerCells) {
                html += `<th><span>${this._renderInline(cell.trim())}</span></th>`;
            }
            html += '</tr></thead><tbody>';
            for (const row of bodyRows) {
                const cells = row.split('|').filter(c => c.trim() !== '');
                html += '<tr>';
                for (const cell of cells) {
                    html += `<td><span>${this._renderInline(cell.trim())}</span></td>`;
                }
                html += '</tr>';
            }
            html += '</tbody></table></div>\n';
            return html;
        },

        _escapeHtml(text) {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };

    root.__DS_CensorReplyRestore_markdown = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
