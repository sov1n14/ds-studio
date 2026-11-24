/**
 * chrome.storage change-event doubles shared by content-script scenarios that load content-script.js themselves (overlay-consistency-harness.js imports it statically, so a spec that needs a fresh instance cannot import the harness).
 */
import { isDeepStrictEqual } from 'node:util';

// Plays background/settings-routes.js: every committed storage change reaches the content script as DSS_SETTINGS_CHANGED.
export const relaySettingsChanged = (changes, area) => {
    chrome.runtime.onMessage.callListeners({ type: 'DSS_SETTINGS_CHANGED', area, changes }, {}, () => {});
};

// Real Chrome onChanged semantics (verified in Chrome 156, local and sync): wraps both areas so an event lists only the keys whose value changed and a write that changes nothing fires no event; returns the restore.
export function silenceUnchangedWrites() {
    const areas = [chrome.storage.local, chrome.storage.sync];
    const originals = areas.map((area) => area._notify);
    areas.forEach((area, i) => {
        area._notify = (changes, areaName) => {
            const changed = Object.fromEntries(Object.entries(changes).filter(([, c]) => !isDeepStrictEqual(c.oldValue, c.newValue)));
            if (Object.keys(changed).length > 0) originals[i].call(area, changed, areaName);
        };
    });
    return () => areas.forEach((area, i) => { area._notify = originals[i]; });
}
