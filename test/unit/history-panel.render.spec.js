import { describe, it, expect, beforeEach } from 'vitest';
import HistoryPanelRender from '../../content/history-panel.render.js';

const { createPanel, renderThread } = HistoryPanelRender;

describe('HistoryPanelRender.renderThread', () => {
    let panelEl;

    beforeEach(() => {
        document.body.innerHTML = '';
        panelEl = createPanel({});
        document.body.appendChild(panelEl);
    });

    it('shows an empty-state row when threadResult.ok is false', () => {
        renderThread(panelEl, { ok: false, reason: 'NO_MESSAGES' });
        const listEl = panelEl.querySelector('.dss-history-list');
        expect(listEl.querySelectorAll('.dss-history-empty').length).toBe(1);
        expect(listEl.querySelectorAll('.dss-history-msg').length).toBe(0);
    });

    it('shows an empty-state row when threadResult is nullish', () => {
        renderThread(panelEl, null);
        const listEl = panelEl.querySelector('.dss-history-list');
        expect(listEl.querySelectorAll('.dss-history-empty').length).toBe(1);
    });

    it('renders one row per message for a valid thread', () => {
        renderThread(panelEl, {
            ok: true,
            title: 'My Chat',
            messages: [
                { messageId: '1', role: 'USER', fragments: [{ type: 'TEXT', content: 'hi' }] },
                { messageId: '2', role: 'ASSISTANT', fragments: [{ type: 'TEXT', content: 'hello' }] },
            ],
        });
        const listEl = panelEl.querySelector('.dss-history-list');
        expect(listEl.querySelectorAll('.dss-history-msg').length).toBe(2);
        expect(listEl.querySelectorAll('.dss-history-empty').length).toBe(0);
    });

    it('puts THINK fragment content inside a closed <details> element', () => {
        renderThread(panelEl, {
            ok: true,
            title: 'x',
            messages: [
                {
                    messageId: '1',
                    role: 'ASSISTANT',
                    fragments: [
                        { type: 'THINK', content: 'reasoning here' },
                        { type: 'TEXT', content: 'visible reply' },
                    ],
                },
            ],
        });
        const details = panelEl.querySelector('.dss-history-list details.dss-history-think');
        expect(details).not.toBeNull();
        expect(details.hasAttribute('open')).toBe(false);
        expect(details.querySelector('.dss-history-think__body').textContent).toContain('reasoning here');
    });

    it('sets message body content via textContent (no innerHTML injection)', () => {
        const maliciousContent = '<img src=x onerror="window.__pwned = true">';
        renderThread(panelEl, {
            ok: true,
            title: 'x',
            messages: [
                { messageId: '1', role: 'USER', fragments: [{ type: 'TEXT', content: maliciousContent }] },
            ],
        });
        const bodyEl = panelEl.querySelector('.dss-history-msg__body');
        // textContent preserves the raw string; it must NOT have been parsed as markup.
        expect(bodyEl.textContent).toBe(maliciousContent);
        expect(bodyEl.querySelector('img')).toBeNull();
        expect(window.__pwned).toBeUndefined();
    });

    it('sets the panel title from threadResult.title', () => {
        renderThread(panelEl, {
            ok: true,
            title: 'Custom Title',
            messages: [{ messageId: '1', role: 'USER', fragments: [{ type: 'TEXT', content: 'hi' }] }],
        });
        expect(panelEl.querySelector('.dss-history-title').textContent).toBe('Custom Title');
    });
});
