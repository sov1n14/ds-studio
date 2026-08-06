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
            expect(item.querySelector('.ds-select__item-btn--delete')).not.toBeNull();
        });

        it('emits a pin button before the delete button, unpinned by default when called with only preset (no options object)', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: 'Alpha' });
            const pinIndex = html.indexOf('ds-select__item-btn--pin"');
            const deleteIndex = html.indexOf('ds-select__item-btn--delete"');
            expect(pinIndex).toBeGreaterThan(-1);
            expect(deleteIndex).toBeGreaterThan(-1);
            expect(pinIndex).toBeLessThan(deleteIndex);
        });

        it('unpinned pin button has aria-pressed="false" and no --pinned class', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: 'Alpha' }, { isPinned: false });
            expect(html).not.toContain('ds-select__item-btn--pinned');
            expect(html).toContain('aria-pressed="false"');
        });

        it('pinned pin button carries --pinned class and aria-pressed="true"', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: 'Alpha' }, { isPinned: true });
            expect(html).toContain('ds-select__item-btn--pin');
            expect(html).toContain('ds-select__item-btn--pinned');
            expect(html).toContain('aria-pressed="true"');
        });

        it('unpinned pin button aria-label/title come from pinPresetAriaLabel/pinPresetTooltip i18n keys', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: 'Alpha' }, { isPinned: false });
            expect(html).toContain(`aria-label="${dsI18n.t('pinPresetAriaLabel')}"`);
            expect(html).toContain(`title="${dsI18n.t('pinPresetTooltip')}"`);
        });

        it('pinned pin button aria-label/title come from unpinPresetAriaLabel/unpinPresetTooltip i18n keys', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: 'Alpha' }, { isPinned: true });
            expect(html).toContain(`aria-label="${dsI18n.t('unpinPresetAriaLabel')}"`);
            expect(html).toContain(`title="${dsI18n.t('unpinPresetTooltip')}"`);
        });

        it('still HTML-escapes the group name when a pin option is supplied', () => {
            const html = Renderer.buildPresetItemMarkup({ id: 'a', name: '<b>Alpha</b>' }, { isPinned: true });
            expect(html).toContain('<span class="ds-select__item-name">&lt;b&gt;Alpha&lt;/b&gt;</span>');
        });
    });
});
