/**
 * RED-phase spec for utils/notification-permission.js.
 *
 * Contract under test — a popup-facing wrapper over chrome.permissions for the optional `notifications` permission that never throws at its callers. It is a classic script that publishes globalThis.DSSNotificationPermission:
 *
 *   hasNotificationPermission()     -> chrome.permissions.contains({ permissions: ['notifications'] })
 *   requestNotificationPermission() -> chrome.permissions.request({ permissions: ['notifications'] })
 *
 * Both resolve the boundary's boolean answer; a rejection or synchronous throw resolves false and logs a console.error whose first argument starts with '[DSS] notification-permission.<function name>'; an absent chrome or chrome.permissions resolves false without logging.
 *
 * test/setup/vitest.setup.js installs no chrome.permissions, so each test installs its own and afterEach restores the original (absent) state. loadApi() evaluates the module afresh in every test (vi.resetModules), so its load-time code runs inside the test that asserts it; the wrapper must still read chrome.permissions at call time, because each test installs its mock after loading.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// node:path, not new URL(): happy-dom's global URL does not resolve a relative path against a file: base.
const MODULE_PATH = resolve(import.meta.dirname, '../../utils/notification-permission.js');
// import.meta.glob resolves outside test/ and yields {} for a missing file instead of failing the transform, which a literal dynamic import() does.
const MODULE_LOADERS = import.meta.glob('../../utils/notification-permission.js');
const NOTIFICATIONS_PERMISSION_SET = { permissions: ['notifications'] };
const LOG_PREFIX = '[DSS] notification-permission.';

/**
 * Loads the module under test and returns its published global.
 * The existence check keeps "not implemented yet" distinct from "exists but failed to load" (testing-pitfalls: Red For the Right Reason).
 */
async function loadApi() {
    if (!existsSync(MODULE_PATH)) {
        throw new Error(`utils/notification-permission.js does not exist (${MODULE_PATH}); the module under test is not implemented yet`);
    }
    const [loader] = Object.values(MODULE_LOADERS);
    if (!loader) {
        throw new Error(`utils/notification-permission.js exists but import.meta.glob did not match it; fix the loader path in this spec`);
    }
    vi.resetModules();
    await loader();
    return globalThis.DSSNotificationPermission;
}

/** True when console.error received a first argument starting with the module's log prefix. */
const loggedPrefixedError = (spy) =>
    spy.mock.calls.some(([first]) => typeof first === 'string' && first.startsWith(LOG_PREFIX));

const CASES = [
    { fnName: 'hasNotificationPermission', boundaryMethod: 'contains', },
    { fnName: 'requestNotificationPermission', boundaryMethod: 'request', },
];

describe('DSSNotificationPermission', () => {
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

    /** Installs a chrome.permissions double whose `method` behaves per `impl`; the other method stays a bare spy. */
    const installPermissions = (method, impl) => {
        chrome.permissions = { contains: vi.fn(), request: vi.fn(), [method]: impl };
        return chrome.permissions;
    };

    it('publishes hasNotificationPermission and requestNotificationPermission on globalThis.DSSNotificationPermission', async () => {
        const api = await loadApi();

        expect(typeof api?.hasNotificationPermission).toBe('function');
        expect(typeof api?.requestNotificationPermission).toBe('function');
    });

    describe.each(CASES)('$fnName', ({ fnName, boundaryMethod }) => {
        it(`asks chrome.permissions.${boundaryMethod} for exactly { permissions: ['notifications'] }`, async () => {
            const api = await loadApi();
            const permissions = installPermissions(boundaryMethod, vi.fn().mockResolvedValue(true));

            await api[fnName]();

            expect(permissions[boundaryMethod]).toHaveBeenCalledWith(NOTIFICATIONS_PERMISSION_SET);
        });

        it(`resolves true when chrome.permissions.${boundaryMethod} resolves true`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, vi.fn().mockResolvedValue(true));

            await expect(api[fnName]()).resolves.toBe(true);
        });

        it(`resolves false when chrome.permissions.${boundaryMethod} resolves false`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, vi.fn().mockResolvedValue(false));

            await expect(api[fnName]()).resolves.toBe(false);
        });

        it(`resolves false and logs a '${LOG_PREFIX}' error when chrome.permissions.${boundaryMethod} rejects`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, vi.fn().mockRejectedValue(new Error('permissions API error')));

            await expect(api[fnName]()).resolves.toBe(false);
            expect(loggedPrefixedError(errorSpy)).toBe(true);
        });

        it(`the rejection log's first argument names the function: '${LOG_PREFIX}${fnName}'`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, vi.fn().mockRejectedValue(new Error('permissions API error')));

            await api[fnName]();

            const firsts = errorSpy.mock.calls.map(([first]) => first);
            expect(firsts.some((first) => typeof first === 'string' && first.startsWith(`${LOG_PREFIX}${fnName}`)), JSON.stringify(firsts)).toBe(true);
        });

        it(`resolves false and logs a '${LOG_PREFIX}' error when chrome.permissions.${boundaryMethod} throws synchronously`, async () => {
            const api = await loadApi();
            installPermissions(boundaryMethod, vi.fn(() => {
                throw new Error('Only permissions specified in the manifest may be requested.');
            }));

            let result;
            expect(() => { result = api[fnName](); }).not.toThrow();
            await expect(result).resolves.toBe(false);
            expect(loggedPrefixedError(errorSpy)).toBe(true);
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

    it('hasNotificationPermission never calls chrome.permissions.request (checking must not prompt the user)', async () => {
        const api = await loadApi();
        const permissions = installPermissions('contains', vi.fn().mockResolvedValue(false));

        await api.hasNotificationPermission();

        expect(permissions.request).not.toHaveBeenCalled();
    });
});
