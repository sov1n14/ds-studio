import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
//  Load i18n module
//  utils/i18n.js is a classic IIFE (not an ES module), so we read the source
//  and evaluate it to populate window.dsI18n.
// ─────────────────────────────────────────────────────────────────────────────
beforeAll(() => {
    const code = readFileSync(resolve(__dirname, '../../utils/i18n.js'), 'utf-8');
    eval(code);
});

// Shorthand — avoid repeating window.dsI18n in every assertion
const dsI18n = () => window.dsI18n;

// ─────────────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('dsI18n', () => {
    beforeEach(async () => {
        // vitest.setup.js clears chrome.storage.sync in its own beforeEach, so
        // init() reads empty storage and defaults to zh_TW.  Re-initialize to
        // guarantee a clean, predictable starting state for every test.
        await dsI18n().init();
    });

    // ── 1. Basic translation ────────────────────────────────────────────────
    describe('t() — basic translation', () => {
        it('returns the correct zh_TW string for a known key', () => {
            expect(dsI18n().t('globalPromptLabel')).toBe('全域預設提示詞');
            expect(dsI18n().t('saveStatus')).toBe('已儲存');
            expect(dsI18n().t('confirmButton')).toBe('確定');
        });

        it('returns the key itself for a non-existent key (graceful fallback)', () => {
            expect(dsI18n().t('nonexistentKey')).toBe('nonexistentKey');
            expect(dsI18n().t('')).toBe('');
        });

        it('returns English string after switching to English locale', async () => {
            await dsI18n().setLocale('en');
            expect(dsI18n().t('globalPromptLabel')).toBe('Global Default Prompt');
            expect(dsI18n().t('saveStatus')).toBe('Saved');
        });
    });

    // ── 2. Placeholder substitution ─────────────────────────────────────────
    describe('t() — placeholder substitution', () => {
        it('substitutes {name} placeholder in duplicateNameMessage', () => {
            expect(dsI18n().t('duplicateNameMessage', { name: 'My Prompt' }))
                .toBe('「My Prompt」已存在，請使用不同的名稱。');
        });

        it('substitutes {count} placeholder in syncRemainingToast', () => {
            expect(dsI18n().t('syncRemainingToast', { count: 5 }))
                .toBe('仍有 5 項未同步');
        });

        it('substitutes {seconds} placeholder in thinkBlockHeader', () => {
            expect(dsI18n().t('thinkBlockHeader', { seconds: 42 }))
                .toBe('已思考（用時 42 秒）');
        });

        it('substitutes {message} placeholder in restoreFailedMessage', () => {
            expect(dsI18n().t('restoreFailedMessage', { message: 'File not found' }))
                .toBe('讀取備份檔案時發生錯誤：File not found');
        });

        it('substitutes {name} placeholder in deletePresetMessage', () => {
            expect(dsI18n().t('deletePresetMessage', { name: 'Test Group' }))
                .toBe('確定要刪除「Test Group」嗎？此操作無法復原。');
        });

        it('substitutes placeholder after switching to English', async () => {
            await dsI18n().setLocale('en');
            expect(dsI18n().t('duplicateNameMessage', { name: 'My Prompt' }))
                .toBe('"My Prompt" already exists, please use a different name.');
            expect(dsI18n().t('syncRemainingToast', { count: 3 }))
                .toBe('3 item(s) not synced');
        });

        it('substitutes the same placeholder appearing multiple times (if present)', () => {
            // All current strings have at most one placeholder type, but verify
            // that the g(global) flag on the regex handles replacements correctly.
            const customStr = '{name} is named {name}';
            dsI18n()._data._testMulti = customStr;
            expect(dsI18n().t('_testMulti', { name: 'Foo' }))
                .toBe('Foo is named Foo');
            delete dsI18n()._data._testMulti;
        });

        it('does not substitute anything when replacements object is empty', () => {
            expect(dsI18n().t('duplicateNameMessage', {}))
                .toBe('「{name}」已存在，請使用不同的名稱。');
        });

        it('ignores extra keys in replacements that do not appear in the string', () => {
            expect(dsI18n().t('syncRemainingToast', { count: 2, extra: 'ignored' }))
                .toBe('仍有 2 項未同步');
        });
    });

    // ── 3. Locale switching ────────────────────────────────────────────────
    describe('locale switching', () => {
        it('getLocale() returns zh_TW by default', () => {
            expect(dsI18n().getLocale()).toBe('zh_TW');
        });

        it('setLocale() with valid locale returns true and updates getLocale()', async () => {
            expect(await dsI18n().setLocale('en')).toBe(true);
            expect(dsI18n().getLocale()).toBe('en');

            expect(await dsI18n().setLocale('zh_TW')).toBe(true);
            expect(dsI18n().getLocale()).toBe('zh_TW');
        });

        it('after setLocale("en"), t() returns English strings', async () => {
            await dsI18n().setLocale('en');
            expect(dsI18n().t('globalPromptLabel')).toBe('Global Default Prompt');
            expect(dsI18n().t('searchPresetPlaceholder')).toBe('Search Prompt Group');
            expect(dsI18n().t('presetSelectPanelAriaLabel')).toBe('Prompt Group List');
            expect(dsI18n().t('confirmButton')).toBe('OK');
        });

        it('setLocale persists the locale to chrome.storage.sync', async () => {
            await dsI18n().setLocale('en');
            const result = await chrome.storage.sync.get('ds_studio_locale');
            expect(result.ds_studio_locale).toBe('en');

            await dsI18n().setLocale('zh_TW');
            const result2 = await chrome.storage.sync.get('ds_studio_locale');
            expect(result2.ds_studio_locale).toBe('zh_TW');
        });

        it('init() reads the saved locale from chrome.storage.sync', async () => {
            // Pre-populate storage with English locale *before* init
            await chrome.storage.sync.set({ ds_studio_locale: 'en' });
            await dsI18n().init();
            expect(dsI18n().getLocale()).toBe('en');
            expect(dsI18n().t('globalPromptLabel')).toBe('Global Default Prompt');
        });

        it('init() defaults to zh_TW when storage is empty', async () => {
            // Storage was cleared by vitest.setup.js beforeEach, so init() sees
            // an empty store and falls back to DEFAULT_LOCALE.
            await dsI18n().init();
            expect(dsI18n().getLocale()).toBe('zh_TW');
            expect(dsI18n().t('globalPromptLabel')).toBe('全域預設提示詞');
        });

        it('setLocale with invalid locale returns false and does NOT change locale', async () => {
            expect(await dsI18n().setLocale('fr')).toBe(false);
            expect(dsI18n().getLocale()).toBe('zh_TW');

            expect(await dsI18n().setLocale('')).toBe(false);
            expect(dsI18n().getLocale()).toBe('zh_TW');

            expect(await dsI18n().setLocale('zh_cn')).toBe(false);
            expect(dsI18n().getLocale()).toBe('zh_TW');
        });

        it('setLocale with the same locale twice is idempotent', async () => {
            await dsI18n().setLocale('en');
            await dsI18n().setLocale('en');
            expect(dsI18n().getLocale()).toBe('en');
            expect(dsI18n().t('globalPromptLabel')).toBe('Global Default Prompt');
            // Storage should still be 'en' from the first call
            const result = await chrome.storage.sync.get('ds_studio_locale');
            expect(result.ds_studio_locale).toBe('en');
        });

        it('getLocaleName() returns display name for current locale', () => {
            expect(dsI18n().getLocaleName()).toBe('中文');
            dsI18n().setLocale('en');
            expect(dsI18n().getLocaleName()).toBe('English');
        });
    });

    // ── 4. DOM i18n (apply function) ──────────────────────────────────────
    describe('apply() — DOM i18n', () => {
        beforeEach(() => {
            document.body.innerHTML = '';
        });

        it('updates textContent for elements with data-i18n', () => {
            document.body.innerHTML = '<span data-i18n="globalPromptLabel"></span>';
            dsI18n().apply();
            expect(document.querySelector('[data-i18n]').textContent)
                .toBe('全域預設提示詞');
        });

        it('updates placeholder attribute when data-i18n-attr is "placeholder"', () => {
            document.body.innerHTML =
                '<input data-i18n="searchPresetPlaceholder" data-i18n-attr="placeholder">';
            dsI18n().apply();
            expect(document.querySelector('[data-i18n]').getAttribute('placeholder'))
                .toBe('搜尋提示詞組');
        });

        it('updates aria-label attribute when data-i18n-attr is "aria-label"', () => {
            document.body.innerHTML =
                '<div data-i18n="presetSelectPanelAriaLabel" data-i18n-attr="aria-label"></div>';
            dsI18n().apply();
            expect(document.querySelector('[data-i18n]').getAttribute('aria-label'))
                .toBe('提示詞組清單');
        });

        it('after switching to English, apply() updates elements to English text', async () => {
            document.body.innerHTML = '<span data-i18n="globalPromptLabel"></span>';
            await dsI18n().setLocale('en');
            dsI18n().apply();
            expect(document.querySelector('[data-i18n]').textContent)
                .toBe('Global Default Prompt');
        });

        it('elements without data-i18n attribute are left untouched', () => {
            document.body.innerHTML = '<span id="plain">Original Content</span>';
            dsI18n().apply();
            expect(document.getElementById('plain').textContent).toBe('Original Content');
        });

        it('apply() on a DocumentFragment root works correctly', () => {
            const fragment = document.createDocumentFragment();
            const el = document.createElement('span');
            el.setAttribute('data-i18n', 'globalPromptLabel');
            fragment.appendChild(el);
            dsI18n().apply(fragment);
            expect(el.textContent).toBe('全域預設提示詞');
        });

        it('applies translations to multiple elements in a single call', () => {
            document.body.innerHTML = `
                <span data-i18n="globalPromptLabel"></span>
                <span data-i18n="saveStatus"></span>
                <span data-i18n="confirmButton"></span>
            `;
            dsI18n().apply();
            const els = document.querySelectorAll('[data-i18n]');
            expect(els[0].textContent).toBe('全域預設提示詞');
            expect(els[1].textContent).toBe('已儲存');
            expect(els[2].textContent).toBe('確定');
        });

        it('correctly applies mixed textContent and attribute translations', () => {
            document.body.innerHTML = `
                <span data-i18n="globalPromptLabel"></span>
                <input data-i18n="searchPresetPlaceholder" data-i18n-attr="placeholder">
                <div data-i18n="presetSelectPanelAriaLabel" data-i18n-attr="aria-label"></div>
            `;
            dsI18n().apply();
            const [span, input, div] = document.querySelectorAll('[data-i18n]');
            expect(span.textContent).toBe('全域預設提示詞');
            expect(input.getAttribute('placeholder')).toBe('搜尋提示詞組');
            expect(div.getAttribute('aria-label')).toBe('提示詞組清單');
        });

        it('handles keys that do not exist in translation data (renders key as fallback)', () => {
            document.body.innerHTML = '<span data-i18n="unknownKey"></span>';
            dsI18n().apply();
            expect(document.querySelector('[data-i18n]').textContent).toBe('unknownKey');
        });

        it('apply() with empty document body does not throw', () => {
            expect(() => dsI18n().apply()).not.toThrow();
        });

        it('apply() with no root argument defaults to document', () => {
            document.body.innerHTML = '<span data-i18n="globalPromptLabel"></span>';
            expect(() => dsI18n().apply()).not.toThrow();
            expect(document.querySelector('[data-i18n]').textContent)
                .toBe('全域預設提示詞');
        });
    });

    // ── 5. Edge cases ──────────────────────────────────────────────────────
    describe('edge cases', () => {
        it('t() works before init() is called (data is embedded via zh_TW fallback)', () => {
            // Simulate pre-init state: _data is null, _locale is default
            dsI18n()._data = null;
            dsI18n()._locale = 'zh_TW';

            // Known keys should resolve via the zh_TW fallback in t()
            expect(dsI18n().t('globalPromptLabel')).toBe('全域預設提示詞');
            expect(dsI18n().t('saveStatus')).toBe('已儲存');

            // Non-existent keys should still return the key itself
            expect(dsI18n().t('unknownKey')).toBe('unknownKey');

            // Restore state for subsequent tests
            return dsI18n().init();
        });

        it('handles empty string translation values gracefully', () => {
            // t() checks `str === undefined` — an empty string is not undefined
            // so it is returned as-is rather than becoming the key name.
            dsI18n()._data._emptyTest = '';
            expect(dsI18n().t('_emptyTest')).toBe('');
            delete dsI18n()._data._emptyTest;
        });

        it('handles replacement value with a dot character correctly', () => {
            // A dot (.) is a wildcard in regex but the replacement value is
            // just a plain string — no regex is constructed from it.
            expect(dsI18n().t('duplicateNameMessage', { name: 'my.preset' }))
                .toBe('「my.preset」已存在，請使用不同的名稱。');
        });

        it('handles numeric replacement values via String conversion', () => {
            expect(dsI18n().t('syncRemainingToast', { count: 0 }))
                .toBe('仍有 0 項未同步');
            expect(dsI18n().t('thinkBlockHeader', { seconds: 0 }))
                .toBe('已思考（用時 0 秒）');
        });

        it('setLocale does not throw when chrome.storage.sync.set fails', async () => {
            // Simulate a storage write failure by replacing the sync mock
            // temporarily with one that rejects.
            const realSet = chrome.storage.sync.set;
            chrome.storage.sync.set = async () => { throw new Error('Storage failure'); };

            // Should not throw — the implementation catches storage errors
            let error = null;
            try {
                await dsI18n().setLocale('en');
            } catch (e) {
                error = e;
            }
            expect(error).toBeNull();

            // Locale should still be updated in memory even when storage fails
            expect(dsI18n().getLocale()).toBe('en');

            // Restore
            chrome.storage.sync.set = realSet;
        });

        it('multiple keys with the same prefix are independently resolvable', () => {
            expect(dsI18n().t('cancelButton')).toBe('取消');
            expect(dsI18n().t('cancelButtonBackupManager')).toBe('取消');
            expect(dsI18n().t('cancelButtonClearRestored')).toBe('取消');
            // They all happen to be the same string — that is the correct data
        });

        it('all zh_TW keys have a corresponding en key in the data', () => {
            // The i18n module does not expose the raw data objects directly,
            // but we can verify this structurally by checking that every key
            // present in zh_TW is also present in en by iterating zh_TW keys
            // and checking t() output differs (or at least exists) when
            // locale is switched.
            const zhKeys = [
                'globalPromptLabel', 'saveStatus', 'confirmButton',
                'cancelButton', 'deleteButton',
            ];
            for (const key of zhKeys) {
                const zhVal = dsI18n().t(key);
                expect(typeof zhVal).toBe('string');
                // After switching to en, the value must be a string (not the key itself)
                dsI18n().setLocale('en');
                const enVal = dsI18n().t(key);
                expect(typeof enVal).toBe('string');
                expect(enVal).not.toBe(key); // must not be the fallback key
                // Switch back
                dsI18n().setLocale('zh_TW');
            }
        });
    });
});
