/**
 * Tests for the tri-state "連網搜索" (web search) toggle:
 *   - StorageManager.KEYS.WEBSEARCH_TOGGLE === 'dsWebSearchToggle'
 *   - StorageManager.DEFAULTS[WEBSEARCH_TOGGLE] === 'default'
 *   - unset → getSettings() returns websearchToggle === 'default'
 *   - saveWebsearchToggle(value) persists; getSettings() round-trips 'on' and 'off'
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('StorageManager — websearchToggle (tri-state web search toggle)', () => {
    describe('KEYS / DEFAULTS', () => {
        it('exposes KEYS.WEBSEARCH_TOGGLE as dsWebSearchToggle', () => {
            expect(StorageManager.KEYS.WEBSEARCH_TOGGLE).toBe('dsWebSearchToggle');
        });

        it('defines the DEFAULTS entry for the key as "default"', () => {
            expect(StorageManager.DEFAULTS[K.WEBSEARCH_TOGGLE]).toBe('default');
        });

        it('returns websearchToggle === "default" when unset', async () => {
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('default');
        });
    });

    describe('saveWebsearchToggle / getSettings() round-trip', () => {
        it('round-trips "on" via saveWebsearchToggle', async () => {
            await StorageManager.saveWebsearchToggle('on');
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('on');
        });

        it('round-trips "off" via saveWebsearchToggle', async () => {
            await StorageManager.saveWebsearchToggle('off');
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('off');
        });
    });
});
