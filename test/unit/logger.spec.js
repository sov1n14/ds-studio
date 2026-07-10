/**
 * Unit tests for utils/logger.js
 *
 * 診斷記錄器已移除 dsDebugSync 旗閘（gate）：sync() 一律轉發至 Service Worker
 * console（透過 chrome.runtime.sendMessage），毋須任何開關。本測試據此驗證。
 *
 * Coverage groups:
 *   A. sync() 一律透過 chrome.runtime.sendMessage 轉發（payload 內容與邊界值）
 *   B. warn() 一律 console.warn，並額外轉發
 *   C. Fail-safe — chrome / chrome.runtime.sendMessage 不可用時不拋出、為 no-op
 *   D. 來源標籤（source）隨附於每筆轉發訊息
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
// Group A — sync() always forwards via chrome.runtime.sendMessage
// ---------------------------------------------------------------------------

describe('A. sync() always forwards via chrome.runtime.sendMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('A.1 sync() forwards a message with __dsSyncLog flag, level=log, event and data', () => {
        const logger = loadFreshLogger();
        const spy = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        logger.sync('PUSH', { key: 'v1' });
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            __dsSyncLog: true,
            level: 'log',
            event: 'PUSH',
            data: { key: 'v1' },
        }));
    });

    it('A.2 sync() never writes to console.log directly (channel is the SW forward)', () => {
        const logger = loadFreshLogger();
        vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logger.sync('EVENT', 'data');
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('A.3 sync() passes empty string as data when data argument is omitted', () => {
        const logger = loadFreshLogger();
        const spy = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        logger.sync('EVENT_ONLY');
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            event: 'EVENT_ONLY',
            data: '',
        }));
    });

    it('A.4 sync() forwards falsy data values (0, null, false) verbatim', () => {
        const logger = loadFreshLogger();
        const spy = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});

        logger.sync('ZERO', 0);
        expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'ZERO', data: 0 }));

        logger.sync('NULL', null);
        expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'NULL', data: null }));

        logger.sync('FALSE', false);
        expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'FALSE', data: false }));
    });

    it('A.5 sync() swallows a rejected sendMessage promise (no unhandled rejection)', () => {
        const logger = loadFreshLogger();
        vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => Promise.reject(new Error('Receiving end does not exist')));
        expect(() => logger.sync('EVENT', 'data')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Group B — warn() always fires console.warn and forwards
// ---------------------------------------------------------------------------

describe('B. warn() always fires console.warn and forwards', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('B.1 warn() calls console.warn with [DS-Sync] prefix, event and data', () => {
        const logger = loadFreshLogger();
        vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('QUOTA_EXCEEDED', { bytes: 1024 });
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'QUOTA_EXCEEDED', { bytes: 1024 });
    });

    it('B.2 warn() also forwards to the Service Worker with level=warn', () => {
        const logger = loadFreshLogger();
        const spy = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('SYNC_FAILED', 'network error');
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            __dsSyncLog: true,
            level: 'warn',
            event: 'SYNC_FAILED',
            data: 'network error',
        }));
    });

    it('B.3 warn() with no data argument passes empty string to console.warn', () => {
        const logger = loadFreshLogger();
        vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('EVENT_NO_DATA');
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'EVENT_NO_DATA', '');
    });

    it('B.4 warn() does NOT call console.log', () => {
        const logger = loadFreshLogger();
        vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('WARN_EVENT', 'x');
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('B.5 sync() does NOT call console.warn (wrong channel)', () => {
        const logger = loadFreshLogger();
        vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.sync('CHECK', 'data');
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Group C — Fail-safe: chrome / sendMessage unavailable
// ---------------------------------------------------------------------------

describe('C. Fail-safe — chrome / sendMessage unavailable', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('C.1 loading logger does NOT throw when chrome is undefined', () => {
        const savedChrome = globalThis.chrome;
        globalThis.chrome = undefined;
        try {
            expect(() => loadFreshLogger()).not.toThrow();
        } finally {
            globalThis.chrome = savedChrome;
        }
    });

    it('C.2 sync() is a silent no-op when chrome is undefined', () => {
        const savedChrome = globalThis.chrome;
        globalThis.chrome = undefined;
        let logger;
        try {
            logger = loadFreshLogger();
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            expect(() => logger.sync('no-chrome', 'test')).not.toThrow();
            expect(logSpy).not.toHaveBeenCalled();
        } finally {
            globalThis.chrome = savedChrome;
        }
    });

    it('C.3 sync() swallows a synchronously-throwing sendMessage (context invalidated)', () => {
        const logger = loadFreshLogger();
        vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });
        expect(() => logger.sync('boom', 'test')).not.toThrow();
    });

    it('C.4 warn() still writes to console.warn even when sendMessage throws', () => {
        const logger = loadFreshLogger();
        vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => logger.warn('QUOTA', { bytes: 1 })).not.toThrow();
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'QUOTA', { bytes: 1 });
    });
});

// ---------------------------------------------------------------------------
// Group D — Source tagging
// ---------------------------------------------------------------------------

describe('D. Source tag accompanies every forwarded message', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('D.1 forwarded message carries a non-empty string source label', () => {
        const logger = loadFreshLogger();
        const spy = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(() => {});
        logger.sync('EVENT', 'data');
        const payload = spy.mock.calls[0][0];
        expect(typeof payload.source).toBe('string');
        expect(payload.source.length).toBeGreaterThan(0);
    });
});
