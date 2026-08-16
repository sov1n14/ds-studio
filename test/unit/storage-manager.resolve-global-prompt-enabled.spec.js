/**
 * Tests for StorageManager.resolveGlobalPromptEnabled(activePreset, legacyGlobalFlag).
 *
 * Pure decision function: no storage access, no mutation.
 *
 * Rule (from requirement spec):
 *   - If activePreset exists, its own globalPromptEnabled field decides.
 *     - field === true  -> true
 *     - field === false -> false
 *     - field absent, undefined, or null -> true (fallback via `?? true` semantics)
 *   - If activePreset is null/undefined, legacyGlobalFlag decides directly.
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

describe('StorageManager.resolveGlobalPromptEnabled', () => {
    it('is reachable as a public method on StorageManager', () => {
        expect(typeof StorageManager.resolveGlobalPromptEnabled).toBe('function');
    });

    it('returns true when active preset has globalPromptEnabled=true', () => {
        const preset = { globalPromptEnabled: true };
        expect(StorageManager.resolveGlobalPromptEnabled(preset, false)).toBe(true);
    });

    it('returns false when active preset has globalPromptEnabled=false', () => {
        const preset = { globalPromptEnabled: false };
        expect(StorageManager.resolveGlobalPromptEnabled(preset, true)).toBe(false);
    });

    it('returns true when active preset is missing the globalPromptEnabled field entirely (legacy backup restore)', () => {
        const preset = { name: 'legacy preset without the field' };
        expect(StorageManager.resolveGlobalPromptEnabled(preset, false)).toBe(true);
    });

    it('returns true when active preset has globalPromptEnabled=undefined', () => {
        const preset = { globalPromptEnabled: undefined };
        expect(StorageManager.resolveGlobalPromptEnabled(preset, false)).toBe(true);
    });

    it('returns true when active preset has globalPromptEnabled=null (?? treats null as absent)', () => {
        const preset = { globalPromptEnabled: null };
        expect(StorageManager.resolveGlobalPromptEnabled(preset, false)).toBe(true);
    });

    it('falls back to legacyGlobalFlag=true when activePreset is null', () => {
        expect(StorageManager.resolveGlobalPromptEnabled(null, true)).toBe(true);
    });

    it('falls back to legacyGlobalFlag=false when activePreset is null', () => {
        expect(StorageManager.resolveGlobalPromptEnabled(null, false)).toBe(false);
    });

    it('falls back to legacyGlobalFlag=true when activePreset is undefined', () => {
        expect(StorageManager.resolveGlobalPromptEnabled(undefined, true)).toBe(true);
    });

    it('falls back to legacyGlobalFlag=false when activePreset is undefined', () => {
        expect(StorageManager.resolveGlobalPromptEnabled(undefined, false)).toBe(false);
    });

    it('is pure: does not mutate the passed-in preset object', () => {
        const preset = { globalPromptEnabled: false, name: 'untouched' };
        const snapshot = JSON.stringify(preset);

        StorageManager.resolveGlobalPromptEnabled(preset, true);

        expect(JSON.stringify(preset)).toBe(snapshot);
    });

    it('is pure: does not touch chrome.storage', async () => {
        StorageManager.resolveGlobalPromptEnabled({ globalPromptEnabled: false }, true);

        const local = await chrome.storage.local.get(null);
        const sync = await chrome.storage.sync.get(null);
        expect(local).toEqual({});
        expect(sync).toEqual({});
    });
});
