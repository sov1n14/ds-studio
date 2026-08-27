/**
 * Tests for the isGlobalPromptEnabled gate in buildInjectionPrefix / injectPrefix.
 * Uses direct state property access on contentScript.state exposed by content-script.js.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

describe('buildInjectionPrefix — isGlobalPromptEnabled gating', () => {
    beforeEach(() => {
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, isShowSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    });

    it('(a) excludes globalDefaultPrompt when isGlobalPromptEnabled=false, but still includes preset prefix', () => {
        contentScript.state.isGlobalPromptEnabled = false;
        contentScript.state.globalDefaultPrompt = 'Global system instruction';
        contentScript.state.promptPrefix = 'Preset-specific prefix';
        const result = contentScript.buildInjectionPrefix();
        expect(result).not.toContain('Global system instruction');
        expect(result).toContain('Preset-specific prefix');
    });

    it('(b) includes globalDefaultPrompt when isGlobalPromptEnabled=true', () => {
        contentScript.state.isGlobalPromptEnabled = true;
        contentScript.state.globalDefaultPrompt = 'Global system instruction';
        contentScript.state.promptPrefix = '';
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Global system instruction');
    });

    it('(b) includes both when isGlobalPromptEnabled=true and both are set', () => {
        contentScript.state.isGlobalPromptEnabled = true;
        contentScript.state.globalDefaultPrompt = 'Global';
        contentScript.state.promptPrefix = 'Preset';
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Global');
        expect(result).toContain('Preset');
    });

    it('returns empty string when isGlobalPromptEnabled=false and no promptPrefix', () => {
        contentScript.state.isGlobalPromptEnabled = false;
        contentScript.state.globalDefaultPrompt = 'Global system instruction';
        contentScript.state.promptPrefix = '';
        expect(contentScript.buildInjectionPrefix()).toBe('');
    });

    it('default state (reset) has isGlobalPromptEnabled=true, so globalDefaultPrompt is included', () => {
        contentScript.state.globalDefaultPrompt = 'Default global';
        // isGlobalPromptEnabled defaults to true after reset
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Default global');
    });
});

describe('injectPrefix — master toggle priority over isGlobalPromptEnabled', () => {
    function makeTextarea(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        return ta;
    }

    beforeEach(() => {
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, isShowSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
    });

    it('(c) injection does not happen when isEnabled=false, regardless of isGlobalPromptEnabled=true', () => {
        contentScript.state.isEnabled = false;
        contentScript.state.isGlobalPromptEnabled = true;
        contentScript.state.globalDefaultPrompt = 'Global system instruction';
        contentScript.state.promptPrefix = 'Preset prefix';
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('user message');
    });

    it('(c) injection does not happen when isEnabled=false, regardless of isGlobalPromptEnabled=false', () => {
        contentScript.state.isEnabled = false;
        contentScript.state.isGlobalPromptEnabled = false;
        contentScript.state.globalDefaultPrompt = 'Global system instruction';
        contentScript.state.promptPrefix = 'Preset prefix';
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('user message');
    });

    it('injection happens when isEnabled=true and isGlobalPromptEnabled=false but promptPrefix present', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.isGlobalPromptEnabled = false;
        contentScript.state.globalDefaultPrompt = 'Should be excluded';
        contentScript.state.promptPrefix = 'Preset prefix';
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).not.toContain('Should be excluded');
        expect(ta.value).toContain('Preset prefix');
    });

    it('injection returns false when isEnabled=true but both prompts excluded/empty', () => {
        contentScript.state.isEnabled = true;
        contentScript.state.isGlobalPromptEnabled = false;
        contentScript.state.globalDefaultPrompt = 'Global';
        contentScript.state.promptPrefix = '';
        const ta = makeTextarea('user message');
        // No prefix produced — still wraps in <user-input>
        const result = contentScript.injectPrefix(ta);
        expect(result).toBe(true);
        expect(ta.value).not.toContain('<system-reminder>');
        expect(ta.value).toContain('<user-input>');
    });
});
