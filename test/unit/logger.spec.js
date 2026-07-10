/**
 * Unit tests for utils/logger.js
 *
 * 診斷記錄器已移除純診斷用的跨情境記錄轉發子系統（sync() / _forward() /
 * _detectSource()）。__DS_Logger 現僅保留 warn(event, data)，且僅呼叫本地
 * console.warn('[DS-Sync]', event, data)，不再與 chrome.runtime.sendMessage
 * 有任何互動。本測試據此驗證。
 *
 * Coverage groups:
 *   A. warn() calls console.warn with [DS-Sync] prefix, event and data
 *   B. Fail-safe — warn() never throws and still logs when chrome is unavailable
 *   C. Regression guard — sync()/_forward()/_detectSource() no longer exist
 *
 * Loading strategy:
 *   logger.js is a plain script (not an ES module) that exports via
 *   module.exports. We use createRequire so Node.js CJS semantics apply.
 *   Each group that needs a fresh IIFE execution uses a fresh require() handle
 *   from import.meta.url after deleting the module cache entry.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a fresh copy of utils/logger.js by evicting the CJS module cache so the
 * IIFE re-executes. Returns the __DS_Logger object.
 */
function loadFreshLogger() {
    const req = createRequire(import.meta.url);
    const loggerPath = req.resolve('../../utils/logger.js');
    delete req.cache[loggerPath];
    return req('../../utils/logger.js');
}

// ---------------------------------------------------------------------------
// Group A — warn() fires console.warn locally
// ---------------------------------------------------------------------------

describe('A. warn() fires console.warn with [DS-Sync] prefix', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('A.1 warn() calls console.warn with [DS-Sync] prefix, event and data', () => {
        const logger = loadFreshLogger();
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('QUOTA_EXCEEDED', { bytes: 1024 });
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'QUOTA_EXCEEDED', { bytes: 1024 });
    });

    it('A.2 warn() with no data argument passes empty string to console.warn', () => {
        const logger = loadFreshLogger();
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('EVENT_NO_DATA');
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'EVENT_NO_DATA', '');
    });

    it('A.3 warn() forwards falsy data values (0, null, false) verbatim', () => {
        const logger = loadFreshLogger();
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        logger.warn('ZERO', 0);
        expect(spy).toHaveBeenLastCalledWith('[DS-Sync]', 'ZERO', 0);

        logger.warn('NULL', null);
        expect(spy).toHaveBeenLastCalledWith('[DS-Sync]', 'NULL', null);

        logger.warn('FALSE', false);
        expect(spy).toHaveBeenLastCalledWith('[DS-Sync]', 'FALSE', false);
    });

    it('A.4 warn() does NOT call console.log', () => {
        const logger = loadFreshLogger();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('WARN_EVENT', 'x');
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('A.5 warn() never touches chrome.runtime.sendMessage', () => {
        const logger = loadFreshLogger();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sendSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        logger.warn('SYNC_FAILED', 'network error');
        expect(sendSpy).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Group B — Fail-safe: chrome unavailable
// ---------------------------------------------------------------------------

describe('B. Fail-safe — warn() works without chrome API interaction', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('B.1 loading logger does NOT throw when chrome is undefined', () => {
        const savedChrome = globalThis.chrome;
        globalThis.chrome = undefined;
        try {
            expect(() => loadFreshLogger()).not.toThrow();
        } finally {
            globalThis.chrome = savedChrome;
        }
    });

    it('B.2 warn() does not throw and still logs correctly when chrome is undefined', () => {
        const savedChrome = globalThis.chrome;
        globalThis.chrome = undefined;
        let logger;
        try {
            logger = loadFreshLogger();
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(() => logger.warn('no-chrome', 'test')).not.toThrow();
            expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'no-chrome', 'test');
        } finally {
            globalThis.chrome = savedChrome;
        }
    });
});

// ---------------------------------------------------------------------------
// Group C — Regression guard: removed forwarding subsystem stays removed
// ---------------------------------------------------------------------------

describe('C. Regression guard — removed forwarding subsystem', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('C.1 __DS_Logger.sync is undefined (sync() no longer exists)', () => {
        const logger = loadFreshLogger();
        expect(logger.sync).toBeUndefined();
    });

    it('C.2 __DS_Logger._forward is undefined (_forward() no longer exists)', () => {
        const logger = loadFreshLogger();
        expect(logger._forward).toBeUndefined();
    });

    it('C.3 __DS_Logger._detectSource is undefined (_detectSource() no longer exists)', () => {
        const logger = loadFreshLogger();
        expect(logger._detectSource).toBeUndefined();
    });

    it('C.4 __DS_Logger only exposes the warn() method', () => {
        const logger = loadFreshLogger();
        expect(Object.keys(logger)).toEqual(['warn']);
    });
});
