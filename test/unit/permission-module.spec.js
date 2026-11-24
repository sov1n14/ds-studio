/**
 * utils/permission-module.js — the one chrome.permissions wrapper factory behind DSSClipboardPermission and DSSNotificationPermission.
 *
 * Contract: DSSPermissionModule.create({ permissionSet, label, hasName, requestName }) returns { has, request }. has() resolves chrome.permissions.contains(permissionSet) as a boolean (only a boolean true counts as true) and request() resolves chrome.permissions.request(permissionSet) the same way; both read chrome.permissions at call time and resolve false when the API or the method is absent. A rejection or synchronous throw never reaches the caller: it logs one console.error whose first argument is `[DSS] <label>.<hasName>:` (has) or `[DSS] <label>.<requestName>:` (request) and resolves false, except that request() resolves true when DSSPermissionRequestErrors classifies the failure as "no window can host the prompt" (Kiwi Browser). Without DSSPermissionRequestErrors loaded that failure resolves false. Two modules created with different sets and labels never share the set or the label.
 *
 * Trust boundary: chrome.permissions is a per-test double, restored after each test; the classifier is the real utils/permission-request-errors.js, loaded or removed per test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/permission-request-errors.js';
import '../../utils/permission-module.js';

const WINDOW_UNAVAILABLE = 'Could not find an active window.';
const SET_A = { permissions: ['alpha'] };
const SET_B = { permissions: ['beta', 'gamma'] };

let originalPermissions;
let hadPermissions;
let errorSpy;
let realClassifier;

function makeModule(options = {}) {
    return globalThis.DSSPermissionModule.create({ permissionSet: SET_A, label: 'alpha-permission', hasName: 'hasAlpha', requestName: 'requestAlpha', ...options });
}

/** Installs a chrome.permissions double whose methods resolve or reject as configured and records every argument. */
function installPermissions({ contains, request }) {
    const calls = [];
    chrome.permissions = {
        contains: async (arg) => { calls.push(['contains', arg]); return typeof contains === 'function' ? contains() : contains; },
        request: async (arg) => { calls.push(['request', arg]); return typeof request === 'function' ? request() : request; },
    };
    return calls;
}

const loggedFirstArgs = () => errorSpy.mock.calls.map(([first]) => first);

beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hadPermissions = 'permissions' in chrome;
    originalPermissions = chrome.permissions;
    realClassifier = globalThis.DSSPermissionRequestErrors;
});

afterEach(() => {
    if (hadPermissions) chrome.permissions = originalPermissions; else delete chrome.permissions;
    globalThis.DSSPermissionRequestErrors = realClassifier;
    vi.restoreAllMocks();
});

describe('DSSPermissionModule.create', () => {
    it('has() asks contains for exactly its own permission set and resolves the boundary answer', async () => {
        const calls = installPermissions({ contains: true });
        const { has } = makeModule();
        expect(await has()).toBe(true);
        expect(calls).toEqual([['contains', SET_A]]);
    });

    it('request() asks request for exactly its own permission set and resolves the boundary answer', async () => {
        const calls = installPermissions({ request: true });
        const { request } = makeModule();
        expect(await request()).toBe(true);
        expect(calls).toEqual([['request', SET_A]]);
    });

    it.each([
        ['false', false],
        ['a truthy non-boolean', 'yes'],
        ['undefined', undefined],
    ])('resolves false when the boundary answers %s', async (_name, answer) => {
        installPermissions({ contains: answer, request: answer });
        const { has, request } = makeModule();
        expect([await has(), await request()]).toEqual([false, false]);
    });

    it('two modules keep their own set and their own log label', async () => {
        const calls = installPermissions({ contains: () => { throw new Error('nope'); }, request: true });
        const a = makeModule();
        const b = makeModule({ permissionSet: SET_B, label: 'beta-permission', hasName: 'hasBeta', requestName: 'requestBeta' });
        await a.request();
        await b.request();
        await b.has();
        expect(calls).toEqual([['request', SET_A], ['request', SET_B], ['contains', SET_B]]);
        expect(loggedFirstArgs()).toEqual(['[DSS] beta-permission.hasBeta:']);
    });

    it('resolves false without throwing when chrome.permissions is absent or lacks the method', async () => {
        const { has, request } = makeModule();
        delete chrome.permissions;
        expect([await has(), await request()]).toEqual([false, false]);
        chrome.permissions = {};
        expect([await has(), await request()]).toEqual([false, false]);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('has() resolves false and logs under the has name when contains rejects', async () => {
        installPermissions({ contains: () => Promise.reject(new Error('boom')) });
        expect(await makeModule().has()).toBe(false);
        expect(loggedFirstArgs()).toEqual(['[DSS] alpha-permission.hasAlpha:']);
    });

    it('request() resolves false and logs under the request name for a rejection that is not the window error', async () => {
        installPermissions({ request: () => Promise.reject(new Error('denied by policy')) });
        expect(await makeModule().request()).toBe(false);
        expect(loggedFirstArgs()).toEqual(['[DSS] alpha-permission.requestAlpha:']);
    });

    it('request() resolves false for a synchronous throw', async () => {
        chrome.permissions = { request: () => { throw new Error('sync boom'); } };
        expect(await makeModule().request()).toBe(false);
        expect(loggedFirstArgs()).toEqual(['[DSS] alpha-permission.requestAlpha:']);
    });

    it('request() resolves true and still logs when the rejection says no window can host the prompt', async () => {
        installPermissions({ request: () => Promise.reject(new Error(WINDOW_UNAVAILABLE)) });
        expect(await makeModule().request()).toBe(true);
        expect(loggedFirstArgs()).toEqual(['[DSS] alpha-permission.requestAlpha:']);
    });

    it('has() resolves false for the window error, which only request() forgives', async () => {
        installPermissions({ contains: () => Promise.reject(new Error(WINDOW_UNAVAILABLE)) });
        expect(await makeModule().has()).toBe(false);
    });

    it('request() resolves false for the window error when the classifier is not loaded', async () => {
        delete globalThis.DSSPermissionRequestErrors;
        installPermissions({ request: () => Promise.reject(new Error(WINDOW_UNAVAILABLE)) });
        expect(await makeModule().request()).toBe(false);
    });
});
