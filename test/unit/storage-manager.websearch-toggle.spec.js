/**
 * Tests for the two-state "連網搜索" (web search) toggle:
 *   - StorageManager.KEYS.WEBSEARCH_TOGGLE === 'dsWebSearchToggle'
 *   - StorageManager.DEFAULTS[WEBSEARCH_TOGGLE] === 'on'
 *   - unset → getSettings() returns websearchToggle === 'on'
 *   - legacy raw value 'default' → getSettings() normalizes to websearchToggle === 'on'
 *   - raw 'on' / 'off' → getSettings() surfaces the same value unchanged
 *   - saveWebsearchToggle(value) persists; getSettings() round-trips 'on' and 'off'
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('StorageManager — websearchToggle (two-state web search toggle)', () => {
    describe('KEYS / DEFAULTS', () => {
        it('exposes KEYS.WEBSEARCH_TOGGLE as dsWebSearchToggle', () => {
            expect(StorageManager.KEYS.WEBSEARCH_TOGGLE).toBe('dsWebSearchToggle');
        });

        it('defines the DEFAULTS entry for the key as "on"', () => {
            expect(StorageManager.DEFAULTS[K.WEBSEARCH_TOGGLE]).toBe('on');
        });

        it('returns websearchToggle === "on" when unset', async () => {
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('on');
        });

        it('normalizes a legacy raw "default" value to "on"', async () => {
            await chrome.storage.local.set({ [K.WEBSEARCH_TOGGLE]: 'default' });
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('on');
        });

        it('surfaces raw "on" unchanged', async () => {
            await chrome.storage.local.set({ [K.WEBSEARCH_TOGGLE]: 'on' });
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('on');
        });

        it('surfaces raw "off" unchanged', async () => {
            await chrome.storage.local.set({ [K.WEBSEARCH_TOGGLE]: 'off' });
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('off');
        });
    });

    describe('saveWebsearchToggle / getSettings() round-trip', () => {
        it('round-trips "off" via saveWebsearchToggle', async () => {
            await StorageManager.saveWebsearchToggle('off');
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('off');
        });

        it('round-trips "on" via saveWebsearchToggle', async () => {
            await StorageManager.saveWebsearchToggle('on');
            const settings = await StorageManager.getSettings();
            expect(settings.websearchToggle).toBe('on');
        });
    });
});
