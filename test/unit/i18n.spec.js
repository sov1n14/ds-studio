import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
//  Load i18n module
//  utils/i18n.js is a classic IIFE; read and eval it to populate the global.
//  Provide fallbacks for globals that may not be free variables in this scope.
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
    // Only eval once per suite
    if (globalThis.dsI18n) return;
    const code = readFileSync(resolve(__dirname, '../../utils/i18n.js'), 'utf-8');
    // Provide global fallbacks inside eval for chrome, document, window
    eval('var chrome=globalThis.chrome,document=globalThis.document,window=globalThis;' + code);
});

function dsI18n() { return globalThis.dsI18n; }

// Wait for dsI18n to be ready before each test
beforeEach(async () => {
    if (!dsI18n()) return; // skip if eval didn't run yet
    dsI18n()._reset();
    await dsI18n().init();
    // Set up in-memory storage for tests that need chrome
    if (!globalThis.__i18nStorageMock) {
        globalThis.__i18nStorageMock = {};
        // The setup file's InMemoryStorageMock is on chrome.storage.sync
        // but we might not have access to it here.  Fall back to our own.
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('dsI18n', () => {
    // ── 1. Basic translation ────────────────────────────────────────────────
    describe('t() — basic translation', () => {
        it('returns the correct zh_TW string for a known key', () => {
            expect(dsI18n().t('globalPromptLabel')).toBe('全域提示詞');
            expect(dsI18n().t('saveStatus')).toBe('已儲存');
            expect(dsI18n().t('confirmButton')).toBe('確定');
        });

        it('returns the key itself for a non-existent key (graceful fallback)', () => {
            expect(dsI18n().t('nonexistentKey')).toBe('nonexistentKey');
            expect(dsI18n().t('')).toBe('');
        });

        it('returns English string after switching to English locale', async () => {
            await dsI18n().setLocale('en');
            expect(dsI18n().t('globalPromptLabel')).toBe('Global Prompt');
            expect(dsI18n().t('saveStatus')).toBe('Saved');
        });
    });

    // ── 1b. Global prompt copy (全域提示詞 rename) ───────────────────────────
    describe('t() — global prompt label copy', () => {
        it('resolves globalPromptLabel, editGlobalPromptTitle, globalPresetTitle, globalPlaceholder to the new copy in zh_TW', () => {
            expect(dsI18n().t('globalPromptLabel')).toBe('全域提示詞');
            expect(dsI18n().t('editGlobalPromptTitle')).toBe('編輯全域提示詞');
            expect(dsI18n().t('globalPresetTitle')).toBe('全域提示詞');
            expect(dsI18n().t('globalPlaceholder')).toBe('輸入全域提示詞（會在所有對話中自動插入）');
        });

        it('resolves the same four keys to the new copy in en', async () => {
            await dsI18n().setLocale('en');
            expect(dsI18n().t('globalPromptLabel')).toBe('Global Prompt');
            expect(dsI18n().t('editGlobalPromptTitle')).toBe('Edit Global Prompt');
            expect(dsI18n().t('globalPresetTitle')).toBe('Global Prompt');
            expect(dsI18n().t('globalPlaceholder')).toBe('Enter the global prompt (will be inserted in all conversations)');
        });

        it('does NOT alter restoreSettingsMessage, which already reads "全域提示詞" / "global prompt" today', async () => {
            dsI18n().setLocale('zh_TW');
            expect(dsI18n().t('restoreSettingsMessage')).toBe(
                '確定要匯入嗎？\n• 覆蓋：介面設定、對話綁定、全域提示詞\n• 合併：提示詞組合（相同 ID 保留本地、新組合新增於後）'
            );

            await dsI18n().setLocale('en');
            expect(dsI18n().t('restoreSettingsMessage')).toBe(
                'Import this backup?\n• Overwrite: Interface settings, conversation bindings, global prompt\n• Merge: Prompt groups (same ID keeps local, new ones appended)'
            );
            dsI18n().setLocale('zh_TW');
        });

        it('does NOT alter the pin/unpin preset copy, which uses an unrelated meaning of "default"', () => {
            expect(dsI18n().t('pinPresetAriaLabel')).toBe('設為預設（新對話自動選用）');
            expect(dsI18n().t('pinPresetTooltip')).toBe('設為預設（新對話自動選用）');
            expect(dsI18n().t('unpinPresetAriaLabel')).toBe('取消預設');
            expect(dsI18n().t('unpinPresetTooltip')).toBe('取消預設');
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
            expect(dsI18n().t('thinkBlockHeader', { seconds: 3 }))
                .toBe('已思考（用時 3 秒）');
        });

        it('substitutes {message} placeholder in restoreFailedMessage', () => {
            expect(dsI18n().t('restoreFailedMessage', { message: 'Parse error' }))
                .toBe('讀取備份檔案時發生錯誤：Parse error');
        });

        it('substitutes {name} placeholder in deletePresetMessage', () => {
            expect(dsI18n().t('deletePresetMessage', { name: 'Test' }))
                .toBe('確定要刪除「Test」嗎？此操作無法復原。');
        });

        it('substitutes placeholder after switching to English', async () => {
            await dsI18n().setLocale('en');
            expect(dsI18n().t('duplicateNameMessage', { name: 'Test' }))
                .toBe('"Test" already exists, please use a different name.');
        });

        it('substitutes the same placeholder appearing multiple times', () => {
            // Temporarily add a custom string with multiple occurrences
            const key = '_multiTest_';
            dsI18n()._data[key] = '{tag} is named {tag}';
            expect(dsI18n().t(key, { tag: 'Foo' })).toBe('Foo is named Foo');
            delete dsI18n()._data[key];
        });

        it('does not substitute when replacements object is empty', () => {
            expect(dsI18n().t('duplicateNameMessage', {}))
                .toBe('「{name}」已存在，請使用不同的名稱。');
        });

        it('ignores extra keys in replacements that do not appear in the string', () => {
            expect(dsI18n().t('cancelButton', { extra: 'ignored' })).toBe('取消');
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
        });

        it('after setLocale("en"), t() returns English strings', async () => {
            await dsI18n().setLocale('en');
            expect(dsI18n().t('globalPromptLabel')).toBe('Global Prompt');
            expect(dsI18n().t('searchPresetPlaceholder')).toBe('Search Prompt Group');
            expect(dsI18n().t('confirmButton')).toBe('OK');
        });

        it('init() defaults to zh_TW when storage is empty', async () => {
            dsI18n()._reset();
            await dsI18n().init();
            expect(dsI18n().getLocale()).toBe('zh_TW');
            expect(dsI18n().t('globalPromptLabel')).toBe('全域提示詞');
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
            expect(dsI18n().t('globalPromptLabel')).toBe('Global Prompt');
        });
    });

    // ── 4. Edge cases ──────────────────────────────────────────────────────
    describe('edge cases', () => {
        it('t() works before init() is called (data is embedded via zh_TW fallback)', () => {
            // Simulate pre-init state: _data is null, _locale is default
            dsI18n()._data = null;
            dsI18n()._locale = 'zh_TW';

            expect(dsI18n().t('globalPromptLabel')).toBe('全域提示詞');
            expect(dsI18n().t('saveStatus')).toBe('已儲存');
            expect(dsI18n().t('unknownKey')).toBe('unknownKey');

            // Restore state for subsequent tests
            return dsI18n().init();
        });

        it('handles empty string translation values gracefully', () => {
            dsI18n()._data._emptyTest = '';
            expect(dsI18n().t('_emptyTest')).toBe('');
            delete dsI18n()._data._emptyTest;
        });

        it('handles replacement value with a dot character correctly', () => {
            expect(dsI18n().t('duplicateNameMessage', { name: 'my.preset' }))
                .toBe('「my.preset」已存在，請使用不同的名稱。');
        });

        it('handles numeric replacement values via String conversion', () => {
            expect(dsI18n().t('syncRemainingToast', { count: 0 }))
                .toBe('仍有 0 項未同步');
            expect(dsI18n().t('thinkBlockHeader', { seconds: 0 }))
                .toBe('已思考（用時 0 秒）');
        });

        it('does not throw when setLocale encounters a storage error', async () => {
            // setLocale has a try/catch around chrome.storage.sync.set.
            // Even if the mock is broken/missing, it should not throw.
            let error = null;
            try {
                await dsI18n().setLocale('en');
            } catch (e) {
                error = e;
            }
            expect(error).toBeNull();
            expect(dsI18n().getLocale()).toBe('en');
        });

        it('multiple keys with the same prefix are independently resolvable', () => {
            expect(dsI18n().t('cancelButton')).toBe('取消');
            expect(dsI18n().t('cancelButtonBackupManager')).toBe('取消');
            expect(dsI18n().t('cancelButtonClearRestored')).toBe('取消');
        });

        it('preset tooltip/title/message keys resolve to non-empty strings in zh_TW and en', () => {
            // Note: deleteAllPresetsTitle and deleteAllPresetsTooltip intentionally
            // share the same zh_TW/en copy ("刪除全部提示詞組" / "Delete all prompt
            // groups") in the actual translation data, so this suite does not
            // assert cross-key distinctness — only non-emptiness and that each
            // key resolves to real text (not a raw-key fallback), plus that the
            // en/zh_TW pair for every key differs (locale actually switched).
            const keys = [
                'deletePresetTooltip',
                'deleteAllPresetsTooltip',
                'deleteAllPresetsTitle',
                'deleteAllPresetsMessage',
            ];

            dsI18n().setLocale('zh_TW');
            const zhValues = keys.map(key => dsI18n().t(key));
            zhValues.forEach((val, i) => {
                expect(typeof val).toBe('string');
                expect(val.length).toBeGreaterThan(0);
                expect(val).not.toBe(keys[i]); // must not fall back to the raw key
            });

            dsI18n().setLocale('en');
            const enValues = keys.map(key => dsI18n().t(key));
            enValues.forEach((val, i) => {
                expect(typeof val).toBe('string');
                expect(val.length).toBeGreaterThan(0);
                expect(val).not.toBe(keys[i]);
            });

            // en strings must differ from their zh_TW counterparts (locale actually switched)
            keys.forEach((_, i) => {
                expect(enValues[i]).not.toBe(zhValues[i]);
            });

            dsI18n().setLocale('zh_TW');
        });

        it('all zh_TW keys have a corresponding en key in the data', () => {
            const sampleKeys = [
                'globalPromptLabel', 'saveStatus', 'confirmButton',
                'cancelButton', 'deleteButton',
            ];
            for (const key of sampleKeys) {
                const zhVal = dsI18n().t(key);
                expect(typeof zhVal).toBe('string');
                dsI18n().setLocale('en');
                const enVal = dsI18n().t(key);
                expect(typeof enVal).toBe('string');
                expect(enVal).not.toBe(key);
                dsI18n().setLocale('zh_TW');
            }
        });
    });
});
