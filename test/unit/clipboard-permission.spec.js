/**
 * RED-phase spec for utils/clipboard-permission.js.
 *
 * Contract under test — a popup-facing wrapper over chrome.permissions for the optional `clipboardWrite` + `offscreen` permission pair, which auto-copy requests together when either auto-copy checkbox turns on. It is a classic script that publishes globalThis.DSSClipboardPermission and never throws at its callers:
 *
 *   hasClipboardPermission()     -> chrome.permissions.contains({ permissions: ['clipboardWrite', 'offscreen'] })
 *   requestClipboardPermission() -> chrome.permissions.request({ permissions: ['clipboardWrite', 'offscreen'] })
 *
 * Both resolve the boundary's boolean answer; a rejection or synchronous throw resolves false and logs exactly one console.error whose first argument starts with '[DSS] clipboard-permission' (the log channel and prefix shape of utils/notification-permission.js); an absent chrome or chrome.permissions resolves false without logging. The permission order inside the array is not part of the contract. The one exception: when utils/permission-request-errors.js is loaded (globalThis.DSSPermissionRequestErrors) and the request function's chrome.permissions.request rejects with Chromium's exact `Error: Could not find an active window.` (no window can host the prompt, as on Kiwi Browser), the request function resolves true; the check function still resolves false on that rejection.
 *
 * test/setup/vitest.setup.js installs no chrome.permissions, so each test installs its own double and afterEach restores the original (absent) state. loadApi() evaluates the module afresh in every test (vi.resetModules), so the wrapper must read chrome.permissions at call time, because each test installs its double after loading.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// node:path, not new URL(): happy-dom's global URL does not resolve a relative path against a file: base.
const MODULE_PATH = resolve(import.meta.dirname, '../../utils/clipboard-permission.js');
// import.meta.glob resolves outside test/ and yields {} for a missing file instead of failing the transform, which a literal dynamic import() does.
const MODULE_LOADERS = import.meta.glob('../../utils/clipboard-permission.js');
const EXPECTED_PERMISSIONS = ['clipboardWrite', 'offscreen'];
const LOG_PREFIX = '[DSS] clipboard-permission';
const ERRORS_MODULE_LOADERS = import.meta.glob('../../utils/permission-request-errors.js');
const WINDOW_UNAVAILABLE = 'Could not find an active window.';

/** Loads the real utils/permission-request-errors.js, which popup.html and service-worker.js load beside this wrapper; call it after loadApi(), whose vi.resetModules() would discard it. */
async function loadErrorsModule() {
    const [loader] = Object.values(ERRORS_MODULE_LOADERS);
    if (!loader) throw new Error('utils/permission-request-errors.js is missing or import.meta.glob did not match it');
    await loader();
    if (!globalThis.DSSPermissionRequestErrors) throw new Error('utils/permission-request-errors.js loaded but did not publish globalThis.DSSPermissionRequestErrors');
}

/**
 * Loads the module under test and returns its published global.
 * The existence check keeps "not implemented yet" distinct from "exists but failed to load" (testing-pitfalls: Red For the Right Reason).
 */
async function loadApi() {
    if (!existsSync(MODULE_PATH)) {
        throw new Error(`utils/clipboard-permission.js does not exist (${MODULE_PATH}); the module under test is not implemented yet`);
    }
    const [loader] = Object.values(MODULE_LOADERS);
    if (!loader) {
        throw new Error('utils/clipboard-permission.js exists but import.meta.glob did not match it; fix the loader path in this spec');
    }
    vi.resetModules();
    await loader();
    const api = globalThis.DSSClipboardPermission;
    if (!api) {
        throw new Error('utils/clipboard-permission.js loaded but did not publish globalThis.DSSClipboardPermission');
    }
    return api;
}

/** First arguments of every console.error call that start with the module's log prefix. */
const prefixedErrors = (spy) =>
    spy.mock.calls.map(([first]) => first).filter((first) => typeof first === 'string' && first.startsWith(LOG_PREFIX));

const CASES = [
    { fnName: 'hasClipboardPermission', boundaryMethod: 'contains' },
    { fnName: 'requestClipboardPermission', boundaryMethod: 'request' },
];

describe('DSSClipboardPermission', () => {
    let errorSpy;
    let hadPermissions;
    let originalPermissions;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        hadPermissions = 'permissions' in chrome;
        originalPermissions = chrome.permissions;
    });

    afterEach(() => {
        if (hadPermissions) {
            chrome.permissions = originalPermissions;
        } else {
            delete chrome.permissions;
        }
        vi.restoreAllMocks();
    });

    /**
     * Installs a chrome.permissions double: `method` behaves per `behave(arg)`, the other method resolves false.
     * Each method records a structured clone of every argument it receives, as the real API serialises its input, so a later mutation by the caller cannot rewrite what was asked.
     */
    const installPermissions = (method, behave) => {
        const received = { contains: [], request: [] };
        const record = (name, impl) => (arg) => {
            received[name].push(structuredClone(arg));
            return impl(arg);
        };
        chrome.permissions = {
            contains: record('contains', () => Promise.resolve(false)),
            request: record('request', () => Promise.resolve(false)),
        };
        chrome.permissions[method] = record(method, behave);
        return received;
    };

    it('publishes hasClipboardPermission and requestClipboardPermission on globalThis.DSSClipboardPermission', async () => {
        const api = await loadApi();

        expect(typeof api.hasClipboardPermission).toBe('function');
        expect(typeof api.requestClipboardPermission).toBe('function');
    });

    describe.each(CASES)('$fnName', ({ fnName, boundaryMethod }) => {
        it(`asks chrome.permissions.${boundaryMethod} once for exactly { permissions: ['clipboardWrite', 'offscreen'] }`, async () => {
            const api = await loadApi();
            const received = installPermissions(boundaryMethod, () => Promise.resolve(true));

            await api[fnName]();

            expect(received[boundaryMethod], JSON.stringify(received)).toHaveLength(1);
            const [arg] = received[boundaryMethod];
            expect(Object.keys(arg), JSON.stringify(arg)).toEqual(['permissions']);
            expect([...arg.permissions].sort()).toEqual([...EXPECTED_PERMISSIONS].sort());
        });

        it(`resolves true when chrome.permissions.${boundaryMethod} resolves true`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, () => Promise.resolve(true));

            await expect(api[fnName]()).resolves.toBe(true);
        });

        it(`resolves false when chrome.permissions.${boundaryMethod} resolves false`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, () => Promise.resolve(false));

            await expect(api[fnName]()).resolves.toBe(false);
        });

        it(`resolves false and logs exactly one '${LOG_PREFIX}' console.error when chrome.permissions.${boundaryMethod} rejects`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, () => Promise.reject(new Error('permissions API error')));

            await expect(api[fnName]()).resolves.toBe(false);
            expect(prefixedErrors(errorSpy), JSON.stringify(errorSpy.mock.calls)).toHaveLength(1);
        });

        it.each([
            ['rejects', () => Promise.reject(new Error('permissions API error'))],
            ['throws synchronously', () => { throw new Error('Only permissions specified in the manifest may be requested.'); }],
        ])(`when chrome.permissions.${boundaryMethod} %s, the log's first argument names the function: '${LOG_PREFIX}.${fnName}'`, async (_how, behave) => {
            const api = await loadApi();
            installPermissions(boundaryMethod, behave);

            await api[fnName]();

            const firsts = errorSpy.mock.calls.map(([first]) => first);
            expect(firsts.some((first) => typeof first === 'string' && first.startsWith(`${LOG_PREFIX}.${fnName}`)), JSON.stringify(firsts)).toBe(true);
        });

        it(`resolves false and logs exactly one '${LOG_PREFIX}' console.error when chrome.permissions.${boundaryMethod} throws synchronously`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, () => {
                throw new Error('Only permissions specified in the manifest may be requested.');
            });

            let result;
            expect(() => { result = api[fnName](); }).not.toThrow();
            await expect(result).resolves.toBe(false);
            expect(prefixedErrors(errorSpy), JSON.stringify(errorSpy.mock.calls)).toHaveLength(1);
        });

        it('resolves false without logging when chrome.permissions is undefined', async () => {
            const api = await loadApi();
            delete chrome.permissions;

            await expect(api[fnName]()).resolves.toBe(false);
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('resolves false without throwing or logging when globalThis.chrome is undefined', async () => {
            const api = await loadApi();
            const savedChrome = globalThis.chrome;
            let result;
            try {
                globalThis.chrome = undefined;
                expect(() => { result = api[fnName](); }).not.toThrow();
                await expect(result).resolves.toBe(false);
            } finally {
                globalThis.chrome = savedChrome;
            }
            expect(errorSpy).not.toHaveBeenCalled();
        });
    });

    it('hasClipboardPermission never calls chrome.permissions.request (checking must not prompt the user)', async () => {
        const api = await loadApi();
        const received = installPermissions('contains', () => Promise.resolve(false));

        await api.hasClipboardPermission();

        expect(received.request).toEqual([]);
    });

    // Kiwi Browser on Android: no native window can host the prompt, so Chromium rejects chrome.permissions.request with "Could not find an active window."; the request counts as granted only for that exact rejection, and only when utils/permission-request-errors.js is loaded.
    describe('when chrome.permissions rejects because no window can host the prompt', () => {
        afterEach(() => { delete globalThis.DSSPermissionRequestErrors; });

        it('requestClipboardPermission resolves true when request rejects with the exact window error', async () => {
            const api = await loadApi();
            await loadErrorsModule();
            installPermissions('request', () => Promise.reject(new Error(WINDOW_UNAVAILABLE)));

            await expect(api.requestClipboardPermission()).resolves.toBe(true);
        });

        it('requestClipboardPermission resolves false when request rejects with any other error, with the errors module loaded', async () => {
            const api = await loadApi();
            await loadErrorsModule();
            installPermissions('request', () => Promise.reject(new Error('permissions API error')));

            await expect(api.requestClipboardPermission()).resolves.toBe(false);
        });

        it('hasClipboardPermission resolves false when contains rejects with the exact window error (a check is never a grant)', async () => {
            const api = await loadApi();
            await loadErrorsModule();
            installPermissions('contains', () => Promise.reject(new Error(WINDOW_UNAVAILABLE)));

            await expect(api.hasClipboardPermission()).resolves.toBe(false);
        });

        it('requestClipboardPermission resolves false on the window error when the errors module is not loaded', async () => {
            const api = await loadApi();
            delete globalThis.DSSPermissionRequestErrors;
            installPermissions('request', () => Promise.reject(new Error(WINDOW_UNAVAILABLE)));

            await expect(api.requestClipboardPermission()).resolves.toBe(false);
        });
    });
});
