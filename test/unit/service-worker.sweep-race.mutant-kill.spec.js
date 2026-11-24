/**
 * background/service-worker.js and background/pending-store.js - queue changes that arrive while a queue job holds the in-flight guard, and the queue membership query the sweep runs before each delete request.
 *
 * Requirements (docs/spec/04-features.md "Single In-Flight Sweep"; docs/ARCHITECTURE.md Layer 2):
 *   A. A sync change that adds a queue entry while a job is in flight makes the job re-arm the dss-delete-retry alarm from the stored queue and run another closing round, so the added chat appears in the last broadcast; this holds also when the queue already held other entries.
 *   B. The job runs another closing round only while a nested job joined or a queue addition arrived; a sync change that only updates existing entries (another device renewing a lease) adds no round, and the one closing broadcast matches the stored queue.
 *   C. A failure to re-arm the alarm for an in-flight addition is reported at the boundary with console.error under the [DSS] prefix, with the error (chrome-extension-coding-guidelines "Error reporting"), and the guard still clears, so a later sync change starts a sweep.
 *   D. TemporaryChatPendingStore.hasPendingDelete(chatUuid) answers whether chatUuid is in the pending-delete queue; an empty or missing uuid is never in the queue.
 *
 * Harness: test/helpers/unload-grace-harness.js boots the REAL service worker and its importScripts chain in a vm context; only trust boundaries are faked (chrome.storage with real Chrome onChanged semantics through useRealChromeChangeEvents, chrome.alarms, chrome.tabs, chrome.runtime, fetch, console). Holds are deferred promises released by the test.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    createWorld, relayToken, trackForDeletion, settle, setTabs, tab, ORIGIN, chatUrl, temp, queueEntry, readQueue, deleteRequestsFor,
    useRealChromeChangeEvents, queueFromAnotherDevice, pendingBroadcasts, holdFirstBroadcastTabsQuery, retryAlarm, readWorkerBinding,
} from '../helpers/unload-grace-harness.js';

const TOKEN = 'Bearer sweep-race-token';
const Y = '3e7a1c5b-9d2f-4b8e-a6c4-1f0d8e2b7a53'; // tracked on this device with a live lease; every sweep keeps it queued
const X = '7b1d4f9a-2c6e-4a3b-8e5d-0f9c2a7e4b16'; // released chat queued by another device; the in-flight sweep deletes it
const N = 'c4f8e2a6-1b9d-4c7e-b3a5-8d6f0e1c2b94'; // temporary chat tracked on this device while the job is in flight
const Z = 'e2b6d0f4-8a3c-4e1b-9f7d-5c2a4e6b8d30'; // released chat queued by another device after the job settled

let world;

const tab1Broadcasts = () => pendingBroadcasts(world).filter((b) => b.tabId === 1);
const storedUuids = async () => (await readQueue(world)).map((e) => e.chatUuid);

/** A profile with a DeepSeek home tab (id 1), a tab showing Y and a tab showing N, a relayed token, and Y tracked here with a live lease (its sync-change sweep keeps Y and has settled). */
async function setupWorldWithLiveY() {
    world = createWorld();
    useRealChromeChangeEvents(world);
    setTabs(world, [tab(1, ORIGIN + '/', { active: true }), tab(2, chatUrl(Y)), tab(3, chatUrl(N))]);
    await relayToken(world, TOKEN);
    await trackForDeletion(world, Y);
    await settle(world, 60);
    expect(await storedUuids(), 'precondition: Y is queued with a live lease').toEqual([Y]);
    expect(retryAlarm(world), 'precondition: the non-empty queue has a retry alarm').toBeDefined();
}

/** Records the pending-delete sync onChanged events the worker receives; registered after the worker listener. */
function recordQueueChanges() {
    const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
    const seen = [];
    world.chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && key in changes) seen.push(structuredClone(changes[key]));
    });
    return seen;
}

/** Holds the closing broadcast of the sweep started when another device queues X; that sweep deletes X and keeps Y. Returns the hold. */
async function holdClosingBroadcastOfSweepDeletingX() {
    const broadcastQuery = holdFirstBroadcastTabsQuery(world);
    await queueFromAnotherDevice(world, X);
    await settle(world, 30);
    expect(deleteRequestsFor(world, X).length, 'precondition: the sync-change sweep sent the delete for X').toBe(1);
    expect(await storedUuids(), 'precondition: the sweep removed X and kept Y').toEqual([Y]);
    expect(broadcastQuery.state, 'precondition: the sweep reached its closing broadcast, and its tabs.query({}) is held').toEqual({ unfilteredCalls: 1, isHeldPending: true });
    return broadcastQuery;
}

describe('A - an addition to a non-empty queue during the closing broadcast', () => {
    it('N tracked while the queue still holds Y: after the job settles the last broadcast lists N and the retry alarm exists', async () => {
        await setupWorldWithLiveY();
        const broadcastQuery = await holdClosingBroadcastOfSweepDeletingX();

        const changes = recordQueueChanges();
        await trackForDeletion(world, N);
        await settle(world, 30);
        expect(await storedUuids(), 'precondition: N was added behind Y').toEqual([Y, N]);
        expect(changes.some((c) => (c.oldValue || []).some((e) => e.chatUuid === Y) && (c.newValue || []).some((e) => e.chatUuid === N)), 'precondition: the worker received a change whose old value already held Y and whose new value adds N').toBe(true);
        expect(broadcastQuery.state.isHeldPending, 'precondition: the job was still in flight when N was added').toBe(true);

        broadcastQuery.release();
        await settle(world, 60);

        const last = tab1Broadcasts().at(-1);
        expect(last?.uuids, 'N was added while the job was in flight, so the last broadcast of the job must match the stored queue').toEqual(await storedUuids());
        expect(last?.uuids, 'the last broadcast lists the added N').toContain(N);
        expect(retryAlarm(world), 'the queue holding N has a retry alarm').toBeDefined();
    }, 30000);
});

describe('B - an update-only sync change during the closing broadcast adds no closing round', () => {
    it('another device renews the lease of Y while the broadcast is held: the job closes with exactly one broadcast, matching the stored queue', async () => {
        await setupWorldWithLiveY();
        const broadcastQuery = await holdClosingBroadcastOfSweepDeletingX();

        const changes = recordQueueChanges();
        const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
        const renewed = (await readQueue(world)).map((e) => (e.chatUuid === Y ? { ...e, lastActiveAt: e.lastActiveAt + 60000 } : e));
        await world.chrome.storage.sync.set({ [key]: renewed });
        await settle(world, 30);
        expect(changes.length, 'precondition: the worker received the update-only change').toBe(1);
        expect(changes[0].oldValue.map((e) => e.chatUuid), 'precondition: the change updates Y and adds nothing').toEqual(changes[0].newValue.map((e) => e.chatUuid));
        expect(broadcastQuery.state.isHeldPending, 'precondition: the job was still in flight when the update arrived').toBe(true);

        const before = tab1Broadcasts().length;
        broadcastQuery.release();
        await settle(world, 60);

        const after = tab1Broadcasts().slice(before);
        expect(after.map((b) => b.uuids), 'no nested job joined and no queue entry was added during the closing round, so the job ends with its one held broadcast and no further round').toEqual([[Y]]);
        expect(await storedUuids(), 'the stored queue still holds only Y').toEqual([Y]);
    }, 30000);
});

describe('C - re-arming the alarm for an in-flight addition fails', () => {
    it('chrome.alarms.clear rejects during the re-arm: the failure is logged under [DSS] with the error, and the guard clears so a later sync change starts a sweep', async () => {
        await setupWorldWithLiveY();
        const broadcastQuery = await holdClosingBroadcastOfSweepDeletingX();

        await trackForDeletion(world, N);
        await settle(world, 30);
        expect(await storedUuids(), 'precondition: N was added behind Y while the job was in flight').toEqual([Y, N]);
        expect(broadcastQuery.state.isHeldPending, 'precondition: the job was still in flight when N was added').toBe(true);

        const failure = new Error('alarms.clear failed');
        const realClear = world.chrome.alarms.clear;
        let failedClears = 0;
        world.chrome.alarms.clear = vi.fn(async () => {
            failedClears += 1;
            throw failure;
        });
        broadcastQuery.release();
        await settle(world, 60);
        world.chrome.alarms.clear = realClear;

        expect(failedClears, 'precondition: the job tried to re-arm the retry alarm for the added N, and that call failed').toBeGreaterThan(0);
        const logged = world.console.error.mock.calls.filter((args) => args.includes(failure));
        const prefixes = logged.map((args) => args[0]);
        expect(logged.length, 'the re-arm failure is reported with console.error carrying the error').toBeGreaterThan(0);
        expect(prefixes.every((first) => typeof first === 'string' && first.startsWith('[DSS] ')), 'every report of the failure starts with the [DSS] prefix, observed first arguments: ' + JSON.stringify(prefixes)).toBe(true);

        await queueFromAnotherDevice(world, Z);
        await settle(world, 60);
        expect(deleteRequestsFor(world, Z).length, 'the guard cleared after the failed re-arm, so the sync change queueing the released Z starts a sweep that deletes Z').toBe(1);
        expect(await queueEntry(world, Z), 'the deleted Z leaves the queue').toBeUndefined();
        expect(retryAlarm(world), 'that sweep re-arms the retry alarm for the queue still holding Y and N').toBeDefined();
    }, 30000);
});

describe('D - hasPendingDelete never reports an empty or missing uuid as queued', () => {
    it.each([
        ['an empty string', ''],
        ['undefined', undefined],
        ['null', null],
    ])('with Y queued, hasPendingDelete of %s resolves to false while hasPendingDelete(Y) resolves to true', async (_label, uuid) => {
        await setupWorldWithLiveY();
        const store = readWorkerBinding(world, 'TemporaryChatPendingStore');
        expect(await store.hasPendingDelete(Y), 'control: the queued Y is reported as queued').toBe(true);
        expect(await store.hasPendingDelete(uuid), 'no queue entry has an empty or missing uuid, so it is never reported as queued').toBe(false);
    }, 30000);
});
