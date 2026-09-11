import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reset module registry before each test so the IIFE re-executes and
// Stryker's perTest coverage correctly links each test to the mutated source.

describe('editor-window-constants', () => {
    beforeEach(() => {
        vi.resetModules();
        delete globalThis.DSS_EDITOR_WINDOW;
    });

    it('CLOSE_MESSAGE_TYPE has the exact expected value', async () => {
        const constants = (await import('../../utils/editor-window-constants.js')).default;
        expect(constants.CLOSE_MESSAGE_TYPE).toBe('DSS_CLOSE_EDITOR_WINDOWS');
    });

    it('STORAGE_KEYS.global has the exact expected value', async () => {
        const constants = (await import('../../utils/editor-window-constants.js')).default;
        expect(constants.STORAGE_KEYS.global).toBe('dss-editor-window-id-global');
    });

    it('STORAGE_KEYS.preset has the exact expected value', async () => {
        const constants = (await import('../../utils/editor-window-constants.js')).default;
        expect(constants.STORAGE_KEYS.preset).toBe('dss-editor-window-id-preset');
    });

    it('STORAGE_KEYS contains exactly two keys', async () => {
        const constants = (await import('../../utils/editor-window-constants.js')).default;
        expect(Object.keys(constants.STORAGE_KEYS)).toHaveLength(2);
        expect(Object.keys(constants.STORAGE_KEYS)).toEqual(
            expect.arrayContaining(['global', 'preset'])
        );
    });

    it('exports exactly the expected top-level shape', async () => {
        const constants = (await import('../../utils/editor-window-constants.js')).default;
        const keys = Object.keys(constants);
        expect(keys).toHaveLength(2);
        expect(keys).toContain('CLOSE_MESSAGE_TYPE');
        expect(keys).toContain('STORAGE_KEYS');
    });

    it('is also available on globalThis.DSS_EDITOR_WINDOW', async () => {
        const constants = (await import('../../utils/editor-window-constants.js')).default;
        expect(globalThis.DSS_EDITOR_WINDOW).toBeDefined();
        expect(globalThis.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE).toBe('DSS_CLOSE_EDITOR_WINDOWS');
        expect(globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS).toBe(constants.STORAGE_KEYS);
    });

    it('module.exports path is exercised when module is defined', async () => {
        const mod = await import('../../utils/editor-window-constants.js');
        expect(mod.default).toBe(globalThis.DSS_EDITOR_WINDOW);
    });
});
