/**
 * Unit tests for utils/logger.js
 *
 * Coverage groups:
 *   A. Initial state — disabled (dsDebugSync not set / false)
 *   B. Initial state — enabled (dsDebugSync: true pre-set before load)
 *   C. Runtime flag toggle via chrome.storage.onChanged
 *   D. warn() always fires regardless of flag state
 *   E. Fail-safe — chrome.storage unavailable at load time
 *   F. Storage area discrimination — flag is read from LOCAL, not SYNC
 *
 * Loading strategy:
 *   logger.js is a plain script (not an ES module) that exports via
 *   module.exports. We use createRequire so Node.js CJS semantics apply.
 *   Each group that needs a fresh IIFE execution uses vi.resetModules()
 *   then creates a new require() handle from import.meta.url.
 *
 * Timer strategy:
 *   _loadFlag() calls chrome.storage.local.get() whose InMemoryStorageMock
 *   implementation resolves via setTimeout(0). We use vi.useFakeTimers() +
 *   vi.runAllTimersAsync() to flush that callback synchronously in tests.
 *   onChanged notifications from InMemoryStorageMock._notify are synchronous
 *   (no setTimeout), so no timer advance is needed after storage.set().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a fresh copy of utils/logger.js after vi.resetModules() and
 * any desired pre-seeding. Returns the __DS_Logger object.
 *
 * IMPORTANT: call vi.useFakeTimers() BEFORE this function if you need to
 * control the initial chrome.storage.local.get callback timing.
 */
function loadFreshLogger() {
    const req = createRequire(import.meta.url);
    // Delete the cached CJS module so require re-executes the IIFE.
    // Node's require cache key is the resolved absolute path.
    const loggerPath = req.resolve('../../utils/logger.js');
    delete req.cache[loggerPath];
    return req('../../utils/logger.js');
}

// ---------------------------------------------------------------------------
// Group A — Initial state: disabled (dsDebugSync not set)
// ---------------------------------------------------------------------------

describe('A. Initial state — disabled (dsDebugSync not set / false)', () => {
    let logger;

    beforeEach(async () => {
        vi.useFakeTimers();
        // Storage is already cleared by vitest.setup.js beforeEach.
        // Re-load the IIFE so _isEnabled starts from the initial get().
        logger = loadFreshLogger();
        // Flush the setTimeout(0) callback inside _loadFlag.
        await vi.runAllTimersAsync();
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('A.1 isEnabled() returns false when dsDebugSync is not set', () => {
        expect(logger.isEnabled()).toBe(false);
    });

    it('A.2 sync() produces ZERO console.log output when disabled', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logger.sync('test-event', { foo: 1 });
        expect(spy).not.toHaveBeenCalled();
    });

    it('A.3 sync() is a complete no-op — returns undefined immediately when disabled', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = logger.sync('event', 'data');
        expect(result).toBeUndefined();
        expect(spy).not.toHaveBeenCalled();
    });

    it('A.4 isEnabled() returns false when dsDebugSync is explicitly false', async () => {
        vi.useFakeTimers();
        await chrome.storage.local.set({ dsDebugSync: false });
        const freshLogger = loadFreshLogger();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        expect(freshLogger.isEnabled()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Group B — Initial state: enabled (dsDebugSync: true pre-set before load)
// ---------------------------------------------------------------------------

describe('B. Initial state — enabled (dsDebugSync: true before load)', () => {
    let logger;

    beforeEach(async () => {
        // Pre-seed storage BEFORE loading the logger so _loadFlag picks it up.
        await chrome.storage.local.set({ dsDebugSync: true });
        vi.useFakeTimers();
        logger = loadFreshLogger();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('B.1 isEnabled() returns true when dsDebugSync is true at load time', () => {
        expect(logger.isEnabled()).toBe(true);
    });

    it('B.2 sync() calls console.log with [DS-Sync] prefix, event, and data', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logger.sync('PUSH', { key: 'v1' });
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'PUSH', { key: 'v1' });
    });

    it('B.3 sync() passes empty string as data when data argument is omitted', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logger.sync('EVENT_ONLY');
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'EVENT_ONLY', '');
    });

    it('B.4 sync() forwards falsy data values (0, null, false) correctly', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logger.sync('ZERO', 0);
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'ZERO', 0);
        spy.mockClear();

        logger.sync('NULL', null);
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'NULL', null);
        spy.mockClear();

        logger.sync('FALSE', false);
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'FALSE', false);
    });
});

// ---------------------------------------------------------------------------
// Group C — Runtime toggle via chrome.storage.onChanged
// ---------------------------------------------------------------------------

describe('C. Runtime flag toggle via chrome.storage.onChanged', () => {
    let logger;

    beforeEach(async () => {
        // Load logger with flag disabled initially.
        vi.useFakeTimers();
        logger = loadFreshLogger();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('C.1 false→true: isEnabled() becomes true after onChanged fires', async () => {
        expect(logger.isEnabled()).toBe(false);
        // InMemoryStorageMock._notify is synchronous; no timer advance needed.
        await chrome.storage.local.set({ dsDebugSync: true });
        expect(logger.isEnabled()).toBe(true);
    });

    it('C.2 false→true: sync() starts producing output after toggle', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logger.sync('before-enable', 'noop');
        expect(spy).not.toHaveBeenCalled();

        await chrome.storage.local.set({ dsDebugSync: true });

        logger.sync('after-enable', 'data');
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'after-enable', 'data');
    });

    it('C.3 true→false: isEnabled() becomes false after second toggle', async () => {
        await chrome.storage.local.set({ dsDebugSync: true });
        expect(logger.isEnabled()).toBe(true);

        await chrome.storage.local.set({ dsDebugSync: false });
        expect(logger.isEnabled()).toBe(false);
    });

    it('C.4 true→false: sync() becomes no-op again after disabling', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await chrome.storage.local.set({ dsDebugSync: true });
        logger.sync('enabled', 'yes');
        expect(spy).toHaveBeenCalledOnce();
        spy.mockClear();

        await chrome.storage.local.set({ dsDebugSync: false });
        logger.sync('disabled', 'no');
        expect(spy).not.toHaveBeenCalled();
    });

    it('C.5 onChanged for area=sync is ignored — flag only from area=local', async () => {
        // Set dsDebugSync in sync storage (should not affect the logger).
        await chrome.storage.sync.set({ dsDebugSync: true });
        // chrome.storage.onChanged is wired to storageMock.local in setup,
        // so sync changes do not fire the logger's listener.
        expect(logger.isEnabled()).toBe(false);
    });

    it('C.6 multiple rapid toggles leave isEnabled() in the correct final state', async () => {
        await chrome.storage.local.set({ dsDebugSync: true });
        await chrome.storage.local.set({ dsDebugSync: false });
        await chrome.storage.local.set({ dsDebugSync: true });
        await chrome.storage.local.set({ dsDebugSync: false });
        expect(logger.isEnabled()).toBe(false);
    });

    it('C.7 unrelated storage key change does not flip the flag', async () => {
        await chrome.storage.local.set({ someOtherKey: 'value' });
        expect(logger.isEnabled()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Group D — warn() always fires regardless of flag state
// ---------------------------------------------------------------------------

describe('D. warn() always fires regardless of enabled flag', () => {
    let logger;

    beforeEach(async () => {
        vi.useFakeTimers();
        logger = loadFreshLogger();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('D.1 warn() calls console.warn when disabled', () => {
        expect(logger.isEnabled()).toBe(false);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('QUOTA_EXCEEDED', { bytes: 1024 });
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'QUOTA_EXCEEDED', { bytes: 1024 });
    });

    it('D.2 warn() calls console.warn when enabled', async () => {
        await chrome.storage.local.set({ dsDebugSync: true });
        expect(logger.isEnabled()).toBe(true);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('SYNC_FAILED', 'network error');
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'SYNC_FAILED', 'network error');
    });

    it('D.3 warn() with no data argument passes empty string', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('EVENT_NO_DATA');
        expect(spy).toHaveBeenCalledWith('[DS-Sync]', 'EVENT_NO_DATA', '');
    });

    it('D.4 warn() does NOT call console.log', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('WARN_EVENT', 'x');
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('D.5 sync() does NOT call console.warn (wrong channel)', async () => {
        await chrome.storage.local.set({ dsDebugSync: true });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        logger.sync('CHECK', 'data');
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Group E — Fail-safe: chrome.storage unavailable at load time
// ---------------------------------------------------------------------------

describe('E. Fail-safe — chrome.storage unavailable at load time', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('E.1 loading logger does NOT throw when chrome is undefined', () => {
        const savedChrome = globalThis.chrome;
        globalThis.chrome = undefined;
        try {
            expect(() => loadFreshLogger()).not.toThrow();
        } finally {
            globalThis.chrome = savedChrome;
        }
    });

    it('E.2 isEnabled() returns false when chrome is undefined at load', async () => {
        const savedChrome = globalThis.chrome;
        globalThis.chrome = undefined;
        let logger;
        try {
            vi.useFakeTimers();
            logger = loadFreshLogger();
            await vi.runAllTimersAsync();
        } finally {
            globalThis.chrome = savedChrome;
            vi.useRealTimers();
        }
        expect(logger.isEnabled()).toBe(false);
    });

    it('E.3 sync() is a no-op when chrome is undefined at load', async () => {
        const savedChrome = globalThis.chrome;
        globalThis.chrome = undefined;
        let logger;
        try {
            vi.useFakeTimers();
            logger = loadFreshLogger();
            await vi.runAllTimersAsync();
        } finally {
            globalThis.chrome = savedChrome;
            vi.useRealTimers();
        }
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logger.sync('no-chrome', 'test');
        expect(spy).not.toHaveBeenCalled();
    });

    it('E.4 loading logger does NOT throw when chrome.storage is undefined', () => {
        const savedStorage = globalThis.chrome.storage;
        globalThis.chrome.storage = undefined;
        try {
            expect(() => loadFreshLogger()).not.toThrow();
        } finally {
            globalThis.chrome.storage = savedStorage;
        }
    });

    it('E.5 isEnabled() returns false when chrome.storage is undefined at load', async () => {
        const savedStorage = globalThis.chrome.storage;
        globalThis.chrome.storage = undefined;
        let logger;
        try {
            vi.useFakeTimers();
            logger = loadFreshLogger();
            await vi.runAllTimersAsync();
        } finally {
            globalThis.chrome.storage = savedStorage;
            vi.useRealTimers();
        }
        expect(logger.isEnabled()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Group F — Storage area discrimination (LOCAL not SYNC)
// ---------------------------------------------------------------------------

describe('F. Flag reads from chrome.storage.local, not chrome.storage.sync', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('F.1 dsDebugSync in sync storage does not enable the logger at load', async () => {
        // Put the flag in SYNC storage only; local is empty.
        await chrome.storage.sync.set({ dsDebugSync: true });
        vi.useFakeTimers();
        const logger = loadFreshLogger();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        // Logger reads from local — sync value must be ignored.
        expect(logger.isEnabled()).toBe(false);
    });

    it('F.2 dsDebugSync in local storage enables the logger at load', async () => {
        await chrome.storage.local.set({ dsDebugSync: true });
        vi.useFakeTimers();
        const logger = loadFreshLogger();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        expect(logger.isEnabled()).toBe(true);
    });

    it('F.3 chrome.storage.local.get is called with dsDebugSync key, not sync', async () => {
        const getSpy = vi.spyOn(chrome.storage.local, 'get');
        vi.useFakeTimers();
        loadFreshLogger();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        expect(getSpy).toHaveBeenCalledWith('dsDebugSync', expect.any(Function));
        // chrome.storage.sync.get must NOT have been called with dsDebugSync
        // (it may be called for other reasons by other modules, but not the logger).
        // We verify by checking local was the target.
        expect(getSpy.mock.calls[0][0]).toBe('dsDebugSync');
    });
});
