/**
 * temporary-chat-constants contract, asserted on copies of the module evaluated INSIDE each test.
 *
 * Why the fresh load: test/setup/vitest.setup.js preloads utils/temporary-chat-constants.js, so every literal in it executes before any test runs. Stryker (ignoreStatic) treats a literal executed only at load time as a static mutant, so a spec that reads the preloaded copy (or a static import of it) never faces those mutants. vi.resetModules() + a dynamic import, and the classic-script evaluation below, re-run the literals within the test body, so a changed value fails here.
 *
 * Expected values are the cross-module storage-key and message-type contract: a typo in any value silently breaks the feature. DSS_LAST_SEEN_CHANGE_KEY_PREFIX comes from docs/spec/04-features.md (key `dss-last-seen-change:<uuid>`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const CONSTANTS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../utils/temporary-chat-constants.js');

/** Every exported constant and its contract value; the module exports exactly these 27 names. */
const CONTRACT = {
    DSS_TEMP_CHAT_STORAGE_KEY: 'dss-temporary-chat-enabled',
    DSS_TEMP_CHAT_CHANGED_EVENT: 'dss-temporary-chat-changed',
    DSS_TEMP_CHAT_UUID_KEY: 'dss-temporary-chat-uuid',
    DSS_CHAT_CREATE_MESSAGE_TYPE: 'DSS_CHAT_CREATE_DETECTED',
    DSS_CHAT_COMPLETION_MESSAGE_TYPE: 'DSS_CHAT_COMPLETION_DETECTED',
    DSS_FIBER_DELETE_MESSAGE_TYPE: 'DSS_FIBER_DELETE_SESSION',
    DSS_FIBER_DELETE_RESULT_TYPE: 'DSS_FIBER_DELETE_RESULT',
    DSS_AUTH_CAPTURED_TYPE: 'DSS_AUTH_CAPTURED',
    DSS_HISTORY_NAV_TYPE: 'DSS_HISTORY_NAV',
    DSS_FRAGMENT_COMPLETE_TYPE: 'DSS_FRAGMENT_COMPLETE',
    DSS_PENDING_DELETES_SYNC_KEY: 'dss-pending-deletes-sync',
    DSS_LAST_AUTH_TOKEN_KEY: 'dss-last-auth-token',
    DSS_OPEN_TEMP_UUIDS_KEY: 'dss-open-temp-uuids',
    DSS_DEVICE_ID_KEY: 'dss-device-id',
    DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE: 'DSS_SCHEDULE_DELETE_RETRY',
    DSS_MSG_TRACK_FOR_DELETION: 'DSS_TRACK_FOR_DELETION',
    DSS_MSG_REMOVE_PENDING_DELETE: 'DSS_REMOVE_PENDING_DELETE',
    DSS_MSG_REMOVE_OPEN_UUID: 'DSS_REMOVE_OPEN_UUID',
    DSS_MSG_SET_LAST_AUTH_TOKEN: 'DSS_SET_LAST_AUTH_TOKEN',
    DSS_MSG_HEARTBEAT: 'DSS_HEARTBEAT',
    DSS_MSG_RELEASE_LEASE: 'DSS_RELEASE_LEASE',
    DSS_MSG_GET_PENDING_UUIDS: 'DSS_GET_PENDING_UUIDS',
    DSS_MSG_PENDING_UUIDS_CHANGED: 'DSS_PENDING_UUIDS_CHANGED',
    DSS_LAST_SEEN_CHANGE_KEY_PREFIX: 'dss-last-seen-change:',
    LEASE_TTL_MS: 600000, // 10 minutes
    FOREIGN_LEASE_TTL_MS: 86400000, // 24 hours
    HEARTBEAT_INTERVAL_MS: 60000, // 1 minute
};

let preloadedNamespace;

/**
 * Re-evaluates the constants module inside the calling test. The static specifier keeps Vite's resolver in charge (a runtime-computed path fails to resolve files outside test/, see testing-pitfalls red-for-the-right-reason).
 */
async function loadFreshConstants() {
    vi.resetModules();
    return (await import('../../utils/temporary-chat-constants.js')).default;
}

beforeEach(() => {
    preloadedNamespace = globalThis.DSS_TEMP_CHAT;
});

afterEach(() => {
    // Every fresh load republishes globalThis.DSS_TEMP_CHAT; put the preloaded copy back so later tests and modules resolve the suite-wide namespace.
    globalThis.DSS_TEMP_CHAT = preloadedNamespace;
});

describe('temporary-chat-constants (module evaluated at test time)', () => {
    it('re-evaluates the module inside the test and publishes the exported object as globalThis.DSS_TEMP_CHAT', async () => {
        const fresh = await loadFreshConstants();

        expect(fresh, 'dynamic import must yield the constants object').toBeTruthy();
        expect(fresh, 'constants must be a fresh evaluation, not the setup preload').not.toBe(preloadedNamespace);
        expect(globalThis.DSS_TEMP_CHAT, 'loading the module must publish its export object on globalThis').toBe(fresh);
    });

    it.each(Object.entries(CONTRACT))('%s has the exact contract value', async (name, value) => {
        const fresh = await loadFreshConstants();

        expect(fresh[name], `${name} must equal ${JSON.stringify(value)}`).toBe(value);
    });

    it('exports exactly the contract constants and nothing else', async () => {
        const fresh = await loadFreshConstants();

        expect(fresh).toStrictEqual(CONTRACT);
    });
});

describe('temporary-chat-constants loaded as a Chrome classic script (no CommonJS module binding)', () => {
    it('publishes the full namespace on globalThis without throwing', () => {
        const src = readFileSync(CONSTANTS_PATH, 'utf-8');
        // new Function code runs in global scope, so `module` resolves like it does for a classic script in Chrome.
        expect(new Function('return typeof module')(), 'precondition: no module binding in global scope').toBe('undefined');
        delete globalThis.DSS_TEMP_CHAT;

        expect(() => new Function(src)(), 'loading without a module binding must not throw').not.toThrow();
        expect(globalThis.DSS_TEMP_CHAT).toStrictEqual(CONTRACT);
    });
});
