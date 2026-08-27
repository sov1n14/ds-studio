/**
 * Tests for the AUTO_EXPAND_MESSAGES setting:
 *   - StorageManager.KEYS.AUTO_EXPAND_MESSAGES === 'dsAutoExpandMessages'
 *   - StorageManager.DEFAULTS['dsAutoExpandMessages'] === false
 *   - unset → getSettings() returns autoExpandMessages === false
 *   - saveAutoExpandMessages(true) persists; getSettings() round-trips true
 *   - saveAutoExpandMessages(false) persists; getSettings() round-trips false
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('StorageManager — autoExpandMessages', () => {
    describe('KEYS / DEFAULTS', () => {
        it('exposes KEYS.AUTO_EXPAND_MESSAGES as dsAutoExpandMessages', () => {
            expect(StorageManager.KEYS.AUTO_EXPAND_MESSAGES).toBe('dsAutoExpandMessages');
        });

        it('defines the DEFAULTS entry for the key as false', () => {
            expect(StorageManager.DEFAULTS[K.AUTO_EXPAND_MESSAGES]).toBe(false);
        });

        it('returns autoExpandMessages === false when unset', async () => {
            const settings = await StorageManager.getSettings();
            expect(settings.autoExpandMessages).toBe(false);
        });
    });

    describe('saveAutoExpandMessages / getSettings() round-trip', () => {
        it('round-trips true via saveAutoExpandMessages', async () => {
            await StorageManager.saveAutoExpandMessages(true);
            const settings = await StorageManager.getSettings();
            expect(settings.autoExpandMessages).toBe(true);
        });

        it('round-trips false via saveAutoExpandMessages', async () => {
            await StorageManager.saveAutoExpandMessages(false);
            const settings = await StorageManager.getSettings();
            expect(settings.autoExpandMessages).toBe(false);
        });
    });
});
