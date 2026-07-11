import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let Renderer;

beforeAll(() => {
    // preset-item-renderer.js calls dsI18n.t(...) at markup-build time, so
    // i18n must be loaded (and initialized) before evaluating the module.
    if (!globalThis.dsI18n) {
        const i18nCode = readFileSync(resolve(__dirname, '../../utils/i18n.js'), 'utf-8');
        eval('var chrome=globalThis.chrome,document=globalThis.document,window=globalThis;' + i18nCode);
    }

    const code = readFileSync(resolve(__dirname, '../../popup/preset-item-renderer.js'), 'utf-8');
    eval(code);
    Renderer = window.__DS_PresetItemRenderer;
});

describe('__DS_PresetItemRenderer', () => {
    describe('escapeHtml()', () => {
        it('escapes &, <, >, and "', () => {
            expect(Renderer.escapeHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;');
        });

        it('does not escape a single quote (implementation does not handle it)', () => {
            expect(Renderer.escapeHtml("it's")).toBe("it's");
        });

        it('escapes a mixed string containing multiple special characters', () => {
            expect(Renderer.escapeHtml('<script>alert("x")</script>'))
                .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
        });

        it('coerces non-string input via String()', () => {
            expect(Renderer.escapeHtml(123)).toBe('123');
            expect(Renderer.escapeHtml(null)).toBe('null');
            expect(Renderer.escapeHtml(undefined)).toBe('undefined');
        });

        it('returns an empty string unchanged', () => {
            expect(Renderer.escapeHtml('')).toBe('');
        });
    });

    describe('buildPresetItemMarkup()', () => {
        it('includes the drag handle span', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: 'Alpha' });
            expect(html).toContain('<span class="ds-select__drag-handle" aria-hidden="true">⠿</span>');
        });

        it('includes the escaped preset name', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: '<b>Alpha</b>' });
            expect(html).toContain('<span class="ds-select__item-name">&lt;b&gt;Alpha&lt;/b&gt;</span>');
        });

        it('includes an edit button with SVG and correct aria-label/title from i18n', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: 'Alpha' });
            expect(html).toContain('ds-select__item-btn--edit');
            expect(html).toContain(`aria-label="${dsI18n.t('renameAriaLabel')}"`);
            expect(html).toContain(`title="${dsI18n.t('editPresetNameTooltip')}"`);
            expect(html).toContain('<svg');
        });

        it('includes a delete button with correct aria-label/title from i18n', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: 'Alpha' });
            expect(html).toContain('ds-select__item-btn--delete"');
            expect(html).toContain(`aria-label="${dsI18n.t('deleteAriaLabel')}"`);
            expect(html).toContain(`title="${dsI18n.t('deletePresetTooltip')}"`);
            expect(html).toContain('>✕</button>');
        });

        it('renders a well-formed row when parsed into the DOM', () => {
            const item = document.createElement('div');
            item.innerHTML = Renderer.buildPresetItemMarkup({ id: 'x', name: 'Test' });
            expect(item.querySelector('.ds-select__drag-handle')).not.toBeNull();
            expect(item.querySelector('.ds-select__item-name')?.textContent).toBe('Test');
            expect(item.querySelector('.ds-select__item-btn--edit')).not.toBeNull();
            expect(item.querySelector('.ds-select__item-btn--delete')).not.toBeNull();
        });
    });
});
