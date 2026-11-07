// Seeds extension settings in chrome.storage.local through the service worker and restores them.
// The service worker broadcasts DSS_SETTINGS_CHANGED for local changes, so open pages react live;
// pages opened afterwards read the seeded values at load.

import { evaluateInWorker } from './extension.js';

/** Writes `values` into chrome.storage.local without any snapshot (caller owns restoration). */
async function setLocal(context, values) {
    await evaluateInWorker(context, (payload) => chrome.storage.local.set(payload), values);
}

/** Writes `values` into chrome.storage.sync, then local, so a sync-first reader and the local broadcast agree. */
async function setBothAreas(context, values) {
    await evaluateInWorker(context, async (payload) => {
        await chrome.storage.sync.set(payload);
        await chrome.storage.local.set(payload);
    }, values);
}

/** Reads `keys` from both storage areas; absent keys are absent from each returned object. */
async function readBothAreas(context, keys) {
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

/**
 * Creates a settings session: `set()` snapshots every key on its first touch, then writes local;
 * `setInBothAreas()` snapshots the same way but writes sync and local, for synced data (presets) that readers take from sync first;
 * `track()` snapshots keys the extension itself writes during a test, without writing them;
 * `restore()` puts every touched key back in both areas. `isEnabled` is always snapshotted.
 */
export function createSettingsSession(context) {
    const snapshots = { local: {}, sync: {} };
    const touched = new Set();

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
        async restore() {
            if (touched.size === 0) return;
            const keys = [...touched];
            await restoreBothAreas(context, keys, snapshots);
        },
    };
}
