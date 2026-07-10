/**
 * StorageManager — 8KB (QUOTA_BYTES_PER_ITEM) oversize guard tests
 *
 * Covers the permanent-failure classification described in to-do/report.md §4.2:
 * a single-item payload over QUOTA_BYTES_PER_ITEM (8192 UTF-8 bytes) can never
 * succeed on chrome.storage.sync.set(), so _set() must intercept it before it
 * touches chrome.storage.sync or the dsLocalAuth retry queue, and track it in
 * dsOversizedKeys instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;
const QUOTA = StorageManager.QUOTA_BYTES_PER_ITEM;

function bigAsciiValue(byteLenTarget) {
    // Each ASCII char is 1 UTF-8 byte; pad past the target to clear JSON overhead.
    return 'x'.repeat(byteLenTarget);
}

function chineseValueForByteLen(charCount) {
    // '中' encodes to 3 UTF-8 bytes but has .length === 1 — undercount bait.
    return '中'.repeat(charCount);
}

describe('StorageManager._set() — 8KB per-key oversize guard', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Invariant 1 & 2b: per-key splitting within one _set() call, mixed batch ──

    it('splits a mixed batch: normal keys go to sync, the oversized key does not', async () => {
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');
        const bigValue = bigAsciiValue(9000);

        await StorageManager._set({
            keyA: 'short value',
            keyBig: bigValue,
            keyB: 'short value 2',
        });

        expect(setSpy).toHaveBeenCalledTimes(1);
        const pushedKeys = Object.keys(setSpy.mock.calls[0][0]);
        expect(pushedKeys).toEqual(expect.arrayContaining(['keyA', 'keyB']));
        expect(pushedKeys).not.toContain('keyBig');
    });

    // ── Invariant 2a: all keys oversized → sync.set skipped entirely ──

    it('never calls chrome.storage.sync.set when every key in the batch is oversized', async () => {
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        await StorageManager._set({
            onlyBigKey: bigAsciiValue(9000),
        });

        expect(setSpy).not.toHaveBeenCalled();
    });

    // ── Invariant 3: oversized keys never appear in dsLocalAuth ──

    it('does not add a newly-oversized key to dsLocalAuth', async () => {
        await StorageManager._set({ bigKey: bigAsciiValue(9000) });

        const localData = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        const auth = localData[K.LOCAL_AUTHORITATIVE] || [];
        expect(auth).not.toContain('bigKey');
    });

    it('strips a key from dsLocalAuth if it was already parked there before the guard classified it oversized', async () => {
        // Simulate leftover state from before this guard existed: the key is
        // sitting in the transient-retry queue from a prior code version.
        await chrome.storage.local.set({ [K.LOCAL_AUTHORITATIVE]: ['bigKey', 'otherKey'] });

        await StorageManager._set({ bigKey: bigAsciiValue(9000) });

        const localData = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        const auth = localData[K.LOCAL_AUTHORITATIVE] || [];
        expect(auth).not.toContain('bigKey');
        // Unrelated pending keys must survive the filter untouched.
        expect(auth).toContain('otherKey');
    });

    // ── Invariant 4: oversized keys are written to local storage, value preserved, and tracked ──

    it('writes the oversized key value to chrome.storage.local', async () => {
        const bigValue = bigAsciiValue(9000);
        await StorageManager._set({ bigKey: bigValue });

        const localData = await chrome.storage.local.get(['bigKey']);
        expect(localData.bigKey).toBe(bigValue);
    });

    it('adds the oversized key to dsOversizedKeys', async () => {
        await StorageManager._set({ bigKey: bigAsciiValue(9000) });

        const localData = await chrome.storage.local.get([K.OVERSIZED_KEYS]);
        expect(localData[K.OVERSIZED_KEYS]).toContain('bigKey');
    });

    it('preserves the normal-sized sibling key value in local storage in the same mixed batch', async () => {
        await StorageManager._set({
            bigKey: bigAsciiValue(9000),
            smallKey: 'fits fine',
        });

        const localData = await chrome.storage.local.get(['bigKey', 'smallKey']);
        expect(localData.bigKey).toBe(bigAsciiValue(9000));
        expect(localData.smallKey).toBe('fits fine');
    });

    // ── Invariant 5: self-healing — shrinking below the threshold clears the flag ──

    it('removes a key from dsOversizedKeys once it is rewritten at or under the threshold', async () => {
        await StorageManager._set({ bigKey: bigAsciiValue(9000) });
        let localData = await chrome.storage.local.get([K.OVERSIZED_KEYS]);
        expect(localData[K.OVERSIZED_KEYS]).toContain('bigKey');

        await StorageManager._set({ bigKey: 'now small' });

        localData = await chrome.storage.local.get([K.OVERSIZED_KEYS]);
        expect(localData[K.OVERSIZED_KEYS]).not.toContain('bigKey');
    });

    it('pushes the self-healed key to chrome.storage.sync.set on the shrinking write', async () => {
        await StorageManager._set({ bigKey: bigAsciiValue(9000) });

        const setSpy = vi.spyOn(chrome.storage.sync, 'set');
        await StorageManager._set({ bigKey: 'now small' });

        expect(setSpy).toHaveBeenCalledTimes(1);
        expect(Object.keys(setSpy.mock.calls[0][0])).toContain('bigKey');
    });

    // ── Invariant 7: _byteLen measures real UTF-8 bytes, not JS .length ──

    it('_byteLen() counts multi-byte UTF-8 characters correctly, exceeding JS .length', () => {
        const value = chineseValueForByteLen(2800); // 2800 chars, 3 bytes each = 8400 bytes
        const obj = { chineseKey: value };
        const naiveLength = JSON.stringify(obj).length;
        const actualByteLen = StorageManager._byteLen(obj);

        expect(actualByteLen).toBeGreaterThan(naiveLength);
        expect(actualByteLen).toBeGreaterThan(QUOTA);
        expect(naiveLength).toBeLessThan(QUOTA); // the undercount this fix guards against
    });

    it('classifies a Chinese-content key as oversized purely from UTF-8 byte length (undercount regression guard)', async () => {
        const value = chineseValueForByteLen(2800);
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        await StorageManager._set({ chineseKey: value });

        expect(setSpy).not.toHaveBeenCalled();
        const localData = await chrome.storage.local.get([K.OVERSIZED_KEYS]);
        expect(localData[K.OVERSIZED_KEYS]).toContain('chineseKey');
    });

    it('does NOT misclassify a Chinese-content key that is genuinely under the byte threshold', async () => {
        const value = chineseValueForByteLen(2000); // 2000*3 = 6000 bytes, under 8192
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        await StorageManager._set({ chineseKey: value });

        expect(setSpy).toHaveBeenCalledTimes(1);
        expect(Object.keys(setSpy.mock.calls[0][0])).toContain('chineseKey');
    });

    // ── Invariant 8 (regression): normal transient-failure / retry behavior is unaffected ──

    describe('regression — Steps 1-2 transient-failure handling still works', () => {
        afterEach(() => {
            chrome.storage.sync.setQuotaError(false);
            delete chrome.runtime.lastError;
        });

        it('still parks a normal-sized key in dsLocalAuth on a transient sync failure', async () => {
            chrome.storage.sync.setQuotaError(true);

            await StorageManager._set({ normalKey: 'small value' });

            const localData = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
            expect(localData[K.LOCAL_AUTHORITATIVE]).toContain('normalKey');
        });

        it('still prunes dsLocalAuth for a normal-sized key once the retry succeeds', async () => {
            chrome.storage.sync.setQuotaError(true);
            await StorageManager._set({ normalKey: 'small value' });
            chrome.storage.sync.setQuotaError(false);
            delete chrome.runtime.lastError;

            await StorageManager._set({ normalKey: 'small value updated' });

            const localData = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
            const auth = localData[K.LOCAL_AUTHORITATIVE] || [];
            expect(auth).not.toContain('normalKey');
        });
    });
});

describe('StorageManager.hasOversizedItems()', () => {
    // ── Invariant 6 ──

    it('returns false when dsOversizedKeys does not exist yet', async () => {
        const result = await StorageManager.hasOversizedItems();
        expect(result).toBe(false);
    });

    it('returns false when dsOversizedKeys is an empty array', async () => {
        await chrome.storage.local.set({ [K.OVERSIZED_KEYS]: [] });
        const result = await StorageManager.hasOversizedItems();
        expect(result).toBe(false);
    });

    it('returns true when dsOversizedKeys contains at least one key', async () => {
        await chrome.storage.local.set({ [K.OVERSIZED_KEYS]: ['bigKey'] });
        const result = await StorageManager.hasOversizedItems();
        expect(result).toBe(true);
    });

    it('reflects the true state after a real oversized _set() call end-to-end', async () => {
        await StorageManager._set({ bigKey: bigAsciiValue(9000) });
        const result = await StorageManager.hasOversizedItems();
        expect(result).toBe(true);
    });
});
