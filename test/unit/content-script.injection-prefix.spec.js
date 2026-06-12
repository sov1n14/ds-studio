import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

describe('buildInjectionPrefix (1.1.x, 1.2.x, 1.3.x scenarios)', () => {
    beforeEach(() => {
        contentScript.__resetState();
    });

    it('returns empty string when both globalDefaultPrompt and promptPrefix are empty', () => {
        expect(contentScript.buildInjectionPrefix()).toBe('');
    });

    it('returns only globalDefaultPrompt wrapped in system-prompt tags', () => {
        contentScript.__setState({ globalDefaultPrompt: 'You are a helpful assistant.' });
        expect(contentScript.buildInjectionPrefix()).toBe(
            '<system-prompt>\nYou are a helpful assistant.\n</system-prompt>'
        );
    });

    it('returns only promptPrefix wrapped in system-prompt tags', () => {
        contentScript.__setState({ promptPrefix: 'Speak in Chinese.' });
        expect(contentScript.buildInjectionPrefix()).toBe(
            '<system-prompt>\nSpeak in Chinese.\n</system-prompt>'
        );
    });

    it('joins both with double newline inside system-prompt tags', () => {
        contentScript.__setState({
            globalDefaultPrompt: 'You are a helpful assistant.',
            promptPrefix: 'Speak in Chinese.',
        });
        expect(contentScript.buildInjectionPrefix()).toBe(
            '<system-prompt>\nYou are a helpful assistant.\n\nSpeak in Chinese.\n</system-prompt>'
        );
    });

    it('handles multi-line globalDefaultPrompt', () => {
        contentScript.__setState({
            globalDefaultPrompt: 'Line 1\nLine 2',
        });
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Line 1');
        expect(result).toContain('Line 2');
    });

    it('handles special characters in prompt content', () => {
        contentScript.__setState({
            promptPrefix: 'Use "quotes" and <tags>',
        });
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Use "quotes" and <tags>');
    });

    it('returns empty when both are whitespace-only', () => {
        contentScript.__setState({
            globalDefaultPrompt: '   ',
            promptPrefix: '   ',
        });
        // globalDefaultPrompt is "   " (truthy), so it will be included
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('   ');
    });

    it('includes both when one is empty string and other has content', () => {
        contentScript.__setState({
            globalDefaultPrompt: '',
            promptPrefix: 'Only this',
        });
        expect(contentScript.buildInjectionPrefix()).toBe(
            '<system-prompt>\nOnly this\n</system-prompt>'
        );
    });
});

describe('injectPrefix edge cases (1.2.2, 1.3.x scenarios)', () => {
    function makeTextarea(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        return ta;
    }

    beforeEach(() => {
        contentScript.__resetState();
    });

    it('1.3.1: returns false when textarea is empty', () => {
        contentScript.__setState({ isEnabled: true, globalDefaultPrompt: 'test' });
        const ta = makeTextarea('');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('');
    });

    it('1.3.2: returns false when textarea is whitespace-only', () => {
        contentScript.__setState({ isEnabled: true, globalDefaultPrompt: 'test' });
        const ta = makeTextarea('   \n  \t  ');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('   \n  \t  ');
    });

    it('1.2.2: re-injects after prefix is removed by user', () => {
        contentScript.__setState({ isEnabled: true, globalDefaultPrompt: 'test' });
        const ta = makeTextarea('hello');

        // First call — injects
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toContain('<system-prompt>');

        // Second call on already-injected value — extraction logic extracts original message and re-injects
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toContain('<system-prompt>');
        expect(ta.value).toContain('<user-input>\nhello\n</user-input>');

        // User removes prefix and types new text
        ta.value = 'new message';
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toContain('<system-prompt>');
    });

    it('returns false when isEnabled is false', () => {
        contentScript.__setState({ isEnabled: false, globalDefaultPrompt: 'test' });
        const ta = makeTextarea('hello');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('hello');
    });

});

describe('showSystemTime feature (2.4.x scenario)', () => {
    function makeTextarea(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        return ta;
    }

    beforeEach(() => {
        contentScript.__resetState();
    });

    it('prepends system time before <system-prompt> when showSystemTime enabled and prompt present', () => {
        contentScript.__setState({
            isEnabled: true,
            globalDefaultPrompt: 'You are helpful.',
            showSystemTime: true,
        });
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\n\n<system-prompt>/);
    });

    it('prepends system time before <user-input> when showSystemTime enabled and no prompt', () => {
        contentScript.__setState({
            isEnabled: true,
            globalDefaultPrompt: '',
            promptPrefix: '',
            showSystemTime: true,
        });
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\n\n<user-input>/);
    });

    it('does not prepend time when showSystemTime is false', () => {
        contentScript.__setState({
            isEnabled: true,
            globalDefaultPrompt: 'You are helpful.',
            showSystemTime: false,
        });
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).not.toMatch(/^Current Time:/);
        expect(ta.value).toMatch(/^<system-prompt>/);
    });

    it('does not prepend time when isEnabled is false', () => {
        contentScript.__setState({
            isEnabled: false,
            globalDefaultPrompt: 'You are helpful.',
            showSystemTime: true,
        });
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('user message');
    });

    it('system time format is yyyy/mm/dd hh:mm:ss', () => {
        contentScript.__setState({
            isEnabled: true,
            globalDefaultPrompt: '',
            promptPrefix: '',
            showSystemTime: true,
        });
        const ta = makeTextarea('hello');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\n\n/);
    });

    it('system time is present in combined injection with both system prompt and user input', () => {
        contentScript.__setState({
            isEnabled: true,
            globalDefaultPrompt: 'System instruction',
            promptPrefix: 'Prefix instruction',
            showSystemTime: true,
        });
        const ta = makeTextarea('user input');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        const result = ta.value;
        expect(result).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\n\n<system-prompt>/);
        expect(result).toContain('<user-input>\nuser input\n</user-input>');
    });
});

describe('re-injection: extracts original message and re-injects (v2.8.0)', () => {
    function makeTextarea(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        return ta;
    }

    beforeEach(() => {
        contentScript.__resetState();
    });

    it('re-injects with fresh system prompt when textarea already has <user-input> wrapper', () => {
        contentScript.__setState({ isEnabled: true, promptPrefix: 'MyPrompt', showSystemTime: false });
        const ta = makeTextarea('<user-input>\noriginal message\n</user-input>');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toBe(
            '<system-prompt>\nMyPrompt\n</system-prompt>\n\n<user-input>\noriginal message\n</user-input>'
        );
    });

    it('re-injects with fresh Current Time when textarea already has injected content with old time', () => {
        contentScript.__setState({
            isEnabled: true,
            showSystemTime: true,
            promptPrefix: '',
            globalDefaultPrompt: '',
        });
        const ta = makeTextarea('Current Time: 2000/01/01 00:00:00\n\n<user-input>\nhello\n</user-input>');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: (?!2000\/01\/01 00:00:00)/);
        expect(ta.value).toContain('<user-input>\nhello\n</user-input>');
    });

    it('re-injects with updated prompt when textarea has old injection and prompt changed', () => {
        contentScript.__setState({ isEnabled: true, promptPrefix: 'NewPrompt', showSystemTime: false });
        const ta = makeTextarea(
            '<system-prompt>\nOldPrompt\n</system-prompt>\n\n<user-input>\nmy message\n</user-input>'
        );
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toBe(
            '<system-prompt>\nNewPrompt\n</system-prompt>\n\n<user-input>\nmy message\n</user-input>'
        );
    });

    it('still returns false when extracted user message is empty', () => {
        contentScript.__setState({ isEnabled: true, promptPrefix: 'SomePrompt', showSystemTime: false });
        const ta = makeTextarea('<user-input>\n   \n</user-input>');
        expect(contentScript.injectPrefix(ta)).toBe(false);
    });
});

describe('onSelectChange: promptPrefix updates synchronously (v2.8.1)', () => {
    // These tests require PresetOverlay to be exposed in the test export block of
    // content-script.js.  The required production-code change is a single line
    // inside the `module.exports` object:
    //
    //   PresetOverlay,
    //
    // Without that addition, contentScript.PresetOverlay is undefined and every
    // test in this block will fail with a TypeError.  See the report at the end
    // of this file for the precise location.

    async function seedPreset(id, name, content) {
        const item = {
            activePresetId: id,
            dsPresetIndex: [id],
            [`dsPreset_${id}`]: { id, name, content, createdAt: 1000, updatedAt: 1000 },
        };
        await chrome.storage.local.set(item);
        await chrome.storage.sync.set(item);
    }

    beforeEach(async () => {
        await new Promise(r => setTimeout(r, 0));
        contentScript.__resetState();

        await chrome.storage.local.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId',
            'dsPreset_preset-A', 'dsPreset_preset-B', 'syncInitialized',
        ]);
        await chrome.storage.sync.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId',
            'dsPreset_preset-A', 'dsPreset_preset-B', 'syncInitialized',
        ]);

        await seedPreset('preset-A', 'Preset A', 'Content of preset A');
        await seedPreset('preset-B', 'Preset B', 'Content of preset B');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('updates promptPrefix immediately when binding new preset to existing chat', async () => {
        // Arrange: chat uuid already bound to preset-A
        contentScript.__setState({
            currentChatUuid: 'uuid-1',
            chatPresetMap: { 'uuid-1': 'preset-A' },
            promptPrefix: 'Content of preset A',
        });

        // Mock bindChatToPreset to never resolve so the async chain never runs
        vi.spyOn(StorageManager, 'bindChatToPreset').mockReturnValue(new Promise(() => {}));
        vi.spyOn(StorageManager, 'saveActivePresetId').mockResolvedValue(undefined);
        // Mock getSettings so updatePromptPrefixFromBinding resolves in one microtask
        vi.spyOn(StorageManager, 'getSettings').mockResolvedValue({
            promptPresets: [
                { id: 'preset-A', name: 'Preset A', content: 'Content of preset A' },
                { id: 'preset-B', name: 'Preset B', content: 'Content of preset B' },
            ],
            isEnabled: true, globalDefaultPrompt: '', showSystemTime: false,
            activePresetId: 'preset-A', chatPresetMap: {},
        });

        // Act: select preset-B synchronously
        contentScript.PresetOverlay.onSelectChange('preset-B');

        // Assert chatPresetMap updated synchronously (before any async resolution)
        expect(contentScript.__getState().chatPresetMap['uuid-1']).toBe('preset-B');

        // updatePromptPrefixFromBinding is async — wait one tick for it to finish
        await new Promise(r => setTimeout(r, 0));

        // Assert promptPrefix now reflects preset-B content, not preset-A
        expect(contentScript.__getState().promptPrefix).toBe('Content of preset B');
        expect(contentScript.__getState().promptPrefix).not.toBe('Content of preset A');
    });

    it('clears promptPrefix immediately when unbinding preset from existing chat', async () => {
        // Arrange: chat uuid bound to preset-A
        contentScript.__setState({
            currentChatUuid: 'uuid-1',
            chatPresetMap: { 'uuid-1': 'preset-A' },
            promptPrefix: 'Content of preset A',
        });

        // Mock unbindChat to never resolve
        vi.spyOn(StorageManager, 'unbindChat').mockReturnValue(new Promise(() => {}));
        vi.spyOn(StorageManager, 'saveActivePresetId').mockResolvedValue(undefined);

        // Act: select empty value (unbind)
        contentScript.PresetOverlay.onSelectChange('');

        // Assert chatPresetMap entry deleted synchronously
        expect(contentScript.__getState().chatPresetMap['uuid-1']).toBeUndefined();

        // Wait one tick for the async updatePromptPrefixFromBinding to settle
        await new Promise(r => setTimeout(r, 0));

        // Assert promptPrefix cleared
        expect(contentScript.__getState().promptPrefix).toBe('');
    });

    it('sets pendingPresetId when no currentChatUuid', () => {
        // Arrange: no active chat uuid
        contentScript.__setState({
            currentChatUuid: null,
            chatPresetMap: {},
        });

        vi.spyOn(StorageManager, 'saveActivePresetId').mockResolvedValue(undefined);

        // Act: select preset-B with no uuid
        contentScript.PresetOverlay.onSelectChange('preset-B');

        // Assert pendingPresetId set synchronously — no async needed
        expect(contentScript.__getState().pendingPresetId).toBe('preset-B');
    });
});
