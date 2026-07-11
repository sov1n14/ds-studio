/**
 * utils/storage-manager.lock.js — _acquireChatPresetMapLock() owner token.
 * The lock owner token was switched from an ad-hoc string generator to
 * crypto.randomUUID(). No prior spec asserted the token shape/uniqueness
 * directly — this file closes that gap. Per the coverage-gap instructions,
 * this does not assert an exact format, only that the token is a non-empty
 * unique string that a subsequent release accepts as the valid owner.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

describe('_acquireChatPresetMapLock() / _releaseChatPresetMapLock() — owner token', () => {
    beforeEach(async () => {
        await chrome.storage.local.remove('chatPresetMapLock');
    });

    it('returns a non-empty string token', async () => {
        const token = await StorageManager._acquireChatPresetMapLock();
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);
        await StorageManager._releaseChatPresetMapLock(token);
    });

    it('produces a different token on each acquisition', async () => {
        const tokenA = await StorageManager._acquireChatPresetMapLock();
        await StorageManager._releaseChatPresetMapLock(tokenA);
        const tokenB = await StorageManager._acquireChatPresetMapLock();
        await StorageManager._releaseChatPresetMapLock(tokenB);

        expect(tokenB).not.toBe(tokenA);
    });

    it('the acquired token is accepted as the valid owner on release (round-trips through storage)', async () => {
        const token = await StorageManager._acquireChatPresetMapLock();
        const stored = await chrome.storage.local.get('chatPresetMapLock');
        expect(stored.chatPresetMapLock.owner).toBe(token);

        await StorageManager._releaseChatPresetMapLock(token);
        const afterRelease = await chrome.storage.local.get('chatPresetMapLock');
        expect(afterRelease.chatPresetMapLock).toBeUndefined();
    });
});
