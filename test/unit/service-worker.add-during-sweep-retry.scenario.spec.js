/**
 * Scenario: a temporary chat added to the pending-delete queue while a queue job is in flight must still end with a pending-delete retry alarm, or be deleted, once every in-flight job settles.
 *
 * Requirement (user rule "conversations that should be deleted are correctly deleted"): after DSS_TRACK_FOR_DELETION adds chat N to the queue and every in-flight queue job settles, with no further storage change, startup or message, a chrome.alarms retry alarm for pending deletes exists, or N has been deleted through fetch.
 *
 * Windows, each a moment at which the queue write of the add lands while a queue job holds the in-flight guard:
 *   W1: after the sync-change sweep re-read the queue in applySweepResult and saved it without the deleted X (the sweep is held at its orphan-key read, chrome.storage.local.get(null)).
 *   W2: during the closing broadcast of that sweep (held at its chrome.tabs.query({})).
 *   W3: during the closing broadcast of an onInstalled sweep that found the queue empty and returned early (held at its chrome.tabs.query({})).
 *   C0 (control): no job in flight when N is added, so the assertion is shown to be satisfiable.
 *
 * Harness: test/helpers/unload-grace-harness.js boots the real background/service-worker.js and its importScripts chain (pending-store.js, pending-store-routes.js and the rest) in a vm context; only trust boundaries are faked: chrome.storage (structuredClone on get and set, real Chrome onChanged semantics through useRealChromeChangeEvents), chrome.alarms, chrome.tabs, chrome.runtime and fetch. Holds are deferred promises released by the test; outcome assertions read only the alarms double, the fetch calls and the stored queue.
 */
import { describe, it, expect } from 'vitest';
import {
    createWorld, relayToken, trackForDeletion, settle, setTabs, tab, ORIGIN, chatUrl, temp, queueEntry, readQueue, deleteRequestsFor,
    useRealChromeChangeEvents, queueFromAnotherDevice, pendingBroadcasts, holdFirstBroadcastTabsQuery, retryAlarm,
} from '../helpers/unload-grace-harness.js';

const TOKEN = 'Bearer add-during-sweep-token';
const X = '5c2e8a1f-3b7d-4c9e-a1f0-6d4b2c8e9a07'; // released chat queued by another device; the in-flight sweep deletes it
const N = 'a9d3f6b2-7e1c-4a85-b0d4-2f6e8c1a3b59'; // temporary chat tracked on this device while a queue job is in flight

let world;

/** A profile with a DeepSeek home tab and the tab of N, a relayed token, an empty queue and no retry alarm. */
async function setupWorld() {
    world = createWorld();
    useRealChromeChangeEvents(world);
    setTabs(world, [tab(1, ORIGIN + '/', { active: true }), tab(2, chatUrl(N))]);
    await relayToken(world, TOKEN);
    await settle(world);
    expect(await readQueue(world), 'precondition: the queue starts empty').toEqual([]);
    expect(retryAlarm(world), 'precondition: no retry alarm exists at the start').toBeUndefined();
}

/** Records the pending-delete onChanged events whose new value lists uuid; registered after the worker listener. */
function recordQueueChangesListing(uuid) {
    const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
    const seen = [];
    world.chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && key in changes && (changes[key].newValue || []).some((e) => e.chatUuid === uuid)) seen.push(uuid);
    });
    return seen;
}

/** Holds the response of the first chrome.storage.local.get(null), which is the orphan-key read of the sweep, made after applySweepResult and the alarm decision; the read itself is taken at call time, as a slow response of a real read would be. */
function holdFirstLocalGetAll() {
    const area = world.chrome.storage.local;
    const realGet = area.get.bind(area);
    let resolveHeld;
    const held = new Promise((resolve) => { resolveHeld = resolve; });
    const state = { getAllCalls: 0, isHeldPending: false };
    area.get = (keys, callback) => {
        if (keys !== null || typeof callback === 'function') return realGet(keys, callback);
        state.getAllCalls += 1;
        if (state.getAllCalls > 1) return realGet(keys);
        const snapshot = realGet(keys);
        state.isHeldPending = true;
        return held.then(() => { state.isHeldPending = false; return snapshot; });
    };
    return { state, release: () => resolveHeld() };
}

/** Tracks N through the worker route while a job is held, and checks that the add landed and its onChanged event reached the worker. */
async function trackNWhileHeld(isHeldPending) {
    const changesListingN = recordQueueChangesListing(N);
    await trackForDeletion(world, N);
    await settle(world, 30);
    expect(await queueEntry(world, N), 'precondition: N was added to the pending-delete queue').toBeDefined();
    expect(changesListingN.length, 'precondition: the worker received a pending-delete onChanged event listing N').toBeGreaterThan(0);
    expect(isHeldPending(), 'precondition: the queue job was still in flight when N was added').toBe(true);
}

/** The requirement: once every job settled, a retry alarm exists, or N was deleted and left the queue. */
async function expectRetryAlarmOrNDeleted(reason) {
    const outcome = {
        retryAlarm: retryAlarm(world) ?? null,
        deleteRequestsForN: deleteRequestsFor(world, N).length,
        isNStillQueued: (await queueEntry(world, N)) !== undefined,
        lastBroadcastToTab1: pendingBroadcasts(world).filter((b) => b.tabId === 1).at(-1) ?? null,
    };
    const isMet = outcome.retryAlarm !== null || (outcome.deleteRequestsForN > 0 && !outcome.isNStillQueued);
    expect(isMet, reason + ' | observed: ' + JSON.stringify(outcome)).toBe(true);
}

/** Another device queues the released X, which starts the sync-change sweep; the caller installed a hold first. */
async function startSweepDeletingX() {
    await queueFromAnotherDevice(world, X);
    await settle(world, 30);
    expect(deleteRequestsFor(world, X).length, 'precondition: the sync-change sweep sent the delete for X').toBe(1);
    expect(await queueEntry(world, X), 'precondition: applySweepResult re-read the queue and saved it without X').toBeUndefined();
    expect(retryAlarm(world), 'precondition: with the queue empty after X, the sweep left no retry alarm').toBeUndefined();
}

describe('C0 (control): a chat added while no queue job is in flight', () => {
    it('ends with a retry alarm, because the sync change of the add starts a sweep', async () => {
        await setupWorld();
        await trackNWhileHeld(() => true);
        await settle(world, 60);
        await expectRetryAlarmOrNDeleted('C0: N was added with no job in flight, so a retry alarm must exist or N must be deleted');
    }, 30000);
});

describe('a chat added while a queue job holds the in-flight guard', () => {
    it('W1: added after the sync-change sweep re-read the queue in applySweepResult, it still ends with a retry alarm or deleted', async () => {
        await setupWorld();
        const orphanRead = holdFirstLocalGetAll();
        await startSweepDeletingX();
        expect(orphanRead.state, 'precondition: the sweep reached its orphan-key read after applySweepResult, and that read is held').toEqual({ getAllCalls: 1, isHeldPending: true });

        await trackNWhileHeld(() => orphanRead.state.isHeldPending);
        const broadcastsBefore = pendingBroadcasts(world).length;
        orphanRead.release();
        await settle(world, 60);
        expect(pendingBroadcasts(world).length, 'precondition: the sweep finished with its closing broadcast').toBeGreaterThan(broadcastsBefore);

        await expectRetryAlarmOrNDeleted('W1: N was added after the in-flight sweep re-read the queue; once the sweep settled, a retry alarm must exist or N must be deleted');
    }, 30000);

    it('W2: added during the closing broadcast of the sync-change sweep, it still ends with a retry alarm or deleted', async () => {
        await setupWorld();
        const broadcastQuery = holdFirstBroadcastTabsQuery(world);
        await startSweepDeletingX();
        expect(broadcastQuery.state, 'precondition: the sweep reached its closing broadcast, and its tabs.query({}) is held').toEqual({ unfilteredCalls: 1, isHeldPending: true });

        await trackNWhileHeld(() => broadcastQuery.state.isHeldPending);
        const broadcastsBefore = pendingBroadcasts(world).length;
        broadcastQuery.release();
        await settle(world, 60);
        expect(pendingBroadcasts(world).length, 'precondition: the held closing broadcast was sent').toBeGreaterThan(broadcastsBefore);

        await expectRetryAlarmOrNDeleted('W2: N was added during the closing broadcast of the in-flight sweep; once the sweep settled, a retry alarm must exist or N must be deleted');
    }, 30000);

    it('W3: added while an onInstalled sweep that found the queue empty is still in flight, it still ends with a retry alarm or deleted', async () => {
        await setupWorld();
        const broadcastQuery = holdFirstBroadcastTabsQuery(world);
        world.events.onInstalled.listeners.forEach((fn) => fn({ reason: 'update' }));
        await settle(world, 30);
        expect(broadcastQuery.state, 'precondition: the onInstalled sweep found the queue empty, returned early, and its closing broadcast tabs.query({}) is held').toEqual({ unfilteredCalls: 1, isHeldPending: true });
        expect(retryAlarm(world), 'precondition: the empty-queue sweep armed no retry alarm').toBeUndefined();

        await trackNWhileHeld(() => broadcastQuery.state.isHeldPending);
        const broadcastsBefore = pendingBroadcasts(world).length;
        broadcastQuery.release();
        await settle(world, 60);
        expect(pendingBroadcasts(world).length, 'precondition: the held closing broadcast was sent').toBeGreaterThan(broadcastsBefore);

        await expectRetryAlarmOrNDeleted('W3: N was added while the empty-queue onInstalled sweep was in flight; once the sweep settled, a retry alarm must exist or N must be deleted');
    }, 30000);
});
