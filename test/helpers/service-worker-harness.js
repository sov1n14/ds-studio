/**
 * Shared bootstrap for background/service-worker.js sweep specs.
 *
 * Loads the REAL background/pending-store.js and the real service worker against the in-memory chrome.storage fixture (deep-copy get/set, like real chrome.storage). Mocked trust boundaries only: chrome.storage.onChanged registration (the SW listener is captured instead of wired to the fixture, so seeding the queue never starts a sweep; drive it with fireSyncChange), chrome.tabs, chrome.alarms (backed by the exported `alarms` Map so the scheduled alarm set is observable), fetch. StorageManager and the four route installers are stubbed because they are off the sweep path.
 *
 * Call installServiceWorkerHarness() once at spec top level; it registers the beforeAll/beforeEach/afterEach hooks. Date.now reads `clock`, reset to NOW before each test; move it with setClock.
 */
import '../../utils/deepseek-api.js';
import '../../utils/temporary-chat-constants.js';
import '../../background/service-worker-constants.js';
import TemporaryChatPendingStore from '../../background/pending-store.js';
import { beforeAll, beforeEach, afterEach, vi } from 'vitest';

export const RETRY_ALARM_NAME = globalThis.RETRY_ALARM_NAME;
export const SCHEDULE_DELETE_RETRY = globalThis.DSS_TEMP_CHAT.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE;
export const SYNC_KEY = globalThis.DSS_TEMP_CHAT.DSS_PENDING_DELETES_SYNC_KEY;
export const TOKEN_KEY = globalThis.DSS_TEMP_CHAT.DSS_LAST_AUTH_TOKEN_KEY;
export const DEVICE_ID_KEY = globalThis.DSS_TEMP_CHAT.DSS_DEVICE_ID_KEY;
export const FOREIGN_LEASE_TTL_MS = globalThis.DSS_TEMP_CHAT.FOREIGN_LEASE_TTL_MS;
export const NOW = 1700000000000;
export const store = TemporaryChatPendingStore;
export const alarms = new Map();
/** Every newValue written to the sync pending-delete queue, in order. */
export const syncQueueWrites = [];
export let clock = NOW;
let swOnChanged;

export function setClock(ms) {
    clock = ms;
}

export const expired = (uuid, attemptCount = 0) => ({ chatUuid: uuid, attemptCount, lastActiveAt: 0 });
export const fresh = (uuid) => ({ chatUuid: uuid, attemptCount: 0, lastActiveAt: NOW });

export async function settle(rounds = 30) {
    for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
export async function seedQueue(entries) {
    await chrome.storage.sync.set({ [SYNC_KEY]: entries });
}
/** This device's ID as persisted in storage.local (created by the first addPendingDelete); undefined when none exists yet. */
export async function readLocalDeviceId() {
    return (await chrome.storage.local.get(DEVICE_ID_KEY))[DEVICE_ID_KEY];
}
export async function readQueue() {
    return (await chrome.storage.sync.get(SYNC_KEY))[SYNC_KEY] || [];
}
export function fetchedUuids() {
    return globalThis.fetch.mock.calls.map((c) => JSON.parse(c[1].body).chat_session_id);
}
export function fireSyncChange(area = 'sync') {
    swOnChanged({ [SYNC_KEY]: { newValue: [] } }, area);
}

export function installServiceWorkerHarness() {
    beforeAll(async () => {
        globalThis.importScripts = vi.fn();
        globalThis.StorageManager = { isSyncedWithCloud: vi.fn().mockResolvedValue(true), retrySync: vi.fn() };
        globalThis.DSSSettingsRoutes = { install: vi.fn() };
        globalThis.DSSPendingStoreRoutes = { install: vi.fn() };
        globalThis.DSSEditorWindowRoutes = { install: vi.fn() };
        globalThis.DSSChatMapRoutes = { install: vi.fn() };
        globalThis.fetch = vi.fn();
        const addListener = chrome.storage.onChanged.addListener;
        chrome.storage.onChanged.addListener = (listener) => { swOnChanged = listener; };
        try {
            await import('../../background/service-worker.js');
        } finally {
            chrome.storage.onChanged.addListener = addListener;
        }
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && SYNC_KEY in changes) syncQueueWrites.push(changes[SYNC_KEY].newValue);
        });
    });

    beforeEach(async () => {
        clock = NOW;
        vi.spyOn(Date, 'now').mockImplementation(() => clock);
        globalThis.fetch.mockReset().mockResolvedValue({ ok: true });
        chrome.tabs.query.mockReset().mockResolvedValue([]);
        alarms.clear();
        chrome.alarms.create.mockReset().mockImplementation((name, info) => { alarms.set(name, info); });
        chrome.alarms.clear.mockReset().mockImplementation(async (name) => alarms.delete(name));
        await store.setLastAuthToken('Bearer tok');
    });

    afterEach(async () => {
        await settle(5);
        vi.restoreAllMocks();
    });
}
