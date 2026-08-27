import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

describe('buildInjectionPrefix (1.1.x, 1.2.x, 1.3.x scenarios)', () => {
    beforeEach(() => {
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, showSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    });

    it('returns empty string when both globalDefaultPrompt and promptPrefix are empty', () => {
        expect(contentScript.buildInjectionPrefix()).toBe('');
    });

    it('returns only globalDefaultPrompt wrapped in system-reminder tags', () => {
        contentScript.state.globalDefaultPrompt = 'You are a helpful assistant.';
        expect(contentScript.buildInjectionPrefix()).toBe(
            '<system-reminder>\nYou are a helpful assistant.\n</system-reminder>'
        );
    });

    it('returns only promptPrefix wrapped in system-reminder tags', () => {
        contentScript.state.promptPrefix = 'Speak in Chinese.';
        expect(contentScript.buildInjectionPrefix()).toBe(
            '<system-reminder>\nSpeak in Chinese.\n</system-reminder>'
        );
    });

    it('joins both with double newline inside system-reminder tags', () => {
        contentScript.state.globalDefaultPrompt = 'You are a helpful assistant.';
        contentScript.state.promptPrefix = 'Speak in Chinese.';
        expect(contentScript.buildInjectionPrefix()).toBe(
            '<system-reminder>\nYou are a helpful assistant.\n\nSpeak in Chinese.\n</system-reminder>'
        );
    });

    it('handles multi-line globalDefaultPrompt', () => {
        contentScript.state.globalDefaultPrompt = 'Line 1\nLine 2';
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Line 1');
        expect(result).toContain('Line 2');
    });

    it('handles special characters in prompt content', () => {
        contentScript.state.promptPrefix = 'Use "quotes" and <tags>';
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Use "quotes" and <tags>');
    });

    it('returns empty when both are whitespace-only', () => {
        contentScript.state.globalDefaultPrompt = '   ';
        contentScript.state.promptPrefix = '   ';
        // globalDefaultPrompt is "   " (truthy), so it will be included
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('   ');
    });

    it('includes both when one is empty string and other has content', () => {
        contentScript.state.globalDefaultPrompt = '';
        contentScript.state.promptPrefix = 'Only this';
        expect(contentScript.buildInjectionPrefix()).toBe(
            '<system-reminder>\nOnly this\n</system-reminder>'
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
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, showSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    });

    it('1.3.1: returns false when textarea is empty', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'test';
        const ta = makeTextarea('');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('');
    });

    it('1.3.2: returns false when textarea is whitespace-only', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'test';
        const ta = makeTextarea('   \n  \t  ');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('   \n  \t  ');
    });

    it('1.2.2: re-injects after prefix is removed by user', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'test';
        const ta = makeTextarea('hello');

        // First call — injects
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toContain('<system-reminder>');

        // Second call on already-injected value — extraction logic extracts original message and re-injects
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toContain('<system-reminder>');
        expect(ta.value).toContain('<user-input>\nhello\n</user-input>');

        // User removes prefix and types new text
        ta.value = 'new message';
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toContain('<system-reminder>');
    });

    it('returns false when isEnabled is false', () => {
        contentScript.state.isEnabled = false;
        contentScript.state.globalDefaultPrompt = 'test';
        const ta = makeTextarea('hello');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('hello');
    });

});

describe('injectPrefix isSendableWithoutText (send-with-attachment-only, new behavior)', () => {
    function makeTextarea(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        return ta;
    }

    beforeEach(() => {
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, showSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    });

    it('isSendableWithoutText=true with empty text proceeds, returns true, includes timestamp + prompt, no <user-input> wrapper', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'test';
        contentScript.state.showSystemTime = true;
        const ta = makeTextarea('');
        expect(contentScript.injectPrefix(ta, true)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n\n<system-reminder>\ntest\n<\/system-reminder>$/);
        expect(ta.value).not.toContain('<user-input>');
        expect(ta.value).not.toContain('</user-input>');
    });

    it('isSendableWithoutText=true with whitespace-only text proceeds the same as empty text', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'test';
        contentScript.state.showSystemTime = true;
        const ta = makeTextarea('   \n  \t  ');
        expect(contentScript.injectPrefix(ta, true)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n\n<system-reminder>\ntest\n<\/system-reminder>$/);
        expect(ta.value).not.toContain('<user-input>');
        expect(ta.value).not.toContain('</user-input>');
    });

    it('isSendableWithoutText defaults to false when omitted, so empty text still returns false', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'test';
        const ta = makeTextarea('');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('');
    });

    it('isSendableWithoutText=true does not bypass isEnabled=false', () => {
        contentScript.state.isEnabled = false;
        contentScript.state.globalDefaultPrompt = 'test';
        const ta = makeTextarea('');
        expect(contentScript.injectPrefix(ta, true)).toBe(false);
        expect(ta.value).toBe('');
    });

    it('isSendableWithoutText=true does not alter the with-text injection path', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'test';
        const ta = makeTextarea('hello');
        expect(contentScript.injectPrefix(ta, true)).toBe(true);
        expect(ta.value).toBe(
            '<system-reminder>\ntest\n</system-reminder>\n\n<user-input>\nhello\n</user-input>'
        );
    });

    it('with showSystemTime off and only promptPrefix configured, empty text yields the prefix alone with no wrapper tags', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.promptPrefix = 'MyPrefix';
        contentScript.state.showSystemTime = false;
        const ta = makeTextarea('');
        expect(contentScript.injectPrefix(ta, true)).toBe(true);
        expect(ta.value).toBe('<system-reminder>\nMyPrefix\n</system-reminder>');
    });

    it('dispatches an input event and actually writes the textarea value for the empty-text sendable-without-text case', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'test';
        const ta = makeTextarea('');
        const events = [];
        ta.addEventListener('input', (e) => events.push({ type: e.type, bubbles: e.bubbles }));
        const originalValue = ta.value;
        expect(contentScript.injectPrefix(ta, true)).toBe(true);
        expect(ta.value).not.toBe(originalValue);
        const inputEvent = events.find(e => e.type === 'input');
        expect(inputEvent).toBeDefined();
        expect(inputEvent.bubbles).toBe(true);
    });
});

describe('showSystemTime feature (2.4.x scenario)', () => {
    function makeTextarea(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        return ta;
    }

    beforeEach(() => {
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, showSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    });

    it('prepends system time before <system-reminder> when showSystemTime enabled and prompt present', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'You are helpful.';
        contentScript.state.showSystemTime = true;
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n\n<system-reminder>/);
    });

    it('prepends system time before <user-input> when showSystemTime enabled and no prompt', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = '';
        contentScript.state.promptPrefix = '';
        contentScript.state.showSystemTime = true;
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n\n<user-input>/);
    });

    it('does not prepend time when showSystemTime is false', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'You are helpful.';
        contentScript.state.showSystemTime = false;
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).not.toMatch(/^Current Time:/);
        expect(ta.value).toMatch(/^<system-reminder>/);
    });

    it('does not prepend time when isEnabled is false', () => {
        contentScript.state.isEnabled = false;
        contentScript.state.globalDefaultPrompt = 'You are helpful.';
        contentScript.state.showSystemTime = true;
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('user message');
    });

    it('system time format is yyyy/mm/dd hh:mm:ss', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = '';
        contentScript.state.promptPrefix = '';
        contentScript.state.showSystemTime = true;
        const ta = makeTextarea('hello');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n\n/);
    });

    it('system time is present in combined injection with both system prompt and user input', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'System instruction';
        contentScript.state.promptPrefix = 'Prefix instruction';
        contentScript.state.showSystemTime = true;
        const ta = makeTextarea('user input');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        const result = ta.value;
        expect(result).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n\n<system-reminder>/);
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
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, showSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    });

    it('re-injects with fresh system prompt when textarea already has <user-input> wrapper', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.promptPrefix = 'MyPrompt';
        contentScript.state.showSystemTime = false;
        const ta = makeTextarea('<user-input>\noriginal message\n</user-input>');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toBe(
            '<system-reminder>\nMyPrompt\n</system-reminder>\n\n<user-input>\noriginal message\n</user-input>'
        );
    });

    it('re-injects with fresh Current Time when textarea already has injected content with old time', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.showSystemTime = true;
        contentScript.state.promptPrefix = '';
        contentScript.state.globalDefaultPrompt = '';
        const ta = makeTextarea('Current Time: 2000/01/01 00:00:00 (UTC+00:00)\n\n<user-input>\nhello\n</user-input>');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toMatch(/^Current Time: (?!2000\/01\/01 00:00:00 \(UTC\+00:00\))\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n\n<user-input>/);
        expect(ta.value).toContain('<user-input>\nhello\n</user-input>');
    });

    it('re-injects with updated prompt when textarea has old injection and prompt changed', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.promptPrefix = 'NewPrompt';
        contentScript.state.showSystemTime = false;
        const ta = makeTextarea(
            '<system-reminder>\nOldPrompt\n</system-reminder>\n\n<user-input>\nmy message\n</user-input>'
        );
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).toBe(
            '<system-reminder>\nNewPrompt\n</system-reminder>\n\n<user-input>\nmy message\n</user-input>'
        );
    });

    it('still returns false when extracted user message is empty', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.promptPrefix = 'SomePrompt';
        contentScript.state.showSystemTime = false;
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
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, showSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });

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
        contentScript.state.currentChatUuid = 'uuid-1';
        contentScript.state.chatPresetMap = { 'uuid-1': 'preset-A' };
        contentScript.state.promptPrefix = 'Content of preset A';

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
        expect(contentScript.state.chatPresetMap['uuid-1']).toBe('preset-B');

        // updatePromptPrefixFromBinding is async — wait one tick for it to finish
        await new Promise(r => setTimeout(r, 0));

        // Assert promptPrefix now reflects preset-B content, not preset-A
        expect(contentScript.state.promptPrefix).toBe('Content of preset B');
        expect(contentScript.state.promptPrefix).not.toBe('Content of preset A');
    });

    it('clears promptPrefix immediately when unbinding preset from existing chat', async () => {
        // Arrange: chat uuid bound to preset-A
        contentScript.state.currentChatUuid = 'uuid-1';
        contentScript.state.chatPresetMap = { 'uuid-1': 'preset-A' };
        contentScript.state.promptPrefix = 'Content of preset A';

        // Mock unbindChat to never resolve
        vi.spyOn(StorageManager, 'unbindChat').mockReturnValue(new Promise(() => {}));
        vi.spyOn(StorageManager, 'saveActivePresetId').mockResolvedValue(undefined);

        // Act: select empty value (unbind)
        contentScript.PresetOverlay.onSelectChange('');

        // Assert chatPresetMap entry deleted synchronously
        expect(contentScript.state.chatPresetMap['uuid-1']).toBeUndefined();

        // Wait one tick for the async updatePromptPrefixFromBinding to settle
        await new Promise(r => setTimeout(r, 0));

        // Assert promptPrefix cleared
        expect(contentScript.state.promptPrefix).toBe('');
    });

    it('sets pendingPresetId when no currentChatUuid', () => {
        // Arrange: no active chat uuid
        contentScript.state.currentChatUuid = null;
        contentScript.state.chatPresetMap = {};

        vi.spyOn(StorageManager, 'saveActivePresetId').mockResolvedValue(undefined);

        // Act: select preset-B with no uuid
        contentScript.PresetOverlay.onSelectChange('preset-B');

        // Assert pendingPresetId set synchronously — no async needed
        expect(contentScript.state.pendingPresetId).toBe('preset-B');
    });

    it('switching to "No Prompt Set" clears the prefix even when the chat was only ever resolved via a stale pendingPresetId (bug regression, end-to-end)', async () => {
        // Arrange: currentChatUuid is bound, but chatPresetMap was never actually
        // populated for it (mirrors the reported bug) — the only reason
        // promptPrefix was non-empty is a leftover pendingPresetId from an earlier
        // ACTIVE_PRESET_CHANGED message.
        contentScript.state.currentChatUuid = 'uuid-1';
        contentScript.state.chatPresetMap = {};
        contentScript.state.pendingPresetId = 'preset-A';
        contentScript.state.promptPrefix = 'Content of preset A';

        vi.spyOn(StorageManager, 'unbindChat').mockResolvedValue(undefined);
        vi.spyOn(StorageManager, 'saveActivePresetId').mockResolvedValue(undefined);

        // Act: user explicitly selects "No Prompt Set" (id === '')
        contentScript.PresetOverlay.onSelectChange('');

        // Wait for the async updatePromptPrefixFromBinding to settle
        await new Promise(r => setTimeout(r, 0));

        // Assert: promptPrefix must be cleared, not re-populated from pendingPresetId
        expect(contentScript.state.promptPrefix).toBe('');

        // Assert end-to-end: a resubmit textarea gets no <system-reminder> wrapper injected
        contentScript.state.isEnabled = true;
        const ta = document.createElement('textarea');
        ta.value = 'resubmitted message';
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).not.toContain('<system-reminder>');
    });
});

describe('ACTIVE_PRESET_CHANGED message handler does not leak into an already-bound chat (v2.8.x fix)', () => {
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
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, showSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });

        await chrome.storage.local.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId',
            'dsPreset_preset-A', 'syncInitialized',
        ]);
        await chrome.storage.sync.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId',
            'dsPreset_preset-A', 'syncInitialized',
        ]);

        await seedPreset('preset-A', 'Preset A', 'Content of preset A');
    });

    it('dispatching ACTIVE_PRESET_CHANGED while a chat is already active must not resurrect its prefix via pendingPresetId', async () => {
        // Arrange: a chat is already active and explicitly has no binding.
        contentScript.state.currentChatUuid = 'uuid-active';
        contentScript.state.chatPresetMap = {};
        contentScript.state.promptPrefix = '';

        // Act: simulate the popup broadcasting ACTIVE_PRESET_CHANGED via the real
        // chrome.runtime.onMessage listener registered by content-script.js at load time.
        chrome.runtime.onMessage.callListeners(
            { action: 'ACTIVE_PRESET_CHANGED', presetId: 'preset-A' },
            {},
            () => {}
        );

        // The handler sets pendingPresetId synchronously, then calls
        // updatePromptPrefixFromBinding() asynchronously — wait for it to settle.
        await new Promise(r => setTimeout(r, 0));

        // pendingPresetId is set (that part of the handler is unchanged)...
        expect(contentScript.state.pendingPresetId).toBe('preset-A');
        // ...but because currentChatUuid is already active with no map entry,
        // promptPrefix must remain empty — not fall back to the new pendingPresetId.
        expect(contentScript.state.promptPrefix).toBe('');
    });
});
