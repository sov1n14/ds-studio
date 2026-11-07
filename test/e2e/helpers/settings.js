// Seeds extension settings in chrome.storage.local through the service worker and restores them.
// The service worker broadcasts DSS_SETTINGS_CHANGED for local changes, so open pages react live;
// pages opened afterwards read the seeded values at load.

import { evaluateInWorker } from './extension.js';

/** Writes `values` into chrome.storage.local without any snapshot (caller owns restoration). */
async function setLocal(context, values) {
    await evaluateInWorker(context, (payload) => chrome.storage.local.set(payload), values);
}

/** Reads `keys` from both storage areas; absent keys are absent from each returned object. */
async function readBothAreas(context, keys) {
    return evaluateInWorker(context, async (list) => ({
        local: await chrome.storage.local.get(list),
        sync: await chrome.storage.sync.get(list),
    }), keys);
}

/**
 * Restores `keys` of `area` to `snapshot`: present keys are set, absent keys removed.
 * Sync is rewritten only where it drifted, so restoration never adds sync traffic of its own.
 */
async function restoreArea(context, area, keys, snapshot) {
    await evaluateInWorker(context, async ({ areaName, list, saved }) => {
        const storage = chrome.storage[areaName];
        const current = await storage.get(list);
        const drifted = list.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(saved[key]));
        const toSet = {};
        const toRemove = [];
        drifted.forEach((key) => {
            if (key in saved) toSet[key] = saved[key];
            else toRemove.push(key);
        });
        if (Object.keys(toSet).length > 0) await storage.set(toSet);
        if (toRemove.length > 0) await storage.remove(toRemove);
    }, { areaName: area, list: keys, saved: snapshot });
}

/**
 * Creates a settings session: `set()` snapshots every key on its first touch, then writes local;
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
        async restore() {
            if (touched.size === 0) return;
            const keys = [...touched];
            await restoreArea(context, 'local', keys, snapshots.local);
            await restoreArea(context, 'sync', keys, snapshots.sync);
        },
    };
}
