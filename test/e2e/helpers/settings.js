// Seeds extension settings in chrome.storage.local through the service worker and restores them.
// The service worker broadcasts DSS_SETTINGS_CHANGED for local changes, so open pages react live;
// pages opened afterwards read the seeded values at load.

import { evaluateInWorker } from './extension.js';

/** Writes `values` into chrome.storage.local without any snapshot (caller owns restoration). */
export async function setLocal(context, values) {
    await evaluateInWorker(context, (payload) => chrome.storage.local.set(payload), values);
}

/** Writes `values` into chrome.storage.sync, then local, so a sync-first reader and the local broadcast agree. */
export async function setBothAreas(context, values) {
    await evaluateInWorker(context, async (payload) => {
        await chrome.storage.sync.set(payload);
        await chrome.storage.local.set(payload);
    }, values);
}

/** Reads `keys` from both storage areas without snapshotting them; absent keys are absent from each returned object. */
export async function readBothAreas(context, keys) {
    return evaluateInWorker(context, async (list) => ({
        local: await chrome.storage.local.get(list),
        sync: await chrome.storage.sync.get(list),
    }), keys);
}

/**
 * Restores `keys` in both areas to their snapshots (present keys set, absent keys removed), sync first and local right after, inside one worker call.
 * One call keeps the window in which the areas disagree to a few milliseconds: while they disagree the extension's sync-first reader writes the sync value back into local, which would undo a local-first restore of synced data such as presets.
 * Only drifted keys are written, so restoration adds no sync traffic of its own.
 */
async function restoreBothAreas(context, keys, snapshots) {
    await evaluateInWorker(context, async ({ list, saved }) => {
        const plan = {};
        for (const areaName of ['sync', 'local']) {
            const current = await chrome.storage[areaName].get(list);
            const drifted = list.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(saved[areaName][key]));
            plan[areaName] = {
                toSet: Object.fromEntries(drifted.filter((key) => key in saved[areaName]).map((key) => [key, saved[areaName][key]])),
                toRemove: drifted.filter((key) => !(key in saved[areaName])),
            };
        }
        for (const areaName of ['sync', 'local']) {
            const { toSet, toRemove } = plan[areaName];
            if (Object.keys(toSet).length > 0) await chrome.storage[areaName].set(toSet);
            if (toRemove.length > 0) await chrome.storage[areaName].remove(toRemove);
        }
    }, { list: keys, saved: snapshots });
}

/** Names of the keys in each area that start with `prefix`. */
async function listKeysWithPrefix(context, prefix) {
    return evaluateInWorker(context, async (start) => {
        const names = {};
        for (const areaName of ['sync', 'local']) {
            names[areaName] = Object.keys(await chrome.storage[areaName].get(null)).filter((key) => key.startsWith(start));
        }
        return names;
    }, prefix);
}

/** Removes, in each area, the keys that start with `prefix` and are absent from `existing[area]`. */
async function removeKeysCreatedSince(context, prefix, existing) {
    await evaluateInWorker(context, async ({ start, before }) => {
        for (const areaName of ['sync', 'local']) {
            const known = new Set(before[areaName]);
            const created = Object.keys(await chrome.storage[areaName].get(null)).filter((key) => key.startsWith(start) && !known.has(key));
            if (created.length > 0) await chrome.storage[areaName].remove(created);
        }
    }, { start: prefix, before: existing });
}

/**
 * Creates a settings session: `set()` snapshots every key on its first touch, then writes local;
 * `setInBothAreas()` snapshots the same way but writes sync and local, for synced data (presets) that readers take from sync first;
 * `track()` snapshots keys the extension itself writes during a test, without writing them;
 * `trackNewKeys(prefix)` records which keys starting with `prefix` exist now, for keys the extension creates under a name the test cannot know in advance (a prompt group added through the popup);
 * `restore()` puts every touched key back in both areas, then removes every key created under a tracked prefix. `isEnabled` is always snapshotted.
 */
export function createSettingsSession(context) {
    const snapshots = { local: {}, sync: {} };
    const touched = new Set();
    const keysBeforeByPrefix = new Map();

    async function captureUntouched(keys) {
        const fresh = keys.filter((key) => !touched.has(key));
        if (fresh.length === 0) return;
        const { local, sync } = await readBothAreas(context, fresh);
        fresh.forEach((key) => {
            touched.add(key);
            if (key in local) snapshots.local[key] = local[key];
            if (key in sync) snapshots.sync[key] = sync[key];
        });
    }

    return {
        async set(values) {
            await captureUntouched(['isEnabled', ...Object.keys(values)]);
            await setLocal(context, values);
        },
        async setInBothAreas(values) {
            await captureUntouched(['isEnabled', ...Object.keys(values)]);
            await setBothAreas(context, values);
        },
        async track(keys) {
            await captureUntouched(keys);
        },
        async trackNewKeys(prefix) {
            if (keysBeforeByPrefix.has(prefix)) return;
            keysBeforeByPrefix.set(prefix, await listKeysWithPrefix(context, prefix));
        },
        async restore() {
            if (touched.size > 0) await restoreBothAreas(context, [...touched], snapshots);
            for (const [prefix, existing] of keysBeforeByPrefix) {
                await removeKeysCreatedSince(context, prefix, existing);
            }
        },
    };
}

/** Names of the keys that differ between two full dumps of one storage area: present in only one, or holding unequal JSON. */
export function differingKeys(before, after) {
    const names = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...names].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

/**
 * Puts both areas back to `snapshot` (a full `{ local, sync }` dump from `readBothAreas(context, null)`): drifted keys are set back, keys absent from the snapshot are removed.
 * Sync goes first and local right after inside one worker call, for the same reason as `restoreBothAreas`; only drifted keys are written, so an area already equal to its snapshot costs no write.
 */
export async function restoreFullSnapshot(context, snapshot) {
    await evaluateInWorker(context, async (saved) => {
        for (const areaName of ['sync', 'local']) {
            const current = await chrome.storage[areaName].get(null);
            const names = new Set([...Object.keys(current), ...Object.keys(saved[areaName])]);
            const drifted = [...names].filter((key) => JSON.stringify(current[key]) !== JSON.stringify(saved[areaName][key]));
            const toSet = Object.fromEntries(drifted.filter((key) => key in saved[areaName]).map((key) => [key, saved[areaName][key]]));
            const toRemove = drifted.filter((key) => !(key in saved[areaName]));
            if (Object.keys(toSet).length > 0) await chrome.storage[areaName].set(toSet);
            if (toRemove.length > 0) await chrome.storage[areaName].remove(toRemove);
        }
    }, snapshot);
}
