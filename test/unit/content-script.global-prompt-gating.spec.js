/**
 * Tests for the isGlobalPromptEnabled gate in buildInjectionPrefix / injectPrefix.
 * Uses the __setState / __resetState / __getState test harness exposed by content-script.js.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

describe('buildInjectionPrefix — isGlobalPromptEnabled gating', () => {
    beforeEach(() => {
        contentScript.__resetState();
    });

    it('(a) excludes globalDefaultPrompt when isGlobalPromptEnabled=false, but still includes preset prefix', () => {
        contentScript.__setState({
            isGlobalPromptEnabled: false,
            globalDefaultPrompt: 'Global system instruction',
            promptPrefix: 'Preset-specific prefix',
        });
        const result = contentScript.buildInjectionPrefix();
        expect(result).not.toContain('Global system instruction');
        expect(result).toContain('Preset-specific prefix');
    });

    it('(b) includes globalDefaultPrompt when isGlobalPromptEnabled=true', () => {
        contentScript.__setState({
            isGlobalPromptEnabled: true,
            globalDefaultPrompt: 'Global system instruction',
            promptPrefix: '',
        });
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Global system instruction');
    });

    it('(b) includes both when isGlobalPromptEnabled=true and both are set', () => {
        contentScript.__setState({
            isGlobalPromptEnabled: true,
            globalDefaultPrompt: 'Global',
            promptPrefix: 'Preset',
        });
        const result = contentScript.buildInjectionPrefix();
        expect(result).toContain('Global');
        expect(result).toContain('Preset');
    });

    it('returns empty string when isGlobalPromptEnabled=false and no promptPrefix', () => {
        contentScript.__setState({
            isGlobalPromptEnabled: false,
            globalDefaultPrompt: 'Global system instruction',
            promptPrefix: '',
        });
        expect(contentScript.buildInjectionPrefix()).toBe('');
    });

    it('default state (reset) has isGlobalPromptEnabled=true, so globalDefaultPrompt is included', () => {
        contentScript.__setState({ globalDefaultPrompt: 'Default global' });
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
        contentScript.__resetState();
    });

    it('(c) injection does not happen when isEnabled=false, regardless of isGlobalPromptEnabled=true', () => {
        contentScript.__setState({
            isEnabled: false,
            isGlobalPromptEnabled: true,
            globalDefaultPrompt: 'Global system instruction',
            promptPrefix: 'Preset prefix',
        });
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('user message');
    });

    it('(c) injection does not happen when isEnabled=false, regardless of isGlobalPromptEnabled=false', () => {
        contentScript.__setState({
            isEnabled: false,
            isGlobalPromptEnabled: false,
            globalDefaultPrompt: 'Global system instruction',
            promptPrefix: 'Preset prefix',
        });
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(false);
        expect(ta.value).toBe('user message');
    });

    it('injection happens when isEnabled=true and isGlobalPromptEnabled=false but promptPrefix present', () => {
        contentScript.__setState({
            isEnabled: true,
            isGlobalPromptEnabled: false,
            globalDefaultPrompt: 'Should be excluded',
            promptPrefix: 'Preset prefix',
        });
        const ta = makeTextarea('user message');
        expect(contentScript.injectPrefix(ta)).toBe(true);
        expect(ta.value).not.toContain('Should be excluded');
        expect(ta.value).toContain('Preset prefix');
    });

    it('injection returns false when isEnabled=true but both prompts excluded/empty', () => {
        contentScript.__setState({
            isEnabled: true,
            isGlobalPromptEnabled: false,
            globalDefaultPrompt: 'Global',
            promptPrefix: '',
        });
        const ta = makeTextarea('user message');
        // No prefix produced — still wraps in <user-input>
        const result = contentScript.injectPrefix(ta);
        expect(result).toBe(true);
        expect(ta.value).not.toContain('<system-prompt>');
        expect(ta.value).toContain('<user-input>');
    });
});
