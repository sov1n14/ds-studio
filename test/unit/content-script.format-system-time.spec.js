import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import contentScript from '../../content/content-script.js';

beforeEach(() => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-480);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('formatSystemTime', () => {
    it('formats a date with zero-padded month', () => {
        const date = new Date('2026-05-31T14:30:45');
        const result = contentScript.formatSystemTime(date);
        expect(result).toBe('2026/05/31 14:30:45 (UTC+08:00)');
    });

    it('formats a date with zero-padded day', () => {
        const date = new Date('2026-05-09T08:15:30');
        const result = contentScript.formatSystemTime(date);
        expect(result).toBe('2026/05/09 08:15:30 (UTC+08:00)');
    });

    it('formats a date with zero-padded hours', () => {
        const date = new Date('2026-05-31T09:22:10');
        const result = contentScript.formatSystemTime(date);
        expect(result).toBe('2026/05/31 09:22:10 (UTC+08:00)');
    });

    it('formats a date with zero-padded minutes', () => {
        const date = new Date('2026-05-31T14:05:45');
        const result = contentScript.formatSystemTime(date);
        expect(result).toBe('2026/05/31 14:05:45 (UTC+08:00)');
    });

    it('formats a date with zero-padded seconds', () => {
        const date = new Date('2026-05-31T14:30:09');
        const result = contentScript.formatSystemTime(date);
        expect(result).toBe('2026/05/31 14:30:09 (UTC+08:00)');
    });

    it('uses 24-hour format (not 12-hour)', () => {
        const date = new Date('2026-05-31T23:59:59');
        const result = contentScript.formatSystemTime(date);
        expect(result).toBe('2026/05/31 23:59:59 (UTC+08:00)');
        expect(result).not.toContain('AM');
        expect(result).not.toContain('PM');
    });

    it('formats 00:00:00 correctly (midnight)', () => {
        const date = new Date('2026-05-31T00:00:00');
        const result = contentScript.formatSystemTime(date);
        expect(result).toBe('2026/05/31 00:00:00 (UTC+08:00)');
    });

    it('accepts a custom Date object and does not mutate it', () => {
        const date = new Date('2026-05-31T14:30:45');
        const dateBefore = date.getTime();
        contentScript.formatSystemTime(date);
        expect(date.getTime()).toBe(dateBefore);
    });

    it('returns string in format yyyy/mm/dd hh:mm:ss', () => {
        const date = new Date('2026-12-25T16:45:30');
        const result = contentScript.formatSystemTime(date);
        expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
        expect(result).toBe('2026/12/25 16:45:30 (UTC+08:00)');
    });

    it('formatTimezoneOffset returns UTC+05:30 for offset -330', () => {
        vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330);
        const date = new Date('2026-06-01T12:00:00');
        expect(contentScript.formatTimezoneOffset(date)).toBe('UTC+05:30');
    });

    it('formatTimezoneOffset returns UTC-03:45 for offset +225', () => {
        vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(225);
        const date = new Date('2026-06-01T12:00:00');
        expect(contentScript.formatTimezoneOffset(date)).toBe('UTC-03:45');
    });

    it('formatTimezoneOffset returns UTC+00:00 for offset 0', () => {
        vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
        const date = new Date('2026-06-01T12:00:00');
        expect(contentScript.formatTimezoneOffset(date)).toBe('UTC+00:00');
    });

    it('formatSystemTime full string matches timezone pattern', () => {
        const date = new Date('2026-06-01T12:00:00');
        const result = contentScript.formatSystemTime(date);
        expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    });
});
