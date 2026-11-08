/**
 * background/service-worker.js - permission-intent route wiring: the worker loads background/permission-intent-routes.js and installs its chrome.permissions.onAdded listener at top level.
 *
 * Requirement (approved fix for the 4.39.0 bug "the setting stays off after Allow"): the service worker loads background/permission-intent-routes.js through importScripts and calls DSSPermissionIntentRoutes.install() at its top level, so the chrome.permissions.onAdded listener survives worker restarts and completes a pending intent the popup recorded before Chrome closed it for the permission prompt.
 *
 * Harness: the REAL service worker runs the way Chrome runs it (cloned from service-worker.notification-wiring.spec.js): a fresh vm context is the worker global, background/service-worker.js runs in it as a classic script and its own importScripts() call runs each requested file in the same context. The popup runs in the test realm with the real toggle manager (test/helpers/permission-intent-harness.js). The two realms share what one extension shares: the chrome.storage.local / sync areas (the suite in-memory double) and chrome.permissions (the fake permission world). Only trust boundaries are faked: chrome.*, fetch and console.
 *
 * Observable assertions only: which scripts the worker requested, the onAdded listener it registered at top level, and the setting the popup realm StorageManager reports after Allow.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { InMemoryStorageMock } from '../fixtures/chrome-storage-mock.js';
import { CLIPBOARD, createPermissionWorld, loadPopupModules, openPopup, settle, readGatedSettings, targetOf } from '../helpers/permission-intent-harness.js';

const BACKGROUND_DIR = path.resolve(__dirname, '../../background');
const ROUTES_FILE = 'permission-intent-routes.js';

function createEvent() {
    const listeners = [];
    return { listeners, addListener: (fn) => { listeners.push(fn); }, removeListener: (fn) => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }, hasListener: (fn) => listeners.includes(fn) };
}

const world = createPermissionWorld();
const cleanups = [];
const saved = {};

beforeAll(() => {
    saved.hadPermissions = 'permissions' in chrome;
    saved.permissions = chrome.permissions;
    chrome.permissions = world.api;
    loadPopupModules();
});
afterAll(() => {
    if (saved.hadPermissions) chrome.permissions = saved.permissions;
    else delete chrome.permissions;
});
beforeEach(() => {
    world.reset();
    world.onAddedListeners.splice(0);
});
afterEach(() => {
    cleanups.splice(0).forEach((fn) => fn());
    vi.useRealTimers();
});

/** Fake chrome.* for one worker: the storage areas and chrome.permissions are the ones the popup realm uses; everything else is private to the worker. */
function createWorkerChrome() {
    const shared = globalThis.chrome.storage;
    const onChanged = createEvent();
    const fanIn = (changes, area) => onChanged.listeners.forEach((fn) => fn(changes, area));
    shared.local.onChanged.addListener(fanIn);
    shared.sync.onChanged.addListener(fanIn);
    cleanups.push(() => { shared.local.onChanged.removeListener(fanIn); shared.sync.onChanged.removeListener(fanIn); });
    return {
        storage: { local: shared.local, sync: shared.sync, session: new InMemoryStorageMock('session'), onChanged },
        permissions: world.api,
        runtime: { id: 'test-extension-id', lastError: undefined, getURL: (p) => 'chrome-extension://test-extension-id/' + p, sendMessage: vi.fn(async () => undefined), onMessage: createEvent(), onInstalled: createEvent(), onStartup: createEvent() },
        alarms: { create: vi.fn(), clear: vi.fn(async () => true), get: vi.fn(async () => undefined), onAlarm: createEvent() },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
        windows: { create: vi.fn(async () => ({ id: 1 })), update: vi.fn(async () => ({})), remove: vi.fn(async () => undefined) },
    };
}

/** Boots background/service-worker.js in a fresh worker global; returns the background-relative files its importScripts requested. A requested file that does not exist throws a named error, so a loader fault cannot pass for a wiring fault. */
function bootServiceWorker() {
    const requested = [];
    const worker = {
        chrome: createWorkerChrome(),
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        fetch: vi.fn(async () => { throw new Error('network disabled in service-worker.permission-intent-wiring.spec.js'); }),
        // A real Chrome service worker global has TextEncoder / TextDecoder; StorageManager measures item bytes with TextEncoder.
        setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone, crypto, TextEncoder, TextDecoder,
    };
    vm.createContext(worker);
    worker.self = vm.runInContext('globalThis', worker);
    const runScript = (file) => {
        if (!fs.existsSync(file)) throw new Error('service worker requested ' + path.relative(BACKGROUND_DIR, file) + ', which does not exist');
        vm.runInContext(fs.readFileSync(file, 'utf-8'), worker, { filename: file });
    };
    worker.importScripts = (...urls) => urls.forEach((url) => {
        requested.push(path.relative(BACKGROUND_DIR, path.resolve(BACKGROUND_DIR, url)).split(path.sep).join('/'));
        runScript(path.resolve(BACKGROUND_DIR, url));
    });
    runScript(path.join(BACKGROUND_DIR, 'service-worker.js'));
    return { requested };
}

describe('service worker wires the permission-intent route', () => {
    it('importScripts loads permission-intent-routes.js and the top-level install registers a chrome.permissions.onAdded listener', () => {
        const { requested } = bootServiceWorker();

        expect(requested, 'background/service-worker.js must importScripts ' + ROUTES_FILE).toContain(ROUTES_FILE);
        expect(world.onAddedListeners.length, 'booting the worker must register a chrome.permissions.onAdded listener synchronously, at top level').toBeGreaterThan(0);
    });

    it('a popup closed by the prompt: after Allow, the booted worker turns auto-copy reply on', async () => {
        bootServiceWorker();
        const target = targetOf('autoCopyReply');
        const dom = openPopup();
        await target.turnOn(dom);
        expect(world.api.request, 'precondition: the popup showed the permission prompt').toHaveBeenCalledTimes(1);

        await settle(() => world.grant(CLIPBOARD));

        expect(await readGatedSettings(), 'the popup realm StorageManager reports auto-copy reply on after Allow').toEqual({ autoCopyReply: true, autoCopyCode: false, replyNotification: false });
    });
});
