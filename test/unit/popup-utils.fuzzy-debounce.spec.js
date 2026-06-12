import { describe, it, expect, vi } from 'vitest';
import { fuzzyMatch, debounce } from '../../popup/popup-utils.js';

describe('fuzzyMatch()', () => {
    it('空關鍵字永遠回傳 true', () => {
        expect(fuzzyMatch('任何名稱', '')).toBe(true);
        expect(fuzzyMatch('', '')).toBe(true);
    });

    it('完全相符', () => {
        expect(fuzzyMatch('Alpha', 'Alpha')).toBe(true);
    });

    it('子序列相符（連續字元）', () => {
        expect(fuzzyMatch('Chinese Search', 'chs')).toBe(true);
    });

    it('子序列相符（散落字元）', () => {
        expect(fuzzyMatch('Content Script Injection', 'csi')).toBe(true);
    });

    it('不相符回傳 false', () => {
        expect(fuzzyMatch('Alpha', 'xyz')).toBe(false);
    });

    it('大小寫不敏感', () => {
        expect(fuzzyMatch('DS studio', 'DSS')).toBe(true);
        expect(fuzzyMatch('alpha', 'ALP')).toBe(true);
    });

    it('非字串 name 轉換為字串', () => {
        expect(fuzzyMatch(123, '12')).toBe(true);
        expect(fuzzyMatch(null, 'n')).toBe(true);
    });

    it('關鍵字比 name 長時不相符', () => {
        expect(fuzzyMatch('ab', 'abc')).toBe(false);
    });

    it('空 name 但有關鍵字回傳 false', () => {
        expect(fuzzyMatch('', 'a')).toBe(false);
    });
});

describe('debounce()', () => {
    it('在延遲時間後僅呼叫一次', async () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced('a');
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith('a');

        vi.useRealTimers();
    });

    it('快速連續呼叫時重置計時器，只觸發最後一次', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 200);

        debounced('first');
        vi.advanceTimersByTime(100);
        debounced('second');
        vi.advanceTimersByTime(100);
        debounced('third');
        vi.advanceTimersByTime(200);

        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith('third');

        vi.useRealTimers();
    });

    it('延遲時間未到時不觸發', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced();
        vi.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('可多次獨立觸發', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 50);

        debounced('x');
        vi.advanceTimersByTime(50);
        debounced('y');
        vi.advanceTimersByTime(50);

        expect(fn).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });
});
